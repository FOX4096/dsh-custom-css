/**
 * `strict` 判定与失败分级的单元测试。
 *
 * 为什么单独一个文件：`judgeStrict` 与 `classifyRun` 是探针里唯一「下结论」的代码，而它们的
 * 分支在真页面上凑不齐 —— 找不到元素、0 面积、布局盒子溢出、滚动容器溢出豁免、单轴豁免、
 * 环境问题 vs 回归，这些里能自然遇到的只有一两种。留证的工作流天天跑，判定逻辑本身却没人测，
 * 那是本末倒置。
 *
 *   node tests/probe-strict-smoke.mjs
 */
import assert from 'node:assert';
import { classifyRun, judgeStrict } from './visual-probe.mjs';

/** 一个「一切正常」的测量结果，各用例只改它的一两个字段。 */
const healthy = {
	selector: '.dshCc_row',
	found: true,
	visible: true,
	overflowX: 0,
	overflowY: 0,
	overflowStyle: { x: 'visible', y: 'visible' },
};

// 1. 正常：没有失败项。
assert.deepStrictEqual(judgeStrict([healthy]), [], '一切正常时不该有失败项');

// 2. 找不到元素 —— 插件没加载，和「没变化」不是一件事。
assert.match(judgeStrict([{ ...healthy, found: false }])[0].reason, /没有这个元素/);

// 3. 占了 0 面积 —— display:none 或被压成 0，测到了也等于没测。
assert.match(judgeStrict([{ ...healthy, visible: false }])[0].reason, /0 面积/);

// 4. 布局盒子溢出：scrollWidth > clientWidth 而它又不是滚动容器，这是真溢出。
assert.strictEqual(judgeStrict([{ ...healthy, overflowX: 12 }]).length, 1);
assert.match(judgeStrict([{ ...healthy, overflowY: 40 }])[0].reason, /纵向 40px/);

// 5. 滚动容器（textarea / overflow:auto）溢出是设计，不是 bug。
assert.deepStrictEqual(
	judgeStrict([{ ...healthy, overflowX: 12, overflowY: 40, overflowStyle: { x: 'auto', y: 'auto' } }]),
	[],
	'滚动容器允许滚动',
);

// 6. 豁免是按轴算的：横向 auto 不代表纵向可以溢出。
const mixedAxis = judgeStrict([{ ...healthy, overflowY: 40, overflowStyle: { x: 'auto', y: 'visible' } }]);
assert.strictEqual(mixedAxis.length, 1, '纵向溢出仍要报出来');
assert.match(mixedAxis[0].reason, /纵向 40px/, '而且是纵向那一轴');

// 7. 多个选择器：一个坏不连累另一个，坏的那个带上自己的选择器名。
const mixed = judgeStrict([healthy, { ...healthy, selector: '.dshCc_editorWrap', overflowX: 3 }]);
assert.deepStrictEqual(mixed.map(entry => entry.selector), ['.dshCc_editorWrap']);

// --- 失败分级：环境问题 ≠ 本插件回归 ----------------------------------------
//
// 这两种红在 CI 邮件里看起来一样，处置却相反：一个要去改探针/跟进 DSH 换代，一个才是本插件
// 真的坏了。分级错了比不分级更浪费人。

// 8. 一切正常。
assert.deepStrictEqual(
	classifyRun({ settingsRequested: true, settingsOpened: true, selectors: [healthy] }),
	{ kind: 'ok', exitCode: 0 },
);

// 9. 要求打开设置，但面板没打开 —— 环境（退出码 2，与人熟知的「命令失败」区分开）。
assert.deepStrictEqual(
	classifyRun({ settingsRequested: true, settingsOpened: false, selectors: [] }),
	{ kind: 'environment', exitCode: 2 },
	'面板没打开就是环境问题，哪怕一个选择器都没量',
);

// 10. 面板开着，但一个选择器都没命中 —— 回归。
assert.deepStrictEqual(
	classifyRun({ settingsRequested: true, settingsOpened: true, selectors: [{ selector: '.dshCc_row', found: false }] }),
	{ kind: 'regression', exitCode: 1 },
);

// 11. 部分命中算正常：个别选择器量不到不说明插件没挂上（`--strict` 会另外把它判死）。
assert.deepStrictEqual(
	classifyRun({ settingsRequested: true, settingsOpened: true, selectors: [healthy, { selector: '.gone', found: false }] }),
	{ kind: 'ok', exitCode: 0 },
);

// 12. 没要求打开设置时，不该把「面板没开」算成环境问题。
assert.deepStrictEqual(
	classifyRun({ settingsRequested: false, settingsOpened: false, selectors: [healthy] }),
	{ kind: 'ok', exitCode: 0 },
);

console.log('probe-strict-smoke: OK — 正常 / 找不到 / 0 面积 / 溢出 / 滚动容器豁免 / 单轴豁免 / 多选择器 / 环境 vs 回归');
