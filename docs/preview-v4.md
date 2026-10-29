# 预览块 v4：重写方案

[← 返回 README](../README.md) · [文档索引](./index.md) · [现状（v3）](./preview.md)

> **状态：已实现并发布（0.13.0，tag `v0.13.0`）。** 实现与本文的差异只有三处，都记在 §12；
> 结构、控件、量测数字以本文为准，其余（为什么不用 iframe、保真度、芯片机制）仍在 [`preview.md`](./preview.md)；
> 实现落地后，`preview.md` 的「布局」「分阶段」两节由本文第 8、12 节接班，其余（为什么不用 iframe、
> 保真度口径、状态芯片的机制）继续有效，不重写。
>
> 一句话：**预览块不再是「行里攒出来的一堆闭包 + 借壳的胶囊」，而是一个真正的组件 ——
> 它拥有自己的状态，控件全部来自 `ui.*`，行内与全屏共用同一份渲染。**

---

## 1. 为什么重写，而不是接着修

这一版是第四轮改它。前三轮的修法都是「在现有结构上补一条」，于是每修一条就多一处耦合。
下面是实测出来的结构问题，按代价排序 —— 它们不是审美意见，每条都能指到行。

| # | 问题 | 证据（`lib/client.js`） |
| --- | --- | --- |
| 1 | **预览的状态全在行里，面板却是「当函数调用」的**（`RulePanel({…})`，不是 `createElement`），所以在面板里写 hook 就是条件 hook。结果：8 个 `useState` + 5 个 `ref` + 10 个处理器都住在 `CustomCssRow`，通过 30 多个 props 灌进面板 | 定义 `8539`，调用 `11781`；状态 `9240`–`9264`；处理器 `11100`–`11300`；props `11781`–`11807` |
| 2 | **行内与全屏是两份 JSX**（舞台、两块窗格、标签、归位各写两遍），差异靠 CSS 兜（`.dshCc_fullStage .dshCc_previewBox>:last-child{margin:auto}` 就是在补第二份的结构差） | 行内 `9019`–`9046`；全屏 `9142`–`9167`；补丁 `1984` |
| 3 | **绘制由模块级可变字符串驱动**：`previewSignature` 只含「选择器 + 表长度 + 视图 + 索引 + 芯片 + 排除」，于是窗口变宽、容器变窄、主题切换、表在别处被改，都不会重画 | `971`、`1159`、`1243`、`1336`、`1409`、`11100` |
| 4 | **控件语义借壳**：全屏 / 对比 / 列表 / 适应 / 状态芯片全都用 `.dshCc_hlToggle` —— 那是「强调显示」那枚警告色胶囊的类（`2005`）。借完还得再写一条覆盖规则把它的选中色改回中性（`2010`） | `8881`–`8913`、`8953`–`8970`、`2010` |
| 5 | **自创控件高度**：归位 22px（`1934`）、游标钮 18px（`1905`）、下拉与胶囊 11px/17px（`1943`、`1948`）。[设计一致性](./design-tokens.md) 写死「只有 36px 与 28px 两档」 | 同上 |
| 6 | **渲染期做重活**：每次渲染都 `resolveSelector` 三次、`diagnoseElement` 沿祖先链走一遍、`getComputedStyle` 读一次 —— 编辑器每敲一个字都重算 | `10979`–`11005` |
| 7 | **状态芯片会空转**：芯片是固定五枚，但 `forcePreviewStates` 只做「选择器里把 `:hover` 换成状态类」的字符串替换。选择器里没有 `:hover` 时替换无匹配，临时表注入了也等于没注入 —— 用户点一下，什么都没发生 | `988`、`1228`–`1231` |
| 8 | **「适应」只量一次**：只在「fit 变了」或「从没量过」时重算，窗口 / 容器变宽变窄不重算 | `11107`–`11113` |
| 9 | **拖动没有边界**：`canvasDragTo` 只做加法，样本可以被整块拖出窗格，唯一出口是「归位」 | `1073`–`1086`、`11210`–`11214` |
| 10 | **全屏不管焦点**：`showModal()` / `close()` 之外没有任何焦点安排 —— 打开后焦点落在哪、关掉后回到哪，都没写 | `11068`–`11078` |
| 11 | **文档已经和代码分家** | [naming.md](./naming.md) `226` 仍写「平移量按窗格各记各的」（已改回一份）、`234` 单屏预览写「规划中」（早就实现了）；CHANGELOG 未发布段仍写「全屏左右分开拖」 |
| 12 | **测试绑在实现上**：`loader-smoke` 靠 `dshCc_hlToggle` 找预览的三个按钮，换控件库必然要改它 | `tests/loader-smoke.cjs:5861` |

