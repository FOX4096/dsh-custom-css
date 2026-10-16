# host 侧文件接口

[← 返回 README](../README.md) · [文档索引](./index.md)

host 侧在 `/dsh-custom-css` 前缀上挂了一组 JSON 端点。这是浏览器半与磁盘之间**唯一**的通道 ——
编辑器不碰文件系统，它只跟这些端点说话。

---

## 请求围栏（必读）

所有端点**必须**通过 Connection 服务的请求围栏：

- 未认证 / 非信任来源 → **401 / 403**
- 拿不到围栏（例如跑在非 Web composition 里）→ **503 fail-closed**，绝不裸奔

所以从浏览器控制台直接 `fetch('/dsh-custom-css/list')` 会拿到 401 ——
除非你带着页面自身的凭据（`credentials: 'same-origin'` 且已认证）。
这是**设计如此**，不是坏了：这个路由能写磁盘，不能给任意来源用。

## 端点

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/list` | `{ files, active, disabled, dir }` |
| GET | `/read?name=<name>` | `{ name, css, rev }` |
| GET | `/history?name=<name>` | `{ name, entries: [{ stamp, bytes, mtime }] }`，按时间倒序（快照目录 `.history/<name>/`，`.history` 这一层不会被 `/list` 当成表列出来） |
| GET | `/export` | 全部内容打成一个 JSON：每张表的正文与历史版本、两份记录、壁纸（base64）。用于「导出全部」 |
| POST | `/write` | 写入指定文件（写之前把被替换的内容留一份快照） |
| POST | `/create` | 新建空文件（已存在 → 409） |
| POST | `/import` | 导入内容为文件（按设计覆盖同名） |
| POST | `/rename` | `{ name, to }` → 改名；目标已存在 → 409 `exists`，名字不合法 → 400，源不存在 → 404。**历史快照一起搬过去**，`active.json` 里的 active / disabled 也跟着改 |
| POST | `/delete` | `{ name }` → 删掉；删之前先留一份快照（所以可逆）；**最后一张拒绝删除** → 409 `last-sheet`；active 被删时自动切到 `custom.css` 或字典序第一张 |
| POST | `/open-dir` | 用系统文件管理器打开样式表目录（无请求体；与 `/open` 同一个启动器） |
| POST | `/archive-and-reset` | `{ css? }` → 把样式表 / 历史 / 壁纸 / 记录**挪进** `.backup/<时间戳>/`，然后写一张 `custom.css` 并设为 active。返回 `{ stamp, backup, moved, skipped }` |
| POST | `/active` | 记录当前文件（文件不存在 → 404 `not-found`，与 `/toggle` 一致） |
| POST | `/toggle` | `{ name, enabled }` → 打开 / 关闭某张样式表（**文件保留**），状态记进 `active.json` 的 `disabled` |
| POST | `/open` | 用系统默认程序打开指定文件（仅限目录内已存在的 `.css`；不存在 → 404） |
| POST | `/restore` | `{ name, stamp }` → 把某一版快照写回该文件（被替换的内容先留一份快照，所以恢复可逆；`stamp` 不是时间戳 → 400，快照不存在 → 404） |

### 记录不是样式表（`.json.css`）

插件自己的两份记录叫 `wallpaper.json.css` 与 `settings.json.css` —— 它们以 `.css` 结尾、并且
**通过同一组文件端点读写**（浏览器半需要），但它们不是样式表。每条把名字当用户内容的路径都要
说清这件事，否则会出实测过的问题：文件下拉把 `wallpaper.json.css` 当成表列出来供编辑，
而重命名 / 删除会把「壁纸在哪」这份记录改掉。

| 事情 | 规则 |
| --- | --- |
| 出现在 `/list` 里 | **不**（`isSheetName` 拒绝 `*.json.css`） |
| `/read` 读得到 | **能**（记录要能被面板读回来） |
| `/write` 写得进 | **能**（唯一的例外，走 `safeRecordPath`） |
| `/rename`、`/delete` | **不能** → 400 `bad-name` |

### 重置是归档，不是删除

`archive-and-reset` **不删任何东西**：`.backup/<时间戳>/` 里能找到原来的一切，所以「重置」这个
按钮按错一次，代价是多一层目录，不是作品没了。

| 事实 | 说明 |
| --- | --- |
| 保留 | `custom.css`（写成调用方给的内容，缺省空），以及所有 `.backup/` |
| 搬走 | 其余 `*.css`、`.history/`、`.wallpapers/`、`active.json`、两份记录 |
| 为什么是白名单而不是扫目录 | `.backup` 自己绝不能被搬进新的归档里 |
| `skipped` | 在 Windows 上，被本插件 watcher 打开着的**目录**改名会 `EPERM`；这时记进 `skipped` 并继续，而不是整条路由失败（实测：文件逐个搬没问题，目录本身被占用） |
| 条数上限 | 归档与删除都按 `listFiles(Infinity)` 走 —— 按 `MAX_FILES` 截断的话，排在后面的表会被留在原处（实测：200+ 张表的目录，重置后还剩两张） |
| GET | `/gallery` | `{ dir, wallpapers: [{ name, bytes, mtime }] }`，按时间倒序 —— 壁纸用过的图，供面板列缩略图 |
| GET | `/wallpaper?name=<name>` | **直接返回图片字节**（不是 JSON），带 `content-type` 与 `cache-control: private, max-age=31536000, immutable` |
| POST | `/wallpaper-image` | `{ dataUrl }` → 存下这张图，回 `{ name, bytes, reused, url }` |

`rev` 是宿主报的**修订号**（`size/mtime` 拼出来的），不是内容哈希 —— 编辑器用它判断
「文件在别处被动过没有」。详见 [编辑器 · 在别的编辑器里改](./editor.md#在别的编辑器里改这里跟着变)。

## 壁纸的三个端点

壁纸不是样式表，所以它有自己的目录与自己的白名单：图片存在
`$DSH_HOME/custom-css/.wallpapers/`（**样式表目录下一层**，所以 `/list` 永远看不到它们，
不需要按扩展名过滤）。详见 [自定义壁纸](./wallpaper.md)。

- **名字是内容哈希**：`wallpaper-<sha256>.png`。同一张图传两次只落一个文件、一个缓存项，
  而一个「名字就是哈希」的 URL 可以永久缓存 —— 它不可能改主意指向别的字节。
- **接受的名字形状是钉死的**：`^wallpaper-[0-9a-f]{64}\.(png|jpg|webp|gif|avif|bmp)$`。
  名字来自 URL 且会被拼到目录上，所以这里比样式表名更严：不是这个形状一律 **400**，
  合法但不存在才是 **404**。
- **两个上限，不是一回事**：请求体上限（`32 MiB × 4/3 + 4 KiB`）先把过大的上传挡在内存外
  → `bad-body`；解码后的字节数上限（32 MiB）由 `/wallpaper-image` 自己判 → `bad-image`。
- 只接受 `data:image/*;base64,…`。传 URL 不下载 —— **这个端点存字节，不取字节**。


## 文件名白名单

限定为**单个路径段且以 `.css` 结尾**：

```
^[A-Za-z0-9._一-龥-]+\.css$      （≤ 64 字符）
```

- `..`、路径分隔符、无扩展名、Windows 设备名（`nul.css`、`con.css`…）一律 **400**。
- 目录外的路径在拼接后**还会二次校验**。
- **符号链接也拒绝**：目录内的软链会让写入落到目录之外，而字面量校验看不出来。

## `active.json` 的写入方式

用**临时文件 + rename** 写入，改动**串行**执行。两条都是踩出来的：

- 直接写入会先截断 —— 中途断电留下的半截文件会被读成「没有当前文件、没有关闭项」，
  于是下一次改动就把这个空状态固化下来。
- 两个标签页同时开关两张表会各写一份、**后写覆盖先写**。

另外：目录簿记里**指向已删除文件的关闭项**在每次写入时清理 ——
所以删掉再重建同名文件，不会一出生就是「关闭」状态。

## `/list` 的文件数上限

最多返回 **200** 个文件，但**当前文件一定在列表里**（哪怕它排在 200 名之外）。

否则行会退回到列表第一个文件，**每次打开页面都悄悄换掉用户选的样式表** ——
这种「悄悄换掉」比少列几个文件糟得多。

## 相关

- [它是什么](./getting-started.md#它是什么) —— 样式表目录在哪、注入怎么发生
- [编辑器](./editor.md) —— 谁在调这些端点、什么时候调
- [控件](./controls.md) —— 文件下拉 / 新建 / 导入导出的界面
- [开发 · 测试](./testing.md) —— host 路由的冒烟测试断言了什么
