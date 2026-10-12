/**
 * 样式重复分析：把 ROW_CSS 生成的样式表拆成规则，找"声明块几乎一样"的规则组。
 *
 * 为什么要有这个：插件里 30 多个类各自写了一遍背景 / 描边 / 圆角 / 字体，
 * 值相同但**声明分散**。分散的代价不是体积，是**改一处忘一处** —— 上一轮改
 * 圆角时，18px 分布在 4 个不同的规则里，靠人肉 grep 才找全。这个脚本回答的是
 * 「哪些规则其实在说同一件事」。
 *
 * 只读：不写任何文件。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(path.join(REPO, 'lib', 'client.js'), 'utf8');

const start = source.indexOf('const ROW_CSS = [');
const end = source.indexOf("].join('');", start);
if (start < 0 || end < 0) throw new Error('找不到 ROW_CSS');

/**
 * 把源码里的字符串数组拼成真正的样式表文本。
 *
 * 只取单引号字符串字面量，并且跳过纯注释行 —— 注释里也有 `.dshCc_x{...}` 的
 * 例子（比如滚动条那段说明），把它们算进来会凭空多出几条规则。
 * @param body - `const ROW_CSS = [` 到 `].join('')` 之间的源码
 * @returns 样式表文本
 */
function assemble(body) {
	const pieces = [];
	for (const line of body.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.startsWith('//')) continue;
		const match = trimmed.match(/'((?:[^'\\]|\\.)*)'\s*,?\s*$/);
		if (match) pieces.push(match[1].replace(/\\'/g, "'"));
	}
	return pieces.join('');
}

const css = assemble(source.slice(start, end));

// 拆规则：选择器 + 声明块。@media 之类整段跳过（它们是分组，不是规则）。
const rules = [];
const pattern = /([^{}@]+)\{([^{}]*)\}/g;
let match;
while ((match = pattern.exec(css)) !== null) {
	const selector = match[1].trim();
	const declined = match[2].trim();
	if (selector === '' || declined === '') continue;
	rules.push({ selector, declined });
}

/**
 * 把一个声明块拆成声明 Map。属性重复时取最后一条（CSS 的覆盖规则）。
 * @param text - 声明块文本
 * @returns 属性 → 值
 */
function declarationsOf(text) {
	const out = new Map();
	for (const piece of text.split(';')) {
		const at = piece.indexOf(':');
		if (at < 0) continue;
		out.set(piece.slice(0, at).trim(), piece.slice(at + 1).trim());
	}
	return out;
}

const parsed = rules.map(rule => ({ ...rule, declarations: declarationsOf(rule.declined) }));

// ── 1) 哪些属性最常被重复写 ──────────────────────────────────────────────
const perProperty = new Map();
for (const rule of parsed) {
	for (const [property, value] of rule.declarations) {
		const key = property + ':' + value;
		if (!perProperty.has(key)) perProperty.set(key, []);
		perProperty.get(key).push(rule.selector);
	}
}

const repeated = [...perProperty.entries()]
	.filter(([, selectors]) => selectors.length >= 3)
	.sort((a, b) => b[1].length - a[1].length);

console.log('══ 重复次数 ≥3 的声明（值完全相同）══');
for (const [declaration, selectors] of repeated) {
	console.log(`  ×${String(selectors.length).padStart(2)}  ${declaration}`);
	console.log(`        ${selectors.join('  ')}`);
}

// ── 2) 哪些规则整块几乎一样（按声明集合的相似度）────────────────────────
console.log('');
console.log('══ 声明块高度重合的规则（重合 ≥80%）══');
const seen = new Set();
for (let i = 0; i < parsed.length; i += 1) {
	for (let j = i + 1; j < parsed.length; j += 1) {
		const a = parsed[i];
		const b = parsed[j];
		if (a.declarations.size < 4 || b.declarations.size < 4) continue;
		let same = 0;
		for (const [property, value] of a.declarations) {
			if (b.declarations.get(property) === value) same += 1;
		}
		const ratio = same / Math.min(a.declarations.size, b.declarations.size);
		if (ratio < 0.8) continue;
		const key = a.selector + '|' + b.selector;
		if (seen.has(key)) continue;
		seen.add(key);
		const differences = [];
		for (const [property, value] of a.declarations) {
			const other = b.declarations.get(property);
			if (other === undefined) differences.push(property + ' 只有前者');
			else if (other !== value) differences.push(property + ': ' + value + ' ↔ ' + other);
		}
		for (const [property, value] of b.declarations) {
			if (!a.declarations.has(property)) differences.push(property + ' 只有后者: ' + value);
		}
		console.log(`  ${Math.round(ratio * 100)}%  ${a.selector}  ↔  ${b.selector}`);
		console.log(`        差异: ${differences.length === 0 ? '（完全相同）' : differences.join(' | ')}`);
	}
}

console.log('');
console.log(`规则总数 ${parsed.length}，声明条目 ${[...perProperty.keys()].length}，重复声明的组 ${repeated.length}`);
