# 测试与巡检

[← 返回 README](../README.md) · [文档索引](./index.md)

本仓库的测试分四类：**两套冒烟测试**（`npm test`）、**样式审计**（`npm run audit`）、
**兼容断言**（`npm run compat`）、**探针**（`npm run probe`，只量不断言）。

插件**没有构建步骤、也没有运行时依赖**，所以 CI 里不装任何东西。

---

## `npm test` — 两套冒烟测试

### `tests/loader-smoke.cjs`

用**假 host 真实执行** `lib/client.js`。校验：

- 模块形状、槽注册参数、host 支撑的启动应用、离线降级
- 首次运行从 `localStorage` 播种默认文件
- **组件真能渲染**
- 校验器的两类回归：合法的 `@property` 块必须**零报错**，非法描述符
  （`syntax: <color>`、`inherits: maybe`）必须**报出来**
- 补全、规则面板、属性下拉、字符串 / `url()` / 嵌套块的不透明性、
  同名规则的面板绑定、补全与光标的一致性、保存指示只在写入成功后说「已保存」

其中**拾取器端到端**也在这里跑：点按钮 → 武装 → 悬停报告尺寸 → 点击锁定 → 候选排序 →
插入规则（含复用已有规则、光标落点与滚动到新规则）。

> 测试床自带一个**真的做选择器匹配与按矩形命中**的 DOM 桩。以前这两处忽略入参、等于常量，
> 断言其实只守了「桩被配置成了什么」—— 修好桩之后，原先看着通过的断言才真的开始守行为。

### `tests/host-api-smoke.mjs`

用假 `webServer` 驱动 host 路由。校验：

- 文件 API、目录簿记（含 `active.json` 损坏后的恢复与幽灵关闭项清理）、`/active`、重名冲突
- **路径穿越 / 非法文件名 / Windows 设备名 / 符号链接拒绝**
- 请求体上限、`/open` 的启动器注入、列表上限不会吞掉当前文件
- 无围栏时的 **fail-closed**（读写都被围栏拦住）

## `npm run audit` — 样式审计

守着那些**看不出来**的错：

| 审计 | 守什么 |
| --- | --- |
| 圆角 | 样式表里的圆角必须在 DSH 的圆角阶梯上 |
| 字体 | 同上，字号 / 行高必须在阶梯上 |
| 可访问名 | 名字只来自 `title` 的控件会被点名（`--enforce` 时退出码 1，CI 用它当门禁） |
| **组件库** | 组件库之外不许手写 `dshUi_*` 类名 —— 否则新功能会绕过 `ui.*` 的状态（busy/invalid/disabled） |
| 文档 | 链接与锚点可解析、没有孤儿文档、不许把 DSH 版本范围抄进 `docs/` |
| **示例皮肤** | 见下 |

### 示例皮肤审计（`tests/audit-skin.mjs`）

守 `examples/acrylic.css` 的三类问题 —— 它们都是**历史上真踩过、而且肉眼看不出**的：

| 守什么 | 踩过的实例 |
| --- | --- |
| 引用了**不存在的令牌** | 曾经写过 `--dsw-specific-tabhost-fill`（DSH 里根本没这个令牌），它在浏览器里**静默失效、不报错** |
| 用了 `border` / `background` **简写** | `border: 0.5px solid …` 隐式重置了 `border-radius`，把「标准模式」按钮清成直角 |
| `[class*=]` 选择器**数量失控** | 上一版涨到几十处，那正是"逐元素覆盖"的标志：会漏、而且会在同一个区域叠层（实测一个按钮里叠过四层） |

还有一条动态判据（`--dump <快照>`）：把浏览器导出的 DOM 快照喂进来，它会数
**"嵌在别的有外观元素里的元素"**以及其中"内层自画描边或模糊"的数量。
不设成失败条件（DSH 自己的按钮、主题卡、分隔线本来就有描边，皮肤不该改它们），
但数字明显变大就是要去看一眼的信号。

只允许一处 `border` 简写：滚动条滑块（紧接着设了 `border-radius: 999px`，是故意的形状声明），
审计按声明顺序配对放行。

另外 `npm run audit:duplication` 做重复率巡检：同一份规格被抄了多次就点名 ——
曾经有三份几乎相同的等宽字体栈。

