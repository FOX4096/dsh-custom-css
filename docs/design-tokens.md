# 设计一致性

[← 返回 README](../README.md) · [文档索引](./index.md)

行内样式**全部来自 DSH 自身的设计变量与行规格**，因此会跟随当前主题（浅色 / 深色）自动变色，
**无需为配色方案写分支**。本文记的是每一处控件规格的出处。

改样式前先读这里：这些数字不是审美偏好，是从 DSH 自己的产物里逐值抄来的。

---

## 逐元素规格

| 元素 | 规格 | 来源 |
| --- | --- | --- |
| 行容器 | `0.5px solid --dsw-alias-border-l2` 分隔线，上下 `16px` 内边距，`gap: 8px` | General 章节各行的统一规格 |
| 标题 | `14px/22px`，`--dsw-alias-label-primary` | 同 `AppearanceRow` / `FontSizeRow` |
| 说明 / 状态 | `12px/18px`，`--dsw-alias-label-tertiary`；错误用 `--dsw-alias-state-error-primary` | 同上 |
| 按钮 / 下拉 / 输入 | 圆角 `8px`、`13px`、描边 `--dsw-alias-border-l2`、聚焦环 `--dsw-alias-brand-primary` | 插件卡片控件规格 |
| 按钮语义色 | 中性按钮文字 `--dsw-alias-label-secondary`，hover 底色 `--dsw-alias-interactive-bg-hover`；**重置**用 `--dsw-alias-state-error-primary`（浅色 `#ec1313` / 深色 `#f25a5a`）+ hover 底色 `--dsw-alias-interactive-bg-hover-danger` | 破坏性操作与普通操作用色区分 |
| 下拉与菜单 | 触发按钮：`--dsw-alias-bg-module-platform`、`36px` 高、圆角 `18px`、内边距 `0 14px`、`14px/22px`；菜单：`--dsw-specific-menu` 底 + `--dsw-elevation-prominent` 阴影、圆角 `20px`、`4px` 内边距；菜单项：圆角 `10px`、`min-height 40px`、hover `--dsw-alias-interactive-bg-hover` | 逐值照抄 DSH 设置行 selector（`oY77xG_selector` / `T1PP_q_selector` / `lats3W_selector` 三者**字节级相同**）与共享下拉 `_root_1nxmc_1` |
| 编辑器 | 行号 gutter 与文本区共用一个等宽行高（`--dshCc-line: 19px`）；获得焦点时边框让位给 `--dsw-alias-brand-primary` 聚焦环；补全列表用共享菜单的紧凑规格（圆角 `7px`、项 `min-height 26px`、`12px/18px`） | DevTools 风格的代码编辑外观 + 共享菜单层级 |
| 预览块 / 令牌页 / 全屏视图（0.8 起的新界面） | 与既有块同一套：块本身 `--dsw-radius-md` + `--dsw-alias-bg-module-platform` + `0.5px --dsw-alias-border-l2`；内层视口 `--dsw-radius-sm` + `--dsw-alias-bg-layer-1`；说明文字 `--dsw-font-xxs-12` + `--dsw-alias-label-caption`（与历史版本页那条一样的规格）；全屏卡片用 `--dsw-alias-settings-card-fill` / `-stroke` + `--dsw-elevation-prominent` | 这条是**事后统一**：新功能一开始各写各的字号与内边距，2026-10 按本页的阶梯与 DSH 卡片规格对齐了。**v4 起预览块的控件只用 28px 档**（`ui` 的 `size:'sm'`），那一排不再有 22 / 18 / 17px 三个自创高度 |
| 编辑器容器 | 圆角 `12px` + `--dsw-alias-border-l2` 描边、`--dsw-alias-bg-layer-1` 底：**表头（文件名 + `CSS` 徽章 + 开关）／正文（代码在上、属性面板在下，均占满宽度）／状态行** 三段同框；表头与状态行用 `--dsw-alias-bg-module-platform` 与 `0.5px` 分隔线区分 | 设置面板里成块控件的统一做法 |

---

## 几条容易搞错的地方

### 只有两个按钮高度

DSH 的 Button 只有 **36px**（`14px` 字号、`0 14px` 内边距）与 **28px**（`12px`、`0 10px`）两档。
自创第三个高度会让这一行看起来「不像 DSH」，即使肉眼看不出差 2px。

### 圆角与字号有阶梯，别自创

- 圆角：`--dsw-radius-xs` 4 / `-sm` 8 / `-md` 12 / `-lg` 16 / `-xl` 20 / `-panel` 28
- 字体：`--dsw-font-xxxs-11`(11/14) / `-xxs-12`(12/18) / `-xs-13`(13/20) / `-s-14`(14/22)

`npm run audit` 里有一个**圆角审计**与一个**字体审计**在守这两条：样式表里出现阶梯之外的
数值就点名。它们抓的是「看起来差不多」的那种偏差。

### 代码字体只有一处来源

`--ds-font-family-code`（`"SF Mono", "JetBrains Mono", "Fira Code", Consolas, …, "PingFang SC", "Microsoft YaHei"`）。
自己写一份等宽字体栈在浅深主题、不同系统上会和 Markdown 代码块不一致 ——
曾经在三处各写了一份，其中一个还在逗号后多了空格。

### 毛玻璃：`backdrop-filter` 放 `::backdrop` 上，且遮罩要半透明

原生 `<dialog>` 的 `::backdrop` 是 top layer 里的真实元素，所以 `backdrop-filter` 直接写在它身上就生效（`blur(18px) saturate(1.15)`）—— 不需要额外包一层，也不要用 iframe（iframe 里的 `backdrop-filter` 糊不到外面）。
但 `--dsw-alias-bg-overlay` 是**不透明**的 `#e9ecf2`：直接当遮罩色会把页面彻底盖住，模糊等于白做。
正确写法是先混成半透明（`color-mix(in srgb,var(--dsw-alias-bg-overlay) 55%,transparent)`），并在 `prefers-reduced-transparency:reduce` 时退回不透明。

### 增删点缀色是**底色**

`--dsw-alias-code-diff-added` / `-deleted` 的 alpha 只有 **0.08**（实测浅色下是 `rgba(34, 197, 94, .08)`）。
把它们当**文字色**用，标签在真机上等于隐身 —— 左侧「当前」/「修改后」就是这样差点没画出来。
正确用法：当小标签的底色，文字仍用 `--dsw-alias-label-secondary`。

### DSH 只有一个红

`state-error-primary`，语义是**错误**。所以它只用在「重置」（破坏性）与校验失败上。
用别的红会让读者以为出了错。

### 注入顺序不定，所以覆盖内置类名要 `!important`

自定义 CSS 与 DSH 内置样式表同为 `(0,1,0)` 特异性时，**谁后插入谁赢**，而两者的插入时机都不受你控制。
加 `!important` 让结果与顺序无关。见 [已知坑](./known-issues.md) 第一条。

### 焦点环是**全局**的

DSH 的焦点环由它在全局提供，这一行只补 `outline-style: solid` 与 `outline-offset` ——
不要把 `:focus-visible` 的环整个重写一遍，否则与 DSH 其余部分不一致。

## 相关

- [开发 · 测试](./testing.md) —— `npm run audit` 那几个审计各守什么
- [已知坑](./known-issues.md) —— 注入顺序、类名是构建哈希
- [`docs/naming.md`](./naming.md) —— 每个界面元素唯一的名字
