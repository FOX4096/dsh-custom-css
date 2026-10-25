# 已知坑与已知限制

[← 返回 README](../README.md) · [文档索引](./index.md)

两部分：**坑**是「这么写会出事，怎么绕」；**限制**是「它本来就不做这件事」。

改样式之前值得先扫一眼坑那张表 —— 前两条能解释大多数「我明明写了却没生效」。

---

### 带 `transform` 的祖先会让 `position:fixed` 的菜单消失

设置对话框的卡片有一个 `transform`（进场用），任何 `position:fixed` 的后代都会改成「相对它定位」；
再叠一层 `overflow:hidden`（编辑器外壳）就是完全裁掉。表现为控件「点不了」，而 DOM 里一切正常：
`aria-expanded` 是 true、菜单行都在、`getBoundingClientRect()` 有尺寸，只是那个矩形在可见区域之外。

解法是把菜单放进 **top layer**（`popover`），不是调 `z-index`、也不是删掉 `overflow`。
量法：`getComputedStyle(menu).position` 是 `fixed` 时，看它的 rect 有没有落在某个 `overflow:hidden`
祖先之外 —— 落在外面就是被裁了。
## 已知坑（都是实测踩出来的）

| 坑 | 现象 | 结论 |
| --- | --- | --- |
| **注入顺序不定** | 自定义 CSS 与 DSH 内置样式表同为 `(0,1,0)` 特异性时，谁后插入谁赢，而两者的插入时机都不受你控制 | 覆盖 DSH 自己的类名时**一律加 `!important`**，让结果与顺序无关 |
| **类名是构建哈希** | `hHd-Xa_footArea`、`VOzbGW_triggerRow` 这类名字会随 DSH 版本变 | 用它做选择器的样式在 DSH 升级后要复测；从 DOM 里抓类名的正则**必须包含 `-`**，否则会截掉 `hHd-` 前缀、选择器永不命中 |
| `:has()` 不能嵌套 | 写成 `:has(div:has(> .foo))` 时 Chrome 抛 `is not a valid selector`，**整条规则被静默丢弃**（不报错、不生效） | `:has()` 只写一层，把「直接父级」的约束放进同一条相对选择器里（`> div:not(...) > .foo`） |
| 描述符不是属性 | `@property` 块被校验器报成「syntax 的值无效」等 3 处 | 校验按块类型分流（见 [格式校验](./validation.md)）；`CSS.supports` 判不了 descriptor |
| **host 半不热更新** | 改 `lib/index.js` 后刷新页面毫无变化 | host 半必须**重启 dsh**；只有浏览器半（`lib/client.js`）走 `dsh-client-hmr` 热更新 |
| 于是**新功能可以先安静地躺在磁盘上** | 「外部改动已被拦下」的提示、以及后来的自动同步，都写在 host 半：一个从昨天就开着、没重启过的 dsh 会继续跑旧代码 —— 用户会以为「这功能从来没生效过」（本次实测：dsh 启动于 22:29，host 改动写于次日的 00:24） | 改完 host 半**立刻重启**再谈验证；报告缺陷前先对一下 `dsh` 进程的启动时间和 `lib/index.js` 的修改时间 |
| **一行放不下就换行，而换行不报错** | 查找栏的两个输入框加六个控件是固定 610px，而行宽只有 600px（侧栏打开时 440px）：字段被压到最小值之后，最后两个按钮**掉到第二行**，栏变两倍高，页面看起来只是有点挤 | 用实测定位加两级让步：**640px 以下隐去命中计数**、**540px 以下 `替换` / `全部替换` 换成 ↦ / ⇉**。阈值取在仍有富余处。任何装进固定宽度行的 flex 行都该这样量一遍 |
| 自定义属性动画 | `--my-color` 在关键帧之间硬跳，不插值 | 这是规范行为：先用 `@property --my-color { syntax: '<color>'; inherits: true; initial-value: … }` 声明类型，浏览器才肯对它做插值 |
| **自己定义的变量在 `:root` 里引用 DSH 令牌 → 静默失效** | 写 `:root { --my-tone: var(--dsw-static-blue-400); }` 之后，`--my-tone` 解析成空值，于是**整条依赖它的声明被丢弃**（壁纸、背景、渐变全部不见），而浏览器不报任何错 | DSH 把全部 `--dsw-*` 令牌定义在 **`body`** 上（不是 `:root`）。凡是引用 DSH 令牌的自定义属性，**必须定义在 `body` 上**。纯字面量的变量放哪儿都行。详见 [`examples/README.md`](../examples/README.md) |
| **玻璃面加错元素 → 模糊了却没有效果** | 给"看起来像容器"的祖先加 `backdrop-filter`，视觉上毫无变化；或者把该有底色的元素设成透明，结果背景直接漏出来 | 玻璃要加在**拥有底色的那个元素**上，而且那个元素常常是**实心 `#fff`** —— 先把它的底换成半透明，模糊才有意义。用 `getComputedStyle` 逐层看 `backgroundColor`，别猜 |
| **`inset` 放大固定尺寸元素 → 渐变跑出视口** | 给壁纸伪元素写 `inset: -20%`（想给动画留余量）后，`radial-gradient(… at 82% …)` 的右边缘落到**视口之外**，右半边只剩 `transparent` —— 看起来像"只铺了左半边" | 渐变盒与视口同尺寸（`inset: 0`），色斑用百分比在盒内展开。要留余量就调渐变的尺寸百分比，而不是放大盒子 |
| **自己画的层和皮肤打平 → 图没画上，面板还说「已保存」** | 自定义壁纸的 `body::before` 与亚克力皮肤的 `body::before` **特异性相同**，皮肤的表后注入 → 皮肤赢，页面仍是渐变，而面板状态是「已保存」（看起来像壁纸功能坏了） | 插件自己的图片层写成 `html body::before,html body[data-ds-dark-theme]::before`（高一档）并给关键几何带 `!important`；界面底色那几个令牌**不带** `!important`，让皮肤赢并给出一行说明。详见 [自定义壁纸 · 三个设计决定](./wallpaper.md#三个设计决定) |
| **窄栏里 `flex-wrap` 会悄悄把布局撑坏** | 设置对话框右侧开一个面板后只剩 198px：260px 的预览单独占一行，控件列被压到 0 宽又各自溢出 96–124px，整块涨到 691px 高 | 用 `container-type: inline-size` + `@container` 在阈值处切换方向（宽了并排、窄了堆叠），并且**窄时每一行自己也要改成纵向** —— 96px 的标签 + 滑块放不进同一行 |
| 跨代插件 | 插件加载失败：`client-modules: require("…") missed the module table` | 那是给**旧一代 DSH** 编译的 bundle：它把平台包硬写进了产物（如 `@deepseek-ai/dsh-client-runtime/client`、`dsh-ui-primitives`），而当前代已删掉这些包。只能等插件作者更新；本插件运行时 require 数为 0，不受这类漂移影响 |
| **设置里根本没有「自定义 CSS」这一行** | 设置 → 通用 从上到下看一遍，没有这一项；同时控制台里有一条 `[dsh-custom-css] 3 秒内没有拿到设置槽位…` 的 warn | 这是**槽位名变了**：插件靠 `settings.general.item` 这个席位出现，DSH 换代改名后它永远不会被挂上（插件本身不报错，只是安静地什么都不出现）。从 v0.4.5 起这种情况会在控制台 warn 一次，并带上**插件版本 + DSH 版本**。把那条 warn 原样贴进 issue 即可 —— 不给版本号的话，只能靠猜是哪一版改的 |

### 设置里没有这一行时，按这个顺序查

1. **先看控制台**（F12 → Console）有没有 `[dsh-custom-css]`：有那条 warn = 槽位名变了（见上表）；
   没有 = 插件这半可能压根没被加载（插件没启用、或 host 半版本不匹配）。
2. **确认插件是启用状态**：设置 → 内置插件 → `dsh-custom-css` 是否在列表里、开关是否打开。
3. **确认 DSH 版本**：`/dsh-custom-css/about` 现在会返回 `dsh` 与 `dshCommit`（v0.4.5 起），
   和 [兼容矩阵](./compat.md) 对一下 —— 落在矩阵里说明契约测过了，问题更可能在别处（比如某个
   主题扩展改了设置页的布局）。
4. **报 issue 时带上**：那条 warn 的全文、`/about` 的返回、以及「设置 → 通用」的截图。

### 扩展冲突：聊天里的图片压住后面的内容（本插件已打补丁）

**现象**：消息里的图片会盖住下一块内容（截图里那张 256px 图标压住了下面的 callout），看起来像「图片样式写错了」。

**归因：是另一个扩展 `dsh-smooth-stream` 0.7.0，不是 DSH 本身。** 判别方法是「逐张样式表二分」——
在 3080 真机上关掉本插件的补丁，然后以 217 张扩展样式表为集合做二分，每步只量一个数：图片外层 `<p>` 的高度。

| 打开的样式表 | 图片 `<p>` 高度 | 结论 |
| --- | --- | --- |
| 全部关闭 | **256px** | DSH 自己布局是对的 |
| 只打开 `dsh-smooth-stream/TypewriterAssistantNodeView.module.css` | **19px**（行高） | 就是这张表 |
| 交替 off/on ×3 | 256 / 19 稳定复现 | 可确定归因 |
| 本插件补丁开启 | **256px** | 补丁把它盖住了 |

它压塌的方式（**真正的规则**，上一版把这里写成 `min-height:0`，是错的）：

```css
@supports (text-box-trim: trim-both) {
  .root :is(p, h1, h2, h3, h4, h5, h6, blockquote) {
    text-box-trim: trim-both;
    text-box-edge: text;
  }
}
```

`text-box-trim: trim-both` 会按**文字边**裁掉首末行的半行距。而 DSH 把图片渲染成
`<p><button class="imageButton"><img class="image"></button></p>` —— 当段落里只有一个很高的
inline-block 时，裁剪按的是**文字行高**（19px），于是 `<p>` 只剩一行文字的高度，
而图片仍按 256px 绘制：图就画在自己盒子外面，盖住上面/下面的内容。

判别做到最细的一步（3080 真机，本插件补丁关闭）：

| 动作 | 图片 `<p>` 高度 |
| --- | --- |
| 原样（smooth-stream 开） | 19px |
| 只删掉上面那条 `@supports` 规则 | **256px** |
| 把规则放回去 | 19px |
| 换用作者修复版的选择器（加 `:not(:has(img, …))`） | **256px** |

**上游状态**：作者已在 `main`（commit `1f199b7`）与 **0.8.0-rc.1**（npm tag `next`，2026-10-07）
修好 —— 选择器改成 `:not(:has(img, video, canvas, iframe, object, embed, code))`，注释里描述的
症状与这里完全一致。但 npm 的 `latest` 仍是 **0.7.0**，所以装 latest 的人依旧会看到。

**本插件的补丁**（`lib/client.js` 的 `HOST_FIX_CSS`，注入成独立的 `<style data-plugin-css="dsh-custom-css/host-fix.css">`）：

```css
[class*="_imageButton_"] { display: block; width: fit-content; max-width: 100% }
```

让包图片的按钮成为块级元素，那个 `<p>` 的高度就只能由图片决定 —— 不管上游是哪个扩展布局出岔子，
图都不会再盖住下文。

选择器用**模块名前缀**（`_imageButton_`）而不是完整类名：哈希后缀每次构建都变，而这段来自 CSS module 文件名，跨版本稳定；DSH 哪天改了这个模块名，规则会静默失效（退回原状），不会误伤别的元素。`width: fit-content` 不能省 —— 只写 `display:block` 会让按钮撑满整行、点整行都开大图。

**副作用**：无（只在 markdown 图片按钮上生效）。真正的修法在 smooth-stream 那边（别让可折叠容器把消息内容压到行高），它修好之后这段可以整块删掉。


> 最后一条的判别方式见 [兼容性 · 两种失效模式的判别](./compat.md#两种失效模式的判别)。

## 已知限制

- 只能**追加** CSS，不能修改内置样式表本身。
- 跨浏览器会话跟随的是**文件**而非 origin，因此端口变化（如 DSH Desktop 每次分配端口）
  不影响已保存的样式表。
- host 文件接口不可达时（例如跑在非 Web composition 里）自动降级：编辑器仍在、样式仍生效，
  但内容退回浏览器 `localStorage`，且此行隐藏下拉与「打开文件」并给出提示。
- 规则面板只认**顶层**样式规则：写在 `@media` / `@supports` 里的规则不在可点范围内
  （它们照常生效，只是面板编辑不到），`@font-face`、`@property` 这类块也按各自规矩单独校验
  而不进面板。
- 拾取器只能拾取**当前文档**里的元素：侧边栏浏览器面板那种跨域 iframe 里拾取不到。
- 拾取器给出的候选是「尽量活得久」，不是「绝对唯一」—— 命中多个元素的候选仍会被列出
  （标注为「N 个命中」），只是不会默认选中它。
- 令牌建议可能**一个都不给**：只有作用域内、且名字读起来像该属性的令牌才会被建议
  （见 [拾取器 · 令牌反查](./picker.md#令牌反查)）。这是有意的取舍，**不是没读到**。
- 未注册多语言字典，界面文案为中文。

## 相关

- [兼容性](./compat.md) —— 换代时的两种失效模式
- [设计一致性](./design-tokens.md) —— 为什么覆盖内置类名要 `!important`
- [开发](./development.md) —— 改 host 半之后怎么重启
