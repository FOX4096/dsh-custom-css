# 写 CSS 用的页面 API（`window.dshCss`）

[← 返回 README](../README.md) · [文档索引](./index.md)

插件在页面里挂了一个对象：`window.dshCss`。它不另造能力，只是把插件**已经有**的东西
（读写样式表、命中数、规则归属、令牌反查、元素拾取）摆到控制台里，省掉「开 DevTools 翻 DOM、
再回编辑器手抄」这一段。

```js
dshCss.help()                                  // 打印方法表 + 示例
dshCss.css.selectorHits('.hHd-Xa_panelRow')    // 7
dshCss.css.deadSelectors()                     // 当前页面里匹配 0 个元素的选择器
await dshCss.sheets.read('custom.css')         // 活动表的文本
await dshCss.pick()                            // 点页面 → { selector, declarations }
```

`apiVersion = 1`。破坏性改动才递增；新方法只会**追加**。

---

## 样式表（走 host 文件接口）

| 方法 | 说明 |
| --- | --- |
| `sheets.list()` | `[{ name, bytes, mtime, active, disabled }]` |
| `sheets.read(name)` | 文本；不存在返回 `null`（不抛） |
| `sheets.write(name, css)` | 写盘，自动进 `.history`；活动表会立刻重绘 |
| `sheets.create(name, css?)` | 新建；同名返回 409 错误（`error: exists`） |
| `sheets.rename(name, to)` | 改名（历史跟着走） |
| `sheets.remove(name)` | 删除（进 `.backup/`，不是真删） |
| `sheets.activate(name)` | 设为活动表 |
| `sheets.toggle(name, enabled)` | 启用 / 停用（内容仍在磁盘上） |
| `sheets.history(name)` | `[{ stamp, bytes, mtime }]` |
| `sheets.restore(name, stamp)` | 恢复到某个历史版本 |
| `sheets.export()` | 下载整包（等同面板上的「导出全部」） |

**写盘受设置项控制**：设置 → 通用 → 插件详情页 → 「开发者 · 控制台写盘」。关掉后
`write / create / rename / remove / toggle / restore` 会抛错，只读接口与临时表不受影响。
默认允许 —— 它与编辑器用的是同一套 host 路由与围栏。

## 临时表（只在本页生效）

```js
dshCss.css.apply('.x { color: red }', { id: 'try-1' })   // 返回 id
dshCss.css.remove('try-1')                                // true / false
dshCss.css.list()                                         // [{ id, bytes }]
```

刷新即消失，不落盘。试验与改真表的分界就在这里：`css.apply` 随便用，`sheets.write` 才动磁盘。

## 查页面

| 方法 | 说明 |
| --- | --- |
| `css.selectorHits(sel)` | 命中数；非法选择器返回 `null`（不抛） |
| `css.computed(sel, props?)` | 计算值 `{ prop: value }`；默认取 display/size/color 等十项 |
| `css.rulesFor(sel)` | 命中的规则：`{ selector, sheet, declarations }`（最多 50 条） |
| `css.deadSelectors(cssText?)` | 匹配 0 个元素的选择器；不传文本就用活动表 |
| `inspect(sel)` | 元素摘要、尺寸、父级链、可用的候选选择器 |

`deadSelectors` 的判定口径：**只报「静止页面上也匹配不到」的选择器**。

- 跳过状态伪类（`:hover`、`:focus`、`:active`…）与状态类（`.active`、`.on`、`.current`…）——
  它们在当前状态下匹配 0 是正常的；
- 跳过 `@media` / `@supports` 里的选择器 —— 视口或特性不满足时的 0 不代表规则坏了；
- 跳过伪元素（`::before` 这类 `querySelectorAll` 永远不返回盒子）。

⚠ 它只代表**当前页面状态**：只出现在别的标签页、或关闭中的面板里的元素，会被算成死的。
要审那部分，先打开对应视图再跑一次。

## 令牌

| 方法 | 说明 |
| --- | --- |
| `tokens.all()` | `{ '--dsw-…': 当前值 }`（从 `body` 与 `:root` 读，DSH 把令牌定义在 `body` 上） |
| `tokens.get(name)` | 单个值；不存在返回 `null` |
| `tokens.find(property, selector?)` | 反查：这个属性该用哪些令牌（与拾取器的令牌建议同一套逻辑） |

## 拾取与事件

```js
const picked = await dshCss.pick();      // Esc 取消 → null
// picked = { selector: '…', declarations: ['color: var(--dsw-alias-label-primary);'] }

const off = dshCss.on('change', (event) => console.log(event));
// event: { kind: 'write' | 'create' | 'rename' | 'remove' | 'activate' | 'toggle' | 'restore', name, … }
off();
```

拾取复用面板上那个拾取器（同样的候选排序、命中数、令牌建议），只是把结果交回给你而不是插进编辑器。

## 高级

| 方法 | 说明 |
| --- | --- |
| `host.get(path)` / `host.post(path, body)` | 裸接口（`/list` `/read` `/write` …），不保证稳定 |
| `ui` | 插件自己的组件库，见 [UI 组件库](./ui-kit.md) |

---

## 与之前的关系

| 之前 | 现在 |
| --- | --- |
| 面板上的「导出 / 重置 / 重命名」 | 内部同样走这些 host 路由；`dshCss.sheets.*` 是它们的脚本化入口 |
| 手工写脚本比对「哪些选择器死了」（2026-10-18 那次 `custom.css` 审计） | `dshCss.css.deadSelectors()` |
| 拾取器只能把结果插进编辑器 | 同一个拾取器，`dshCss.pick()` 把结果交给你 |
| 令牌反查只在拾取面板里 | `dshCss.tokens.find()` |

内部函数（`applyUserCss`、`resolveSelector`、`applySheet` …）仍然存在，但**不再属于对外契约**：
它们没有版本号，随时可能改；对外只认 `window.dshCss`。

## 已知边界

- 只在**当前页面**可用，不暴露给跨域 iframe；
- `sheets.*` 的权限与编辑器相同（同一套 host 围栏）；写盘前自动进历史；
- `deadSelectors` 的结果依赖当前页面状态（见上）；
- 没有「截图对比」这类需要额外权限的能力，也没打算加。