**还有两个「拼错探测器」**：规则若用 `attr()` 取一个元素没有的属性就点名
（曾有锁定框因此画出一条 12×2 的横线）；样式表里出现、源码里没人命中的类也点名
（它同时也是类名拼错的探测器 —— 审计要认得出 `'dshCc_tok' + kindOf()` 这类拼接出来的名字）。

## `tests/compat-matrix.mjs` — 兼容断言

见 [兼容性](./compat.md)。需要网络，所以单独一个入口，不混进 `npm test`。

## `tests/visual-probe.mjs` — 探针

无头 Edge + CDP，只测量不断言。见 [开发 · 视觉探针](./development.md#视觉探针在真-chromium-里量不靠看)。

**能先点开页面里的面**：`--click "text=更多操作" --click "text=选择器体检"`（`text=` 按文字找；
`nav=` 也按文字找，但标的是 **DSH 自己的导航** —— 点不开算环境问题；其余按 CSS 选择器）。
点之前会轮询最多 8 秒（插件列表先是骨架再出内容，一次采样失败不该判红）。**点不开就是失败** ——
静默跳过会让「面没打开」伪装成「里面没有元素」。

CI 目前采两个面：设置页里的这一行（`--open-settings`），和本插件详情页的壁纸面板

**预览块的面怎么采**（0.10.0 起；`--sel` 只测量，`--shot` 出图）：

```bash
# 状态芯片：打开一条带 :hover 的规则，点「悬停」，再确认强制表与目标元素
node tests/visual-probe.mjs --open-settings \
  --click ".dshCc_highlight span[data-rule]" \
  --click ".dshCc_stateChips button:nth-child(1)" \
  --sel "#dsh-custom-css-preview-force" --sel ".dshCcStateHover" --shot

# 全屏视图：dialog 必须真的是视口级尺寸（被祖先 transform 裁掉时会明显变小）
node tests/visual-probe.mjs --height 1100 --open-settings \
  --click ".dshCc_highlight span[data-rule]" \
  --click ".dshCc_previewTools button:nth-child(1)" \
  --sel "dialog.dshCc_full" --sel ".dshCc_fullStage" --shot

# 命中 0 个：合成样本要真的出现，并且写着「不是页面上的元素」
node tests/visual-probe.mjs --open-settings \
  --click ".dshCc_highlight span[data-rule]" --sel ".dshCc_sampleSynthetic" --shot
```

量伪元素、量令牌取值时用 `--eval "<表达式>"`（结果落在 `temp/probe/last-probe.json` 的 `evals` 里）——
`::backdrop` 这种 `querySelector` 选不中的东西只能这样量：

```bash
node tests/visual-probe.mjs --open-settings --click ".dshCc_highlight span[data-rule]" \
  --click ".dshCc_previewTools button:nth-child(1)" \
  --eval "getComputedStyle(document.querySelector('dialog.dshCc_full'),'::backdrop').backdropFilter"
```

全屏那条要**看尺寸**：原生 `<dialog>` + `showModal()` 进 top layer，实测 **1280×940**（1440×1000 视口下）；如果哪天有人把它换回
`position:fixed` 的浮层，尺寸会掉到设置对话框那一档（≈ 430×700），探针的 `rect` 一眼就能看出来。

（`--click "nav=插件" --click "nav=dsh-custom-css"`）—— 后者是插件里最大、原来完全没有视觉证据的界面。

**「页面根本没加载」会先被认出来**（正文太短，或带着浏览器的「拒绝连接」文案），直接按环境问题
（退出码 2）失败：实例没起来时，后面每一步都会以「找不到控件」告终，把人引向「DSH 改了入口」这个
错误方向。

---

## CI：三个工作流

| 工作流 | 触发 | 做什么 |
| --- | --- | --- |
| [`ci.yml`](../.github/workflows/ci.yml) | 每个 push / PR | Node 20 / 22 两档：语法自检、两套冒烟测试、令牌 / 圆角 / 字体 / 可访问名巡检、跨版本兼容断言 |
| [`publish.yml`](../.github/workflows/publish.yml) | 推 `v*` tag | 跑测试 → **OIDC 受信发布**（带 provenance 签名，不需要任何长期令牌）→ 自动建 GitHub Release |
| [`compat-watch.yml`](../.github/workflows/compat-watch.yml) | 每 6 小时 + 手动 | DSH 换代检查：发现新版本 → 断言 → 通过则提交文档更新，**并补跑一次 `visual.yml`**（换代那一刻最容易出事，契约检查证明不了「界面还能用」） |

**发布只需一个 tag**：

```bash
git tag -a vX.Y.Z -m "X.Y.Z — …"
git push origin main --follow-tags
```

推上去后它自己跑完测试与发布。前置条件只有一条：npmjs.com 上该包的
Settings → Trusted Publisher 已填本仓库与本文件名。

## 视觉回归（`.github/workflows/visual.yml`）

手动触发 + 每日一次：在 **windows-latest** 上装一份 DSH、用 `dev/instance.mjs up` 起开发实例、
再用 `tests/visual-probe.mjs` 打开设置页量几何并截图，产物上传为 `visual-probe` artifact。

它**主要**是「留证」：几何数字与截图是给人看的产物。它不挂在 push 上，因为它慢一个数量级。
判定只做「一定不该发生的那几条」（见下表），**不判像素阈值**：行高 381px、面板宽 559px 是今天的
排版，不是契约 —— 真要判得先有每日数据说明「这个数字变了就是坏事」，否则等于用今天的排版约束
明天的设计。

**定时任务只承诺「大概每天一次」**：GitHub 的调度漂移很大。本仓库实测（cron `17 3 * * *`）：
两次都落在 **08:32 / 08:34 UTC**，也就是延迟约 **5 小时 15 分**；compat-watch 那个「每 6 小时」的
历史记录里也有 4h44m / 6h44m 的间隔。跳一天不算故障；连着三天都没有，才说明调度坏了，手动
`workflow_dispatch` 一次做对照。

**必须红的情况**（它们不是「阈值没定」，而是「这次采集没有意义」）：

| 红的情况 | 退出码 | 为什么 |
| --- | --- | --- |
| 要求打开设置，但**面板没打开** | **2**（环境） | 多半是 DSH 又改了入口或首启通知 —— 该去看 `steps` 最后一条，不该去翻 CSS |
| 面板开着，但请求的选择器**一个都没命中** | 1（回归） | 插件没挂上；空的几何和「没变化」长得一模一样 |
| `--strict` 下：**某条选择器 0 面积** | 1（回归） | 元素在页面上占 0 面积（`display:none`、被压成 0）—— 量到了等于没量 |
| `--strict` 下：**布局盒子溢出** | 1（回归） | `scrollWidth > clientWidth` 而它自己不是滚动容器（`auto`/`scroll` 的溢出是设计，不算） |
| 实例起不来 / 页面 401 | 1 | 令牌过期、端口冲突：探针连的是假的东西 |

**退出码 2 与 1 是故意分开的**：两种红在邮件里长得一样，处置却相反 —— 一个要去跟进 DSH 换代，
一个才是本插件真的坏了。分级写成纯函数 `classifyRun`，和环境判定、`--strict` 的五个分支一起
由 `tests/probe-strict-smoke.mjs` 覆盖 —— 真页面上能自然遇到的只有一两种，其余只能构造。

干净机器上踩过的坑（都已修，留在这里免得下次再踩）：

1. **全新 profile 先弹一张通知盖住整页**，而且它换过三副面孔：有 × 的、能 Esc 关的、**只剩一个
   「Continue」主按钮的**（第三种连 Esc 都不理）。所以依次试：主按钮 → 关闭按钮 → Esc。
2. **设置入口会挪窝**：有一版直接写着 `Settings`，有一版折进左下角「更多」菜单（本插件量过宽度的
   那个 252×36 按钮），还有一版只在菜单里露出 `Ctrl + Alt + ,`。三条路都试，且**每条都核对
   「面板里有 `.dshCc_` 那行」**才算成功 —— 点完不看结果，等于把「点到了别的菜单」当成成功。
3. **侧栏里 `[aria-haspopup="menu"]` 不止一个**：工作区列表也是。取「最后一个」会点到
   `Choose workspace`（CI 上就是这么红的）。先按文字认 `更多|More`，认不出来才退到「最靠下的那个」。
4. `dev/instance.mjs` 里**「端口通了」不等于「入口 URL 已打印」** —— 要轮询到 URL 真的落进日志。

## 相关

- [开发](./development.md) —— 命令表、开发实例、探针
- [兼容性](./compat.md) —— 契约与换代门禁
- [CONTRIBUTING.md](../CONTRIBUTING.md) —— 硬约束与发版流程
