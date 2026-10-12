/**
 * 无障碍审计：找出"只有 title、没有 aria-label"的按钮。
 *
 * 为什么写成脚本（第三次因为 PowerShell 里的引号栽跟头了）：`'aria-label'` 这种带引号的
 * 字面量在 pwsh 的 -e 里要被转义两层，写出来的正则自己先坏掉。
 *
 * 判据：从每个 `createElement('button'` 起往下取若干行，看这段里有没有 title 却没有
 * aria-label。宁可多报也不要漏 —— 假阳性看一眼就能排除，漏掉的会一直存在。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(path.join(REPO, 'lib', 'client.js'), 'utf8');
const lines = source.split('\n');

const WINDOW = 18;
const flagged = [];
for (let index = 0; index < lines.length; index += 1) {
	if (!/createElement\(\s*'button'/.test(lines[index])) continue;
	const chunk = lines.slice(index, index + WINDOW).join('\n');
	const hasTitle = chunk.includes('title:');
	const hasAriaLabel = chunk.includes("'aria-label'");
	// 有可见文字的按钮不需要 aria-label —— 可访问名就是那段文字。这里只关心
	// "既没有 aria-label、又看不出有文字" 的那些，但静态看不出来，所以先把全部报出来。
	if (hasTitle && !hasAriaLabel) {
		const title = (chunk.match(/title:\s*([^\n]+)/) ?? [])[1] ?? '?';
		flagged.push({ line: index + 1, title: title.trim().slice(0, 60) });
	}
}

console.log('══ 只有 title、没有 aria-label 的按钮 ══');
for (const entry of flagged) console.log(`  ${String(entry.line).padStart(5)}  ${entry.title}`);
console.log(`共 ${flagged.length} 处（其中带可见文字的那些不需要 aria-label）`);
