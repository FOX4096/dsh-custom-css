#!/usr/bin/env node
/**
 * 文档巡检：链接完整性 + README 里自动维护的锚点是否还在。
 *
 * 为什么需要它：README 被拆成 docs/ 下十几篇之后，**断链不会报错** —— 点过去 404 才发现。
 * 而更隐蔽的一种是：`tests/update-compat.mjs` 靠 README 里四处的**行首特征**定位要写回的
 * 位置（那颗 DSH 徽章、「- 兼容：DSH 」、「**前置**：DSH 」、`### 验证矩阵` + 表格后的说明段）。
 * 版式一动就可能把某处挪走或改写，于是脚本每 6 小时打印一次「找不到锚点」而没人看 ——
 * 文档从此悄悄过期，这比断链更糟。所以这两件事都做成会让 CI 红的事。
 *
 * 用法：
 *   node tests/audit-docs.mjs              巡检并报告
 *   node tests/audit-docs.mjs --enforce    有问题时退出码 1
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENFORCE = process.argv.includes('--enforce');

/** 只查这些后缀的文档；其余文件（图片、json）不参与链接检查。 */
const DOC_EXT = /\.md$/;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'temp', 'dev']);
const SKIP_FILES = new Set(['CHANGELOG.md']);

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (SKIP_DIRS.has(name)) continue;
		const full = path.join(dir, name);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (DOC_EXT.test(name) && !SKIP_FILES.has(name)) out.push(full);
	}
	return out;
}

const files = walk(REPO);
const problems = [];

/**
 * GitHub 的标题锚点规则，近似版：小写、去 Markdown 标记、**去掉标点（而不是把它变成空格）**、
 * 空格转 `-`，中文保留。
 *
 * 「去掉而不是变空格」这条是踩出来的：写成 `replace(/[^\p{L}\p{N}\s-]/gu, ' ')` 时，
 * `强调显示（规则面板里，选择器字段右侧）` 会被算成 `强调显示-规则面板里-选择器字段右侧`
 * （两个 `-`），而 GitHub 实际生成 `强调显示规则面板里选择器字段右侧`（零个）——
 * 于是巡检报了三个并不存在的断链。中文标点后接中文时不该凭空多出一个分隔符。
 *
 * 做不到与 GitHub 完全一致（它还有重名后缀、emoji 规则等），但足以抓住「标题被改写」这类断链。
 */
