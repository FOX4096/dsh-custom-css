# dsh-custom-css

<!-- Hero：徽章与色彩取自图标渐变的四个停靠点（绿 #257b56 / 青 #257083 / 蓝 #3156af / 紫 #6048bb）。
     图标走 jsDelivr 镜像而不是仓库内相对路径 —— 本机网络把 raw.githubusercontent.com
     解析到非公网地址，而 GitHub 渲染仓库内图片用的正是该域名，相对路径的图在本地打不开；
     图标本体仍在 assets/ 下，两处内容一致。
     下载量徽章暂缺：npm 的 downloads API 对刚发布的包要等约一天才有数据
     （实测此刻返回 404），届时可补 https://img.shields.io/npm/dw/dsh-custom-css 。

     ── 自动维护的三行 ──
     下面有三行由 npm run compat:update 写回，改版式时**请保留行首特征**，否则脚本会打印
     「找不到锚点」而不是猜着改：那颗 DSH 徽章、概览里的「- 兼容：DSH 」、安装一节的
     「**前置**：DSH 」。另外「### 验证矩阵」那一节也是它维护的（表格 + 表格后的说明段）。

     ── 本文只做落地页 ──
     细节都在 docs/ 下，见「文档」那一节。往这里加长内容之前先想想该不该进 docs/。 -->
<div align="center">
  <img src="https://cdn.jsdelivr.net/gh/FOX4096/dsh-custom-css@main/assets/icon.svg" width="88" height="88" alt="dsh-custom-css 图标：深色渐变圆角方块 + 白色花括号与三条声明行"><br /><br />
  <b style="font-size: 1.15em;">设置行里的 CSS 编辑器：写完即生效，样式表就是磁盘上的 .css 文件</b><br /><br />
  <a href="https://github.com/FOX4096/dsh-custom-css/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/FOX4096/dsh-custom-css/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/FOX4096/dsh-custom-css/releases"><img alt="release" src="https://img.shields.io/github/v/release/FOX4096/dsh-custom-css?label=release&amp;color=3156af"></a>
  <a href="https://www.npmjs.com/package/dsh-custom-css"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-custom-css?color=3156af"></a>
  <a href="https://www.npmjs.com/package/dsh-custom-css"><img alt="npm unpacked size" src="https://img.shields.io/npm/unpacked-size/dsh-custom-css?color=6048bb"></a>
  <a href="https://github.com/FOX4096/dsh-custom-css/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/FOX4096/dsh-custom-css?color=3156af"></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
  <a href="https://github.com/topics/dsh-plugin"><img alt="插件生态：GitHub topic dsh-plugin" src="https://img.shields.io/badge/插件生态-topic%20dsh--plugin-4d6bfe"></a>
  <a href="https://dshfind.com/zh/plugins/FOX4096/dsh-custom-css"><img alt="收录于 dshfind" src="https://dshfind.com/api/badge/FOX4096/dsh-custom-css?lang=zh"></a><br /><br />
  <a href="https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions"><img alt="支持的 DSH 版本：0.0.1-rc.1 ~ 0.2.1-rc.2（接口契约断言，36 个版本）；其中 0.1.2-rc.1 与 0.1.5-rc.1 与 0.2.0-rc.2 已真机验证" src="https://img.shields.io/badge/DSH-0.0.1--rc.1_0.2.1--rc.2_%28asserted%29-4d6bfe"></a><br /><br />
  <img alt="即时生效" src="https://img.shields.io/badge/-即时生效-257b56"> <img alt="DevTools 编辑器" src="https://img.shields.io/badge/-DevTools_编辑器-257083"> <img alt="键入补全" src="https://img.shields.io/badge/-键入补全-3156af"> <img alt="规则面板" src="https://img.shields.io/badge/-规则面板-6048bb"> <img alt="格式校验" src="https://img.shields.io/badge/-格式校验-257b56"> <img alt="声明模板" src="https://img.shields.io/badge/-声明模板-257083"> <img alt="元素拾取器" src="https://img.shields.io/badge/-元素拾取器-3156af"> <img alt="多文件管理" src="https://img.shields.io/badge/-多文件管理-6048bb"> <img alt="明暗自适应" src="https://img.shields.io/badge/-明暗自适应-257b56"> <img alt="属性字典" src="https://img.shields.io/badge/-属性字典-257083"> <img alt="历史版本" src="https://img.shields.io/badge/-历史版本-3156af"> <img alt="查找替换" src="https://img.shields.io/badge/-查找替换-6048bb"> <img alt="撤销重做" src="https://img.shields.io/badge/-撤销重做-257b56"> <img alt="规则大纲" src="https://img.shields.io/badge/-规则大纲-257083"> <img alt="自定义壁纸" src="https://img.shields.io/badge/-自定义壁纸-6048bb"><br /><br />
  <b>拾取元素 · 查找 · 文件下拉 · 更多操作</b>，把 <code>~/.dsh/custom-css/</code> 下的样式表注入界面 ——<br />
  编辑器照 DevTools 的 Styles 标签页做：行号 gutter、语法高亮、键入补全、规则面板、格式校验、撤销重做、查找替换；<br />
  拾取器在界面里点选一个元素，直接给出跨版本尽量稳的选择器，并把它实际生效的令牌写成声明；<br />
  <b>壁纸</b>不用写 CSS：选一张本机图片即可，界面透明与明暗都由它自己调（插件详情页里那一节）。
