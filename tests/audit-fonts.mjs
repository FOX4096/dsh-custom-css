/**
 * 字体审计：把样式表里每一处写死的字号 / 行高连它的规则名一起列出来，
 * 并给出"这一处在 DSH 的哪一档令牌上"。
 *
 * 为什么必须看上下文：`font-size` 与 `line-height` 写在一起时应该整体换成一条
 * 字体令牌（`font: var(--dsw-font-xxs-12)`），但如果两者分散在不同声明里、或者
 * 单独出现，就不能这么换 —— 只按数字替换会改出行高或字重上的偏差。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(path.join(REPO, 'lib', 'client.js'), 'utf8');

const start = source.indexOf('const ROW_CSS = [');
const end = source.indexOf("].join('');", start);
const lines = source.slice(start, end).split('\n');

// DSH 的字体档位（值 → 令牌）
const LADDER = {
	'11px/14px': 'dsw-font-xxxs-11',
	'12px/18px': 'dsw-font-xxs-12',
	'13px/20px': 'dsw-font-xs-13',
	'14px/22px': 'dsw-font-s-14',
	'11px/16px': '（无对应：11px 配 16px 行高不在档位上）',
	'10px/16px': '（无对应：10px 不在档位上）',
	'12px/16px': '（无对应）',
};

const rows = [];
for (let index = 0; index < lines.length; index += 1) {
	const line = lines[index];
	const selector = line.match(/\.dshCc_[A-Za-z0-9_-]+/)?.[0] ?? '(续行)';
	const sizes = [...line.matchAll(/font-size:(\d+px)/g)].map(m => m[1]);
	const heights = [...line.matchAll(/line-height:(\d+px)/g)].map(m => m[1]);
	if (sizes.length === 0 && heights.length === 0) continue;
	for (const size of sizes) {
		rows.push({ line: index + 1, selector, kind: 'font-size', value: size, heights: heights.join(',') });
	}
	for (const height of heights) {
		rows.push({ line: index + 1, selector, kind: 'line-height', value: height, sizes: sizes.join(',') });
	}
}

console.log('══ 每一处字号 / 行高 ══');
for (const row of rows) {
	const pair = row.kind === 'font-size' && row.heights !== ''
		? `${row.value}/${row.heights}`
		: '';
	const ladder = pair === '' ? '' : `  → ${LADDER[pair] ?? '（不在档位上）'}`;
	console.log(`  ${String(row.line).padStart(3)}  ${row.kind.padEnd(11)} ${row.value.padEnd(6)} ${row.selector.padEnd(24)}${ladder}`);
}

console.log('');
const byValue = new Map();
for (const row of rows) byValue.set(row.kind + ':' + row.value, (byValue.get(row.kind + ':' + row.value) ?? 0) + 1);
console.log('汇总:', [...byValue.entries()].map(([k, n]) => `${k}×${n}`).join('  '));
console.log(`共 ${rows.length} 处`);