一句话归纳第 1、2、3 条：**预览块没有自己的边界**。它的一半在行里、一半在面板里，靠一个全局字符串
把两半缝起来 —— 于是每加一个功能，缝合线就多一处。

---

## 2. 目标与不变量

**目标**

1. 预览块是一个**组件**：自己的状态、自己的生命周期、自己的渲染函数。行只负责给它数据。
2. 它在**行内与全屏是同一份**：同一棵树、同一个绘制路径，`variant` 只影响尺寸类。
3. 它的每一个控件都来自 `ui.*`，和这个扩展其余部分同一套规格、同一套状态表达。
4. 修掉第 7–10 条那四个具体缺陷（空转的芯片、不重算的适应、没有边界的拖动、没人管的焦点）。
5. 让「改值 → 看效果」这一圈**不需要滚动**：预览块固定在面板顶部，正文滚动。

**不变量（前三轮拍板过的东西，一律保留）**

| 不变量 | 出处 |
| --- | --- |
| 组件按**页面实测宽度**排版，窗格只裁不滚 | 用户原话「不要改变组件大小」 |
| 默认**居中**，比窗口大的向两边对称溢出 | 「默认居中」 |
| 拖动是**一份平移量**，两块一起走 | 「拖动一个另一个也移动」 |
| `page` 档底色 = 组件在页面上的那层底（`--dshCc-page-backdrop`） | 「明明在对话里有背景，预览里没有」 |
| **不用 iframe**；样本 = 克隆 + 冻结计算样式 | `preview.md` 的两条实测理由 |
| 冻结口径那一行小字必须留着 | 诚实口径 |
| 对比的左边是「**打开这条规则时**的文本」，不是「去掉这条规则」 | `preview.md` 的口径表 |
| 浏览器半**零 `@deepseek-ai/*` require**、无构建、单文件 | `compat.json` |
| 命中 0 个 / 元素在排除名单 → 合成样本并**明确标注** | `preview.md` 边界表 |

---

## 3. 结构

```
CustomCssRow                       ← 只留：样式表文本、编辑器、面板开合、排除名单、行级写盘
└── React.createElement(RulePanel) ← 从「函数调用」改成「真组件」（这是前提）
    ├── .dshCc_panelHead           选择器输入 + 命中芯片 + ×
    ├── PreviewBlock                ← 新组件，拥有全部预览状态
    │   ├── PreviewBar             ui.segments / ui.choice / ui.button
    │   ├── PreviewHints           ui.status（warn）/ ui.hint + ui.button
    │   ├── PreviewStage           canvas → viewport → pan → sample（只此一份）
    │   ├── dialog(PreviewFull)    同一个 PreviewStage，variant="full"
    │   └── PreviewFoot            冻结口径 + 命中读数
    └── .dshCc_panelBody           renderBody()：预设 / 声明 / 加属性 / 模板（自己滚）
```

三个新角色，职责不重叠：

| 角色 | 是什么 | 碰 DOM 吗 | 在哪 |
| --- | --- | --- | --- |
| **`previewModel()`** | 纯计算：命中列表、目标元素、排除、合成、芯片适用范围、诊断、样本键 | 只读（`getComputedStyle`） | 模块级函数 |
| **`buildSample()`** | 纯构造：克隆 + 冻结样式 + 伪元素合成 + 表格包装 → 返回一个**游离节点** | 建节点，不插入 | 模块级函数 |
| **`PreviewBlock`** | 唯一的状态拥有者与唯一写 DOM 的地方 | 是 | 组件 |

`previewModel()` 与 `buildSample()` 是这一版的可测边界：它们不依赖 React、不依赖行的 ref，
`tests/loader-smoke.cjs` 的 `__probe` 可以直接断言。

### 3.1 谁必须是「真组件」：是 `PreviewBlock`，不是 `RulePanel`

`RulePanel` 现在是 `RulePanel({…})`（`11781`）—— 一个**普通函数调用**。它因此不能有 hook。

但重读之后：`RulePanel` 本来就**不需要** hook。它没有状态，只是「把 props 摆成一棵树」。
真正需要 hook 的是预览块。所以正确的切法是：

```
CustomCssRow（状态：样式表 / 面板开合 / 排除名单）
└── RulePanel({...})                 ← 保持普通函数：它只摆元素，没有状态
    └── React.createElement(PreviewBlock, {...})   ← 真组件，状态与副作用的唯一拥有者
```

这一点是实施第 1 步时确认的：把 `RulePanel` 改成 `createElement` 的唯一好处是「将来能在它里面
写 hook」，而它没有那个需要；代价是测试床（不展开函数组件）要跟着改一大片。**不做。**

