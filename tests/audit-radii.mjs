/**
 * 圆角审计：把生成的样式表里每条 `border-radius` 连它的选择器一起列出来。
 *
 * 为什么要看选择器而不是只看值：批次 A 只负责"36px/28px 控件"那一批，菜单容器
 * （20px）、菜单项（10px）、补全列表（7px）属于后续批次。只按值判断会把两批混在
 * 一起 —— 而值脱离了角色本来就没有意义。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(path.join(REPO, 'lib', 'client.js'), 'utf8');

const start = source.indexOf('const ROW_CSS = [');
const end = source.indexOf("].join('');", start);

const pieces = [];
for (const line of source.slice(start, end).split('\n')) {
	const trimmed = line.trim();
	if (trimmed.startsWith('//')) continue;
	const match = trimmed.match(/'((?:[^'\\]|\\.)*)'\s*,?\s*$/);
	if (match) pieces.push(match[1].replace(/\\'/g, "'"));
}
const css = pieces.join('');

// 选择器可能横跨多条字符串（规则被拆行写），所以按 `}` 切块而不是按行。
const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(match => ({
	selector: match[1].trim().replace(/\s+/g, ' '),
	body: match[2],
}));

const rows = [];
for (const rule of rules) {
	for (const found of rule.body.matchAll(/border-radius:([^;]+)/g)) {
		rows.push({ selector: rule.selector, value: found[1].trim() });
	}
}

const literal = rows.filter(row => !row.value.includes('--dsw-radius'));
const token = rows.filter(row => row.value.includes('--dsw-radius'));

console.log(`══ 已用令牌（${token.length} 处）══`);
for (const row of token) console.log(`  ${row.value.padEnd(30)} ${row.selector.slice(0, 58)}`);

console.log('');
console.log(`══ 仍是字面量（${literal.length} 处）══`);
for (const row of literal) console.log(`  ${row.value.padEnd(8)} ${row.selector.slice(0, 24).padEnd(26)} ${row.selector.slice(24, 76)}`);

console.log('');
const byValue = new Map();
for (const row of literal) byValue.set(row.value, (byValue.get(row.value) ?? 0) + 1);
console.log('字面量汇总:', [...byValue.entries()].map(([v, n]) => `${v}×${n}`).join('  '));
