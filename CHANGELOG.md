# 更新日志

本文件记录 `dsh-custom-css` 的用户可见变更。版本号跟随 `package.json`。

## 0.1.1 — 发布通道与文档

- README：新增 npm 徽章（version / unpacked size）；安装章节改为「**npm 优先**」，GitHub 装法与 `link:` 开发安装顺延为方式二、方式三；顶部元信息补 npm 包链接。
- README：注释里记下下载量徽章暂缺的原因（npm downloads API 对刚发布的包要等约一天才有数据），届时补 `img.shields.io/npm/dm/dsh-custom-css`。
- `publish.yml`：打开 `push: tags: ['v*']` 触发（OIDC 受信发布 + provenance 签名），并把唯一前置写进注释 —— 先在 npmjs.com 给这个包配置 Trusted Publisher。
- **无运行时改动**：`lib/client.js` 与 `lib/index.js` 与 0.1.0 逐字节相同，本版只为刷新 npm 页面上的 README 并走通自动发版流水线。

## 0.1.0 — 首个公开版本

设置行 / 编辑器

- 在 **设置 → 通用 → 外观** 下方新增一行「自定义 CSS」（`settings.general.item`，`order: 12`）。
- 样式表以普通 `.css` 文件存放在 `~/.dsh/custom-css/`，当前文件记在 `active.json`；编辑**即时生效**（400ms 防抖）。
- 编辑器照 DevTools Styles 标签页做：行号 gutter、shiki 同色语法高亮、键入时补全。
- 补全数据取自浏览器自身：属性名枚举自 `CSSStyleDeclaration.prototype`，值的候选逐个过 `CSS.supports()`。
- 补全只在真正键入时出现（看 `InputEvent.inputType`），且一行里有多条声明时只认光标所在的那条。
- **规则面板**：点选择器就地展开 —— 可重命名选择器、逐条列出已有声明（枚举型给中文名 + 中文值下拉）、未设置的属性收进「＋ 添加属性…」、底部是 14 个声明模板。
- 改属性是**替换**而非叠加：写入走逐条声明的扫描 + 块规范化，不会堆出 `display: flex; display: grid;`。

这一行上的控件

- 文件下拉（DSH 原生样式，末项「＋ 新建…」）、打开文件（调起系统默认程序）、导入、导出（另存为 / 回退下载）、重置（错误色，语义破坏性）。

host 侧

- `/dsh-custom-css` 前缀下的 JSON 接口：`/list`、`/read`、`/write`、`/create`、`/import`、`/active`、`/open`。
- 全部走 Connection 服务的请求围栏；拿不到围栏时 503 fail-closed。
- 文件名限定单个路径段 + `.css`（≤64 字符），目录外路径二次校验。
- 围栏不可达时浏览器半自动降级到 `localStorage`，编辑器仍可用。

校验

- 每次渲染扫一遍样式表：括号与注释闭合、声明可解析、值被引擎接受；状态行给出**行首问题 + 总数**（最多 5 处）。
- **描述符块单独处理**：`@property` 的 `syntax` / `inherits` / `initial-value` 是 descriptor 而非 CSS 属性，`CSS.supports()` 一律不认 —— 早期实现把它们当声明判，合法的 `@property` 会被报成 3 处错误。现在 `@property` 按描述符规则校（`syntax` 必须带引号、`inherits` 只能布尔），`@font-face` / `@page` / `@counter-style` / `@viewport` / `@font-palette-values` / `@font-feature-values` 整块交给引擎。
- 回归测试覆盖：合法 `@property` **零报错**、非法描述符必须报出、`!important` 不算值的一部分。

文档

- README 补齐：从 npm / GitHub 安装（`dsh plugin --profile web add` + `dsh.profile.bundles` 两步）、本机 `link:` 安装、仓库结构、以及一节**已知坑**（注入顺序与 `!important`、类名哈希、`:has()` 不可嵌套、描述符不是属性、host 半需重启、自定义属性动画需 `@property`）。

发布

- `0.1.0` 于 2026-09-13 发布到 npm（`npm i dsh-custom-css` / `registry.npmjs.org`，10 个文件，带 registry 签名）。首次发布走本机 `npm publish` + 浏览器 OTP；此后由 `.github/workflows/publish.yml` 以受信发布（OIDC + provenance）完成，不需要长期令牌，也不会再弹动态码。
