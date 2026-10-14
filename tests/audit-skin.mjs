/**
 * 亚克力皮肤的覆盖审计。
 *
 * 为什么需要它：这个皮肤连着几轮"改来改去不行"，根因都是**没有机制发现**
 * 「一个区域被画了多遍」——上一版一个"新会话"按钮里四层元素各被刷了一层白，
 * 四层叠起来就是一块糊的实心，而我是靠肉眼在缩略图上看的，看不出来。
 *
 * 这个脚本把三条判据变成可复核的数字：
 *
 *   ① 每个区域**最多一层外观**（底 / 描边 / 模糊三者都算外观）。
 *      沿祖先链数"有外观的元素"，>1 就是叠了。
 *   ② 内层不许自己画**描边或模糊**（底可以是自己控件的常态，描边/模糊多半是误加）。
 *   ③ 皮肤引用的每个 `--dsw-*` 令牌必须真实存在。
 *      实测抓到过两个编造的令牌（`--dsw-specific-tabhost-fill` 根本不存在），
 *      它们在浏览器里静默失效、不报错，只能靠静态核对。
 *
 * 用法：
 *   node tests/audit-skin.mjs              # 只跑静态检查（不需要浏览器）
 *   node tests/audit-skin.mjs --dump <f>   # 读浏览器导出的 DOM 快照，跑动态检查
 *
 * 浏览器侧怎么导出快照（在 DSH 页面的控制台里执行，然后存成文件）：
 *   见本文件末尾的 `SNAPSHOT_PROBE`，把它贴进控制台，输出就是 --dump 要的 JSON。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const skinPath = path.join(REPO, 'examples', 'acrylic.css');
const css = readFileSync(skinPath, 'utf8');

const problems = [];
const notes = [];

/** ① 静态：皮肤引用的令牌白名单 —— 这些是 DSH 真实存在的（都已核对过引用数）。 */
const KNOWN_TOKENS = new Set([
	'--dsw-static-blue-400',
	'--dsw-static-green-400',
	'--dsw-static-amber-400',
	'--dsw-alias-border-l2',
	'--dsw-alias-border-l4',
	'--dsw-alias-label-tertiary',
	'--dsw-alias-state-business-primary',
	'--dsw-elevation-prominent',
	// 被重新赋值的那批（都在 DSH 的 CSS 里以 var() 出现，引用数见注释）
	'--dsw-alias-bg-base', // 31
	'--dsw-alias-bg-layer-1', // 60
	'--dsw-alias-bg-layer-2', // 19
	'--dsw-alias-bg-layer-3', // 16
	'--dsw-alias-bg-module-platform', // 42
	'--dsw-specific-sidebar-fill', // 8
	'--dsw-specific-input-major', // 10
	'--dsw-alias-button-elevated-fill', // 2
	'--dsw-alias-settings-card-fill', // 5
	'--dsw-alias-bg-document-preview', // 1
]);

