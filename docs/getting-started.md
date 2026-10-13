# 三分钟上手 · 它是什么

[← 返回 README](../README.md) · [文档索引](./index.md)

---

## 三分钟上手

1. 打开 **设置 → 通用**，滚到「外观」下方的 **自定义 CSS** 行。
2. 在编辑器里写 CSS。不想对着 DevTools 抄类名，就点 **[拾取元素]** 在界面里点你要的东西 ——
   它会给出候选选择器，并把它**实际解析到**的令牌写成声明：

   ```css
   [data-dockkit-strip] {
     background-color: var(--dsw-alias-bg-layer-1);
     border-radius: var(--dsw-radius-sm);
   }
   ```

3. 想写整套皮肤？用「更多操作 → 导入」把 [`examples/showcase.css`](../examples/showcase.css)
   导进来当底子 —— 它只用设计变量、不选哈希类名。

写自定义样式的三条经验在 [`examples/README.md`](../examples/README.md)：压过内置规则要加
`!important`、别选构建哈希类名、用 `var(--dsw-*)` 而不是写死颜色。

**改错了怎么办**：整个样式表在磁盘上，历史版本也留着 —— 用「更多操作 → 历史版本」回退，
或直接删掉文件里那几行（编辑器每次覆盖写盘前都会留快照，所以连恢复本身也能反悔）。
详见 [编辑器 · 历史版本](./editor.md#历史版本)。

---

## 它是什么

在 DSH 的 **设置 → 通用** 里，「外观」下方多一行 **自定义 CSS**。样式表是**宿主磁盘上的普通文件**，
写进去即时应用到整个界面。

- 注册在 `settings.general.item` 槽，`order: 12`。DSH 自带的 `ui-theme` 在这个槽上占了
  `appearance`(order 10) 与 `font-size`(order 11)，所以这一行正好落在它们下面。
- 样式表由 **host 侧**读写，存放在 `~/.dsh/custom-css/`（`$DSH_HOME/custom-css`，
  `$DSH_HOME` 未设时为 `~/.dsh`）。是普通文件：可用任意编辑器改、可备份、可放进版本库。
- 当前活动文件名与**各文件的开关**记录在同目录的 `active.json`
  （如 `{"active":"custom.css","disabled":["dark-tweak.css"]}`）。
- 注入的 `<style id="dsh-custom-css-user-style">` 追加到 `<head>` 末尾，同特异性下优先于内置样式表；
  需要压过内置规则时用 `!important`。
- 启动时由 `apply()` 直接读取并应用活动样式表 —— **不依赖设置面板打开**
  （只在面板挂载的组件里应用的话，普通对话页永远拿不到样式）。

### 为什么用文件而不是浏览器存储

- 你的编辑器、diff、git 都能直接管它；换浏览器、换端口都不影响已保存的表
  （跟随的是**文件**而不是 origin）。
- 多个标签页 / 多个窗口看到的是同一份；改一处，别的页面在几秒内跟上
  （机制见 [编辑器 · 在别的编辑器里改](./editor.md#在别的编辑器里改这里跟着变)）。
- host 接口不可达时（例如跑在非 Web composition 里）会自动降级到浏览器
  `localStorage` —— 编辑器还在、样式仍生效，但这一行会隐藏下拉与「打开文件」并给出提示。

### 一份样式表的生命周期

```
你在编辑器里敲字
  → 防抖 400ms
  → POST /dsh-custom-css/write（写前先把被替换的内容留一份快照）
  → 磁盘上的 .css 文件
  → 注入 <head> 的一个 <style>，页面重绘
```

反方向（在别的编辑器里改这个文件）走的是另一条路：宿主报修订号、浏览器每 1.5 秒问一次。
两条链的细节分别在 [API](./api-host.md) 与 [编辑器](./editor.md)。

## 相关

- [安装](./install.md) —— 三种装法与装错的症状对照
- [编辑器](./editor.md) —— 这个编辑器到底能做什么
- [元素拾取器](./picker.md) —— 不抄类名怎么写第一条规则
- [规则面板](./rule-panel.md) —— 选中一条规则之后怎么改
