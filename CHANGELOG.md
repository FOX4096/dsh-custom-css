# 更新日志

本文件记录 `dsh-custom-css` 的用户可见变更。版本号跟随 `package.json`。

## 0.1.3 — 编辑器面板重做 · 已发布 2026-09-13

这一版把「设置 → 通用 → 自定义 CSS」这一行的形态定下来：一个容器、三段布局（表头 / 正文 / 状态行），属性面板移到代码下方并以网格铺开，同时补上 112 条属性字典与简写属性的分量输入。

### 编辑器行

- 新增**文件条**：`#` 图标 + 文件名 + `CSS` 徽章 + 状态点 + **开关胶囊**。
- **开关语义是临时停用当前样式表**：样式不再注入页面，而文件内容、当前选择、校验状态全都不动。状态写进 `active.json` 的 `disabled` 列表，多个浏览器与重启后表现一致；host 半新增 `POST /toggle {name, enabled}`、`GET /list` 增加 `disabled` 字段（旧的 `{"active": …}` 文件仍可读，缺失即视为全部启用）。旧 host 半（尚未重启 dsh）会让开关回退到本浏览器 `localStorage`，功能不失效。
- **整块编辑器收进一个容器**：表头 / 正文（代码 + 属性面板）/ 状态行三段同框。容器是**单列 grid**（`grid-template-columns:minmax(0,1fr)`），每一块都写明 `width:100%` + `box-sizing:border-box` + `min-width:0`，不再依赖 flex 默认的 `align-items:stretch`。

### 规则面板

- 面板从代码右侧移到**代码下方**，声明与模板按自适应网格铺开（声明 `minmax(200px,1fr)`、模板 `minmax(124px,1fr)`），面板限高 `260px` 内滚动；代码区成为容器内独立的一层表面。
- **属性字典 14 → 112 条**，分十组（布局 / 弹性与对齐 / 网格 / 尺寸 / 间距 / 文本 / 背景 / 描边与圆角 / 效果与动效 / 交互）；"＋ 添加属性…" 菜单用 `<optgroup>` 分组，整组设满时该组自动隐藏。
- **字典支持三种形态**：
  - **枚举型** → 中文值下拉（写入的是 CSS 值本身）；
  - **自由型**（`gap`、`margin-top`、`font-size`、`box-shadow`、`grid-template-columns` …）→ 中文标签 + 自由输入框，添加时写入字典里的种子值，占位文本即取值提示；
  - **分量型** → `flex`（放大 / 收缩 / 基准尺寸）、`gap`（行 / 列）、`margin` / `padding` / `inset` / `border-radius`（上 / 右 / 下 / 左）、`aspect-ratio`（宽 / 高）。读取按 CSS 简写展开规则拆分（`margin: 8px 12px` → 8px / 12px / 8px / 12px），写回收敛为最短等价形式（四值相同 → `margin: 8px`）；分量名是浅底小标签（`--dsw-alias-markdown-tag` + `label-secondary`），与值成对排在同一行；`border-radius` 的斜杠形式保留自由输入框。
- **面板里的下拉全部改为自绘菜单**：原生 `<select>` 的弹出层由操作系统绘制、CSS 控制不到（方角 + 系统配色），现在用与文件下拉同一套的 DSH 菜单（`--dsw-specific-menu` 底 + `--dsw-elevation-prominent` 阴影 + 20px 圆角 + 10px 圆角菜单项）。菜单以 `position: fixed` 按触发按钮定位，既不会被容器的 `overflow:hidden` 裁掉、也不会被面板自身的滚动区截断；视口下方不足 240px 时自动向上展开。
- **控件规格对齐 DSH 自身的设置行**：36px 高 / 18px 圆角胶囊 / 14px 字号 —— 属性值输入框、下拉触发按钮、选择器字段、行内文件名输入框、同行动作按钮统一 36px（字段为胶囊、动作为 8px 矩形，保持层级）；菜单项 36px 高、模板 chip 36px 高。
- **选择器字段与 `×` 合为一个控件**：`×` 从输入框右侧的独立按钮改为**框内的圆形按钮**（26px），输入框因此铺满面板宽度；聚焦环移到外层字段、输入框本身无边框。「＋ 添加属性…」位于**属性列表下方**，铺满面板宽度、文案靠左、箭头贴右端。

### 修复

