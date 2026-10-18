# 写 CSS 用的页面 API（`window.dshCss`）· 规划

[← 返回 README](../README.md) · [文档索引](./index.md)

> **状态：规划中，尚未实现。** 这份文档是实现前的设计稿：接口形状、它把哪些已有能力收进来、
> 分几期做、每期怎么验收。实现后这份会改成 `docs/api-client.md`（去掉「规划」标记）。

## 要解决什么

现在想在页面里「顺手做点事」，只有两条路：打开编辑器手写 CSS，或者开 DevTools 翻 DOM。
而插件其实**已经有**这些能力，只是都埋在内部：读/写样式表、历史版本、元素拾取、令牌反查、
选择器命中数、外部改动同步。缺的是一个**给写 CSS 的人用的入口**：

```js
// 目标：在控制台里这样用
dshCss.css.selectorHits('.hHd-Xa_panelRow')      // 3
dshCss.sheets.read('custom.css')                  // 拿到当前样式表文本
dshCss.css.deadSelectors()                        // ['..._block_rsn9u_4:not(:last-child)']
dshCss.tokens.get('--dsw-alias-brand-primary')    // '#4d6bfe'
dshCss.pick()                                     // 点一下页面元素 → 返回稳定选择器
```

## 非目标

- 不做**远程样式**的自动加载（安全边界：只认本机文件）。
- 不替代编辑器：API 面向「一次性查询 / 试验 / 脚本化」，长期编辑还是编辑器。
- 不碰跨域 iframe：拾取器原本就只在当前文档里工作。

## 接口形状（v1）

命名空间只有一个：`window.dshCss`。`apiVersion = 1`，破坏性改动时递增。

### 样式表（走 host 的文件接口）

| 方法 | 作用 |
| --- | --- |
| `sheets.list()` | `[{ name, bytes, mtime, active, disabled }]` |
| `sheets.read(name)` | 文本；不存在返回 `null`（不抛） |
| `sheets.write(name, css)` | 写盘（自动进 `.history`） |
| `sheets.create(name, css?)` / `sheets.rename(name, to)` / `sheets.remove(name)` | 基本管理 |
| `sheets.activate(name)` / `sheets.toggle(name, enabled)` | 切换活动表 / 启用停用 |
| `sheets.history(name)` / `sheets.restore(name, rev)` | 历史版本 |
| `sheets.export()` | 触发下载（等同面板上的「导出全部」） |

### 样式试验（只在本页生效，刷新即消失）

| 方法 | 作用 |
| --- | --- |
| `css.apply(css, { id })` | 插入一张临时表；同 id 覆盖 |
| `css.remove(id)` | 移除 |
| `css.list()` | 当前临时表 `[{ id, bytes }]` |

### 查询页面（写选择器时最常用的四件事）

| 方法 | 作用 |
| --- | --- |
| `css.selectorHits(sel)` | 命中元素数；非法选择器返回事件（不抛） |
| `css.computed(sel, props[])` | 计算值，`{ prop: value }` |
| `css.rulesFor(sel)` | 命中的规则：选择器、出处（哪张表/哪个插件）、关键声明 |
| `css.deadSelectors(cssText?)` | 与 live DOM 比对，列出「匹配 0 个元素」的选择器；默认对比活动表 |
| `inspect(sel)` | 元素结构：tag、类名、尺寸、父级链（拾取器的输出形状） |

### 令牌

| 方法 | 作用 |
| --- | --- |
| `tokens.all()` | `{ '--dsw-…': 值 }`（从 `body` 上取，DSH 的令牌定义在那儿） |
| `tokens.get(name)` | 单个值 |
| `tokens.find(property, value?)` | 反查：某个属性（可带值）对应哪些令牌 |

### 拾取与事件

| 方法 | 作用 |
| --- | --- |
| `pick()` | 进入拾取模式，`Promise<selector>`（Esc 取消 → `null`） |
| `on(event, cb)` / `off(event, cb)` | `change`（活动表变化 / 外部改动 / 写入完成）、`pick`（拾取完成） |
| `help()` | 打印方法表 + 一段示例 |
| `host.*` | 裸接口（`host.get('/list')` 等），高级用法，不保证稳定 |

## 把之前的一起统一

现在这些能力散在三处（内部函数、host 路由、面板 UI）。统一后它们只有一个入口：

| 之前 | 统一到 |
| --- | --- |
| `applyUserCss` / `applySheet` / `sheetEnabled` | `dshCss.sheets.*` + `dshCss.css.apply` |
| `api()` / `post()`（内部 fetch 封装） | `dshCss.host.*` |
| `resolveSelector` / `probeMatches` | `dshCss.css.selectorHits` / `rulesFor` |
| 2026-10-18 手写的「死选择器审计」脚本 | `dshCss.css.deadSelectors()` |
| 拾取器（面板上那个按钮） | `dshCss.pick()` |
| 令牌反查（拾取器的副产物） | `dshCss.tokens.find()` |
| `ui.*` 组件库 | `dshCss.ui`（同一个对象，不再有第二个入口） |
| 面板上的「导出 / 重置 / 重命名」 | `dshCss.sheets.*`（面板改为调用它，行为不变） |

命名规则（与 [命名表](./naming.md) 对齐）：

- **API 一律挂在 `dshCss` 下**，内部函数不再出现在全局；
- 注入到页面的 DOM 用 `dshCss*` 前缀（拾取器的浮层等），CSS 类沿用 `dshUi_*`（组件库）/ `dshWp_*`、`dshCc_*`（功能）；
- 一个 `apiVersion`，README 与 `docs/` 里只写这一个版本号。

## 分期

| 期 | 内容 | 风险 | 验收 |
| --- | --- | --- | --- |
| **1 · 只读骨架** | 命名空间 + `help` + `sheets`（只读部分）+ `css.selectorHits/computed` + `tokens` | 低（纯读） | loader-smoke 单测；控制台实测 |
| **2 · 审计与拾取** | `deadSelectors`、`rulesFor`、`pick`、`tokens.find` | 中（要读 CSSOM、要改拾取器的返回） | 用今天那次 `custom.css` 审计做回归样例 |
| **3 · 写入与事件** | `sheets.write/create/rename/remove/activate/toggle/history/restore`、`on('change')`、`host.*` | 中高（会写盘） | host-api-smoke 覆盖；面板改为调用它 |
| **4 · 收口** | `dshCss.ui`、旧入口删除 / 标记弃用、`docs/api-client.md` 完成、示例三段 | 低 | audit-docs + 全量测试 |

## 安全与边界

- 只在**当前页面**可用（同源），不暴露给 iframe；
- `sheets.write` 的权限等同于 GUI 里的编辑器（同一套 host 路由，同样的围栏）；写盘前自动备份；
- `css.apply` 不落盘，刷新即消失 —— 这是「试验」和「改真表」的分界；
- 可选设置项 **「允许从控制台写样式表」**（默认开）—— 关掉后 `sheets.write` 抛错，只读 API 不受影响。

## 需要你拍板的三件事

1. **名字**：`window.dshCss`（推荐，短且与类名前缀一致）还是 `window.dshCustomCss`？
2. **写盘**：控制台允许直接改真实样式表，还是只允许 `css.apply` 的临时表？（我倾向允许，默认开、可关）
3. **优先级**：这四期要不要一次做完，还是先做 1+2（写 CSS 时最有用的查询/审计），3+4 下一轮？
