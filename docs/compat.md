# 兼容性

[← 返回 README](../README.md) · [文档索引](./index.md)

插件与 DSH 的耦合面是**刻意做窄的**，所以它跨版本比多数插件活得久。

---

## 平台契约只有四条

**浏览器半在运行时一个 `@deepseek-ai/*` 模块都不 require**（只通过 `dsh.client.inject` 声明可用 id、
并从 Context 取 `slots` 服务），host 半只挂 HTTP 路由。

| 契约点 | 内容 |
| --- | --- |
| 槽位 | `settings.general.item`（`@deepseek-ai/dsh-client-ui-settings-general` 里 `GeneralSection` 渲染的那个 seat） |
| 声明的模块 id | `@deepseek-ai/dsh-client-ui-settings`、`@deepseek-ai/dsh-client-ui-settings-general` |
| 需要的服务 | 仅 `slots` |
| 运行时 require | 零 |

四条全部记在 [`compat.json`](../compat.json)，由 `npm run compat` **逐个版本断言**。

## 验证结果

**验证矩阵在 [README 的「兼容性」一节](../README.md#兼容性)** —— 它有四个理由留在那里：

1. 它是**自动维护**的（`npm run compat:update` 每 6 小时核对一次，见下），
   放在 README 就不会两处漂移
2. 它是读者最先想知道的事，值得在门槛上
3. 相对链接在两个渠道都对（GitHub 与 npm 都渲染 README）
4. 换版本时最该被看见的地方

## 断言是怎么做的

```bash
npm run compat            # 契约里 knownGood + probe + registry 上的最新版
npm run compat:check      # 换代检查：发现新版本 → 断言 → 只报告
npm run compat:update     # 同上，并把结果写回 compat.json / README / 社交卡
```

- `npm pack` 下目标版本的 `settings-general` 包，解包后在 js 里找槽名 ——
  它是 `GeneralSection` 渲染的那个 slot，**DSH 换代改名时这里会先失败**。
- 再核对 `package.json#dsh.client.inject` 声明的每个模块 id 在目标版本都有同版本号的包。
- 这不是运行时证明：真正的加载验证要起一个对应版本的 DSH 实例（那一条记在验证矩阵的
  「真机运行」档）。它的定位是**换代门禁**。

`npm run compat` 需要网络（要拉各版本的包），所以本地 `npm test` 保持离线可跑；CI 里单跑一档。

## 自动维护

`.github/workflows/compat-watch.yml` 每 **6 小时**跑一次：

1. **发现**：GitHub releases（含预发布，比 npm 的 `latest` 更早看到信号）+ npm registry 取并集
2. **断言**：对最近一批版本 + 真机验证过的锚点逐个跑上面的契约检查
3. **写回**：`compat.json` 的 `knownGood` / `lastChecked`、README 的验证矩阵与三处版本提及、
   以及 `assets/social-preview.svg` 的版本标签

**契约对不上时零写入**并让 job 失败 —— 那时需要人工处理（改 slot、加回退），
把「通过」写进文档是最坏的结果。

## 两种失效模式的判别

这是最实用的一节：**症状不同，原因完全不同**。

| 症状 | 原因 | 怎么查 |
| --- | --- | --- |
| 行内控件**静默不出现**（**没有报错**） | DSH 把 `settings.general.item` 改名了 —— 这正是 `npm run compat` 要提前挡住的事 | `dsh web --dump-default-config` 看有没有本插件的段；跑 `npm run compat` |
| 加载失败：`client-modules: require("…") missed the module table` | 那是给**旧一代 DSH** 编译的 bundle：它把平台包硬写进了产物（如 `@deepseek-ai/dsh-client-runtime/client`、`dsh-client-ui-primitives`），而当前代已删掉这些包 | 看插件是否在运行时硬 require 平台包。本插件 require 数为 0，**不受这类漂移影响** |

第二种只能等插件作者更新 —— 但它**不会**发生在本插件上，这也是「运行时 require 为零」
这个设计目标的实际价值。

## 相关

- [README · 兼容性](../README.md#兼容性) —— 验证矩阵
- [`compat.json`](../compat.json) —— 契约与已验证版本的机器可读来源
- [已知坑](./known-issues.md) —— 跨代插件那一条
- [开发 · 测试](./testing.md) —— CI 里怎么跑
