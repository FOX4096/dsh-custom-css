#!/usr/bin/env node
/**
 * DSH 换代检查：发现新版本 → 断言接口契约 → 把结果写回文档。
 *
 * 这件事以前是手工的，后果就是文档落后：`compat.json` 还停在 0.1.5-rc.1，而当时的
 * 最新版已经是 0.2.1-alpha.2、本机跑的也已经是 0.2.0-rc.2 —— 契约其实一直通过，
 * 但没人把这个事实写下来，于是「兼容性文档」看起来像没维护过。
 *
 * 三步：
 *   1. 发现：GitHub releases（**包含预发布**，比 npm 的 latest 更早看到信号；这个插件
 *      依赖的正是预发布版本）+ npm registry，两边取并集
 *   2. 断言：对样本版本逐个跑与 `npm run compat` 同一套契约检查（槽位 + inject id）
 *   3. 写回：compat.json 的版本列表与核对时间、README 的验证矩阵
 *
 * 用法：
 *   node tests/update-compat.mjs            只检查并报告（零写入）—— CI 与本地默认
 *   node tests/update-compat.mjs --write    通过则写回 compat.json 与 README
 *   node tests/update-compat.mjs --all      断言每个已发布版本（慢，约 10 分钟）
 *
 * 退出码：0 = 全部通过（或已写回）；1 = 有版本对不上（换代了，需要人工处理）。
 * 「对不上」与「版本不存在」是两件事：后者只报告，不算失败。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(root, 'package.json')
const contractPath = join(root, 'compat.json')
const readmePath = join(root, 'README.md')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const contract = JSON.parse(readFileSync(contractPath, 'utf8'))

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const ALL = args.includes('--all')

/** 没有参数、也不是 --write/--all 时，把它们当版本号（与 compat-matrix 一致）。 */
const explicit = args.filter((a) => !a.startsWith('--'))

const isWindows = process.platform === 'win32'
const npmCli = process.env.npm_execpath && process.env.npm_execpath.endsWith('.js')
  ? process.env.npm_execpath
  : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const TAR = isWindows ? 'tar.exe' : 'tar'
const runNpm = (argv, opts = {}) => execFileSync(process.execPath, [npmCli, ...argv], opts)
const npmView = (spec) => runNpm(['view', spec, 'version'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
}).trim()

const DSH = '@deepseek-ai/dsh'
const REPO = 'FOX4096/dsh-custom-css'

/**
 * 从 GitHub releases 发现 DSH 的版本。
 *
 * 需要的仓库是 DSH 自己的；本插件的仓库只用于比对（下面 REPO 常量是给说明用的）。
 * 注意 GitHub 可能因为本地代理证书或 hosts 拦截而不可达 —— 那是**环境问题不是代码问题**，
 * 所以这里失败就安静地返回空数组，由 npm 那一路兜住，并在报告里注明用的是哪一路信号。
 */
