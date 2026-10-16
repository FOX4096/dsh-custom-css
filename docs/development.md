# 开发

[← 返回 README](../README.md) · [文档索引](./index.md)

本地跑起来、改代码时必须知道的硬约束、以及在哪验证。

**先读这两条硬约束**，它们决定了「为什么我改完看不到效果」：

- `lib/client.js` 是交给 DSH 浏览器模块加载器的产物
  （`window.__ModuleLoader__.load({ id, factory })` 工厂），**不是**普通 ES 模块 ——
  与 DSH 自身 `@deepseek-ai/dsh-client-ui-*` 的产物同构。所以 `node --check` 能做语法自检，
  但**不要**当 ESM 引入它。
- `lib/index.js` 是 host 侧：拥有样式表目录、挂载围栏内的 JSON 接口。
  路由挂载方式与 `dsh-smooth-stream` 一致（本代内核的 `connection.rpc.handle()` 会因服务内部
  Context 未注入 `webServer` 而失败，直挂 Web 服务器是受支持的兜底）。

> **host 半不热更新。** 改 `lib/index.js` 后刷新页面毫无变化 —— 必须重启 dsh。
> 只有浏览器半走 `dsh-client-hmr` 热更新。这条踩过：host 改动在磁盘上躺了一整夜，
> 期间所有人都在测旧代码。见 [已知坑](./known-issues.md)。

## 控件一律用平台的原生组件

界面里的按钮、开关、标签**不是**这个插件画的，是 **DSH 组件库**（`@deepseek-ai/dsh-client-ui-primitives`）
的。清单与用法：

| 事项 | 事实 |
| --- | --- |
| 声明 | `package.json` 的 `dsh.client.inject` 里加 `@deepseek-ai/dsh-client-ui-primitives` |
| 取用 | `require('@deepseek-ai/dsh-client-ui-primitives')`，**只有这一处 require** |
| 为什么是 inject 而不是 import | 平台不在 `node_modules` 里暴露它，它是**模块表**里的一个模块；inject 描述的正是这张表 |
| 实测可用 | `Button` · `Checkbox` · `Input` · `Switch` · `Tag` · `Tooltip` · `StateDot` · `Menu` · `Toast` · 98 个 `Icon*Regular` |
| 实测**没有** | `Select` / `Slider` / `Segmented` / `Radio` —— 选择用原生 `<select>`（已按 DSH 字段规格着色），滑块用原生 `<input type=range>` |
| 缺失时的行为 | `native(name, fallback)` 退化成带 `nativeFallback` 标记的普通元素：**控件不会消失**，只是不再来自组件库 |

**React 元素类型是大小写敏感的**：组件必须作为**类型**传入（`createElement(native('Button','button'), …)`），
写小写字符串会被当成未知 DOM 标签。

> 代价与收益：这条依赖让这个插件**不再是「运行时零 require」**（那是它过去跨 31 个版本不坏的原因之一）。
> 换来的是「这一行的控件与 DSH 自己是同一套」。降级路径留在 `native()` 里，所以组件库哪天消失，
> 界面退回普通元素而不是坏掉。

---

## 命令

| 命令 | 做什么 |
| --- | --- |
| `node --check lib/client.js` | 语法自检（**不要**当 ESM 引入） |
| `npm test` | 两套冒烟测试，见 [测试](./testing.md) |
| `npm run compat` | 跨版本兼容断言（需要网络） |
| `npm run compat:check` | DSH 换代检查，只报告不写文件 |
| `npm run compat:update` | 同上，并把结果写回 `compat.json` / README / 社交卡 |
| `npm run audit` | 三个样式审计：圆角 / 字体 / 可访问名 |
| `npm run audit:duplication` | 重复率巡检 |
| `npm run dev` · `dev:down` · `dev:status` · `dev:dump` | 开发实例（端口 3081） |
| `npm run probe` | 无头 Edge + CDP 的量测探针 |
| `npm run ego` | 取件窗口：让 ego 浏览器带令牌进开发实例，令牌不落痕 |

---

## 开发实例

改这一行的界面时，用 `npm run dev` 起一个**只加载本插件**的 DSH：
独立 `DSH_HOME`（`dev/home`）、端口 **3081**、profile `ccdev`，与你正在用的那个实例**完全无关**。

```bash
npm run dev          # 起（幂等）；dev:down 停；dev:status 看状态
npm run probe -- --open-settings --sel .dshCc_row --shot
```

**它不是「复制一份 profiles/web」**：真机 profile 的 `cordis.patch.yml` 把 `webserver.port`
写死成 `3080`，而 DSH 出厂配置里那个字段是跟着 `--port` 走的 ——
复制过来的实例会去**抢真机的端口**。现在用官方模板 `--from-default-profile web`，
它只复制 bundle 列表，不读真机的本地状态。详见 [`dev/README.md`](../dev/README.md)。

## 视觉探针：在真 Chromium 里量，不靠看

`npm run probe` 用无头 Edge + CDP（**零依赖**：Node 24 自带 `WebSocket`）量几何、截图、
收控制台错误。

它**只测量、不断言** —— 「看起来有点挤」与「真的溢出 16px」是两回事，后者只有数字能说。
这条规矩救过一次：查找栏在窄窗口下把按钮挤到了第二行，肉眼看只是「有点挤」，
量出来才发现栏高翻倍（见 [已知坑](./known-issues.md)）。

## 要实时看着界面用 ego

`npm run ego` 会起一个**取件窗口**并打印一个本机地址。用 `ego_navigate` 打开它 ——
页面自己取走带令牌的 URL 并跳转，**令牌因此不出现在对话、终端或日志里**。

截图与临时产物落在 `temp/`（`temp/probe/` 是探针的，`temp/ego/` 是 ego 的），
整个目录不进版本库。

---

## 提交前

1. `npm test` —— 两套冒烟测试
2. `npm run audit` —— 样式审计（圆角 / 字体 / 可访问名）
3. 若改的是界面：`npm run probe` 量一遍，别只靠看
4. 若改了 host 半：**重启 dsh** 再验证

**每条修复都要做反向验证**：先把补丁反向打回去、确认测试会红。
否则你守的可能只是「实现长什么样」而不是行为。这条在本仓库是硬要求，
`tests/loader-smoke.cjs` 的注释里多处记着它抓出的「假守卫」。

发版流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)；文档拆分与链接校验见 [测试](./testing.md)。

## 相关

- [测试](./testing.md) —— 两套冒烟测试、四个审计、CI 三个工作流
- [仓库结构](./repo-map.md) —— 每个目录是干什么的
- [已知坑](./known-issues.md) —— 尤其是 host 半不热更新那两条
