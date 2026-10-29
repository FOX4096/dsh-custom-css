#!/usr/bin/env node
/**
 * 预览块不许自己造控件。
 *
 * 这条门禁的理由是历史，不是洁癖：预览块曾经把「全屏 / 对比 / 列表 / 适应 / 芯片」全写成
 * 手绘的 `button.dshCc_hlToggle` —— 那是「强调显示」那枚警告色胶囊的类，借完还得再写覆盖
 * 规则把选中色改回去；三档自创高度（22 / 18 / 17px）也是这么来的。用户的原话是
 * 「组件要和其他组件一样」，而 `audit-ui` 守不到它：它管的是 `dshUi_*`，预览块用的是
 * 自己的 `dshCc_*`，两边都不报。
 *
 * 判据（少而硬，避免变成一份靠人维护的清单）：
 *   1. `PreviewBlock` 里不许出现 `createElement('button' | 'input'` —— 按钮、开关、下拉、
 *      分段控件一律走 `ui.*`；
 *   2. 它必须真的用到 `ui.button`、`ui.choice`、`ui.segments` 这些零件（防止有人把整块换成
 *      一堆 div + role）。
 *
 * 用法：node tests/audit-preview-kit.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(path.join(REPO, 'lib', 'client.js'), 'utf8').replace(/\r\n/g, '\n');

/** Cut one indented function body out of the source by counting braces. */
function bodyOf(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('找不到 ' + name + '()');
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(name + '() 的大括号没有闭合');
}

const body = bodyOf('PreviewBlock');
const problems = [];

// ① 手绘控件
for (const match of body.matchAll(/createElement\(\s*'(button|input)'/g)) {
  const line = body.slice(0, match.index).split('\n').length;
  problems.push('PreviewBlock 里手写了 <' + match[1] + '>（第 ' + line + ' 行）—— 用 ui.button / ui.field / ui.switch');
}

// ② 一副空壳：三个零件都得真的用上
for (const part of ['ui.button', 'ui.choice', 'ui.segments']) {
  if (!body.includes(part)) problems.push('PreviewBlock 没有用 ' + part + ' —— 这块界面的控件从组件库出');
}

if (problems.length > 0) {
  console.error('══ 预览块越权造控件 ══');
  for (const problem of problems) console.error('  ✗ ' + problem);
  process.exitCode = 1;
}
else {
  console.log('audit-preview-kit: OK — 预览块的控件全部来自 ui.*（' + body.split('\n').length + ' 行）');
}
