# 更新日志

本文件记录 `dsh-custom-css` 的用户可见变更。版本号跟随 `package.json`。

## 0.1.3 — 样式表开关与文件条

- 编辑器上方新增**文件条**：左侧「CSS 图标 + 文件名 + `CSS` 徽章」，右侧**开关胶囊**与状态点 —— 表头形态参考了 AnacondaKC 那版编辑器的做法，但控件规格与配色仍走本插件的行内控件家族与 DSH 设计令牌。
- **整块编辑器收进一个容器**：表头（文件名 + `CSS` 徽章 + 开关）、正文（代码 ｜ 属性面板）、状态行三段同框，不再各占一个盒子。容器持有描边与圆角，表头 / 状态行只负责自己的底色与分隔线（`overflow: hidden` 让底色贴合圆角，不必各自带 radius）。编辑器本身随之去掉自己的描边与圆角，最小高度 140px → 120px。
- 修掉容器内的 16px 溢出（**根因**）：正文行设了 `padding:8px` 却没写 `box-sizing:border-box`，于是它的盒宽 = 容器宽 + 16px，把代码区与属性面板一起顶出容器右边界。现在整条链路都显式声明盒子与宽度：容器改为**单列 grid**（`grid-template-columns:minmax(0,1fr)`），表头 / 正文 / 状态行的每一块都写明 `width:100%` + `box-sizing:border-box` + `min-width:0`，不再依赖 flex 默认的 `align-items:stretch`。用无头浏览器实测：容器 600px 时表头 / 正文 / 状态行均为 600px、`scrollWidth` 等于容器宽、无任何子元素越界（420px 宽度同样成立）；测试里对这六条盒子规则做了断言。
- 修掉网格化后的一处溢出：网格项与 flex 项默认 `min-width:auto`（等于内容的 max-content），而 `<select>` 会把最宽选项报成固有宽度，于是一个长选项就把整格撑出面板。现在整条链路都允许收缩（`.dshCc_propGrid>*{min-width:0}`、`.dshCc_prop{min-width:0}`、`max-width:100%`），面板另加 `overflow-x:hidden` 兜底；测试里对这几条规则做了断言，避免以后重新排版时被丢掉。
- 属性面板从**代码右侧**移到**代码下方**并改成网格：声明按 `repeat(auto-fill, minmax(240px, 1fr))` 铺开，模板按 `minmax(104px, 1fr)` 排成紧凑 chip；面板自身限高 `260px` 内滚动，声明再多也不会把设置行撑长。代码区因此成为容器内独立的一层表面（`bg-module-platform` + `8px` 圆角）。
- 冒烟测试新增**结构断言**：容器里确实同时渲染 `dshCc_fileBar` / `dshCc_main` / `dshCc_foot`，且三者都是容器的直接子节点 —— 布局回退会被测试挡住。
- 开关语义是**临时停用当前样式表**：样式不再注入页面，而文件内容、当前选择、校验状态全都不动。状态写进 `active.json` 的 `disabled` 列表，所以多个浏览器与重启后表现一致。
- host 半新增 `POST /toggle {name, enabled}`，`GET /list` 增加 `disabled` 字段（旧的 `{"active": …}` 文件仍可读，缺失即视为全部启用）。旧 host 半（尚未重启 dsh）会让开关回退到本浏览器 `localStorage`，开关因此不会失效。
- 冒烟测试补齐：浏览器半覆盖「渲染开关 → 关闭后样式标签被移除 → 恢复后样式回到页面 → host 无该路由时开关仍然可用并落到 localStorage」；host 半覆盖 `/toggle` 的持久化、遍历名拒绝、缺失文件 404、非布尔值拒绝。
- **`lib/` 本版有实质改动**（0.1.1 / 0.1.2 是纯文档与门禁版）。

## 0.1.2 — 兼容性证据与换代门禁

- 新增 [`tests/compat-matrix.mjs`](./tests/compat-matrix.mjs) 与 [`compat.json`](./compat.json)：逐个 DSH 版本断言插件依赖的平台契约（槽位 `settings.general.item` 与 `dsh.client.inject` 的两个 id）。`npm run compat` 本地与 CI 均可复跑；CI 新增该步骤（单档）——**DSH 换代改名时会先在这里红**，而不是等用户看到模块表报错。
- 真机验证扩到 `0.1.2-rc.1`：独立 `DSH_HOME` 起实例，`/dsh-custom-css/list`、`POST /write`、`GET /read` 全部 200，文件确实落盘；`0.0.1-rc.5` / `0.1.0-rc.7` / `0.1.1-rc.2` 通过接口契约断言。README 新增「兼容性」一节（含验证矩阵与两种失效模式的判别）。
- README「已知坑」补一条：跨代插件的 `missed the module table` 报错成因与判别方法。
- **无运行时改动**：`lib/client.js` 与 `lib/index.js` 与 0.1.1 逐字节相同，本版只增加兼容性证据、门禁与文档。

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
