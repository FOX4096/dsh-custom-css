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
| **按钮** | `ui.button(props, '文字')` | `disabled` · `busy` · `danger` · `title` · `className` · `onClick` | hover / focus-visible / disabled / **busy**（转圈 + 禁用 + `aria-busy`）/ danger |
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

```js
// 一个忙碌按钮 + 一个无效字段
ui.button({ busy: saving, onClick: save }, saving ? '保存中…' : '保存')
ui.field({ value: url, invalid: true, message: '只接受 http(s) 或 file://', onChange })
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
| **状态行** | `ui.status({ state, text })` | `state` = `idle` / `busy` / `ok` / `error`；带 `role=status` + `aria-live=polite`，所以变化会被读屏器念出来 |
| **空态** | `ui.empty('还没有壁纸：…')` | 虚线框 + 一行灰字，表达「这里还没有东西」而不是「出错了」 |

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
