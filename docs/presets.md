# 预设（亚克力 / 毛玻璃 / 榆木 / 细描边卡片）

[← 返回 README](../README.md) · [文档索引](./index.md)

> **状态：设计已定，尚未实现。** 位置在**规则面板上面**，一排按钮 `.dshCc_presets`。
> 名字以 [`docs/naming.md` D2 节](./naming.md) 为准。

---

## 它是什么

点一个预设 = **往当前规则里写入一组声明**。不是新建规则、不改选择器、不动几何。

顺序想清楚：**先检查，再写入**。检查不通过时**不静默失败** —— 要么明确说了为什么不行，
要么给一个「仍然应用」的选项并说明会有什么后果。一个点了没反应的按钮，比一个报错的按钮更糟。

## 检查（这就是「它会检查选择的元素是否符合要求」）

**检查对象**：当前规则命中的**第一个**元素；没有命中时用**拾取器选中的**元素；
两者都没有 → 用合成样本，检查项全部标「无法判断」（允许应用，但提示「看不到实际效果」）。

全部检查都能用 `getComputedStyle` + `CSS.supports` 判，不需要命中元素里有什么特殊标记：

| 检查 | 判据 | 不满足时 |
| --- | --- | --- |
| **不是插件自己的控件** | 元素或任一祖先带 `dshCc_` / `dshWp_` 类 | **拒绝**：改到插件界面上只会让你下次自己踩自己 |
| **有底色** | 元素自身 `background-color` 不是全透明，**或**当前规则已声明 `background-color`/`background` | 提醒：「这块自己是透明的，玻璃不会显形」+ 一键补一条底色 |
| **能模糊** | `CSS.supports('backdrop-filter', 'blur(1px)')` | 静默降级成「不模糊的半透明底」（不是报错：老浏览器上也该能用） |
| **面积够看** | `rect.width ≥ 40 && rect.height ≥ 24`；纹理类要 `≥ 120 × 60` | 提醒：「元素太小，纹理/玻璃看不出来」 |
| **有文字** | 元素有非空 `textContent` | 只影响参数提示：文字块用更低的透明度（对比度），空白块可以更重 |

**三种结论**：可应用 / 可应用但有提醒 / 拒绝。前两种都写入，第三种给原因。

## 预设目录

每个预设写什么、检查什么、以及**它做不到什么**。全部用 `--dsw-*` 令牌，不写死颜色。

### 1. 亚克力（Acrylic）

取自 [`examples/acrylic.css`](../examples/acrylic.css) 里已经验证过的做法：长写法描边、
`backdrop-filter` 只加在**拥有底色的那个元素**上。

```css
background-color: color-mix(in srgb, var(--dsw-alias-bg-base) 72%, transparent);
backdrop-filter: blur(24px) saturate(150%);
border-width: 0.5px;
border-style: solid;
border-color: var(--dsw-alias-border-l2);
box-shadow:
  inset 0 1px 0 color-mix(in srgb, #ffffff 60%, transparent),
  var(--dsw-elevation-prominent);
```

**不写 `border` / `background` 简写**：简写会把 `border-radius`、`background-image` 一起重置
（`examples/acrylic.css` 的文件头原则 3，是踩出来的）。**不碰几何**：宽高、padding 一律不动。

### 2. 毛玻璃（Frosted）

比亚克力「更磨砂」：模糊更大、饱和更低、没有内高光（内高光会让它看起来像塑料）。

```css
background-color: color-mix(in srgb, var(--dsw-alias-bg-base) 58%, transparent);
backdrop-filter: blur(36px) saturate(120%);
border-width: 0.5px;
border-style: solid;
border-color: var(--dsw-alias-border-l1);
```

检查同上；**额外提醒**：如果元素在滚动容器里，大半径模糊会明显掉帧（移动端尤其）。

### 3. 榆木（Elm）

**纯 CSS 的木纹**，不用图片文件。三层 `repeating-linear-gradient` 做纹理方向，加一层极淡的
噪声遮罩（`svg` turbulence 的 `data:` URI）压住渐变的塑料感。

```css
background-color: color-mix(in srgb, #8a5a33 62%, var(--dsw-alias-bg-base));
background-image:
  repeating-linear-gradient(92deg, rgb(0 0 0 / 5%) 0 1px, transparent 1px 7px),
  repeating-linear-gradient(88deg, rgb(255 255 255 / 4%) 0 2px, transparent 2px 11px),
  linear-gradient(160deg, #9a683c, #7a4e2b);
border-width: 0.5px;
border-style: solid;
border-color: color-mix(in srgb, #5c3a1f 40%, transparent);
```

**诚实说明（写进界面的 tooltip）**：这是**近似**，不是照片级木纹。它的价值是「暖色块 + 木纹暗示」，
用在卡片、侧栏、标题栏这类面积上；面积太小或要求真实材质时不要用。

### 4. 细描边卡片（Hairline）

最小的一种，也是验证预设机制用的那个：

```css
border-width: 0.5px;
border-style: solid;
border-color: var(--dsw-alias-border-l2);
box-shadow: var(--dsw-elevation-soft);
```

## 写入的形态

- **合并，不覆盖**：只写预设负责的那几个属性；规则里已有的同名声明**就地改值**，其余声明原样保留。
- **一次编辑**：所有写入合成一次文本改动 → **一次 `Ctrl+Z` 可整体撤回**（与规则面板的所有写入口径一致）。
- 写完属性面板立刻显示新值，预览块（见 [预览块](./preview.md)）跟着变。
- 写入后不弹提示：变化就在眼前，再弹一个「已应用」只是噪音。

## 不做什么

| 不做 | 为什么 |
| --- | --- |
| 不新建规则、不改选择器 | 预设是「给这条例加上一组声明」，换了作用对象就不是预设了 |
| 不写 `!important` | 预设是设计，不是打架；需要压过别人时用户自己加 |
| 不生成图片文件 | 榆木是纯 CSS；引入图片会让「导入/导出」与备份都变复杂 |
| 不动几何（宽高 / padding / margin） | 动几何的预设会悄悄改掉布局，那不是「效果」 |
| 不覆盖 `--dsw-*` 令牌 | 覆盖令牌是皮肤级的操作（见 `examples/acrylic.css`），不是单个元素的预设 |

## 令牌

| 用途 | 令牌 |
| --- | --- |
| 底色 | `--dsw-alias-bg-base` / `--dsw-alias-bg-module-platform` |
| 描边 | `--dsw-alias-border-l1` / `--dsw-alias-border-l2` |
| 阴影 | `--dsw-elevation-soft` / `--dsw-elevation-prominent` |
| 文字 | `--dsw-alias-label-primary` / `--dsw-alias-label-caption` |

## 与「声明模板」的区别

规则面板里已经有一排**声明模板**（`插入模板`：容器 / 横向排列 / 居中 / 描边 / 阴影……），
两者不要混：

| | 声明模板 | 预设 |
| --- | --- | --- |
| 规模 | 2–4 条布局声明 | 4–7 条**成套**的视觉效果 |
| 目的 | 「先摆好结构」 | 「让这块看起来像某种材质」 |
| 检查 | 没有 | **有**（见上表） |
| 位置 | 规则面板底部 | **规则面板上面** |

## 相关

- [预览块](./preview.md) —— 预设写完去哪儿看
- [规则面板](./rule-panel.md) —— 预设下方那块，写入后立刻显示新值
- [`examples/acrylic.css`](../examples/acrylic.css) —— 亚克力参数的来源
- [设计一致性](./design-tokens.md) —— 令牌阶梯与「别自创规格」