> 代价说明：`renderBody()` 保持为闭包函数（正文给全屏共用），不改成子组件 ——
> 它读的是 20 多个 props，抽出去只会把同一堆 props 再传一遍。

---

## 4. 每个元素都用 `ui.*`（这就是「和其他组件一样」）

| 界面元素 | 现在 | v4 | 为什么 |
| --- | --- | --- | --- |
| 单屏 / 对比 | 两枚 `dshCc_hlToggle` 胶囊（`8879`–`8894`） | **`ui.segments`**（单选分段：`单屏` \| `对比`） | 它是一个「二选一」而不是两个独立开关；同一时刻只有一个视图 |
| 背景 | `ui.choice` + 两条覆盖式子选择器改字号与高度（`1945`–`1949`） | `ui.choice`（**不带覆盖**，28px 档） | 控件库的默认规格就是规格；需要 28px 就声明 `size:'sm'`，不写覆盖 |
| 全屏 | `dshCc_hlToggle`（`8881`） | `ui.button({ size:'sm' })` | 一次性动作，不是选中态 |
| 适应 | `dshCc_hlToggle` + `aria-pressed`（`8904`） | `ui.button({ size:'sm', pressed })` | 有选中态的动作按钮 —— 给 `ui.button` 补 `pressed`，别再造一个 |
| 状态芯片 | `.dshCc_hlToggle` 五枚（`8953`–`8970`） | `ui.button({ size:'sm', pressed })`，**只列该选择器真有的状态** | 见 §7.3 |
| 命中游标 ‹ 2 / 5 › | 18px 圆钮 + 11px 文本（`1905`–`1907`） | `ui.button({ size:'sm', icon })` ×2 + `ui.value('2 / 5')` | 两个动作 + 一个读数，都是既有零件 |
| 命中切换（多个元素） | 「列表」按钮展开一排卡片（`8921`–`8938`） | 点游标读数 → `ui.choice` 菜单（`div · 2/5`） | 少一枚常驻按钮、少一排卡片；能力不变 |
| 归位 | `.dshCc_canvasReset` 22px 绝对定位（`1934`） | `ui.button({ size:'sm', icon })`，放在画布右下角 | 第三个高度消失 |
| 演示中 | `.dshCc_previewDemo` 自造红字（`1966`） | `ui.status({ state:'warn' })` | 它本来就是一则状态说明；`role=status` 还能被读屏器念出来 |
| 提示区 | `.dshCc_previewHints` + 自造 `data-tone`（`1896`–`1898`） | `ui.status({ state:'warn' })` + `ui.hint()`；玻璃那条的「换成棋盘看」用 `ui.button({ size:'sm' })` 跟在 hint 后面（`ui.status` 只放文字，不塞按钮） | 同一条信息用同一套零件 |
| 冻结口径 | `.dshCc_previewNote`（`1963`） | `ui.hint` | 一行说明 |
| 全屏顶栏 | `dshCc_fullNav` 28px + `dshCc_fullPick` 覆盖 + `dshCc_fullEsc`（`1976`–`1985`） | `ui.button({size:'sm', icon})` + `ui.choice` + `ui.hint` | 一行里混 28px 与 17px 两档的问题从根上消失 |
| 规则原文 | `<code class=dshCc_previewRule>`（`1892`） | 保留（只读标识，不是控件），挪到面板头部的选择器框旁边 | 它和选择器框是同一个信息 |

**由此消失的东西**：`.dshCc_hlToggle` 在预览块里的 8 处借用（渲染出 11 枚按钮：4 枚工具 + 5 枚芯片 + 卡片 + 玻璃提示）、
4 条覆盖规则、3 个自创高度类。`dshCc_hlToggle` 回归它原本的用途（编辑器表头的「强调显示」）。

---

## 5. `ui` 需要补三件（都很小，且是通用需求）

按 [UI 组件库](./ui-kit.md) 的「加一个组件」流程走，同时补文档与审计。

| 新增 | 签名 | 规格 | 给谁用 |
| --- | --- | --- | --- |
| **分段控件** | `ui.segments({ ariaLabel, value, choices, onChange, disabled })` | 外框 28px、`radius-sm`、`bg-layer-1`、1px 分隔；每段 28px 高、`aria-pressed`、选中 `interactive-bg-active`、`:focus-visible` 走全局环 | 单屏/对比；将来任何「二选一」 |
| **按钮的状态与尺寸** | `ui.button(props)` 增加 `pressed` / `size:'md'\|'sm'` / `icon` | `pressed` → `aria-pressed`（视觉同 `.dshUi_switch[aria-checked]` 那套）；`sm` = 28px（`design-tokens` 允许的两档之一）；`icon` = 方形 28×28、内边距 0 | 适应、全屏、芯片、归位、游标 |
| **状态行的语气** | `ui.status(props)` 增加 `state:'warn'` | 颜色取 `--dsw-alias-state-warn-primary`，`role=status` + `aria-live=polite` 不变；**只放文字** —— 需要按钮时把 `ui.button` 放在它旁边，不要塞进 `p` | 「演示中」、诊断提示 |

