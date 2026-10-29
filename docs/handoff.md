# 交接文档

给接手的人（或下一个会话的自己）：**现状、怎么验、哪些地方别再翻烧饼、还剩什么**。

> 写这份文档时的状态：`main` = `fa51736`，`package.json` = `0.12.0`（已发布到 npm；
> 0.13.0 的内容都还在「未发布」段里），工作树干净，`loader-smoke` 全绿、七个审计逐个通过。

---

## 1. 五分钟上手

| 想做的事 | 命令 |
| --- | --- |
| 跑冒烟测试 | `node tests/loader-smoke.cjs`（快） / `node tests/host-api-smoke.mjs` / `node tests/probe-strict-smoke.mjs` |
| 跑审计 | `node shared/sync.mjs --check`、`node tests/audit-radii.mjs`、`audit-fonts.mjs`、`audit-accessible-names.mjs --enforce`、`audit-ui.mjs`、`audit-docs.mjs --enforce`、`audit-skin.mjs` |
| 起开发实例（3081） | `node dev/instance.mjs up --port 3081` / `down` / `status` |
| 真机量一个界面 | `node tests/visual-probe.mjs --open-settings --eval-file temp/x.js --shot` |

**两条别踩的**：

1. **不要碰线上 3080**。所有验证都在 3081；`dev/home/custom-css/custom.css` 用完必须清空
   （`node -e "require('fs').writeFileSync('dev/home/custom-css/custom.css','')"`），实例用 `down` 收掉。
2. **别把 `npm test` 和 `npm run audit` 串在一条命令里跑**。这一轮真卡死过一次：8 个脚本塞进一个
   `npm` 链，进程编排在沙箱里挂住。逐个 `node tests/xxx.mjs` 跑，每个都在 1 秒内返回。

改完 `lib/client.js` 之后**要重启开发实例**再看效果 —— 它把客户端模块读进内存，不重启拿到的是旧代码。

---

## 2. 这个仓库的形状

- `lib/index.js`：host 侧（文件 API、设置 schema、注入）。
- `lib/client.js`：全部界面（约 1.25 万行，浏览器侧，**没有构建**，`ROW_CSS` 是拼起来的样式数组）。
- `shared/`：随包发布的样式基座，`shared/sync.mjs --check` 会核对源块与产物是否一致。
- `tests/`：三套冒烟 + 七个审计 + `visual-probe.mjs`（CDP 真机探针）。
- `dev/`：开发实例（独立 `DSH_HOME`）、`dsh-alpha`（alpha 版 DSH 的依赖树）。

界面文案一律走 `t(key)`（zh + en 两份词典，少一份 `i18n verified` 会红）；内容（属性字典）走
`content(中文)`。

---

## 3. 预览块：现在的行为与契约

### 3.1 结构：v4 已经换掉（2026-10-27）

> **这一节描述的是 v3。** v4 把预览块重写成了一个组件（`PreviewBlock`）：状态、绘制、测量、
> 强制态都在它里面，行只交数据；控件全部来自 `ui.*`（28px 档）；行内与全屏是同一棵树。
> 结构与时序见 [预览块 v4](./preview-v4.md) §3 / §7，布局与实测数字见同文 §8。
> **3.2 的四条规则仍然成立**（它们是用户拍板的行为，不是实现），锚点从 `paintPreview` 改到了
> `paintModelInto` / `clampPan` / `applyCanvasFit`。

v4 之后值得记的三件事：

- 重画由 `model.key`（模型指纹）驱动，尺寸与主题由 `ResizeObserver` / 无关；`previewSignature`
  那个模块级字符串已经删掉。
- 芯片按选择器推导（`previewChipsFor`）：选择器里没有的状态不提供 —— 以前点了是空操作。
- 面板是「预览固定 + 正文滚」，高度是量出来的：面板上限 520、正文下限 84（见 v4 §8）。

### 3.2 四条已经定死的规则

| 规则 | 为什么（用户的词） | 实现锚点 |
| --- | --- | --- |
| 组件按**页面实测宽度**排版，窗格只裁不滚 | 「不要改变组件大小」 | `paintModelInto` 里 `box.style.width = model.width + 'px'`；窗格 `overflow:hidden` |
| 默认**居中**；比窗口大的向两边对称溢出 | 「默认居中」 | `.dshCc_previewViewport{display:flex;justify-content:center}` |
| 拖动**两块一起走**（一份平移量） | 「拖动一个另一个也移动」 | `PreviewBlock` 的 `panRef`（单个 `{x,y}`）→ `applyCanvasPan` 写进每个 `[data-pane]`；`clampPan` 夹住边界 |
| `page` 档底色 = 组件在页面上的那层底 | 「明明在对话里有背景，预览里没有」 | `pageBackdropOf()` → `--dshCc-page-backdrop` |

另外两条容易被问到的：

