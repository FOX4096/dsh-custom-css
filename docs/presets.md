# 预设（亚克力 / 毛玻璃 / 云母 / 细描边卡片）

[← 返回 README](../README.md) · [文档索引](./index.md)

> **状态：材质令牌已就绪（0.6.1），预设按钮尚未实现。** 位置在**规则面板上面**，一排按钮 `.dshCc_presets`。
> 四个预设引用的 `--dsh-material-*` 默认值已随插件发布（在「更多操作 → 令牌」的「材质参数」里可接管），
> 所以这一版**先能调参数、还没有一键写入的按钮**。
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

每个预设写什么、检查什么、以及**它做不到什么**。

**材质参数不写在预设里**：预设只引用 `--dsh-material-*` 令牌（云母 / 亚克力 / 毛玻璃的底色、模糊、
饱和、颗粒），那些参数在 [令牌管理](./token-manager.md) 里调 —— 调一次，所有用了这套材质的规则一起变。
默认值由插件自带（界面上显示来源为「插件默认」），所以预设第一下就能看见效果。

### 1. 亚克力（Acrylic）

取自 [`examples/acrylic.css`](../examples/acrylic.css) 里已经验证过的做法：长写法描边、
`backdrop-filter` 只加在**拥有底色的那个元素**上。

```css
background-color: var(--dsh-material-acrylic-bg);
backdrop-filter: blur(var(--dsh-material-acrylic-blur)) saturate(var(--dsh-material-acrylic-saturate));
border-width: 0.5px;
border-style: solid;
border-color: var(--dsh-material-acrylic-border);
box-shadow:
  inset 0 1px 0 color-mix(in srgb, #ffffff 60%, transparent),
  var(--dsw-elevation-prominent);
```

默认值：底色 72%、模糊 24px、饱和 150%（三个材质的对照表在下面 §3）。

**不写 `border` / `background` 简写**：简写会把 `border-radius`、`background-image` 一起重置
（`examples/acrylic.css` 的文件头原则 3，是踩出来的）。**不碰几何**：宽高、padding 一律不动。

### 2. 毛玻璃（Frosted）

比亚克力「更磨砂」：模糊更大、饱和更低、没有内高光（内高光会让它看起来像塑料）。

```css
background-color: var(--dsh-material-frost-bg);
backdrop-filter: blur(var(--dsh-material-frost-blur)) saturate(var(--dsh-material-frost-saturate));
border-width: 0.5px;
border-style: solid;
border-color: var(--dsw-alias-border-l1);
```

默认值：底色 58%、模糊 36px、饱和 120%。

检查同上；**额外提醒**：如果元素在滚动容器里，大半径模糊会明显掉帧（移动端尤其）。

### 3. 云母（Mica）

**材质本身是半透明的**：它不自己画颜色，而是把**背后的东西**压成一层低饱和的薄纱，再补一点点
极细的颗粒与顶部微光。CSS 里对应三件事：`backdrop-filter` 的 `saturate`（降饱和）、一层极淡的
噪声（`svg` turbulence 的 `data:` URI）、以及顶部一条内高光。

```css
background-color: var(--dsh-material-mica-bg);
backdrop-filter: blur(var(--dsh-material-mica-blur)) saturate(var(--dsh-material-mica-saturate));
background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='var(--dsh-material-mica-grain)'/%3E%3C/svg%3E");
border-width: 0.5px;
border-style: solid;
border-color: var(--dsw-alias-border-l1);
box-shadow: inset 0 1px 0 color-mix(in srgb, #ffffff 34%, transparent);
```

默认值：底色 86%、模糊 18px、饱和 115%、颗粒 0.035（想要更干净的云母就把颗粒设成 `0`）。

**与亚克力 / 毛玻璃的区别**（三个都是半透明，但观感不同，参数也就不同）：

| | 底色 | 模糊 | 饱和 | 颗粒 | 用在哪 |
| --- | --- | --- | --- | --- | --- |
| 亚克力 | 72% | 24px | 150% | 无 | 对话气泡、卡片：**透但清楚** |
| 毛玻璃 | 58% | 36px | 120% | 无 | 浮层、面板：**糊得明显** |
| **云母** | **86%** | **18px** | **115%** | **有（3.5%）** | 标题栏、侧栏、大块底：**几乎不糊，只换质感** |

**诚实说明（写进界面的 tooltip）**：这是对「云母」这类**系统材质**的近似 —— 它靠的是背后有什么。
放在**不透明**的底上时，它看起来只是一层很淡的纯色（这是材质本身的性质，不是 bug）；
放在壁纸或图片之上才看得出那层薄纱。颗粒用的是 SVG 噪声，不是位图。

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
| 不生成图片文件 | 云母的颗粒是 SVG 噪声（`data:` URI），不是位图；引入图片文件会让「导入/导出」与备份都变复杂 |
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
