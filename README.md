# dsh-custom-css

<!-- Hero：徽章与特性卡片的色号取自图标渐变的四个停靠点（绿 #257b56 / 青 #257083 / 蓝 #3156af / 紫 #6048bb）。
     图标走 jsDelivr 镜像而不是仓库内相对路径 —— 本机网络把 raw.githubusercontent.com
     解析到非公网地址，而 GitHub 渲染仓库内图片用的正是该域名，相对路径的图在本地打不开；
     图标本体仍在 assets/ 下，两处内容一致。
     下载量徽章暂缺：npm 的 downloads API 对刚发布的包要等约一天才有数据
     （实测此刻返回 404），届时可补 https://img.shields.io/npm/dm/dsh-custom-css 。 -->
<div align="center">
  <img src="https://cdn.jsdelivr.net/gh/FOX4096/dsh-custom-css@main/assets/icon.svg" width="88" height="88" alt="dsh-custom-css 图标：深色渐变圆角方块 + 白色花括号与三条声明行"><br /><br />
  <b style="font-size: 1.15em;">设置行里的 CSS 编辑器：写完即生效，样式表就是磁盘上的 .css 文件</b><br /><br />
  <a href="https://github.com/FOX4096/dsh-custom-css/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/FOX4096/dsh-custom-css/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/FOX4096/dsh-custom-css/releases"><img alt="release" src="https://img.shields.io/github/v/release/FOX4096/dsh-custom-css?label=release&amp;color=3156af"></a>
  <a href="https://www.npmjs.com/package/dsh-custom-css"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-custom-css?color=3156af"></a>
  <a href="https://www.npmjs.com/package/dsh-custom-css"><img alt="npm unpacked size" src="https://img.shields.io/npm/unpacked-size/dsh-custom-css?color=6048bb"></a>
  <a href="https://github.com/FOX4096/dsh-custom-css/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/FOX4096/dsh-custom-css?color=3156af"></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
  <a href="https://github.com/topics/dsh-plugin"><img alt="插件生态：GitHub topic dsh-plugin" src="https://img.shields.io/badge/插件生态-topic%20dsh--plugin-4d6bfe"></a><br /><br />
  <a href="https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions"><img alt="支持的 DSH 版本：0.1.2 与 0.1.5 已真机验证，接口契约断言覆盖到 0.0.1-rc.5" src="https://img.shields.io/badge/DSH-0.1.2_%7E_0.1.5_%28runtime_verified%29-4d6bfe"></a><br /><br />
  <img alt="即时生效" src="https://img.shields.io/badge/-即时生效-257b56"> <img alt="DevTools 编辑器" src="https://img.shields.io/badge/-DevTools_编辑器-257083"> <img alt="键入补全" src="https://img.shields.io/badge/-键入补全-3156af"> <img alt="规则面板" src="https://img.shields.io/badge/-规则面板-6048bb"> <img alt="格式校验" src="https://img.shields.io/badge/-格式校验-257b56"> <img alt="声明模板" src="https://img.shields.io/badge/-声明模板-257083"> <img alt="多文件管理" src="https://img.shields.io/badge/-多文件管理-3156af"> <img alt="明暗自适应" src="https://img.shields.io/badge/-明暗自适应-6048bb"> <img alt="属性字典" src="https://img.shields.io/badge/-属性字典-257b56"><br /><br />
  <b>文件下拉 · 打开文件 · 导入 · 导出 · 重置</b>，把 <code>~/.dsh/custom-css/</code> 下的样式表注入界面 ——<br />
  编辑器照 DevTools 的 Styles 标签页做：行号 gutter、语法高亮、键入补全、规则面板、格式校验。
</div>

DSH Web GUI 扩展：在 **设置 → 通用** 的「外观」下方增加一行 **自定义 CSS** —— 样式表以普通 `.css` 文件保存在宿主磁盘上，写进去即时应用到整个界面。