**不做**：不加「图标按钮」独立组件、不加 `ui.toolbar`、不加 `ui.popover`。分段与按钮足够；
多一个专用组件就多一套要维护的规格。

`tests/audit-ui.mjs` 的 `KIT_CLASSES` 追加 `dshUi_segments` / `dshUi_segment`，
防止有人绕过 `ui.segments` 手写。

---

## 6. 状态模型（谁拥有什么）

| 状态 | 拥有者 | 寿命 | 持久化 |
| --- | --- | --- | --- |
| 打开的规则（索引） | `CustomCssRow` | 面板关闭即清 | — |
| 样式表现在 / 打开时（基线） | 行持有 `css`；**基线由 `PreviewBlock` 在规则变化时自己记**（`useRef`） | 换规则重置 | — |
| 视图（单屏/对比） | `PreviewBlock` | 换规则保留 | 不持久化（一次会话内） |
| 看第几个命中 | `PreviewBlock` | 换规则归零 | — |
| 状态芯片 | `PreviewBlock` | 换规则清空 | — |
| 画布背景 | `PreviewBlock` | 全局 | `localStorage`（键不变：`dsh-custom-css:canvas`） |
| 适应 | `PreviewBlock` | 换规则保留 | — |
| 平移量 | `PreviewBlock` 的 `useRef` | 换规则归零；全屏共用同一份 | — |
| 全屏开合 | `PreviewBlock` | — | — |
| 排除名单 | 行（设置里那项） | 全局 | 设置记录 |

**模块级可变状态全部删除**：`previewBaselineCss`、`previewSignature`、`previewScrollPending`、
`previewForced`（`968`/`971`/`974`/`995`）。

> 为什么基线也要搬进组件：它是「**这一条规则**打开时的文本」，是一条规则的生命周期，
> 不是整个模块的。放在模块级（`968`）有两个具体后果：任何一次 `paintPreview` 读到的都可能是
> 上一条规则留下的值；而行重新挂载（切文件、关面板再开）不会重置它。第 3 条问题就是从这里长出来的。

---

## 7. 数据流与测量

### 7.1 一次渲染

```
rule + css + baseline + index + exclusions
        │
        ├─ previewModel()     命中、目标、排除、合成、适用芯片、诊断、样本键   ← useMemo
        │
        ├─ 控件（bar/hints/foot）直接读 model                    ← 纯渲染
        │
        └─ PreviewStage
             └─ useLayoutEffect([model.key, view, full]) → buildSample() → replaceChildren
```

`model.key` 是一个**稳定字符串**：`selector | css | baseline | index | chips | excluded`。
它就是原来 `previewSignature` 想做的事，区别是：

- 它是 `useMemo` 的依赖结果，不是跨组件共享的可变全局；
- 它**不负责**尺寸、窗口、主题 —— 那些由 `ResizeObserver` 与 `MutationObserver` 各自负责（见 7.2）。

### 7.2 测量：四件分开的事

| 要量的东西 | 谁量 | 何时 |
| --- | --- | --- |
| 样本宽度（按页面实测） | 先由 `previewModel()` 读一次 `getBoundingClientRect`；之后 `ResizeObserver` 盯着**被预览的那个元素** | 规则 / 命中 / 表文本变化；页面回流导致目标变宽变窄 |
| 「适应」比例 | `ResizeObserver` on `.dshCc_viewport` + on 样本层 | 尺寸变化（含窗口、面板宽度、全屏打开） |
| 平移量边界 | `clampPan()` 纯函数 | 每次拖动 / 每次尺寸变化 |
| 主题切换 | `MutationObserver` on `body` 的 `class` / `data-*`（DSH 把配色画在这上面） | 属性变化 → 重读计算样式、重画样本 |

主题那一行是补第 3 条漏掉的一种情况：样本里是**冻结的计算样式**，浅色下读到的颜色在深色主题里
不会自己变 —— 现在的签名里没有任何东西能发现「主题换了」。测试床没有 `MutationObserver` 时静默跳过。

`ResizeObserver` / `MutationObserver` 不可用的组合（测试床、老浏览器）静默跳过 —— 与现在
`canvasFitNow` 的「量不到就按 1」同一个兜底口径。

