# UI 组件库（`ui`）

[← 返回 README](../README.md) · [文档索引](./index.md)

这个扩展**所有界面元素**都从 `lib/client.js` 里的 `ui` 对象出。加功能时调用 `ui.*`，
不要再手写 `dshUi_button` / `dshUi_switch` / `dshUi_row` 这些结构 —— `tests/audit-ui.mjs`
会报错，理由在文末。

没有构建步骤、没有独立模块文件：`ui` 就是 `client.js` 里声明的一段，DSH 每个插件只发一个
`client.js`（包内 chunk 只有异步接口，会让首帧拿不到控件，也砍掉旧版本兼容）。

---

## 控件

| 组件 | 调用 | props | 状态 |
| --- | --- | --- | --- |
| **按钮** | `ui.button(props, '文字')` | `disabled` · `busy` · `danger` · **`pressed`** · **`size: 'md'\|'sm'`** · **`icon`** · `title` · `className` · `onClick` | hover / focus-visible / disabled / **busy**（转圈 + 禁用 + `aria-busy`）/ danger / **按下**（`aria-pressed`）/ **sm**（28px）/ **icon**（28×28 方形） |
| **分段控件** | `ui.segments({ ariaLabel, value, choices, onChange })` | `ariaLabel` · `value` · `choices: [[value, label]]` · `disabled` · `onChange(value)` | 同组内只有一段 `aria-pressed` / focus-visible / disabled |
| **开关** | `ui.switch({ checked, ariaLabel, labelText, onChange })` | `checked` · `ariaLabel` · `labelText` · `disabled` · `title` · `onChange(next)` | on / off（`aria-checked` 上色）/ disabled / focus-visible |
| **徽标** | `ui.badge('文字')` | —（只读） | — |
| **下拉** | `ui.choice({ ariaLabel, choices, value, onChange })` | `choices: [[value, label]]` · `value` · `disabled` · `onChange(value)` · `className` | hover / focus / open / disabled |
| **文本框** | `ui.field(props)` | `value` · `onChange` · `placeholder` · `disabled` · `readOnly` · `invalid` · `message` · `aria-label` | focus / disabled / **invalid**（`aria-invalid` + 说明）/ readonly |
| **滑块** | `ui.slider(props)` | `value` · `min` · `max` · `step` · `ariaLabel` · `disabled` · `onInput(v)` · `onCommit()` | focus-visible / disabled |
| **外链** | `ui.link({ href }, '文字')` | `href`（`target`/`rel` 自动补） | hover 下划线 |

约定：

- `onChange` / `onInput` 收**新值**，不收事件对象；`ui.field` 是例外（它要把事件原样交给你，
  因为受控输入需要 `event.target.value`）。
- `className` 是**追加**，不替换默认类。
- `ui.slider` 的 `onInput` 持续触发（拖动时即时预览），`onCommit` 在手势结束（pointerup /
  keyup / blur）触发一次 —— 落盘放这里，一次拖动不该写一百次。
- `ui.button` 的 `pressed` 只有**真的传了**才写 `aria-pressed`：给普通按钮写 `"false"` 会让
  读屏器把每颗按钮都念成「未按下」。
- 尺寸只有**两档**：默认 36px、`size: 'sm'` 28px（`icon` 也是 28）。第三个高度不许出现 ——
  这是 [设计一致性](./design-tokens.md) 的硬规定。**要按下的语义用 `pressed`，不要自己拼
  `aria-pressed` 的胶囊**；要「二选一」用 `ui.segments`，不要用两颗独立开关冒充。

```js
// 一个忙碌按钮 + 一个无效字段
ui.button({ busy: saving, onClick: save }, saving ? '保存中…' : '保存')
ui.field({ value: url, invalid: true, message: '只接受 http(s) 或 file://', onChange })
// 28px 工具条：分段 + 有按下态的按钮 + 方形图标钮
ui.segments({ ariaLabel: '视图', value: view, choices: [['single', '单屏'], ['compare', '对比']], onChange: setView })
ui.button({ size: 'sm', pressed: fit, onClick: toggleFit }, '适应')
ui.button({ size: 'sm', icon: true, ariaLabel: '关闭', onClick: close }, '×')
```

## 行布局