const slug = (heading) => heading
	.trim()
	.toLowerCase()
	.replace(/[`*_~]/g, '')
	.replace(/[^\p{L}\p{N}\s-]/gu, '')
	.replace(/\s+/g, '-');

/** 每个文件的标题集合 */
const headingsOf = new Map(
	files.map((file) => {
		const set = new Set(
			readFileSync(file, 'utf8')
				.split('\n')
				.filter((line) => /^#{1,6} /.test(line))
				.map((line) => slug(line.replace(/^#{1,6} /, ''))),
		);
		return [file, set];
	}),
);

// ── ① 链接完整性 ──────────────────────────────────────────────────────────
for (const file of files) {
	const text = readFileSync(file, 'utf8');
	const relative = path.relative(REPO, file);

	// [文本](目标) —— 只看站内链接（跳过 http/https 与纯锚点在这里单独处理）
	for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
		const target = match[1];
		if (/^https?:/i.test(target)) continue;

		const [filePart, anchorPart] = target.split('#');
		if (filePart === '') {
			// 纯锚点：指向本文件内的标题
			if (anchorPart !== undefined && anchorPart !== '' && !headingsOf.get(file).has(anchorPart)) {
				problems.push(`${relative}: 锚点 #${anchorPart} 在本文件里找不到对应标题`);
			}
			continue;
		}

		const resolved = path.resolve(path.dirname(file), decodeURIComponent(filePart));
		let exists = false;
		try {
			exists = statSync(resolved).isFile();
		}
		catch {
			exists = false;
		}
		if (!exists) {
			problems.push(`${relative}: 目标文件不存在 → ${filePart}`);
			continue;
		}
		// 目标文件里的锚点
		if (anchorPart !== undefined && anchorPart !== '' && DOC_EXT.test(resolved)) {
			const targetHeadings = headingsOf.get(resolved) ?? new Set(
				readFileSync(resolved, 'utf8').split('\n')
					.filter((line) => /^#{1,6} /.test(line))
					.map((line) => slug(line.replace(/^#{1,6} /, ''))),
			);
			if (!targetHeadings.has(anchorPart)) {
				problems.push(`${relative}: 锚点 #${anchorPart} 在 ${path.relative(REPO, resolved)} 里找不到对应标题`);
			}
		}
	}
}

// ── ② README 里自动维护的锚点 ────────────────────────────────────────────
const readmePath = path.join(REPO, 'README.md');
const readmeLines = readFileSync(readmePath, 'utf8').split('\n');
const countLines = (predicate) => readmeLines.filter(predicate).length;

const ANCHORS = [
	['DSH 徽章', (line) => line.startsWith('  <a href="https://www.npmjs.com/package/@deepseek-ai/dsh')],
	['概览兼容行', (line) => line.startsWith('- 兼容：DSH ')],
	['安装前置行', (line) => line.startsWith('**前置**：DSH ')],
	['验证矩阵标题', (line) => line === '### 验证矩阵'],
	['表格后说明段', (line) => line.includes('`npm run compat` 需要网络（要拉各版本的包）')],
];
for (const [label, predicate] of ANCHORS) {
	const hits = countLines(predicate);
	if (hits !== 1) {
		problems.push(`README.md: 自动维护锚点「${label}」命中 ${hits} 处（应为 1）—— npm run compat:update 会少改一处`);
	}
}

// ── ③ 每篇 docs 都要被链到 ───────────────────────────────────────────────
//
// ⚠ 只检查**被 git 跟踪**的文档。仓库里允许存在「只留本地、不提交」的笔记
// （例如 `docs/handover.md` 这种交接文档，已在 .gitignore 里）——
// 那些本来就没人链接，报成孤儿文档只会让门槛失去意义。
const docsDir = path.join(REPO, 'docs');
const allText = files.map((file) => readFileSync(file, 'utf8')).join('\n');
const tracked = new Set(
	execFileSync('git', ['ls-files', 'docs'], { cwd: REPO, encoding: 'utf8' })
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => path.basename(line)),
);
for (const name of readdirSync(docsDir).filter((entry) => DOC_EXT.test(entry))) {
	if (!tracked.has(name)) continue;
	// 只要别处提到过这个文件名就算被链到（README 与 docs/index.md 都会链）
	if (!allText.includes(name)) {
		problems.push(`docs/${name}: 没有任何文档链接到它（孤儿文档）`);
	}
}

// ── ④ 别把「版本范围」抄进 docs/ ─────────────────────────────────────────
//
// 为什么禁：DSH 的版本范围（「已真机验证 0.1.2-rc.1 ~ 0.2.0-rc.2」这类）由
// `npm run compat:update` 每 6 小时写回 **README 的验证矩阵** —— 那是唯一的事实来源。
// 抄一份到 docs/ 里就会各自过期，而且**没有任何东西会提醒**：脚本只改 README。
// 与其给每篇文档都加一套锚点，不如禁止抄写，让范围只存在一处。
//
// 这条守卫是拆文档时发现的：`docs/install.md` 真的抄了一份，而且刚抄完就已经和 README
// 用的是同一个值 —— 也就是说它不会在第一次发版时暴露，而是在第二次之后悄悄不一致。
const VERSION_RANGE = /0\.\d+\.\d+(?:-[a-z]+\.\d+)?\s*(?:~|至|到)\s*0\.\d+\.\d+(?:-[a-z]+\.\d+)?/;
for (const file of files) {
	const relative = path.relative(REPO, file);
	// README 就是那个事实来源，跳过
	if (relative === 'README.md') continue;
	const lines = readFileSync(file, 'utf8').split('\n');
	lines.forEach((line, index) => {
		if (VERSION_RANGE.test(line)) {
			problems.push(`${relative}:${index + 1}: 抄了 DSH 版本范围 —— 它只在 README 的验证矩阵里维护，这里请改为链接过去`);
		}
	});
}

// ── ⑤ 示例命令别用真实版本号 ─────────────────────────────────────────────
//
// `add dsh-custom-css@0.2.2` 这种示例会随着每次发版变得过时，读者会以为要照着改。
// 用 `@X.Y.Z` 占位符。（同类问题在 CONTRIBUTING.md 里也修过一次。）
for (const file of files) {
	const relative = path.relative(REPO, file);
	const lines = readFileSync(file, 'utf8').split('\n');
	lines.forEach((line, index) => {
		const match = /dsh-custom-css@(\d+\.\d+\.\d+)/.exec(line);
		if (match !== null && !line.includes('github:')) {
			problems.push(`${relative}:${index + 1}: 命令示例里写死了插件版本 ${match[1]} —— 请用 @X.Y.Z 占位符`);
		}
	});
}

// ── 报告 ─────────────────────────────────────────────────────────────────
console.log(`══ 文档巡检（${files.length} 个 markdown 文件）══`);
if (problems.length === 0) {
	console.log('  ✓ 链接完整、README 锚点齐全、没有孤儿文档、没有抄来的版本范围');
}
else {
	for (const problem of problems) console.log(`  ✗ ${problem}`);
	console.log(`\n  共 ${problems.length} 个问题`);
}
if (ENFORCE && problems.length > 0) {
	console.error('\n::error::文档巡检未通过（断链 / README 锚点丢失 / 孤儿文档）');
	process.exit(1);
}