比例与平移一样：**写 DOM，不进 state**（一次 observer 回调 → 一次 `style.transform`，
不重画样本）。只有「拖过没有」这种要影响渲染的布尔值进 state。

### 7.3 状态芯片的适用范围（修第 7 条）

芯片不再固定五枚，而是**从选择器推出来**：

| 芯片 | 什么时候出现 | 机制 |
| --- | --- | --- |
| 悬停 / 聚焦 / 占位符 | 选择器里出现对应伪类（`:hover` / `:focus` / `:placeholder-shown`） | 真页面强制（同现在） |
| `::before` / `::after` | 选择器里出现该伪元素 | 样本内合成（同现在） |

一条芯片都不适用时，那一排**整排不出现**。理由：现在这五枚里，不适用的那几枚点下去是空操作
（`1228`–`1231`），用户看到的是「点了没反应」。把不存在的能力藏起来，比摆一个按不动的开关诚实。

### 7.4 平移的边界（修第 9 条）

```
clampPan(pan, sample, viewport, margin = 48)
```

保证样本与视口至少重叠 `48px`（两个方向独立夹取）。三个来源都过这个函数：拖动、方向键、尺寸变化后重算。
`canvasTranslate()` 的「回到原点给空串」约定保留（合成层与 `fixed` 包含块那个坑）。

### 7.5 焦点（修第 10 条）

- 打开全屏：`showModal()` 之后把焦点放到**关闭钮**（不是选择器框 —— 那里一进去就被选中不礼貌）；
- 关闭（× / Esc / 视图切换回来）：焦点还给**打开它的那枚全屏按钮**；
- `dialog` 的 `cancel` 事件继续接管 Esc。

---

## 8. 布局

### 8.1 面板结构（这一节是「改值不用滚动」）

```
┌─ .dshCc_panel（flex column，max-height 420，overflow hidden）───────────┐
│ 面板头：选择器输入 · 命中芯片 · ×                          [不滚]        │
├────────────────────────────────────────────────────────────────────────┤
│ 预览块                                                     [不滚]      │
│  ┌ bar（28px）───────────────────────────────────────────────────┐    │
│  │ [单屏|对比]  [背景▾]  [悬停][::before]      ‹ 2/5 ›  [适应] [全屏]│    │
│  ├ hints（只在有话说时）─────────────────────────────────────────┤    │
│  ├ canvas（行内 200px / 全屏 flex:1）────────────────────────────┤    │
│  │   窗格[当前]（仅对比）    │    窗格[修改后]                    │    │
│  │                                         [归位]                │    │
│  └ foot（11/14）：冻结口径 · 命中读数 ────────────────────────────┘    │
├────────────────────────────────────────────────────────────────────────┤
│ 正文：预设 / 声明 / 加属性 / 模板                        [自己滚]      │
└────────────────────────────────────────────────────────────────────────┘
```

三条变化，各有一条理由：

| 变化 | 为什么 |
| --- | --- |
| 预览块**不随正文滚动**（现在是 `.dshCc_panel{overflow-y:auto}` 里的一块） | 「改一个值、看效果」要求值和效果同时在屏幕上。现在滚动到声明区就看不见预览了，滚回来看预览又要滚下去改 |
| 面板高 **340 → 420** | 预览不滚了，正文就少了 200px 的可视高度；340 会让正文只剩一行。420 是「头 36 + 预览 300 + 正文 84」的下限 |
| 芯片与命中导航从常驻两排收进 bar | 常驻高度从「三排 21px」降到「一行 28px」；省出来的给画布（180 → 200） |

### 8.2 尺寸与令牌

| 部位 | 规格 | 出处 |
| --- | --- | --- |
| 块本身 | `radius-md` + `bg-module-platform` + `0.5px border-l2`，内边距 10，间距 8 | 与其它块同一套 |
| bar 控件 | 28px 档（`ui` 的 `size:'sm'`），间距 6 | `design-tokens`「只有两档」 |
| 画布 | `radius-sm` + `bg-layer-1`，行内固定 200px，全屏 `flex:1 1 auto` | 现规格 + 高度调整 |
| 窗格 | `radius-sm` + **`0.5px border-l2` 描边** + `overflow:hidden`，标签用 `xxxs-11` | 现规格 |
| 窗格标签 | 「当前」用 `code-diff-deleted` **作底色**、「修改后」用 `-added` 作底色，文字 `label-secondary` | `design-tokens`「增删色是底色」 |
| 归位 | 画布右下角，28×28 图标按钮 | `ui.button({icon})` |
| 说明文字 | `xxs-12`（foot 用 `xxxs-11`）+ `label-caption` | 与历史版本页那条一致 |
| 全屏卡片 | `min(1280px,96vw) × min(94vh,960px)`、内边距 20、间距 16、`settings-card-fill/stroke`、`elevation-prominent` | 0.12.0 已定，不动 |
| 全屏遮罩 | `bg-overlay` 混 55% 透明 + `blur(18px) saturate(1.15)`；`prefers-reduced-transparency` 退回不透明 | 0.12.0 已定，不动 |

