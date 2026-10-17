#!/usr/bin/env node
/**
 * 防绕过审计：组件库之外不许再手写组件库的类名。
 *
 * 这个扩展只有一套界面元素（`lib/client.js` 里的 `ui`），每个都用 `dshUi_*` 上色。
 * 如果某个新功能为了赶时间直接写 `className: 'dshUi_button'`，它就绕过了 `ui.button`
 * 的三个状态（busy 的转圈、danger、disabled 与 aria 的一致），下一个改动会从那里漂走。
 * 这条审计就是那种漂移的门禁。
 *
 * 白名单：`ui` 定义块本身（它当然要写这些类名）。
 *
 * 用法：node tests/audit-ui.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const file = path.join(here, '..', 'lib', 'client.js');
const text = fs.readFileSync(file, 'utf8');
const lines = text.split('\n');

/** 组件库拥有的类：控件、行布局、反馈、小节。 */
const KIT_CLASSES = [
  'dshUi_button', 'dshUi_buttonDanger', 'dshUi_spinner',
  'dshUi_switch', 'dshUi_switchTrack', 'dshUi_switchThumb', 'dshUi_switchLabel',
  'dshUi_badge', 'dshUi_choiceWrap', 'dshUi_field', 'dshUi_fieldInvalid',
  'dshUi_fieldFail', 'dshUi_fieldMessage', 'dshUi_slider',
  'dshUi_row', 'dshUi_rowLabel', 'dshUi_rowControls',
  'dshUi_group', 'dshUi_hint', 'dshUi_value', 'dshUi_facts',
  'dshUi_status', 'dshUi_statusBad', 'dshUi_statusOk', 'dshUi_statusBusy',
  'dshUi_empty', 'dshUi_section', 'dshUi_sectionTitle', 'dshUi_desc', 'dshUi_link',
];

/** `ui` 定义块的行范围（含标记行）。 */
const start = lines.findIndex((line) => line.includes('UI 组件库'));
assert.ok(start >= 0, 'lib/client.js 里找不到 UI 组件库的说明块');
const end = lines.findIndex((line, index) => index > start && /^\t\t\};$/.test(line));
assert.ok(end > start, '找不到组件库对象的结束处（应是一行 `\t\t};`）');

const offenders = [];
// 组件库自己的机器还包括 `Dropdown`：它渲染 `.dshUi_choice*`，但它是被 ui.choice 包装的
// 实现细节，自己也用这些类名是它的职责。
const dropdownStart = lines.findIndex((line) => /^\t\tfunction Dropdown\(/.test(line));
let dropdownEnd = dropdownStart;
while (dropdownStart >= 0 && dropdownEnd < lines.length && !/^\t\t\}$/.test(lines[dropdownEnd])) dropdownEnd += 1;

lines.forEach((line, index) => {
  if (index >= start && index <= end) return;
  if (dropdownStart >= 0 && index >= dropdownStart && index <= dropdownEnd) return;
  // 注释里提到类名不是「绕过」：说明文字本来就要说类名。
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
  for (const cls of KIT_CLASSES) {
    // JS 里的用法（`className: 'dshUi_x'`）与模板拼接（`'dshUi_status' + …`）都算。
    if (line.includes("'" + cls) || line.includes('"' + cls) || line.includes('`' + cls)) {
      offenders.push({ line: index + 1, cls, text: line.trim().slice(0, 90) });
      break;
    }
  }
});

assert.deepStrictEqual(
  offenders, [],
  '组件库之外出现了手写的组件类名 —— 改用 ui.*（' + offenders.length + ' 处）：\n'
    + offenders.map((entry) => '  第 ' + entry.line + ' 行 [' + entry.cls + '] ' + entry.text).join('\n'),
);

console.log('audit-ui: OK — 组件库之外没有手写组件类（检查 ' + KIT_CLASSES.length + ' 个类）');
