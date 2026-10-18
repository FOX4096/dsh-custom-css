# CSS 公共层（`shared/base.css`）

[← 返回 README](../README.md) · [文档索引](./index.md)

本机这套自定义样式（音乐播放器、费用条、genui 的覆盖）原本各自定义描边 / 卡片阴影 / 圆角，
一份 `custom.css` 里散着同一批值。现在把它们抽成**一份随插件发布的样式基座**：

```
shared/base.css  ──(shared/sync.mjs)──▶  lib/client.js 的 SHARED_BASE_CSS
                                      ──▶  <style data-plugin-css="dsh-custom-css/shared-base.css">
```

它由插件在启动时注入，**先于用户自己的样式表**，所以用户表里的规则天然赢过它，
不需要 `!important`。

---

## 两张公共表

除了这份「样式基座」，扩展自己的控件（`dshUi_*`）也独立成一张表 `Base.module.css` ——
它由 `ROW_CSS` 里拆出来，只留桌面控件与行布局，编辑器自己只剩 `dshCc_*`。注入顺序：

```
shared-base.css（令牌） → Base.module.css（控件） → CustomCssRow.module.css（编辑器） → Wallpaper.module.css（面板）
```

## 里面有什么

| 内容 | 说明 |
| --- | --- |
| `--dsl-g-border-surface` / `--dsl-g-shadow-card` / `--dsl-g-radius-surface` | 描边、卡片阴影、圆角 —— 三个值在多个扩展的覆盖里反复出现，只定义一次 |
| `--dsl-g-gap-tight` / `--dsl-g-gap` / `--dsl-g-font-title` / `--dsl-g-font-note` | 间距与字号步进 |
| `.dsl-card` / `.dsl-surface`（`:where()`） | 细描边卡片原语，特异性 0 |
| `.dsl-ellipsis`（`:where()`） | 单行省略 |
| `.dsl-note`（`:where()`） | 面板里的小号说明文字 |

`custom.css` 里原先重复定义的那三个 `--dsl-g-*` 已删除，改由这里提供（值不变）。

**它不碰 DSH 自己的 `--dsw-*` 令牌。** 那些归宿主，覆盖会连带打断深色主题 —— 实测过一次：
把 `--dsw-alias-label-primary` 钉成深色，深色主题下正文就变成黑底黑字。用户表里现存的那条
`:root { --dsw-alias-label-primary }` 属于历史写法，保留原样，没有并进公共层。

## 为什么不直接改 `custom.css`

`custom.css` 是**用户数据**：会被导出、被历史版本记录、可能被用户整段重写。基座则应该跟着
插件版本走 —— 插件升级时自动带上新令牌，不需要用户手动合并。所以两者的边界是：

- **基座（本文件）**：跨扩展共用的令牌与原语，插件发布时携带；
- **用户表**：只放各扩展自己的覆盖规则。

## 同步与漂移检查

`shared/base.css` 不会在运行时被读取 —— 它是一段源码，由 `shared/sync.mjs` 写进
`lib/client.js` 的标记块里（DSH 每个插件只发一个 `client.js`，没有 import 关系；加构建步骤
就为了这一份 CSS 不值得）：

```bash
node shared/sync.mjs          # 写入
node shared/sync.mjs --check  # 只检查；漂移时退出码 1（已接进 npm run audit）
```

块的首尾有标记：

```
/* <<< dsh-shared:base-css v1.0.0 >>> */
const SHARED_BASE_CSS = "…";
/* <<< dsh-shared:end >>> */
```

标记行本身必须是**完整注释**（以 `*/` 结尾）—— 第一版漏了它，块里 CSS 注释的 `*/`
被当成块的结束符，整个文件语法错误。

## 接入另一个扩展

如果以后 tav2 也要用这套令牌，只需要两步：在它的源码里放一个 `/* dsh-shared:anchor */` 锚点，
在 `shared/sync.mjs` 的 `TARGETS` 里加一项。CSS 块是纯数据（`const SHARED_BASE_CSS = "…"`），
不依赖任何运行时函数，所以任何插件都能用。