**审计口径**：新样式表里 `border-radius` 只用令牌、字号只用四档、控件高度只用 28。
`audit-radii` / `audit-fonts` 打印出来后，预览块那几行应当**全部落在令牌列**。

---

## 9. 交互规格

| 操作 | 结果 |
| --- | --- |
| 按住画布拖动 | 一份平移量，所有窗格一起走（保留）；**夹在边界内**，拖不出视野 |
| 画布聚焦后方向键 | 8px / `Shift` 32px；`Home` / `0` 归位（保留），每步都过 `clampPan` |
| 双击画布 / 归位钮 | 归零；**没拖过时归位钮禁用**（保留） |
| 适应 | `scale(k)`，`k = min(1, 窗宽/样本宽, 窗高/样本高)`，只缩显示（保留）；由 `ResizeObserver` 保证**变宽变窄都重算** |
| 单屏 ⇄ 对比 | 分段控件切视图；对比时左窗格读「打开时的文本」；**还没改动**时左窗格显示一行说明，不摆空盒子（保留） |
| 多个命中 | 游标 `‹ 2 / 5 ›`；点读数开菜单选任意一个；换命中不动规则、不重开面板 |
| 状态芯片 | 只出现选择器里真有的状态；勾选 → 真页面强制 + 样本重画；「演示中」同时在 foot 显示 |
| 全屏 | `showModal()`；顶栏 = 选择器 + 命中读数 + 游标 + ×；正文仍是同一份 `renderBody()`；Esc / × 退出，焦点归还 |
| 换规则 | 基线重置、芯片清空、命中索引归零、平移归零、全屏关闭（保留这些语义，但都由组件自己做） |

---

## 10. 移除清单（要删的东西）

| 删除 | 位置 |
| --- | --- |
| `paintPreview()`（90 行；职责拆给 `previewModel` + `buildSample` + 一个 effect） | `1321`–`1410` |
| `previewSignature` / `previewBaselineCss` / `previewScrollPending` / `previewForced` 四个模块级变量 | `968`–`995` |
| 行里的 8 个 `useState` + 5 个 `ref`（预览相关）+ 10 个处理器 | `9240`–`9264`、`11100`–`11300` |
| `canvasCtl` 那个「一整个对象塞进 props」的传参方式 | `11791`–`11805` |
| 预览块内的 CSS：`dshCc_previewCanvasTools`、`dshCc_previewTools`、`dshCc_previewRule`、`dshCc_previewPicks`、`dshCc_matchCursor`、`dshCc_cursorBtn`、`dshCc_cursorText`、`dshCc_sampleCards`、`dshCc_stateChips`、`dshCc_previewDemo`、`dshCc_previewSame`、`dshCc_canvasReset`、`dshCc_fullPick`、`dshCc_fullNav`、`dshCc_fullKeys`、`dshCc_fullMeta`、`dshCc_fullEsc`、`dshCc_previewHints`（改成 kit 的类） | `1891`–`2010` |
| 覆盖规则 `.dshCc_previewTools .dshCc_hlToggle[aria-pressed…]` / `.dshCc_previewCanvasTools .dshUi_choice…` | `2010`、`1945`–`1949` |

**保留**：`PREVIEW_AFTER_CLASS` / `PREVIEW_CURRENT_CLASS`（样本层的标记，给 `queryOwned` 用）、
`canvasTranslate` / `canvasDragTo` / `canvasFitScale` / `previewTargetSelector` / `frozenStyleText` /
`syntheticPseudo` / `syntheticSample` / `forcePreviewStates` / `clearPreviewForcing`。

---

## 11. 测试与验收

### 11.1 新增的纯函数断言（`tests/loader-smoke.cjs` 的 `__probe`）

| 函数 | 断言 |
| --- | --- |
| `previewModel` | 命中 0 → `synthetic: true`；在排除名单 → `excluded: true` 且不合成克隆；命中 3 个、`index=1` → `target` 是第二个；`matches.length` 与 `count` 一致 |
| `previewChipsFor(selector)` | `button:hover` → `['hover']`；`a::before` → `['before']`；`.x` → `[]`；`input:focus:placeholder-shown` → `['focus','placeholder']`（两个都真在） |
| `clampPan` | 偏移超过半宽 → 夹到「重叠 48px」；尺寸变化后重夹；全零 → `{x:0,y:0}` |
| `buildSample` | `<tr>` 带 `table > tbody` 包装；`::before` 插在首、`::after` 插在尾；`content: url()` 不合成；克隆不带 `id` |
| `canvasTranslate` / `canvasDragTo` / `canvasFitScale` | **现有断言全部保留**（它们是行为，不是实现） |

