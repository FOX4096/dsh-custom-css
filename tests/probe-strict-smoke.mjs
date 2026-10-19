/**
 * `strict` 判定的单元测试。
 *
 * 为什么单独一个文件：`judgeStrict` 是探针里唯一「下结论」的代码，而它的分支在真页面上
 * 凑不齐 —— 找不到元素、0 面积、布局盒子溢出、滚动容器溢出豁免、单轴豁免，五个里能自然
 * 遇到的只有一个。留证的工作流天天跑，判定逻辑本身却没人测，那是本末倒置。
 *
 *   node tests/probe-strict-smoke.mjs
 */
import assert from 'node:assert';
import { judgeStrict } from './visual-probe.mjs';

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

console.log('probe-strict-smoke: OK — 正常 / 找不到 / 0 面积 / 溢出 / 滚动容器豁免 / 单轴豁免 / 多选择器');