- npm：[`dsh-custom-css`](https://www.npmjs.com/package/dsh-custom-css)（2026-09-13 首发，当前版本见上方徽章）
- 兼容：DSH `0.1.2-rc.1` ~ `0.1.5-rc.1` 已真机验证，接口契约断言覆盖到 `0.0.1-rc.5`；`npm run compat` 可复跑（见「兼容性」）
- 许可：MIT
- 形态：DSH profile 插件（host 半 + 浏览器半），无构建步骤，`lib/*.js` 即产物
- 测试：`node tests/loader-smoke.cjs` / `node tests/host-api-smoke.mjs`

## 位置与行为

- 注册在 `settings.general.item` 槽，`order: 12`。DSH 自带的 `ui-theme` 在这个槽上占了 `appearance`(order 10) 和 `font-size`(order 11)，所以这一行正好落在它们下面。
- 样式表由 **host 侧**读写，存放在 `~/.dsh/custom-css/`（`$DSH_HOME/custom-css`，`$DSH_HOME` 未设时为 `~/.dsh`）。是普通文件：可用任意编辑器改、可备份、可放进版本库。
- 当前活动文件名与**各文件的开关**记录在同目录的 `active.json`（如 `{"active":"custom.css","disabled":["dark-tweak.css"]}`）。
- 编辑内容**即时生效**（防抖 400ms 后写回文件并重绘页面）。
- 编辑器是 DevTools Styles 标签页的样式：左侧**行号 gutter**、**语法高亮**（注释 / 选择器 / 属性 / 值 / 标点）、输入时弹出**补全列表**。
  - 高亮用 DSH 自己的 shiki 配色 token（`--shiki-token-keyword/constant/string/comment/punctuation`），所以与 Markdown 代码块同色并随浅深主题切换；渲染前逐段 HTML 转义，样式表永远不可能变成标记。
  - **补全数据来自浏览器本身**：属性名是从 `CSSStyleDeclaration.prototype` 枚举出来的（即该引擎真正认识的全部属性，含厂商前缀与新增属性），不再依赖手写列表 —— 手写列表只在没有 DOM 的调用方（如测试）里兜底。属性值的枚举集合仍由插件维护，但每个候选都先过 `CSS.supports(prop, value)`，引擎不认的直接不显示。
  - `↑`/`↓` 选择、`Enter` 或 `Tab` 采用、`Esc` 关闭，鼠标按下即采用；补全只在规则块内提示属性名（选择器区域不打扰）。
  - **只在真正键入时出现**：靠 `InputEvent.inputType` 判断，删除、粘贴、移动光标都不会弹出列表（老引擎缺这个字段时回退为"文本变长了才算输入"）。
  - **一行里的多条声明只看当前那条**：`color: red; ` 之后（分号紧邻，还没开始写新属性）不再弹任何补全 —— 否则同一行的冒号会把光标所在位置误判成"值"。
- **规则面板**：编辑器里的**选择器本身就是按钮**（`.cm-peak-strip` 这样的选择器带悬停底色与指针光标），点它在编辑器右侧展开面板：
  - 顶部是**可重命名的选择器输入框** —— 改名会原地改写样式表里的选择器，注释与缩进不受影响；
  - 中间是**这条规则已有属性的摘要**（不是一张空白表单）：
    - 解析规则块里真实存在的声明并逐条列出。枚举型属性显示**中文名 + 中文值下拉**（`flex-direction: row` → 「主轴方向：水平排列」）；非枚举型（`gap`、`margin-top`、`min-width`…）显示属性名 + **值输入框**，可以直接改。
    - 下拉里可选「（删除此项）」移除该声明；手工写的、不在选项里的值会被保留为当前选项，不会被静默改掉。
    - **未设置的属性不占行** —— 它们收在**选择器输入框正下方**的「**＋ 添加属性…**」菜单里（只列当前还没设的），菜单按用途分成 **布局 / 弹性与对齐 / 网格 / 尺寸 / 间距 / 文本 / 背景 / 描边与圆角 / 效果与动效 / 交互** 十组（整组都被设完时该组自动隐藏）。
    - **面板里所有下拉都是插件自绘的菜单**（DSH 原生菜单的底色 + 阴影 + 20px 圆角，与文件下拉同一套）：原生 `<select>` 的弹出层不受 CSS 控制（方角、跟随系统配色），所以这里不用它。菜单以 `position: fixed` 按触发按钮的位置定位，**不会被容器或面板自身的滚动裁掉**，视口下方不够高时自动向上展开。
    - **属性字典 112 条，三种形态**：枚举型（`display`、`position`、`justify-content`…）给**中文值下拉**，写入的是 CSS 值本身；长度 / 颜色 / 阴影 / 函数型（`gap`、`margin-top`、`font-size`、`box-shadow`、`grid-template-columns`…）给**中文标签 + 自由输入框**，选中即以一个可用的种子值写入（如 `gap: 8px`），输入框的占位文本就是该属性的取值提示（如 `0 / 8px / auto`）。字典里没有的属性也不会丢：仍然按原属性名给一个自由输入框。
    - **分量形态（简写属性）**：`flex` → 放大 / 收缩 / 基准尺寸三个框；`margin` / `padding` / `inset` / `border-radius` → 上 / 右 / 下 / 左四个框（占满整行）；`gap` → 行间距 / 列间距；`aspect-ratio` → 宽 / 高。每个框都有自己的提示（如 `基准尺寸 · auto / 0 / 240px`），改动任意一个框会与其余分量重新拼成一条声明。读取时按 CSS 的简写展开规则拆分（`margin: 8px 12px` → 8px / 12px / 8px / 12px），写回时**收敛成最短等价形式**（四个都是 8px 就写回 `margin: 8px`），所以编辑一个角不会把你的样式表改得啰嗦。`border-radius` 的斜杠形式（`8px / 12px`）表达的是两个轴向，一个角一个框表达不了，因此这种写法保留为自由输入框。
    - 规则里一条声明都没有时，面板显示「这条规则还没有声明」。
  - 面板**排在代码下方**（占满容器宽度），声明与模板都按**自适应网格**铺开：声明 `repeat(auto-fill, minmax(240px, 1fr))`、模板 `minmax(104px, 1fr)`；一条规则声明很多时面板自身限高 `260px` 内滚动，不会把整个设置行撑长。
  - 最下面是**声明模板**：容器 / 横向排列 / 居中 / 网格 / 文本 / 背景 / 描边 / 阴影 / 尺寸 / 间距 / 截断 / 滚动 / 吸顶 / 隐藏 —— 点一下按 2 空格缩进追加到块内（已有内容保留）。
  - **改属性是替换，不是叠加**：同一个属性反复改只会有一条，绝不堆成 `display: flex; display: grid;`。写入走的是"逐条声明"的扫描而不是正则替换 —— 声明之间是换行分隔、最后一条常常没有分号，任何假设 `;` 分隔的做法都会失手并追加重复。
  - 块在写入前会**规范化**：若某条声明缺了结尾的 `;`（老版本模板插入留下的、或手写的），自动补上再做编辑 —— 所以那种被粘连的老文件也能被逐次修正，不需要手工清理。
  - 面板**贴着编辑器的下沿**伸缩：拖编辑器右下角的 resize 手柄，两个框一起变高，不会一大一小。
  - 选择器按钮浮在高亮层上（该层其余部分仍然点击穿透到文本框），所以点选择器不会把光标打乱。
- **格式校验**：每次渲染都扫一遍 —— 括号与注释必须闭合、每条声明必须可解析、每个值必须被引擎接受（`CSS.supports`）。有问题时状态行变红并给出**行首问题 + 总数**（如 `第 3 行 color 的值无效：notacolor`、`第 73 行 syntax 必须是带引号的字符串，例如 '<color>' 等 3 处`），最多看 5 处；正常时状态行保持中性色。
  - **描述符块走自己的规则**：`@property --x { syntax: '<color>'; inherits: true; initial-value: … }` 里的 `syntax` / `inherits` / `initial-value` 是 **descriptor 而不是 CSS 属性**，`CSS.supports()` 一律不认 —— 早期版本就是把它们当声明判，于是一个完全合法的 `@property` 被报成 3 处错误。现在按块类型分流：`@property` 用描述符规则校（`syntax` 必须带引号、`inherits` 只能 `true`/`false`），`@font-face` / `@page` / `@counter-style` / `@viewport` / `@font-palette-values` / `@font-feature-values` 这些描述符块整块交给引擎，其余规则照旧逐条过 `CSS.supports`。
- 注入的 `<style id="dsh-custom-css-user-style">` 追加到 `<head>` 末尾，同特异性下优先于内置样式表；需要压过内置规则时用 `!important`。
- 启动时由 `apply()` 直接读取并应用活动样式表 —— 不依赖设置面板打开（只在面板挂载的组件里应用的话，普通对话页永远拿不到样式）。

## 这一行上的五个控件

从左到右：**[文件下拉] [打开文件] [导入] [导出] [重置]**；而**编辑器整块（表头 + 正文 + 状态行）在同一个容器里** —— 表头右侧另有一个**开关胶囊**。

| 控件 | 行为 |
| --- | --- |
| 文件选择器 | DSH 原生样式的下拉（触发按钮 + 弹出菜单，**不是**原生 `<select>`）：列出目录里全部 `.css`，当前项带勾选；切换即写回 `active.json` 并立刻换用该文件。**最下面一项是「＋ 新建…」** |
| ＋ 新建… | 选中后行内出现文件名输入框（Enter 创建 / Esc 取消），创建空文件并切换过去；重名返回「已存在」 |
| 打开文件 | 用**系统默认程序**打开当前选中的那个文件（浏览器的文件对话框只能选文件、不能"打开"，所以由 host 侧 `POST /open` 调起系统关联程序），适合在真正的编辑器里改 |
| 导入 | 用文件对话框从磁盘选一个 `.css`，其内容复制为目录里的新文件并切换过去；同名自动加 `-2`、`-3` 后缀，绝不静默覆盖 |
| 导出 | 把当前样式表另存为文件：优先用 File System Access 的「另存为」选择器指定位置，不支持时回退为浏览器下载 |
| 重置 | 清空当前文件内容（移除注入的样式；文件本身保留）。语义是破坏性的，用错误色与其他按钮区分 |
| 开关胶囊（容器表头） | 编辑器容器**表头**的右侧：**临时停用当前样式表** —— 样式不再注入页面，而文件内容、当前选择、校验状态全都不动。状态写进 `active.json` 的 `disabled` 列表，因此多个浏览器与重启后一致。左侧是「CSS 图标 + 文件名 + `CSS` 徽章」，与状态点一起构成这一行的身份区 |

> 「导入」是复制而不是链接原文件：浏览器出于安全不会把所选文件的完整路径交给页面。原文件不受影响；要反复编辑同一份文件，请用「打开文件」。

## host 侧文件接口

host 侧在 `/dsh-custom-css` 前缀上挂了一组 JSON 端点，并且**必须**通过 Connection 服务的请求围栏（未认证 / 非信任来源直接 401/403；拿不到围栏时 503 fail-closed，绝不裸奔）：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/list` | `{ files, active, disabled, dir }` |
| GET | `/read?name=<name>` | `{ name, css }` |
| POST | `/write` | 写入指定文件 |
| POST | `/create` | 新建空文件（已存在 → 409） |
| POST | `/import` | 导入内容为文件（按设计覆盖同名） |
| POST | `/active` | 记录当前文件 |
| POST | `/toggle` | `{ name, enabled }` → 打开 / 关闭某张样式表（**文件保留**），状态记进 `active.json` 的 `disabled` |
| POST | `/open` | 用系统默认程序打开指定文件（仅限目录内已存在的 `.css`） |

文件名限定为**单个路径段且以 `.css` 结尾**（`^[A-Za-z0-9._一-龥-]+\.css$`，≤64 字符）；`..`、分隔符、无扩展名一律 400。目录外的路径在拼接后还会二次校验。

## 设计一致性

行内样式全部来自 DSH 自身的设计变量与行规格，因此会跟随当前主题（浅色/深色）自动变色，无需为配色方案写分支：

| 元素 | 规格 | 来源 |
| --- | --- | --- |
| 行容器 | `0.5px solid --dsw-alias-border-l2` 分隔线，上下 `16px` 内边距，`gap: 8px` | General 章节各行的统一规格 |
| 标题 | `14px/22px`，`--dsw-alias-label-primary` | 同 `AppearanceRow` / `FontSizeRow` |
| 说明 / 状态 | `12px/18px`，`--dsw-alias-label-tertiary`；错误用 `--dsw-alias-state-error-primary` | 同上 |
| 按钮 / 下拉 / 输入 | 圆角 `8px`、`13px`、描边 `--dsw-alias-border-l2`、聚焦环 `--dsw-alias-brand-primary` | 插件卡片控件规格 |
| 按钮语义色 | 中性按钮文字 `--dsw-alias-label-secondary`，hover 底色 `--dsw-alias-interactive-bg-hover`；**重置**用 `--dsw-alias-state-error-primary`（浅色 `#ec1313` / 深色 `#f25a5a`）+ hover 底色 `--dsw-alias-interactive-bg-hover-danger` | 破坏性操作与普通操作用色区分 |
| 下拉与菜单 | 触发按钮：`--dsw-alias-bg-module-platform`、`36px` 高、圆角 `18px`、内边距 `0 14px`、`14px/22px`；菜单：`--dsw-specific-menu` 底 + `--dsw-elevation-prominent` 阴影、圆角 `20px`、`4px` 内边距；菜单项：圆角 `10px`、`min-height 40px`、hover `--dsw-alias-interactive-bg-hover` | 逐值照抄 DSH 设置行 selector（`oY77xG_selector` / `T1PP_q_selector` / `lats3W_selector` 三者字节级相同）与共享下拉 `_root_1nxmc_1` |
| 编辑器 | 行号 gutter 与文本区共用一个等宽行高（`--dshCc-line: 19px`）；获得焦点时边框让位给 `--dsw-alias-brand-primary` 聚焦环；补全列表用共享菜单的紧凑规格（圆角 `7px`、项 `min-height 26px`、`12px/18px`） | DevTools 风格的代码编辑外观 + 共享菜单层级 |
| 编辑器容器 | 圆角 `12px` + `--dsw-alias-border-l2` 描边、`--dsw-alias-bg-layer-1` 底：**表头（文件名 + `CSS` 徽章 + 开关）／正文（代码在上、属性面板在下，均占满宽度）／状态行** 三段同框；表头与状态行用 `--dsw-alias-bg-module-platform` 与 `0.5px` 分隔线区分 | 设置面板里成块控件的统一做法 |

## 安装

### 方式一：从 npm 安装（推荐）

**前置**：DSH `0.1.2-rc.1` ~ `0.1.5-rc.1`（**已真机验证**；接口契约断言覆盖到 `0.0.1-rc.5`，见「兼容性」），Node.js ≥ 20、pnpm ≥ 10。

```bash
# 1) 把插件装进 profile（dsh plugin 会把参数转发给 profile 目录里的 pnpm）
dsh plugin --profile web add dsh-custom-css

# 2) 让它真的被加载：把包名加进 profiles/web/package.json 的 dsh.profile.bundles
#    "dsh": { "profile": { "bundles": [ ..., "dsh-custom-css" ] } }

# 3) 重启 GUI（重开会话不够，进程内模块缓存是旧的）
```

### 方式二：从 GitHub 安装（跟 main 分支）

```bash
dsh plugin --profile web add github:FOX4096/dsh-custom-css
```

方式一里第 2、3 步照旧（`bundles` 里写同一个包名、重启 GUI）。

**第 1 步和第 2 步缺一不可**：只装依赖不列进 `bundles`，包根本不会被 loader 载入；只写 `bundles` 没装依赖，启动时直接失败。反过来，列进 `bundles` 的包**必须自带 `dsh.bundle.patch`** —— `dsh-app-boot` 会为每个包读 `package.json` 的 `dsh.bundle.patch`，缺失即启动失败：

```
profile bundle "…" declares no dsh.bundle in its package.json
```

本仓库的 `cordis.patch.yml` 用 `- insert:` 声明自己的 loader 条目；改写它（或 `dsh.bundle` 字段）会直接让 DSH 起不来。改完用 `dsh web --dump-default-config` 复查：该命令只解析不启动服务器，输出里应出现 `# == dsh-custom-css` 段。

### 方式三：本机开发安装（`link:`，改完即见）

1. `package.json` 的 `dependencies`：
   `"dsh-custom-css": "link:<本仓库绝对路径>"`
2. `package.json` 的 `dsh.profile.bundles` 加入 `"dsh-custom-css"`
3. `profiles/web/node_modules/dsh-custom-css` 建 junction 指向本目录
4. **重启 GUI**

`pnpm install` 会重建 `node_modules`，可能抹掉该 junction；重建一次即可。

## 兼容性

插件与 DSH 的耦合面是刻意做窄的，所以它跨版本比多数插件活得久：**浏览器半在运行时一个 `@deepseek-ai/*` 模块都不 require**（只通过 `dsh.client.inject` 声明可用 id、并从 Context 取 `slots` 服务），host 半只挂 HTTP 路由。真正依赖的平台契约只有四条，全部记在 [`compat.json`](./compat.json)，由 `npm run compat` 逐个版本断言：

| 契约点 | 内容 |
| --- | --- |
| 槽位 | `settings.general.item`（`@deepseek-ai/dsh-client-ui-settings-general` 里 `GeneralSection` 渲染的那个 seat） |
| 声明的模块 id | `@deepseek-ai/dsh-client-ui-settings`、`@deepseek-ai/dsh-client-ui-settings-general` |
| 需要的服务 | 仅 `slots` |
| 运行时 require | 零 |

### 验证矩阵

| DSH 版本 | 验证方式 | 结论 |
| --- | --- | --- |
| `0.1.5-rc.1` | 真机运行（本仓库开发环境） | 通过 |
| `0.1.2-rc.1` | 真机运行：独立 `DSH_HOME` 起实例，`/dsh-custom-css/list`、`/write`、`/read` 全部 200 且文件确实落盘 | 通过 |
| `0.1.1-rc.2` / `0.1.0-rc.7` / `0.0.1-rc.5` | 接口契约断言（`npm run compat` 解包该版本的 settings 包，核对槽位与 id） | 通过 |

`npm run compat` 需要网络（要拉各版本的包），所以本地 `npm test` 保持离线可跑；CI 里单跑一档。

**两种失效模式的判别**：槽位若被 DSH 改名，行内控件会**静默不出现**（没有报错）—— 这正是 `npm run compat` 要提前挡住的事；而 bundle 里若硬 require 了平台包（如 `@deepseek-ai/dsh-client-runtime/client`），加载时会抛 `client-modules: require("…") missed the module table`（见下文「已知坑」）。

## 已知坑（都是实测踩出来的）

| 坑 | 现象 | 结论 |
| --- | --- | --- |
| 注入顺序不定 | 自定义 CSS 与 DSH 内置样式表同为 `(0,1,0)` 特异性时，谁后插入谁赢，而两者的插入时机都不受你控制 | 覆盖 DSH 自己的类名时**一律加 `!important`**，让结果与顺序无关 |
| 类名是构建哈希 | `hHd-Xa_footArea`、`VOzbGW_triggerRow` 这类名字会随 DSH 版本变 | 用它做选择器的样式在 DSH 升级后要复测；从 DOM 里抓类名的正则**必须包含 `-`**，否则会截掉 `hHd-` 前缀、选择器永不命中 |
| `:has()` 不能嵌套 | 写成 `:has(div:has(> .foo))` 时 Chrome 抛 `is not a valid selector`，**整条规则被静默丢弃**（不报错、不生效） | `:has()` 只写一层，把「直接父级」的约束放进同一条相对选择器里（`> div:not(...) > .foo`） |
| 描述符不是属性 | `@property` 块被校验器报成「syntax 的值无效」等 3 处 | 校验按块类型分流（见上文「格式校验」）；`CSS.supports` 判不了 descriptor |
| host 半不热更新 | 改 `lib/index.js` 后刷新页面毫无变化 | host 半必须**重启 dsh**；只有浏览器半（`lib/client.js`）走 `dsh-client-hmr` 热更新 |
| 自定义属性动画 | `--my-color` 在关键帧之间硬跳，不插值 | 这是规范行为：先用 `@property --my-color { syntax: '<color>'; inherits: true; initial-value: … }` 声明类型，浏览器才肯对它做插值 |
| 跨代插件 | 插件加载失败：`client-modules: require("…") missed the module table` | 那是给**旧一代 DSH** 编译的 bundle：它把平台包硬写进了产物（如 `@deepseek-ai/dsh-client-runtime/client`、`dsh-client-ui-primitives`），而当前代已删掉这些包。只能等插件作者更新；本插件运行时 require 数为 0，不受这类漂移影响 |

## 仓库结构

```
dsh-custom-css/
├── package.json        # 插件清单：dsh.bundle / dsh.client 两个约定块
├── cordis.patch.yml    # loader 补丁（- insert: 自己的条目）
├── lib/
│   ├── index.js        # host 半：样式表目录 + 围栏内的 JSON 接口
│   └── client.js       # 浏览器半：设置行、编辑器、补全、校验、规则面板
├── tests/
│   ├── loader-smoke.cjs    # 假 host 里真跑 client.js（含校验、补全、规则面板）
│   └── host-api-smoke.mjs  # 假 webServer 驱动 host 路由（含穿越拒绝、fail-closed）
├── .github/
│   └── workflows/ci.yml    # CI：Node 20/22 × 语法自检 + 两套冒烟测试（无依赖，几秒跑完）
├── assets/
│   ├── icon.svg            # 图标（矢量，README 顶部用的就是它）
│   └── icon-512.png        # 同一图标 512px，带透明通道，可用于仓库头像 / 社交预览
├── LICENSE
├── CHANGELOG.md
└── README.md
```

## 已知限制

- 只能**追加** CSS，不能修改内置样式表本身。
- 跨浏览器会话跟随的是**文件**而非 origin，因此端口变化（如 DSH Desktop 每次分配端口）不影响已保存的样式表。
- host 文件接口不可达时（例如跑在非 Web composition 里）自动降级：编辑器仍在、样式仍生效，但内容退回浏览器 `localStorage`，且此行隐藏下拉与「打开文件」并给出提示。
- 未注册多语言字典，界面文案为中文。

## 开发

- `lib/client.js` 是交给 DSH 浏览器模块加载器的产物（`window.__ModuleLoader__.load({ id, factory })` 工厂），**不是**普通 ES 模块 —— 与 DSH 自身 `@deepseek-ai/dsh-client-ui-*` 的产物同构。
- `lib/index.js` 是 host 侧：拥有样式表目录、挂载围栏内的 JSON 接口。路由挂载方式与 `dsh-smooth-stream` 一致（本代内核的 `connection.rpc.handle()` 会因服务内部 Context 未注入 `webServer` 而失败，直挂 Web 服务器是受支持的兜底）。
- `node --check lib/client.js`：语法自检（浏览器半是 `.js` 但按模块工厂包了一层，**不要**当 ESM 引入）。
- `node tests/loader-smoke.cjs`：用假 host 真实执行 `lib/client.js`，校验模块形状、槽注册参数、host 支撑的启动应用、离线降级、首次运行从 `localStorage` 播种默认文件，以及**组件真能渲染**。其中包含校验器的两类回归：合法的 `@property` 块必须**零报错**，非法描述符（`syntax: <color>`、`inherits: maybe`）必须**报出来**。补全、规则面板、属性下拉也各有断言。
- `node tests/host-api-smoke.mjs`：用假 `webServer` 驱动 host 路由，校验文件 API、目录簿记、重名冲突、**路径穿越与非法文件名拒绝**、`/open` 的启动器注入、以及无围栏时的 fail-closed。
- **CI**（[`.github/workflows/ci.yml`](./.github/workflows/ci.yml)）：Node 20 / 22 两档，跑上面四条 `node --check` 加两套冒烟测试。插件没有构建步骤也没有运行时依赖，所以 CI 里不装任何东西，几秒结束 —— 顶部那枚 CI 徽章就是它。

## 许可

MIT，见 [LICENSE](./LICENSE)。改动记录见 [CHANGELOG.md](./CHANGELOG.md)。