### 11.2 需要改的现有测试

| 测试 | 改什么 |
| --- | --- |
| `loader-smoke` 的预览段（`5833`–`6122`） | 按钮不再按 `dshCc_hlToggle` 找，改按文字 / `aria-label` 找；`dshCc_previewPicks` 那条改成「芯片只在该出现时出现」；归位钮从 `.dshCc_canvasReset` 改成 `ui.button` 的 `aria-label` |
| `loader-smoke` 的绘制段（`5937`–`6071`） | 直接调 `previewModel` / `buildSample`，不再经 `paintPreview` |
| `host-api-smoke` | 不受影响（预览不碰 host 接口） |

### 11.3 新增审计

`tests/audit-preview-kit.mjs`：**预览块里不许出现 `dshCc_*` 的控件类名**。

判据：在 `dshCc_preview` / `dshCc_full` 两块的 JSX 里，`createElement('button'` / `'input'`
的 `className` 不得是 `dshCc_*`。理由与 `audit-ui` 同一条 —— 现在预览块就是靠「借 `.dshCc_hlToggle`」
绕过控件库的，没有这条门禁，下一轮又会漂回去。

### 11.4 真机验收（3081，不动 3080）

| 项 | 做法 | 通过标准 |
| --- | --- | --- |
| 不滚动就能改值看效果 | 打开一条有 6 个声明的规则 | 预览与第一行声明同屏 |
| 窗口变宽 → 适应重算 | 拖窗口 900 → 500px | 样本比例跟着变，不需要动开关 |
| 拖动越界 | 向右拖 2000px | 样本仍露 48px；归位可点 |
| 芯片只在该出现时出现 | 打开 `.x` 与 `button:hover` 两条规则 | 前者无芯片行，后者有「悬停」 |
| 全屏焦点 | 打开全屏 → Esc | 焦点回到全屏按钮 |
| 探针数字 | `npm run probe -- --open-settings --eval-file temp/preview.js --shot` | bar 高度 28±1、画布 200±1、无第二层滚动条、无控制台错误 |

**反向验证**（本仓库硬要求）：把 `clampPan` 的夹取去掉、把 `ResizeObserver` 断开，
对应断言 / 量测必须变红。

---

## 12. 分步实施（每步独立可验证，不破坏 main）

| 步 | 内容 | 验证 | 进度 |
| --- | --- | --- | --- |
| 1 | `previewModel` / `previewChipsFor` / `clampPan` / `buildSample` / `captureSampleStyles` + 单测；`paintPreview` 改成调用它们 | `node tests/loader-smoke.cjs` | ✅ 已完成（芯片改成按选择器推导一并落地 —— 第 7 条缺陷属于「纯函数」这一步的自然结果） |
| 2 | `ui.segments` + `ui.button` 的 `pressed/size/icon` + `ui.status` 的 `warn`；`audit-ui` 白名单；`ui-kit.md` | `npm test` + `audit-ui` | ✅ 已完成 |
| 3 | ~~`RulePanel` 改成 `createElement`~~ | — | ⛔ **不做**：`RulePanel` 没有状态、不需要 hook；`PreviewBlock` 作为子元素放进它的树里就够了（见 §3.1） |
| 4 | `PreviewBlock` 组件落地（toolbar / stage / dialog / foot），**两处 JSX 合一**；行里的预览 state 退役 | `loader-smoke` 预览段 + 真机 | ✅ 已完成（`PreviewBlock` + `paintModelInto`/`applyCanvasPan`/`applyCanvasFit`；行里 8 state / 5 ref / 10 处理器全部删除） |
| 5 | 面板布局：预览块固定、正文滚、面板高度 | 探针量高度与滚动 | ✅ 已完成（数字见下） |
| 6 | 删旧代码与旧 CSS；token/字号审计全绿；`audit-preview-kit` 上线 | `npm test` + `npm run audit` | ✅ 已完成（半径字面量从 8 处降到 4 处，字号表里预览块那一批消失；`audit-preview-kit` 已接进 `npm run audit`，并做过反向验证） |
| 7 | 文档：`preview.md` 的结构章节重写、`naming.md` D/E/F/G、CHANGELOG 未发布段、`handoff.md` | `audit-docs` | ✅ 已完成（`preview.md` 头部/模式/布局/分阶段重写；`naming.md` 17 行改名；`CHANGELOG` 未发布段；`handoff` §3.1–3.3 与 §5；`testing.md` 的探针选择器） |