async function versionsFromGitHub() {
  const targets = ['deepseek-ai/dsh', 'deepseek-ai/DeepSeek-Harness']
  const found = []
  for (const repo of targets) {
    for (const endpoint of ['releases?per_page=30', 'tags?per_page=30']) {
      try {
        const response = await fetch(`https://api.github.com/repos/${repo}/${endpoint}`, {
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-custom-css-compat' },
          signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) continue
        const list = await response.json()
        if (!Array.isArray(list)) continue
        for (const entry of list) {
          const name = entry.tag_name ?? entry.name ?? ''
          const match = /(\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?)/i.exec(String(name))
          if (match !== null) found.push(match[1])
        }
      }
      catch {
        // 不可达 —— 交给 npm 那一路，报告里会说清楚
      }
    }
  }
  return [...new Set(found)]
}

async function versionsFromNpm() {
  try {
    const response = await fetch(`https://registry.npmjs.org/${DSH.replace('/', '%2F')}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) return []
    const json = await response.json()
    return Object.keys(json.versions ?? {})
  }
  catch {
    return []
  }
}

/** 版本排序：按数字段比较，预发布后缀按字符串比较。 */
function compareVersions(left, right) {
  const parse = (v) => {
    const [core, pre = ''] = String(v).split('-')
    return { parts: core.split('.').map(Number), pre }
  }
  const a = parse(left)
  const b = parse(right)
  for (let i = 0; i < 3; i += 1) {
    if ((a.parts[i] ?? 0) !== (b.parts[i] ?? 0)) return (a.parts[i] ?? 0) - (b.parts[i] ?? 0)
  }
  // 有预发布后缀的在前（0.2.0-rc.1 < 0.2.0）
  if (a.pre === b.pre) return 0
  if (a.pre === '') return 1
  if (b.pre === '') return -1
  return a.pre < b.pre ? -1 : 1
}

const slotPresent = (version) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-compat-'))
  try {
    try {
      runNpm(['pack', `${contract.slotPackage}@${version}`, '--pack-destination', dir, '--silent'], { stdio: 'ignore' })
    }
    catch {
      return null
    }
    const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'))
    if (tgz === undefined) return null
    execFileSync(TAR, ['-xzf', join(dir, tgz), '-C', dir], { stdio: 'ignore' })
    const walk = (d, out = []) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name)
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.(js|mjs|cjs)$/.test(name)) out.push(p)
      }
      return out
    }
    for (const file of walk(join(dir, 'package'))) {
      if (readFileSync(file, 'utf8').includes(contract.slot)) return true
    }
    return false
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const idPresent = (id, version) => {
  try {
    return npmView(`${id}@${version}`) === version
  }
  catch {
    return false
  }
}

/**
 * 要断言的版本集。
 *
 * 默认取**最近的一批**而不是全部：每个版本都要 `npm pack` 一次，31 个版本约十分钟，
 * 而契约一旦在某一代通过，更早的版本不会因为新版本发布而失效 —— 所以值得反复核的是
 * 最近的边界。真机验证过的版本永远包含在内（那是文档里最强的一档证据）。
 */
function chooseVersions(published) {
  if (explicit.length > 0) return explicit
  const sorted = [...published].sort(compareVersions)
  if (ALL) return sorted
  const anchors = contract.runtimeVerified ?? []
  const recent = sorted.slice(-6)
  return [...new Set([...anchors, ...recent])].sort(compareVersions)
}

const fromGitHub = await versionsFromGitHub()
const fromNpm = await versionsFromNpm()
const signalParts = []
signalParts.push(fromGitHub.length > 0 ? `GitHub releases(${fromGitHub.length})` : 'GitHub 不可达')
signalParts.push(fromNpm.length > 0 ? `npm(${fromNpm.length})` : 'npm 不可达')
const published = [...new Set([...fromNpm, ...fromGitHub])]
if (published.length === 0) {
  console.log('✗ 两路信号都拿不到 DSH 版本 —— 网络不可用？')
  process.exit(1)
}

const versions = chooseVersions(published)
const newest = [...published].sort(compareVersions).at(-1)

console.log(`信号源      : ${signalParts.join(' + ')}`)
console.log(`已发布版本  : ${published.length} 个，最新 ${newest}`)
console.log(`本次断言    : ${versions.length} 个 — ${versions.join(', ')}\n`)

const results = []
for (const version of versions) {
  const slotOk = slotPresent(version)
  const missing = (pkg.dsh?.client?.inject ?? []).filter((id) => !idPresent(id, version))
  const unavailable = slotOk === null && missing.length === (pkg.dsh?.client?.inject ?? []).length
  const ok = slotOk === true && missing.length === 0
  results.push({ version, ok, unavailable, slotOk, missing })
  if (unavailable) {
    console.log(`· ${version.padEnd(14)} 未发布到 registry —— 无从断言，跳过`)
    continue
  }
  console.log(
    `${ok ? '✓' : '✗'} ${version.padEnd(14)} 槽位: ${(slotOk === true ? '在' : String(slotOk)).padEnd(8)} inject 缺失: ${missing.length ? missing.join(', ') : '无'}`,
  )
}

const checked = results.filter((r) => !r.unavailable)
const failed = checked.filter((r) => !r.ok)
const passed = checked.filter((r) => r.ok)

if (failed.length > 0) {
  console.log(`\n✗ ${failed.length}/${checked.length} 个版本对不上：${failed.map((r) => r.version).join(', ')}`)
  console.log('  DSH 换代了 —— 请核对 compat.json 的 slot 与 package.json 的 dsh.client.inject，')
  console.log('  必要时给插件加接口回退，然后重跑本脚本。文档**不会**被自动改写。')
  process.exit(1)
}

console.log(`\n✓ ${passed.length} 个版本全部通过`)

if (!WRITE) {
  console.log('（只检查，未写入。要更新文档请加 --write）')
  process.exit(0)
}

/**
 * 今天的日期，本地时区。
 *
 * 不用 `toISOString().slice(0, 10)`：那是 UTC，在 UTC+8 上会把本地凌晨 0 点到 8 点的
 * 运行记成前一天，而这句话是写给读者看的（「上次核对：…」），读者按自己的日历读。
 */
function localToday() {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
}

// ── 写回：compat.json 与 README ────────────────────────────────────────────
const today = localToday()
const passing = passed.map((r) => r.version)
const realMachine = contract.runtimeVerified ?? []
// knownGood 是**累积**的，不是「本次测过的那些」。
//
// 第一版把它整个覆盖成 passing，于是在样本之外的版本会从记录里掉出去 —— 实测：
// 它一度只剩 8 个版本，连 README 散文里一直写着的 0.0.1-rc.5 都不在里面了。
// 契约断言有个性质：某个版本通过过一次就是通过过，不会因为后来出了新版本而失效。
// 所以这里取并集，`probe` 只记录**本次**实际断言过的（那是「这次的证据」）。
const knownGood = [...new Set([...(contract.knownGood ?? []), ...passing])].sort(compareVersions)
const probeOnly = passing.filter((v) => !realMachine.includes(v))

const nextContract = {
  ...contract,
  lastChecked: today,
  lastCheckedNewest: newest,
  knownGood,
  probe: probeOnly,
  notes: [
    ...(contract.notes ?? []).filter((n) => !n.startsWith('上次自动核对')),
    `上次自动核对 ${today}：最新已发布版本 ${newest}，本次断言 ${passing.length} 个版本全部通过`
      + `（由 tests/update-compat.mjs 写入）。knownGood 是累积的：某个版本通过过一次即保留。`,
  ],
}
writeFileSync(contractPath, `${JSON.stringify(nextContract, null, 2)}\n`, 'utf8')

// README 的验证矩阵：真机那一档永远排在前面（证据更强），其余合并成一行。
//
// 真机那一档的「验证方式」从 compat.json 的 runtimeVerifiedNotes 里读，不由脚本自己编：
// 这里原本写死「真机运行（本仓库开发环境）」，第一次写回就把 0.1.2-rc.1 那行**具体做过什么**
// （独立 DSH_HOME 起实例、三个接口都 200、文件确实落盘）压成了一句泛话 —— 那是不该丢的
// 细节，它是「真机验证过」这句话唯一有分量的部分。
const notes = contract.runtimeVerifiedNotes ?? {}
const realRows = realMachine
  .filter((v) => passing.includes(v))
  .map((v) => `| \`${v}\` | ${notes[v] ?? '真机运行（本仓库开发环境）'} | 通过 |`)
// 契约断言那一行：一行里塞 31 个版本没人读得下去（全量跑一次之后就是这样）。
// 只列首尾并给出总数，完整清单留在 compat.json 的 knownGood —— 那里是权威、
// 也是机器读的地方；README 这一行是给人看的，要能一眼读完。
//
// 30 个以内就全列：早期版本少的时候整列是有用的（能看出具体覆盖了哪几个）。
const PROBE_INLINE_LIMIT = 12
const probeText = knownGood.length <= PROBE_INLINE_LIMIT
  ? knownGood.map((v) => `\`${v}\``).join(' / ')
  : `\`${knownGood[0]}\` ~ \`${knownGood[knownGood.length - 1]}\`（共 ${knownGood.length} 个）`
const probeLine = knownGood.length > 0
  ? `| ${probeText} | 接口契约断言（\`npm run compat\` 解包该版本的 settings 包，核对槽位与 id） | 通过 |`
  : null
const table = [
  '| DSH 版本 | 验证方式 | 结论 |',
  '| --- | --- | --- |',
  ...realRows,
  ...(probeLine === null ? [] : [probeLine]),
].join('\n')

/**
 * README 里三处「支持到哪个 DSH 版本」的说法，以及那颗 DSH 徽章。
 *
 * 这三处原本写死成 `0.1.2-rc.1 ~ 0.1.5-rc.1`，而矩阵早就扩到 0.2.1-alpha.2 了 ——
 * 换而言之**读者看到的是过期了三个月的支持范围**（本机跑的 0.2.0-rc.2 都不在里面）。
 * 写死的东西会腐烂，所以它们和矩阵一起由这里维护。
 *
 * 措辞刻意区分两档证据，因为它们的强度不同：真机跑过的是「runtime verified」，
 * 只做过接口契约断言的是「contract tested」——把后者说成前者是虚假宣传。
 */
// 真机验证过的版本，按版本号升序。`runtimeVerified` 数组本身是「新→旧」的书写顺序，
// 直接取首尾会得到 `0.1.5 ~ 0.1.2` 这种倒着的范围（第一版就是这么写的）。
const realSorted = [...realMachine].sort(compareVersions)
const realRange = realSorted.length > 0
  ? `\`${realSorted[0]}\` ~ \`${realSorted[realSorted.length - 1]}\``
  : '（无）'
// 断言覆盖的范围：用**累积**的 knownGood，而不是本次样本。
//
// 徽章原先只写「真机验证过的那两个版本」，看起来像只支持 0.1.2 ~ 0.1.5 —— 而实际上
// 大部分版本是自动化契约断言跑过的（0.0.1-rc.1 到 0.2.1-alpha.2 都在其中）。
// 那才是这个徽章该传达的信息。
const assertedSorted = knownGood
const assertedRange = assertedSorted.length > 0
  ? `\`${assertedSorted[0]}\` ~ \`${assertedSorted[assertedSorted.length - 1]}\``
  : '（无）'
const assertedShort = assertedSorted.length > 0
  ? `${assertedSorted[0]} ~ ${assertedSorted[assertedSorted.length - 1]}`
  : 'unknown'
// 静态徽章的语法里 `-` 是分段符，正文里的连字符必须写成 `--`；`_` 表示空格。
// 第一版直接写了 `0.1.5-rc.1_%7E_...`，shields.io 返回 404（实测），
// 而 `--` 形式的 `0.1.2--0.1.5` 实测渲染为 `0.1.2-0.1.5`。
const badgeRange = assertedSorted.length > 0
  ? `${assertedSorted[0].replace(/-/g, '--')}_${assertedSorted[assertedSorted.length - 1].replace(/-/g, '--')}`
  : 'unknown'
const badge = `<a href="https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions">`
  + `<img alt="支持的 DSH 版本：${assertedShort}（接口契约断言，${assertedSorted.length} 个版本）；`
  + `其中 ${realSorted.join(' 与 ')} 已真机验证" `
  + `src="https://img.shields.io/badge/DSH-${badgeRange}_%28asserted%29-4d6bfe"></a>`
const lineCompat = `- 兼容：DSH ${realRange} 已真机验证；接口契约断言覆盖 ${assertedRange}`
  + `（共 ${assertedSorted.length} 个版本）；\`npm run compat\` 可复跑（见「兼容性」）`
const linePrereq = `**前置**：DSH ${realRange}（**已真机验证**；接口契约断言覆盖 ${assertedRange}，见「兼容性」），`
  + 'Node.js ≥ 20、pnpm ≥ 10。'

/**
 * 把这三处替换掉。
 *
 * 用「行首特征 + 到行尾」的整行替换，而不是替换句子中间那一小段：这三行的后半句各不相同，
 * 也只差几个字，按小段替换很容易在多行里串味。整行替换的锚点各自唯一。
 */
function replaceLines(text, replacements) {
  const lines = text.split('\n')
  const seen = new Set()
  for (let index = 0; index < lines.length; index += 1) {
    for (const rule of replacements) {
      if (lines[index].startsWith(rule.startsWith)) {
        lines[index] = rule.to
        seen.add(rule.startsWith)
      }
    }
  }
  return { text: lines.join('\n'), missing: replacements.filter((r) => !seen.has(r.startsWith)) }
}
const VERSION_LINES = [
  { startsWith: '  <a href="https://www.npmjs.com/package/@deepseek-ai/dsh', to: `  ${badge}<br /><br />` },
  { startsWith: '- 兼容：DSH ', to: lineCompat },
  { startsWith: '**前置**：DSH ', to: linePrereq },
]

const readme = readFileSync(readmePath, 'utf8')
const matrixPattern = /(### 验证矩阵\n\n)(?:\|[^\n]*\n)+(?=\n)/
if (!matrixPattern.test(readme)) {
  console.log('✗ README 里找不到「### 验证矩阵」表格 —— 不改写，请人工核对')
  process.exit(1)
}
// 这一段是**受管理的**：先把本脚本上一次留下的说明行整段删掉，再插入新的一份。
//
// 第一版不是这样，它去找一句固定的原句做锚点、把说明插在它后面 —— 而那一句在第一轮之后
// 就不再唯一可辩，于是每跑一次就多插一份。定时任务每 6 小时跑一次，README 会稳定地每 6
// 小时长两行，直到没人看得下去。删后插才是幂等的写法。
const STAMP_START = '上表由 `npm run compat:update` 自动维护'
const STAMP_END = '**上次核对：'
const anchor = '`npm run compat` 需要网络（要拉各版本的包），所以本地 `npm test` 保持离线可跑；CI 里单跑一档。'
const stamp = `${STAMP_START}（GitHub Actions 每 6 小时检查一次 DSH 是否更新，`
  + '有新版本就重新断言并提交这一节）。'
  + `**上次核对：${today}，当时最新已发布版本 \`${newest}\`。**`

/**
 * README 的写回，纯函数：同样的输入永远得到同样的输出。
 *
 * 做成纯函数是为了能在写盘前**自检幂等**（见下面）。这一步不是洁癖：这个脚本每 6 小时被
 * 定时任务调用一次，任何一点不确定性都会变成每 6 小时一次的噪音提交，而「多一个空行」这种
 * 错误不会报错、只会让文件慢慢长胖 —— 实测抓到过两次：一次是说明段被重复追加（第一轮之后
 * 锚点不再唯一），一次是每次多留一个空行。两次都不是崩掉的，都是静静长胖的。
 */
function renderReadme(text, quiet = false) {
  if (!matrixPattern.test(text)) return null
  if (!text.includes(anchor)) return null
  // 删掉本脚本上一次留下的说明行，再插入新的一份：删后插才是幂等的写法
  const withoutStamp = text
    .split('\n')
    .filter((line) => !(line.startsWith(STAMP_START) && line.includes(STAMP_END)))
    .join('\n')
  const withMatrix = withoutStamp.replace(matrixPattern, `$1${table}\n`)
  // 「支持到哪个 DSH 版本」的三处提及，整行替换。
  //
  // 锚点找不到时**告警而不是静默跳过**：那说明 README 被改过（措辞变了、那行被挪走），
  // 而这三处正是读者判断兼容范围的地方。静默不更新等于文档继续过期，而脚本照样打印
  // 「已写回」—— 那比不写还糟，因为它让人以为已经更新了。
  const { text: withVersions, missing } = replaceLines(withMatrix, VERSION_LINES)
  // 只在真正的第一次渲染时告警：不动点自检会再渲染一遍，否则同一句会打印两次。
  if (missing.length > 0 && !quiet) {
    console.log(`⚠ README 里有 ${missing.length} 处版本提及没找到锚点，未更新：`)
    for (const rule of missing) console.log(`    ${rule.startsWith}…`)
  }
  // 锚点行之后原本是「一个空行 + 段落」，所以先吃掉锚点后面的空行再补回两个 `\n`：
  // 写成不吃掉原有空行的版本，每次运行就多留一个空行（实测 385 → 386 行，每跑一次长一行）。
  return withVersions.replace(
    new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n+'),
    `${anchor}\n\n${stamp}\n\n`,
  )
}

const currentReadme = readFileSync(readmePath, 'utf8')
const rendered = renderReadme(currentReadme)
if (rendered === null) {
  console.log('✗ README 里找不到「### 验证矩阵」表格或说明锚点 —— 不改写，请人工核对')
  process.exit(1)
}
// 自检：一路渲染到不动点，必须在**第一步**就停住。
//
// 只比一次「渲染前 vs 渲染后」是不够的，这一点实测过：把「锚点后多留一个空行」那个 bug
// 放回去，单次比对看不到差异（渲染一次的结果看起来正常），而它每次运行都多长一行 ——
// 385 → 386 → 387…，跑到第三次才暴露。所以这里迭代到不动点，并要求它一次就收敛。
let settled = rendered
let steps = 1
while (steps <= 5) {
  const next = renderReadme(settled, true)
  if (next === settled) break
  settled = next
  steps += 1
}
if (steps !== 1) {
  console.log(`✗ 自检失败：README 写回要 ${steps} 步才稳定（应当一步就到不动点）—— 不写盘`)
  process.exit(1)
}
writeFileSync(readmePath, rendered, 'utf8')

// 报累积数而不是本次通过数：这行日志原先写 `${passing.length}`，于是全量跑完写入了 31 个，
// 它却报「knownGood 8 个」（那是本次样本的数目）—— 一个会让人误判写入结果的日志，
// 比没有日志更糟。
console.log(`\n✓ 已写回：compat.json（knownGood 累积 ${knownGood.length} 个、本次断言 ${passing.length} 个、lastChecked ${today}）与 README 的验证矩阵`)
