#!/usr/bin/env node
/**
 * 把 `shared/` 里的公共层写进各扩展的浏览器半（无构建方案）。
 *
 * 为什么是「源码块同步」而不是打包：这些扩展的浏览器半都是手写的单文件 `client.js`，
 * DSH 每个插件只发一个，没有 import 关系。抽公共层要么加构建步骤，要么把源码块写进去。
 * 这里选后者：扩展保持零构建，代价是多一道同步工序 —— 所以配一个 `--check` 做漂移检查，
 * 否则「源改了、某一边忘了同步」会静默存在。
 *
 * 用法：
 *   node shared/sync.mjs            # 写入
 *   node shared/sync.mjs --check    # 只检查（漂移时退出码 1）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const VERSION = '1.0.0';

// 标记本身必须是一条完整的注释：漏掉结尾的 */ 会把后面的内容全部吞进注释里
// （第一次就这么踩的：base-css 块里 CSS 注释的 */ 被当成块的结束符）。
const OPEN = (name) => `/* <<< dsh-shared:${name} v${VERSION} >>> */`;
const CLOSE = '/* <<< dsh-shared:end >>> */';

/** 读源码块，组装成要写进宿主文件的文本（不含缩进，缩进由目标负责）。 */
function buildBlocks(names) {
  const baseCss = readFileSync(join(HERE, 'base.css'), 'utf8').trimEnd();
  const parts = [];
  for (const name of names) {
    if (name === 'client-kit') {
      parts.push([OPEN('client-kit'), kit, CLOSE].join('\n'));
    }
    else if (name === 'base-css') {
      // JSON.stringify 负责转义：反引号、`${`、换行都不会破坏宿主文件。
      parts.push([OPEN('base-css'), `const SHARED_BASE_CSS = ${JSON.stringify(baseCss)};`, CLOSE].join('\n'));
    }
    else {
      throw new Error('未知的共享块: ' + name);
    }
  }
  return parts.join('\n\n');
}

/** 去掉文本里已有的全部共享块。 */
function stripBlocks(text) {
  const pattern = /[ \t]*\/\* <<< dsh-shared:[a-z-]+ v[\d.]+ >>> \*\/[\s\S]*?\/\* <<< dsh-shared:end >>> \*\/[ \t]*\n?/g;
  return text.replace(pattern, '');
}

/** 目标清单：加一个扩展就加一项。 */
const TARGETS = [
  {
    file: join(ROOT, 'lib', 'client.js'),
    anchor: '/* dsh-shared:anchor */',
    blocks: ['base-css'],
    indent: '\t\t',
  },
];

const check = process.argv.includes('--check');
let drifted = 0;

for (const target of TARGETS) {
  if (!existsSync(target.file)) {
    console.warn('跳过（不存在）: ' + target.file);
    continue;
  }
  const before = readFileSync(target.file, 'utf8');
  const stripped = stripBlocks(before);
  const indent = target.indent;
  const body = buildBlocks(target.blocks)
    .split('\n')
    .map((line) => (line === '' ? line : indent + line))
    .join('\n');
  if (!stripped.includes(target.anchor)) {
    console.error('✗ ' + target.file + ': 找不到锚点 ' + JSON.stringify(target.anchor));
    drifted += 1;
    continue;
  }
  // 幂等：把锚点归一成「前后各一个换行」，块放在锚点**后面**。
  // 之前把块放前面、按正则压空行，跑第二次仍会多出一行 —— 检查器当场抓到了。
  const normalized = stripped.replace(/\n*[ \t]*\/\* dsh-shared:anchor \*\/[ \t]*\n*/, () => '\n' + target.anchor + '\n');
  const after = normalized.replace(target.anchor, () => target.anchor + '\n\n' + body + '\n');

  if (after === before) {
    console.log('✓ 已是最新: ' + target.file);
    continue;
  }
  if (check) {
    console.error('✗ 与 shared/ 漂移: ' + target.file + '（跑 node shared/sync.mjs 重新同步）');
    drifted += 1;
    continue;
  }
  writeFileSync(target.file, after);
  console.log('✓ 已同步: ' + target.file);
}

if (check && drifted > 0) process.exitCode = 1;