</div>

DSH Web GUI 扩展：在 **设置 → 通用** 的「外观」下方增加一行 **自定义 CSS** —— 样式表以普通 `.css` 文件保存在宿主磁盘上，写进去即时应用到整个界面。

- npm：[`dsh-custom-css`](https://www.npmjs.com/package/dsh-custom-css)（2026-09-13 首发，当前版本见上方徽章）
- 收录：[dshfind 插件超市 → 皮肤主题](https://dshfind.com/zh/plugins/FOX4096/dsh-custom-css)（徽章与展示卡由 dshfind 提供，`/api/badge` 与 `/api/card`）
- 兼容：DSH `0.1.2-rc.1` ~ `0.2.0-rc.2` 已真机验证；接口契约断言覆盖 `0.0.1-rc.1` ~ `0.2.1-rc.2`（共 36 个版本）；`npm run compat` 可复跑（见「兼容性」）
- 许可：MIT
- 形态：DSH profile 插件（host 半 + 浏览器半），无构建步骤，`lib/*.js` 即产物

<details>
<summary>dshfind 展示卡（440×200）</summary>

[![dshfind](https://dshfind.com/api/card/FOX4096/dsh-custom-css?lang=zh)](https://dshfind.com/zh/plugins/FOX4096/dsh-custom-css?ref=badge)

</details>

---

## 装

**前置**：DSH `0.1.2-rc.1` ~ `0.2.0-rc.2`（**已真机验证**；接口契约断言覆盖 `0.0.1-rc.1` ~ `0.2.1-rc.2`，见「兼容性」），Node.js ≥ 20、pnpm ≥ 10。

```bash
# 1) 装进 profile
dsh plugin --profile web add dsh-custom-css

# 2) 让它真的被加载：把包名加进 profiles/web/package.json 的 dsh.profile.bundles
#    "dsh": { "profile": { "bundles": [ ..., "dsh-custom-css" ] } }

# 3) 重启 GUI（重开会话不够，进程内模块缓存是旧的）
```

**两步缺一不可**：只装不列进 `bundles` → 那一行不出现且没有报错；只写 `bundles` 不装 → 启动直接失败。

装完打开 **设置 → 通用**，滚到「外观」下方的 **自定义 CSS**，写：

```css
[data-dockkit-strip] {
  background-color: var(--dsw-alias-bg-layer-1);
  border-radius: var(--dsw-radius-sm);
}
```

不想抄类名就点 **[拾取元素]** 在界面里点你要的东西。

- 换 GitHub 源、本机 `link:` 开发安装、卸载、换版本 → [安装](./docs/install.md)
- **装错了**：每个症状对应哪一步漏了 → [安装 · 装错了](./docs/install.md#装错了症状与原因)

## 文档

按「想做什么」找，完整索引在 [`docs/index.md`](./docs/index.md)。

| 我在… | 看这些 |
| --- | --- |
| **刚装上** | [安装](./docs/install.md) · [三分钟上手](./docs/getting-started.md) · [已知坑](./docs/known-issues.md) |
| **换张背景图（不写 CSS）** | [自定义壁纸](./docs/wallpaper.md) —— 入口在插件详情页里 |
| **写样式** | [编辑器](./docs/editor.md) · [元素拾取器](./docs/picker.md) · [规则面板](./docs/rule-panel.md) · [格式校验](./docs/validation.md) · [控件](./docs/controls.md) |
| **改插件** | [开发](./docs/development.md) · [UI 组件库](./docs/ui-kit.md) · [测试与巡检](./docs/testing.md) · [设计一致性](./docs/design-tokens.md) · [仓库结构](./docs/repo-map.md) · [命名表](./docs/naming.md) |
| **排查问题** | [已知坑与已知限制](./docs/known-issues.md) · [兼容性](./docs/compat.md) · [host 侧文件接口](./docs/api-host.md) |
| **等新功能** | [预览块（规划中）](./docs/preview.md) |

另有可直接导入的示例：[`examples/acrylic.css`](./examples/acrylic.css) —— 完整的亚克力皮肤（渐变壁纸 + 玻璃面板 + 背景模糊）；
想学怎么写就看 [`examples/showcase.css`](./examples/showcase.css)（60 行的最小示例）。
两者都由 [`examples/README.md`](./examples/README.md) 导览。

## 兼容性

插件与 DSH 的耦合面是刻意做窄的，所以它跨版本比多数插件活得久：**浏览器半在运行时一个 `@deepseek-ai/*` 模块都不 require**（只通过 `dsh.client.inject` 声明可用 id、并从 Context 取 `slots` 服务），host 半只挂 HTTP 路由。真正依赖的平台契约只有四条，全部记在 [`compat.json`](./compat.json)，由 `npm run compat` 逐个版本断言：

| 契约点 | 内容 |
| --- | --- |
| 槽位 | `settings.general.item`（`@deepseek-ai/dsh-client-ui-settings-general` 里 `GeneralSection` 渲染的那个 seat） |
| 声明的模块 id | `@deepseek-ai/dsh-client-ui-settings`、`@deepseek-ai/dsh-client-ui-settings-general` |
| 需要的服务 | 仅 `slots` |
| 运行时 require | 零 |

### 验证矩阵

| DSH 版本 | 验证方式 | 结论 |
| --- | --- | --- |
| `0.2.0-rc.2` | 真机运行：本机日常在用的实例（生产 profile `web`，插件以 `link:` 装入并实际渲染设置行）。实测 host 路由 `GET /list`、`GET /read`、`GET /history` 全部 200，返回的正是磁盘上的样式表与历史快照 | 通过 |
| `0.1.5-rc.1` | 真机运行（本仓库开发环境） | 通过 |
| `0.1.2-rc.1` | 真机运行：独立 `DSH_HOME` 起实例，`/dsh-custom-css/list`、`/write`、`/read` 全部 200 且文件确实落盘 | 通过 |
| `0.0.1-rc.1` ~ `0.2.1-rc.2`（共 36 个） | 接口契约断言（`npm run compat` 解包该版本的 settings 包，核对槽位与 id） | 通过 |

`npm run compat` 需要网络（要拉各版本的包），所以本地 `npm test` 保持离线可跑；CI 里单跑一档。

上表由 `npm run compat:update` 自动维护（GitHub Actions 每 6 小时检查一次 DSH 是否更新，有新版本就重新断言并提交这一节）。**上次核对：2026-10-23，当时最新已发布版本 `0.2.1-rc.2`。**

> **换代时的两种失效模式怎么判别**（症状完全不同）：见 [兼容性](./docs/compat.md#两种失效模式的判别)。

## 已知限制

- 只能**追加** CSS，不能修改内置样式表本身。
- 规则面板只认**顶层**样式规则（`@media` 里的规则照常生效，只是面板编辑不到）。
- 拾取器只能拾取**当前文档**里的元素，跨域 iframe 里拾取不到。
- 壁纸一次只挂**一张**图；来源二选一 —— **上传本机文件**（≤ 32 MiB），或**贴一个 URL**
  （`https://` / `file:///` / `data:image/…`，不下载、直接引用）。它自己会做界面透明，但皮肤若也设了
  那几个 `--dsw-alias-bg-*` 令牌，**皮肤优先**（面板会说明）。

另外五条（含 host 接口不可达时的降级行为、令牌建议为什么可能一个都不给）
在 [已知坑与已知限制](./docs/known-issues.md)。

## 参与

- 想改代码：[CONTRIBUTING.md](./CONTRIBUTING.md)（本地跑起来、硬约束、发版流程）
- 想知道内部怎么转：[开发](./docs/development.md) · [测试与巡检](./docs/testing.md)
- 想直接看效果：[`examples/acrylic.css`](./examples/acrylic.css)（亚克力皮肤） · [`examples/showcase.css`](./examples/showcase.css)（最小示例）
- 安全问题：见 [SECURITY.md](./SECURITY.md) 的私密渠道

改动记录见 [CHANGELOG.md](./CHANGELOG.md)。
