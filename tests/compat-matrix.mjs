#!/usr/bin/env node
/**
 * 跨版本兼容断言（需要网络访问 npm registry；本地与 CI 都可跑）
 *
 * 断言的是本插件真正依赖的平台接口，而不是「插件能不能装」：
 *   1. 我们注册的槽位 settings.general.item 在目标版本的 DSH 客户端包里仍然存在
 *      （做法：npm pack 下该版本的 settings-general 包，解包后在 js 里找该槽名 ——
 *        它是 GeneralSection 渲染的那个 slot，DSH 换代改名时这里会先失败）
 *   2. package.json 里 dsh.client.inject 声明的每个模块 id，在目标版本都存在同版本号的包
 *
 * 这不是运行时证明：真正的加载验证需要起一个对应版本的 DSH 实例
 * （0.1.2-rc.1 与 0.1.5-rc.1 已真机验证，见 README「兼容性」）。
 * 它的定位是**换代门禁** —— 让「槽位改名 / 依赖包被删」在 CI 上先暴露，
 * 而不是等用户看到 `client-modules: require(...) missed the module table`。
 *
 * 用法：
 *   node tests/compat-matrix.mjs                 # 契约里 knownGood + probe + registry 上的最新版
 *   node tests/compat-matrix.mjs 0.1.2-rc.1 ...  # 指定版本
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const contract = JSON.parse(readFileSync(join(root, 'compat.json'), 'utf8'))

// Windows 上 npm 是 .cmd（不能直接 execFile），所以统一用「Node + npm 的 CLI 脚本」调用：
// 既跨平台、又不需要 shell:true（后者在 Node 22+ 会打 deprecation 警告）。
const isWindows = process.platform === 'win32'
const npmCli =
  process.env.npm_execpath && process.env.npm_execpath.endsWith('.js')
    ? process.env.npm_execpath
    : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const TAR = isWindows ? 'tar.exe' : 'tar'

const runNpm = (args, opts = {}) => execFileSync(process.execPath, [npmCli, ...args], opts)

const injectIds = pkg.dsh?.client?.inject ?? []
const slot = contract.slot
const slotPackage = contract.slotPackage

const npmView = (spec) =>
  runNpm(['view', spec, 'version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()

const latestDsh = () => {
  try {
    return npmView('@deepseek-ai/dsh')
  } catch {
    return null
  }
}

const versions = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [...new Set([...(contract.knownGood ?? []), ...(contract.probe ?? []), latestDsh()].filter(Boolean))]

/** 目标版本的客户端包里是否还有我们的槽位。返回 true/false/null（null = 取不到包）。 */
function slotPresent(version) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-compat-'))
  try {
    try {
      runNpm(['pack', `${slotPackage}@${version}`, '--pack-destination', dir, '--silent'], { stdio: 'ignore' })
    } catch {
      return null
    }
    const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'))
    if (!tgz) return null
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
      if (readFileSync(file, 'utf8').includes(slot)) return true
    }
    return false
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const idPresent = (id, version) => {
  try {
    return npmView(`${id}@${version}`) === version
  } catch {
    return false
  }
}

console.log(`槽位        : ${slot}  (位于 ${slotPackage})`)
console.log(`inject ids  : ${injectIds.join(', ') || '(无)'}`)
console.log(`探测版本    : ${versions.join(', ')}\n`)

let failures = 0
for (const version of versions) {
  const slotOk = slotPresent(version)
  const missing = injectIds.filter((id) => !idPresent(id, version))
  const ok = slotOk === true && missing.length === 0
  if (!ok) failures++
  const slotText = slotOk === null ? '包不在 registry' : slotOk ? '在' : '❌ 已不存在'
  console.log(
    `${ok ? '✓' : '✗'} ${version.padEnd(12)} 槽位: ${slotText.padEnd(16)} inject 缺失: ${missing.length ? missing.join(', ') : '无'}`,
  )
}

if (failures) {
  console.log(
    `\n✗ ${failures}/${versions.length} 个版本的平台接口对不上 —— ` +
      'DSH 大概率换代了：请核对 compat.json 的 slot / package.json 的 dsh.client.inject，' +
      '必要时给插件加接口回退，然后更新 compat.json 的 knownGood。',
  )
  process.exit(1)
}
console.log(`\n✓ ${versions.length} 个版本的平台接口全部对得上（槽位存在、inject id 齐全）`)