| 组件 | 调用 | 说明 |
| --- | --- | --- |
| **设置行** | `ui.row(label, control, note?)` | 左 96px 名字列 + 右控件列；`note` 跟在控件后 |
| **分组标题** | `ui.group('编辑器')` | 一条细上边框 + 12px 标题 |
| **说明** | `ui.hint('…')` | 一行灰字 |
| **读数** | `ui.value('26%')` | 等宽数字、右对齐（滑块旁边那个） |
| **事实表** | `ui.facts([{ term, value }])` | `dt`/`dd` 竖排；`value` 可以是元素 |
| **小节** | `ui.section({ kind, title, badge, desc, children })` | 插件详情页的一节：标题 + 徽标 + 说明 + 内容 |

## 反馈

| 组件 | 调用 | 说明 |
| --- | --- | --- |
| **状态行** | `ui.status({ state, text })` | `state` = `idle` / `busy` / `ok` / **`warn`** / `error`；带 `role=status` + `aria-live=polite`，所以变化会被读屏器念出来。`warn` 是「要注意但不是错误」—— DSH 只有一个红，它留给「出错」与「重置」 |
| **空态** | `ui.empty('还没有壁纸：…')` | 虚线框 + 一行灰字，表达「这里还没有东西」而不是「出错了」 |

## 菜单必须在 top layer

`ui.choice` 的菜单是 `popover="manual"`（原生 Popover API），打开时 `showPopover()` —— 
它因此渲染在 **top layer**，不受祖先的 `transform` 与 `overflow` 影响。

这不是偏好，是量出来的：设置对话框的卡片带 `transform`（进场动画），于是菜单的 `position:fixed`
退化成「相对那个祖先定位」，再被编辑器外壳的 `overflow:hidden` **整块裁掉**。症状是
`aria-expanded` 为 true、菜单 DOM 里 89 行都在，屏幕上**一个像素都没有** —— 用户看到的就是
「大纲点不了」（复现于 `aurora-nexus.css` 这类长样式表，因为大纲越长越容易撞上）。

三条约束：

1. 菜单要带 `popover="manual"`，打开后调用 `showPopover()`（老浏览器没有这个方法时静默跳过）。
2. `[popover]` 有 UA 默认样式（`inset:0`、`margin:auto`、边框、`display:none` 直到打开），
   菜单规则里必须清掉：`inset:auto;margin:0;border:0`。
3. 关闭仍由组件自己负责（`manual` 不会 light-dismiss）：点外面、Esc、选中一行。

---

## 状态怎么表达

**状态只写在属性上，CSS 只从属性取值。** 这条规则让「机器读到的」和「眼睛看到的」不可能分家：

| 状态 | 属性 | 谁在画 |
| --- | --- | --- |
| 选中 / 按下 | `aria-pressed` | `[aria-pressed="true"]` |
| 开关开合 | `aria-checked` | `[aria-checked="true"]` |
| 无效输入 | `aria-invalid` | `[aria-invalid="true"]` + `.dshUi_fieldMessageBad` |
| 忙碌 | `aria-busy` | `[aria-busy="true"]` + `.dshUi_spinner` |
| 不可用 | `disabled` | `:disabled` |
| 键盘焦点 | `:focus-visible` | `outline-style: solid`（跟着圆角走，不自己画 ring） |
| 悬停 | `:hover:not(:disabled)` | 令牌色 |

`prefers-reduced-motion: reduce` 时转圈停下，状态仍由 `aria-busy` 与禁用表达。

## 加一个组件

1. 在 `ui` 对象里加一个函数（带 JSDoc，写清 props 与状态）；
2. 样式进 `ROW_CSS`（控件）或 `WALLPAPER_CSS`（面板布局），类名用 `dshUi_*`；
3. 跑 `npm test`（含 `audit-ui`）与四个审计；
4. 在真机上量一遍（本项目的惯例是**量**，不是看）。

## 为什么有 `audit-ui`

`tests/audit-ui.mjs` 禁止组件库之外手写 `dshUi_*` 类名。没有它的话，赶时间的新功能会直接写
`className: 'dshUi_button'`，绕过 `busy`/`danger`/`disabled` 这几个状态的一致性 —— 下一个改动
就从那里漂走。组件库自己与 `Dropdown`（它的实现细节）在白名单里。
