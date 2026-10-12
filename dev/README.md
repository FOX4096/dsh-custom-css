# 开发实例

一个**只加载本插件**的 DSH，用来改界面。它不碰你正在用的那个实例（端口 3080）。

```bash
npm run dev          # 起（幂等：profile 缺就建、junction 掉了就补）
npm run dev:status   # 看状态与入口
npm run dev:down     # 停
npm run dev:dump     # 打印组合后的配置树，并确认本插件的行在里面

npm run probe -- --open-settings --sel .dshCc_row --shot
```

- 实例：<http://127.0.0.1:3081>（**必须**用它启动时打印的那个带令牌 URL，见下）
- 独立 `DSH_HOME`：`dev/home/` —— 与 `~/.dsh` 无关，会话、凭据、日志各一份
- profile：`ccdev`（`dev/home/profiles/ccdev/`）

## 用 ego 浏览器操作它（能实时看见）

内置浏览器这条路上走不通（缺 Electron），所以用 ego：它是**一个真窗口**，你和 AI 看的是同一个界面。

```bash
npm run dev          # 先把实例起起来
node dev/ego.mjs     # 起一个「取件窗口」，它会打印一个 http://127.0.0.1:<port>/ 地址
# 然后让 AI 用 ego_navigate 打开那个地址 —— 页面自己 fetch 到带令牌的 URL 并跳转
```

**为什么要绕这一下**：ego 有自己的 profile 与 cookie 罐，所以它必须**带着令牌进一次**才能换到
cookie。而那个令牌不该出现在对话里、终端输出里、日志里 —— 它等同于一张进界面的通行证。
取件窗口只做一件事：把令牌从「磁盘上的文件」直接交给「浏览器的地址栏」，中间不经过任何
会被记录的地方（页面用 `location.replace`，连浏览器历史里都不留那条带令牌的地址）。交出去
之后窗口立刻关闭。

---

## 它为什么不是「复制一份 profiles/web」

第一版方案是复制真机的 profile 目录。**那条路是错的**，根因在真机那份 `cordis.patch.yml`：

```yaml
- id: webserver
  config:
    port: 3080        # ← 写死
```

而 DSH 出厂配置里同一个字段是：

```yaml
port: !!js ctx.webStartup.port ?? 3080      # ← 跟着 --port 走
```

**写死的 3080 会把 `--port` 这个入口掐掉。** 复制过去的开发实例会去抢真机的端口：
bind 撞上不过是起不来，更坏的是有人把真机停了再起开发实例 —— 真机就被顶掉了，
而且没有任何地方会提示这件事。

所以这里走 DSH 官方给的路子：`--from-default-profile web` 只复制**模板的 bundle
列表**（`dsh-app-boot` 的 `PROFILE_TEMPLATES`：`dsh-base` + `dsh-web-app`），同名内置
profile 的本地状态一个字节都不读。产出的是出厂默认值，而不是「被二十多个插件改过的
运行副本」。

顺带三个好处：`dsh-base` / `dsh-web-app` 直接从 dsh 安装目录解析（不用装依赖）、
不需要任何端口相关的 YAML（`--port` 直接生效）、profile 只有一个依赖（本仓库）。

---

## 令牌：为什么入口一定要现取

dsh 的浏览器认证没有绕过口子：未认证请求一律 401（`dsh-client-connection` 的
`writeUnauthorized`），唯一入口是启动时打印的带令牌 URL：

```
dsh web: http://127.0.0.1:3081/?token=…
```

所以：

- `dev/state/url.txt` 里存着那个完整 URL，**探针从那里读**，它自己拼不出能进的地址；
- 令牌出现在任何日志、终端输出、截图里都是**打码**的（`token=***`）；
- 签名密钥在 `dev/home/.credentials.yaml` 里，与真机那份互不相干；
- 这个文件在 `.gitignore` 里。**它不该进仓库、不该贴给别人、不该进 issue。**

---

## 探针能做什么，不能做什么

`tests/visual-probe.mjs` 用无头 Edge 在**真实 Chromium** 里打开开发实例。零依赖 ——
Node 24 自带 `WebSocket`，直连 CDP。

**能做**：按选择器量几何（含溢出量、盒模型）、截图、收控制台错误 / 页面异常 / 失败请求、
点开设置面板。结果写到 `temp/probe/last-probe.json` 并打在标准输出上。

**不能做**：它**不是 UI 测试套件**，只测量、不断言。断言是下一阶段的事（把现有测试套件
搬进真浏览器）。

**为什么结论不许靠截图**：截图是给人「看一眼」的。`看起来有点挤` 和 `真的溢出 16px` 是两回事，
后者只有数字能说。

常见选项：

```bash
npm run probe -- --open-settings --sel .dshCc_row --shot    # 点开设置，量那一行，截图
npm run probe -- --sel .dshCc_shell --sel .dshCc_panel      # 量多个
npm run probe -- --show --open-settings                      # 有头：窗口会显示出来
npm run probe -- --width 440 --open-settings --sel .dshCc_row  # 窄行（侧栏打开时约 440px）
```

---

## 坏了怎么查

| 现象 | 多半是什么 | 怎么办 |
| --- | --- | --- |
| 起不来，端口没绑上 | profile 初始化失败，或 3081 被别的进程占了 | `npm run dev:dump` 看组合树；`npm run dev:status` |
| 组合树里没有 `# == dsh-custom-css` | profile 的 `bundles` 少了我们那一行 | `npm run dev` 会自己补回去 |
| 报「模块找不到 dsh-custom-css」 | `node_modules` 里的 junction 掉了（真机 profile 那边 pnpm 重建时可能牵连） | `npm run dev` 会自己补回来 |
| 探针报 401 | 令牌过期（实例重启过） | `npm run dev:down` 再 `npm run dev` |
| 探针报「找不到设置入口」 | DSH 换代改了设置入口的名字 | 看 `temp/probe/last-probe.json` 里的 `settings.steps` |
| 浏览器找不到 | 没装 Edge | 探针会列出它找过的路径 |

日志：`dev/state/instance.log`（已打码）。

---

## 两条边界

- **这里看到的界面比真机"穷"。** 开发实例里没有你另外那二十多个插件，所以命中数、
  可用令牌、布局都和真机不一样。这个实例验的是**逻辑与几何**；「界面长什么样」要在
  真机确认。
- **不要把真机那份 `custom.css` 搬进来。** 那份 33.9 KB 的样式表里有大量 `!important`
  与 `display:none`，它们会作用在**一个没有那些插件**的界面上，产生的效果完全是误导。
  开发实例的样式表就写几条 `:hover`、几条 `.dshCc_*` 就够。