**真机数字**（1440×900，设置对话框；`node tests/visual-probe.mjs --open-settings --eval-file temp/preview.js --shot`）：

| 量的是什么 | 计划值 | 实测 |
| --- | --- | --- |
| 面板 | 420 | **520**（420 会让正文只剩 42px 且被裁在可视区外 —— 改成 520 + 正文 `min-height:84px`） |
| 正文 | ≥84 | 142，`overflow-y:auto`（内容 474） |
| 工具条 | 28 | 28；控件类名全是 `dshUi_*`（`dshUi_segments` / `dshUi_choiceSm` / `dshUi_buttonSm`） |
| 画布 | 200 | 200 |
| 面板自身滚动 | 无 | `overflow-y: hidden` ✓ |
| 控制台错误 | 0 | 0 |

> 残留观察：在开发实例的设置对话框里，探针数到 **2 个 `.dshCc_row`**（两份都可见、按钮各一份）。
> 那是宿主侧把同一块设置内容挂了两次（或探针先开了一个设置页再开对话框），与预览块的重写无关：
> 插件只注册一次 `settings.general.item`。记在这里，下次动探针时顺手确认。

---

## 13. 风险与不采纳

| 项 | 判断 |
| --- | --- |
| 测试床的假 React / 假 DOM 撑不起新组件 | 第 1 步把逻辑抽成纯函数就是为了这个：**组件只负责摆**，断言落在纯函数上 |
| `ResizeObserver` 在测试床不存在 | 与 `canvasFitNow` 同一个兜底：没有就按 1，不抛 |
| 拖动写在 `overflow:hidden` 的祖先里 | 画布自己 `touch-action:none` + `pointer capture`（现在已有），不变 |
| 全屏 dialog 与设置对话框的层级 | `showModal()` 进 top layer，现在就是这么做的；保持 |
| 面板变固定头之后正文太矮 | 面板 420 + 正文最小 84px 是下限；探针量一次，必要时把画布 200 → 180 |
| **不采纳**：iframe 预览 | `preview.md` 的两条实测理由仍然成立（令牌、`backdrop-filter`） |
| **不采纳**：平移量按窗格分开 | 用户先后要过两种，最终要「一起走」；v4 保持一份 |
| **不采纳**：把「左边 = 去掉这条规则」做成第二个口径 | 两个口径同时出现会让人分不清左右在比什么（`preview.md` 已论证） |
| **不采纳**：给预览块单独开一个窗口 / 侧栏 | 它就是「编辑循环」的一部分，离开代码区就没有意义 |

---

## 14. 文档与命名改动

| 文件 | 改什么 |
| --- | --- |
| `docs/preview.md` | 「头部」「画布」「三种模式」「布局」「分阶段」按 v4 重写；「为什么不用 iframe」「保真度」「状态芯片的机制」保留 |
| `docs/naming.md` | D 节：去掉「列表按钮」「卡片导航」的独立条目，改成「命中游标 / 命中菜单」；`226` 的「平移量按窗格各记各的」改成「一份平移量」；`234` 单屏预览去掉「规划中」；E 节顶栏控件改 `ui.button` / `ui.choice` |
| `docs/ui-kit.md` | 加 `ui.segments`，补 `ui.button` 的 `pressed/size/icon` 与 `ui.status` 的 `warn` |
| `docs/design-tokens.md` | 预览块那一行补一句：控件只用 28px 档 |
| `CHANGELOG.md` | 未发布段：把「全屏左右分开拖」那条改掉（它已被改回），新增 v4 段 |
| `docs/handoff.md` | 第 3 节（预览块现在的行为与契约）按 v4 重写；第 5 节「待拍板」更新 |
| `docs/index.md` / `README.md` | 索引与链接按需 |

---

## 15. 已拍板（2026-10-27）

四项**全部采纳**，本文其余各节按这个前提写。

| 事 | 决定 | 代价（已知并接受） |
| --- | --- | --- |
| 面板高 340 → 420 | 采纳 | 少 80px 的编辑器可视高度，换「改值看效果不滚动」 |
| 芯片只显示选择器真有的状态 | 采纳 | 少一排常驻控件；「给 `.x` 试一下 hover」这种用法没有了（今天它本来也是空操作） |
| 去掉「列表」按钮、改成点游标读数弹菜单 | 采纳 | 少一枚常驻按钮；多个命中时多点一次 |
| 画布 180 → 200 | 采纳 | 面板多占 20px；比窗口宽的组件仍要拖或开「适应」 |
