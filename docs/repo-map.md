# 仓库结构

[← 返回 README](../README.md) · [文档索引](./index.md)

每个目录是干什么的，以及哪些是「产物」、哪些是「工具」。

---

```
dsh-custom-css/
├── package.json        # 插件清单：dsh.bundle / dsh.client 两个约定块，以及插件页的 icon
├── cordis.patch.yml    # loader 补丁（- insert: 自己的条目）
├── lib/
│   ├── index.js        # host 半：样式表目录 + 围栏内的 JSON 接口
│   └── client.js       # 浏览器半：设置行、编辑器、壁纸与设置两节、补全、校验、规则面板
├── dev/
│   ├── README.md       # 开发实例：一个只加载本插件的 DSH（端口 3081）
│   ├── instance.mjs    # 起 / 停 / 状态 / dump 组合配置树
│   ├── ego.mjs         # 取件窗口：让 ego 浏览器带令牌进开发实例
│   ├── home/           # 它的 DSH_HOME（独立，含会话与凭据）
│   └── state/          # 带令牌的入口 URL + 实例日志
├── temp/               # 探针与 ego 的截图、量出来的 JSON（不进版本库）
├── tests/
│   ├── loader-smoke.cjs      # 假 host 里真跑 client.js
│   ├── host-api-smoke.mjs    # 假 webServer 驱动 host 路由
│   ├── visual-probe.mjs      # 无头 Edge + CDP：量几何、截图、收控制台错误
│   ├── compat-matrix.mjs     # 跨版本兼容断言（槽位 + inject id）
│   ├── update-compat.mjs     # 换代检查：发现新版本 → 断言 → 写回文档
│   └── audit-*.mjs           # 圆角 / 字体 / 可访问名 / 重复率四个审计
├── .github/
│   ├── workflows/ci.yml           # Node 20/22 × 语法自检 + 冒烟 + 巡检 + 兼容
│   ├── workflows/publish.yml      # 推 v* tag → OIDC 受信发布 + 自动建 Release
│   ├── workflows/compat-watch.yml # 每 6 小时检查 DSH 换代并更新文档
│   ├── ISSUE_TEMPLATE/
│   └── pull_request_template.md
├── examples/
│   ├── acrylic.css         # 亚克力皮肤（渐变壁纸 + 玻璃面板 + 背景模糊），导入即用
│   ├── showcase.css        # 最小示例（只用设计变量，不选哈希类名），用来学怎么写
│   └── README.md           # 两份示例的导览 + 写自定义样式的经验
├── docs/                   # 参考文档（本目录）
│   ├── index.md            # 文档索引
│   ├── install.md · getting-started.md
│   ├── editor.md · rule-panel.md · validation.md · preview.md
│   ├── picker.md · controls.md
│   ├── api-host.md · compat.md · design-tokens.md · known-issues.md
│   ├── development.md · testing.md · repo-map.md
│   └── naming.md           # 命名表：每个界面元素唯一的名字
├── assets/
│   ├── icon.svg            # 图标（矢量，README 顶部用的就是它）
│   ├── icon-512.png        # 同一图标 512px，带透明通道，可用于仓库头像
│   ├── social-preview.svg  # 社交预览卡（1280×640）源文件
│   └── social-preview.png  # 同上，位图版（GitHub 社交预览与引用都取这张）
├── compat.json             # 跨版本兼容契约（槽位 / inject id / 已验证版本）
├── .editorconfig
├── CONTRIBUTING.md         # 本地跑起来、硬约束、发版流程
├── SECURITY.md             # 攻击面与私密报告渠道
├── LICENSE
├── CHANGELOG.md
└── README.md
```

---

## 几个容易找错的地方

### `lib/` 是产物，不是源码

`lib/client.js` 与 `lib/index.js` **就是**发布出去的东西 —— 这个仓库没有构建步骤，
改完 `lib/*.js` 直接就是新版本。所以：

- 没有 `src/`，不要去找
- `lib/client.js` 是模块加载器工厂，**不是 ESM**（见 [开发](./development.md)）

### `docs/naming.md` 是命名的权威

这个插件里**每个界面元素只有一个名字**。代码、注释、测试、issue、文档、更新日志 ——
以及你和 AI 对话时 —— 都用那张表里的词。

### 插件页的图标是清单里的 `icon` 字段

插件管理器显示的那个图标**不是界面上画出来的**，而是宿主读包根 `package.json` 的顶层 `icon`
（相对路径；也可以改成导出 `<specifier>/icon`），编成 `data:` URL 交给界面。约束与失败行为：

| 项 | 规定 |
| --- | --- |
| 格式 | SVG / PNG / JPEG / WebP |
| 上限 | 单个文件 ≤ 256 KiB（实测 `assets/icon.svg` 1.6 KB） |
| 路径 | 必须是**相对路径**，且解析后仍在该包目录内 |
| 读不到时 | **保留文字、不回退成别的图标**，并在元数据里带一条诊断 |

改完 `icon` **不用重启**：实测刷新页面就出现（界面每次读的是包清单）。更早的 DSH 不读这个
字段 —— 那时插件页只有默认图形，也没有报错。

上一版的问题就出在没有这张表：同一个输入框被叫过「选择器字段」「规则名」「面板标题框」，
一句「那个框改一下」要来回问三轮才知道是哪一个。

### `temp/` 不进版本库

探针与 ego 的截图、量出来的 JSON 都落在这里。可以随时删。

### `dev/home/` 是独立的一份 DSH_HOME

它含会话与凭据，但**与你在用的那份完全无关**（那是 `~/.dsh`）。
开发实例的 profile 是 `ccdev`、端口 `3081`。

---

## 社交卡位图要手工重新出

`assets/social-preview.*` 的**版本标签**由 `npm run compat:update` 自动维护，
但**位图要手工重新出** —— 出位图需要浏览器渲染，而那个脚本必须保持只依赖网络与 npm
（它同时跑在 CI 里）：

```
打开 assets/social-preview.svg → 对 <svg> 元素截图 1280×640 → 存回 assets/social-preview.png
```

SVG 改动后脚本会打印提醒。实测这个做法出的位图 **541 KB**，而早先那份是 1.03 MB。

## 相关

- [开发](./development.md) —— 命令、实例、探针
- [测试](./testing.md) —— 三个 CI 工作流
- [`docs/naming.md`](./naming.md) —— 命名表