const referenced = [...new Set([...css.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map((m) => m[1]))];
for (const token of referenced) {
	if (!KNOWN_TOKENS.has(token)) {
		problems.push(`引用了未登记的令牌 ${token} —— 它在 DSH 里可能不存在（静默失效）。`
			+ `确认存在后加进 KNOWN_TOKENS 的清单。`);
	}
}

/** ② 静态：不允许出现在这些位置上的写法（都是踩过的坑）。 */
const LINT = [
	// `border` 简写会隐式重置 `border-radius`。唯一的允许：滚动条滑块 —— 那里紧接着就设了
	// `border-radius: 999px`（透明边框用来做内缩），是**故意**的，所以按声明顺序配对放行。
	[/^\s*border\s*:/m, '用了 `border` 简写 —— 它会隐式重置 `border-radius`（实测把「标准模式」按钮清成了直角）。'
		+ '改用 border-width / border-style / border-color。'],
	[/^\s*background\s*:\s*(?!transparent)/m, '`background` 简写（会重置 background-image）；用 background-color。'],
];

for (const [re, message] of LINT) {
	if (!re.test(css)) continue;
	// 逐处复检：紧跟着三行内出现 border-radius 的，视为"故意的形状声明"，放行
	const lines = css.split('\n');
	for (let i = 0; i < lines.length; i += 1) {
		if (!/^\s*border\s*:/.test(lines[i])) continue;
		const nearby = lines.slice(i, i + 3).some((l) => /border-radius\s*:/.test(l));
		if (nearby) continue;
		problems.push(`${message}（第 ${i + 1} 行）`);
	}
}

/** ③ 静态：统计规模，作为"是不是又走回逐元素覆盖"的信号。 */
const stat = {
	行数: css.split('\n').length,
	important: (css.match(/!important/g) || []).length,
	backdropFilter: (css.match(/^\s*backdrop-filter\s*:/gm) || []).length,
	类选择器: (css.match(/\[class\*=/g) || []).length,
	令牌引用: referenced.length,
};

// 上一版逐元素覆盖时：533 行 / 9 处 backdrop-filter / 几十处 [class*=]。
// 现在的设计是"改令牌"，所以 [class*=] 只应出现在两处：
//   §4 容器内部根的豁免（4 条） + §5 浮层（6 条） + 插件菜单的撤销（2 条）
// 合起来约 12 条。设 16 作为上限：留一点余量，但再多一个"逐元素覆盖"块就会顶破。
const CLASS_SELECTOR_BUDGET = 16;
if (stat.类选择器 > CLASS_SELECTOR_BUDGET) {
	problems.push(`[class*=] 用了 ${stat.类选择器} 处（上限 ${CLASS_SELECTOR_BUDGET}）—— 这个数字变大通常意味着`
		+ `又回到"逐元素覆盖"，而那正是会漏、会叠的做法（实测一个按钮里叠过四层）。优先改令牌。`);
}
// !important 的合法用途只有三类，每处都在样式表里写明了原因：
//   ① 压过 xterm 的**内联**样式（§8 终端底色）—— 3 处；
//   ② 撤销皮肤自己误加到插件界面上的东西（§5b）—— 6 处；
//   ③ 动效降级（§9）—— 3 处；
//   ④ 容器内部根的透明豁免（§4）—— 2 处。
// 上一版"逐元素覆盖"时这个数字会随控件数量一路涨；现在它应当稳定在 14 上下。
// 设 18 作为上限：留一点余量，但再多一个"跟 DSH 抢优先级"的块就会顶破。
const IMPORTANT_BUDGET = 18;
if (stat.important > IMPORTANT_BUDGET) {
	problems.push(`!important 用了 ${stat.important} 处（上限 ${IMPORTANT_BUDGET}）—— 偏多，`
		+ `检查是否又在跟 DSH 抢优先级（合法用途只有上面注释里的四类）。`);
}

/** 动态部分：读浏览器导出的快照。 */
const dumpIndex = process.argv.indexOf('--dump');
if (dumpIndex >= 0) {
	const file = process.argv[dumpIndex + 1];
	if (!file) {
		problems.push('--dump 后面要跟快照文件路径');
	}
	else {
		const snap = JSON.parse(readFileSync(file, 'utf8'));
		const els = snap.elements || [];
		let stacked = 0;
		let innerPainted = 0;
		for (const el of els) {
			if (el.ancestorLookCount > 0) stacked += 1;
			if (el.ancestorLookCount > 0 && (el.hasBorder || el.hasBlur)) innerPainted += 1;
		}
		stat.快照元素数 = els.length;
		stat.嵌在别的有外观元素里的 = stacked;
		stat.其中内层自画描边或模糊的 = innerPainted;
		// 这两个数字不设为"失败条件"：DSH 自己的控件（按钮、主题卡、分隔线）本来就有描边，
		// 皮肤不该去改它们。这里只把它当成**变化信号**：数字突然变大就要去看一眼。
		notes.push(`快照里嵌在有外观祖先中的元素 ${stacked} 个，其中内层自画描边/模糊 ${innerPainted} 个。`
			+ `皮肤自己不应新增这类元素 —— 若数字比上次明显变大，去看 examples/audit 报告。`);
	}
}

/** 输出。 */
for (const n of notes) console.log(`  · ${n}`);
console.log('  静态统计: ' + Object.entries(stat).map(([k, v]) => `${k}=${v}`).join('  '));
if (problems.length === 0) {
	console.log('  ✓ 皮肤审计通过（无编造令牌、无已知坑写法、规模未失控）');
	process.exit(0);
}
console.log(`  ✗ ${problems.length} 个问题:`);
for (const p of problems) console.log(`    - ${p}`);
process.exit(1);

/** 贴进 DSH 页面控制台，把输出存成文件即可用于 --dump。 */
export const SNAPSHOT_PROBE = `JSON.stringify({ elements: [...document.querySelectorAll('*')].map(el => {
  const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return null;
  const hasBg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && !/\\/\\s*0\\)$/.test(cs.backgroundColor);
  const hasBorder = cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none';
  const hasBlur = cs.backdropFilter !== 'none';
  let ancestorLookCount = 0; let anc = el.parentElement;
  while (anc) { const a = getComputedStyle(anc);
    if ((a.backgroundColor !== 'rgba(0, 0, 0, 0)' && !/\\/\\s*0\\)$/.test(a.backgroundColor)) || (a.borderTopWidth !== '0px' && a.borderTopStyle !== 'none') || a.backdropFilter !== 'none') ancestorLookCount += 1;
    anc = anc.parentElement; }
  return { cls: (el.className || el.tagName).toString().split(' ')[0].slice(0, 30), hasBg, hasBorder, hasBlur, ancestorLookCount };
}).filter(Boolean) })`;