- **窗格没有自己的底板**（`.dshCc_canvas .dshCc_previewBox{background:transparent}`）：窗格就是画布的
  可见部分。历史上来回改过三次（有底板 → 无 → 有 → 无），**最新结论是无**，理由：底板会把图案洗成 42%，
  看着像「组件的背景」。
- **「适应」只缩显示**（`scale(k)`，`k = min(1, 窗宽/样本宽, 窗高/样本高)`，不重排不改尺寸），默认关。

### 3.3 数据流（改之前先看这三处）

1. `previewModel({ rule, css, baselineCss, index, exclusions })`：命中、目标、排除、合成、芯片适用范围、
   诊断、样本键。**纯函数**（只读 DOM），在 `PreviewBlock` 里 `useMemo`，换规则/改表/换命中才重算。
2. `paintModelInto(root, { model, rule, css, compare, pseudos })`：克隆 + 冻结计算样式 + 写样本层宽度
   + 量页面底色。由 `useLayoutEffect` 调，依赖是 `model.key`。它只碰 DOM、不碰 React，测试直接驱动它。
3. `applyCanvasPan(root, pan)` / `applyCanvasFit(root, fit)`：`translate(...) scale(...)` 写进每个
   `[data-pane]`，比例来自 `surface.dataset.fit`。**不经过 React state**（一次 pointermove 一次渲染
   会把样本重画）。测量由 `ResizeObserver` 驱动，窗口/容器变宽变窄都会重算。

## 4. 这一轮踩过的坑（按代价排序）

1. **菜单/浮层被祖先裁掉**：`.dshCc_shell{overflow:hidden}` + 有 `transform` 的祖先会让 `position:fixed`
   的菜单既定位错又被裁。结论：**插件自己的菜单走 popover（top layer）**。
2. **`Object.keys(Map)` 永远空**：动效检测第一版这么写的，五条断言里两条直接不报，是测试抓住的。
3. **`data-glass` 打错了元素**：标在内层样本容器上，CSS 却选外层框，真机上读到 `undefined`，等于没做。
4. **平移量按窗格存 vs 一份**：用户先后要过「分开拖」和「一起拖」，实现跟着翻过一次。**最新是一份**；
   要改回分开，只需把 `panRef` 换成 `{current:{x,y},modified:{x,y}}` 并让 `applyCanvasPan` 按
   `data-pane` 取值。
5. **令牌量在 `:root` 上是空的**：`--dsh-material-*` 定义在 `body` 上，`:root` 量不到 —— 别据此断定
   令牌缺失。
6. **`npm` 链卡死**（见第 1 节第 2 条）。

---

## 5. 还没做 / 需要拍板

| 事 | 现状 | 备注 |
| --- | --- | --- |
| 发 **0.13.0** | 全在 CHANGELOG「未发布」段 | 内容：预览块 v4（组件化 + 控件全部来自 `ui.*` + 布局重排）、预览画布、v2/v3、元素诊断、问题检测页、查找跳转修复、aurora 主题优化 |
| 预览块 v4 的收尾 | 代码、测试、审计、真机量测都已完成 | 只剩：`handoff` 第 4/5 节复核、发版前跑一遍 `npm test` + 全量审计 |
| `适应` 是否默认开 | 默认**关**（先看真实大小） | 用户可能想要「一打开就看全」；`PreviewBlock` 里 `useState(false)` → `true` 即可 |
| 对比模式左半边空态 | 只有改过之后才有样本，否则显示「还没改动」 | 用户截图问过一次「为什么左半边是空的」 |
| 问题检测页的文档 | `docs/editor.md` 已写「问题检测」三节 | 页面本身的截图/行号脚本没做 |
| `--dshCc-canvas-ink` 浓度 | 10% 黑 | 用户提过棋盘可能太扎眼，可调一个 `color-mix` 比例 |
| 探针里量到 2 个 `.dshCc_row` | 未查明（与 v4 无关，插件只注册一次） | 见 [预览块 v4](./preview-v4.md) §12 的残留观察 |

---

## 6. 交付记录（预览块这条线）

```
fa51736 docs(preview)  为什么会被裁切 + 适应 + 不选中文字
c0a47c4 feat(preview)  「适应」开关 + 画布不选中文字
840276a docs(preview)  v3 三条（默认居中 / 一起拖 / 身后那层底）
b690cef feat(preview)  默认居中、两块一起拖、组件身后那层页面底
5ec0634 docs(preview)  布局树与高度口径按 v2 重写
c839fa0 feat(preview)  v2：固定 180px 视口、提示区上移、顺序重排
4f6c364 docs(preview)  组件不压缩、窗格只裁不滚
db4fbdb feat(preview)  组件不再被压缩
bf97979 docs(preview)  窗格就是画布
efe1f1e fix(preview)   窗格就是画布（去掉底板）
599f6c8 docs(preview)  平移量按窗格记（后被改回一份）
24084d0 feat(preview)  全屏左右分开拖（后被改回一起拖）
```