- **孤儿声明让样式表后半段全部失效**：删 `.dshCc_propValue` 规则时只删掉了选择器行、留下两行声明，使注入的样式表大括号失衡（`{` 112 个、`}` 113 个）—— 浏览器会从失衡处**丢弃后面所有规则**，面板输入框因此退回浏览器默认外观。测试新增**大括号必须平衡**的断言：文本断言看不出解析错误，这条能。
- **控件被容器压缩**：面板是 `max-height:260px` 的纵向 flex 容器，子元素默认 `flex-shrink:1`，内容一超高就把直接子元素挤扁（选择器字段实测被压到 **26px**，而样式表写的是 36px）。现在 `.dshCc_panel>*{flex:none}`，行高由样式表决定、超出部分由面板滚动。
- **网格项 / flex 项的固有宽度溢出**：两者默认 `min-width:auto`（等于内容的 max-content），而 `<select>` 会把最宽选项报成固有宽度，一个长选项就能撑破面板。整条链路补 `min-width:0` 与 `max-width:100%`，面板另加 `overflow-x:hidden` 兜底。
- **容器内的 16px 溢出**：正文行设了 `padding:8px` 却没写 `box-sizing:border-box`，盒宽 = 容器宽 + 16px，把代码区与属性面板一起顶出右边界。
- 代码编辑区最小高度恢复 **140px**（过程中曾误改为 120px，拖拽手柄因此能把编辑区缩到比自身高度还小）。

### 测试与验证

- 浏览器半新增：开关（渲染 → 关闭后样式标签被移除 → 恢复后样式回到页面 → host 无该路由时仍可用并落到 localStorage）、简写分量（`flex` 三分量、`margin` 两值展开成四框、`gap` 两值收敛回单值、圆角斜杠回退）、结构断言（容器三段互为直接子节点、面板在代码下方、添加属性控件在网格下方）、样式守卫（大括号平衡、盒子与收缩规则）。
- host 半新增：`/toggle` 的持久化、遍历名 400、缺失文件 404、非布尔值 400。
- 用无头 Edge + puppeteer-core 做真实排版测量（容器 600 / 420px 两档）：控件统一 36px、编辑区 140px、分量行与网格同宽、`scrollWidth` 等于容器宽、无元素越界。
- 兼容性未变：`0.1.2-rc.1` 与 `0.1.5-rc.1` 已真机验证，`0.0.1-rc.5` / `0.1.0-rc.7` / `0.1.1-rc.2` 接口断言通过（`npm run compat`）。

## 0.1.2 — 兼容性证据与换代门禁 · 已发布 2026-09-13

- 新增 [`tests/compat-matrix.mjs`](./tests/compat-matrix.mjs) 与 [`compat.json`](./compat.json)：逐个 DSH 版本断言插件依赖的平台契约（槽位 `settings.general.item` 与 `dsh.client.inject` 的两个 id）。`npm run compat` 本地与 CI 均可复跑；CI 新增该步骤（单档）——**DSH 换代改名时会先在这里红**，而不是等用户看到模块表报错。
- 真机验证扩到 `0.1.2-rc.1`：独立 `DSH_HOME` 起实例，`/dsh-custom-css/list`、`POST /write`、`GET /read` 全部 200，文件确实落盘；`0.0.1-rc.5` / `0.1.0-rc.7` / `0.1.1-rc.2` 通过接口契约断言。README 新增「兼容性」一节（含验证矩阵与两种失效模式的判别）。
- README「已知坑」补一条：跨代插件的 `missed the module table` 报错成因与判别方法。
- **无运行时改动**：`lib/client.js` 与 `lib/index.js` 与 0.1.1 逐字节相同，本版只增加兼容性证据、门禁与文档。

## 0.1.1 — 发布通道与文档 · 已发布 2026-09-13

- README：新增 npm 徽章（version / unpacked size）；安装章节改为「**npm 优先**」，GitHub 装法与 `link:` 开发安装顺延为方式二、方式三；顶部元信息补 npm 包链接。
- README：注释里记下下载量徽章暂缺的原因（npm downloads API 对刚发布的包要等约一天才有数据），届时补 `img.shields.io/npm/dm/dsh-custom-css`。
- `publish.yml`：打开 `push: tags: ['v*']` 触发（OIDC 受信发布 + provenance 签名），并把唯一前置写进注释 —— 先在 npmjs.com 给这个包配置 Trusted Publisher。
- **无运行时改动**：`lib/client.js` 与 `lib/index.js` 与 0.1.0 逐字节相同，本版只为刷新 npm 页面上的 README 并走通自动发版流水线。

## 0.1.0 — 首个公开版本 · 已发布 2026-09-13

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
