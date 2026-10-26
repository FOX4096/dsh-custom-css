/**
 * 无障碍审计：找出"名字只来自 title"的控件。
 *
 * **这是近似判据，不是测量。** 静态看不出渲染后的可访问名 —— 一个控件只要有内容文字，
 * 它的可访问名就来自那些文字，不需要 aria-label。下面的规则试图把这层排除掉，但做不到
 * 精确：令牌 chip 的文字是运行时才有的，从源码窗口里看不出来。
 *
 * 所以**权威的检查是在浏览器里数可访问名**（实际渲染后的面板）。这一轮就是那样测的：
 * 面板上 5 个按钮都有名，而 range 滑块只靠 title 才被抓出来 —— 那一条是真缺口，已修。
 * 这个脚本的定位是**快筛**：便宜、能进 CI、而且真的抓到过东西（滑块、以及它自己只扫
 * React 按钮的盲区）。剩下的已知假阳性列在下面的白名单里，附理由。
 *
 * 两种建法都要扫：原先只匹配 `React.createElement('button', …)`，而拾取器那一整块
 * （面板的四个按钮、候选行、令牌 chip）是用 `chrome('button', …)` 建的 —— 它们从来没被
 * 扫过。脚本因此一直报「0 处」，其中一部分是**假阴性**：给 --enforce 做反向验证时注入了
 * 一个只有 title 的按钮，脚本依然说 0 处，才发现这一点。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 默认只报告、不改退出码：这个脚本是给人看的快筛，本地跑一次不该让 shell 红。
// 但 CI 需要一道门禁 —— 一个"只打印、永远退出 0"的检查在流水线里等于不存在。
const ENFORCE = process.argv.includes('--enforce');

/**
 * 已知假阳性：名字来自运行时才有的内容文字，静态看不出来。
 * 每条都写清理由 —— 白名单条目本身就是"这条判据在这里不适用"的记录。
 */
const KNOWN_CONTENT_NAMED = [
	// 令牌 chip：它的可访问名是内部那行 `color: var(--dsw-alias-…)`，完全合法；
	// title 只是补充说明。在浏览器里量过，内容文字就是它的名字。
	'entry.property',
	// 画布提示里那个「换成棋盘看」：文字是 `t('preview.glassTry')`，静态看不出是字符串
	// （判据只认字面量实参）。它在渲染出来的面板上是被读到的可见文字，名字不缺。
	'preview.glassTryTitle',
];

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(path.join(REPO, 'lib', 'client.js'), 'utf8');
const lines = source.split('\n');

/** 建一个需要可访问名的控件：React 元素，或拾取器手动建的 chrome 节点。 */
const CONTROL_BUILDER = /createElement\(\s*'(button|input)'|chrome\(\s*'(button|input)'/;

/**
 * 往下看多远。
 *
 * 原先是一个固定的 18 行，既太宽又太窄：太宽是因为按钮后面跟着拾取器的 range 滑块时，
 * 会把**滑块的** title 算到这个按钮头上（当时 4 条命中里有 2 条就是这种）；太窄是因为
 * 没有任何东西把它限定在"这个控件自己"的范围里。停在下一个控件开头，是这件事的廉价版。
 */
const MAX_WINDOW = 14;

const flagged = [];
for (let index = 0; index < lines.length; index += 1) {
	if (!CONTROL_BUILDER.test(lines[index])) continue;

	let end = Math.min(lines.length, index + MAX_WINDOW);
	for (let probe = index + 1; probe < end; probe += 1) {
		if (CONTROL_BUILDER.test(lines[probe])) {
			end = probe;
			break;
		}
	}
	const chunk = lines.slice(index, end).join('\n');

	// props 里的 `title:`，或 chrome 节点上的 `x.title =`
	const hasTitle = chunk.includes('title:') || /\.title\s*=/.test(chunk);
	const hasAriaLabel = chunk.includes("'aria-label'") || /setAttribute\(\s*'aria-label'/.test(chunk);
	if (!hasTitle || hasAriaLabel) continue;

	// 自带可见文字的控件不需要 aria-label —— 可访问名就是那段文字。能静态看出的形态：
	// chrome 的第三个实参是字符串字面量，或 React 的第三个实参是字符串。
	const head = lines[index];
	const chromeText = /chrome\(\s*'(?:button|input)'\s*,\s*'[^']*'\s*,\s*'/.test(head);
	const reactText = /createElement\(\s*'(?:button|input)'\s*,\s*\{[^}]*\}\s*,\s*'/.test(head);
	if (chromeText || reactText) continue;

	const title = (chunk.match(/title:\s*([^\n]+)/) ?? [])[1]
		?? (chunk.match(/\.title\s*=\s*([^\n;]+)/) ?? [])[1]
		?? '?';
	const label = title.trim().slice(0, 60);
	if (KNOWN_CONTENT_NAMED.some(known => label.includes(known))) continue;

	flagged.push({ line: index + 1, title: label });
}

console.log('══ 名字只来自 title 的控件 ══');
for (const entry of flagged) console.log(`  ${String(entry.line).padStart(5)}  ${entry.title}`);
console.log(`共 ${flagged.length} 处`);

if (ENFORCE && flagged.length > 0) {
	console.error(`\n::error::有 ${flagged.length} 个控件的名字只来自 title —— 助手技术可能念成"按钮"并丢掉提示`);
	process.exit(1);
}
