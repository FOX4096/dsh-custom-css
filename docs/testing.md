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

---

## CI：三个工作流

| 工作流 | 触发 | 做什么 |
| --- | --- | --- |
| [`ci.yml`](../.github/workflows/ci.yml) | 每个 push / PR | Node 20 / 22 两档：语法自检、两套冒烟测试、令牌 / 圆角 / 字体 / 可访问名巡检、跨版本兼容断言 |
| [`publish.yml`](../.github/workflows/publish.yml) | 推 `v*` tag | 跑测试 → **OIDC 受信发布**（带 provenance 签名，不需要任何长期令牌）→ 自动建 GitHub Release |
| [`compat-watch.yml`](../.github/workflows/compat-watch.yml) | 每 6 小时 + 手动 | DSH 换代检查：发现新版本 → 断言 → 通过则提交文档更新 |

**发布只需一个 tag**：

```bash
git tag -a vX.Y.Z -m "X.Y.Z — …"
git push origin main --follow-tags
```

推上去后它自己跑完测试与发布。前置条件只有一条：npmjs.com 上该包的
Settings → Trusted Publisher 已填本仓库与本文件名。

## 相关

- [开发](./development.md) —— 命令表、开发实例、探针
- [兼容性](./compat.md) —— 契约与换代门禁
- [CONTRIBUTING.md](../CONTRIBUTING.md) —— 硬约束与发版流程
