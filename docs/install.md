# 安装

[← 返回 README](../README.md) · [文档索引](./index.md)

三种方式选一种。**第 1 步和第 2 步缺一不可**：

- 只装依赖、不列进 `bundles` → 包根本不会被 loader 载入，界面里那一行不会出现，也没有报错
- 只写 `bundles`、没装依赖 → 启动时直接失败

本文补 README 没讲的部分：怎么卸载、怎么换版本、以及装错时**每个症状对应哪一步漏了**。

---

## 方式一：从 npm 安装（推荐）

**前置**：DSH `0.1.2-rc.1` ~ `0.2.0-rc.2`（**已真机验证**；接口契约断言覆盖到 `0.2.1-alpha.2`，见 [兼容性](./compat.md)），Node.js ≥ 20、pnpm ≥ 10。

```bash
# 1) 把插件装进 profile（dsh plugin 会把参数转发给 profile 目录里的 pnpm）
dsh plugin --profile web add dsh-custom-css

# 2) 让它真的被加载：把包名加进 profiles/web/package.json 的 dsh.profile.bundles
#    "dsh": { "profile": { "bundles": [ ..., "dsh-custom-css" ] } }

# 3) 重启 GUI（重开会话不够，进程内模块缓存是旧的）
```

## 方式二：从 GitHub 安装（跟 main 分支）

```bash
dsh plugin --profile web add github:FOX4096/dsh-custom-css
```

方式一里第 2、3 步照旧。

## 方式三：本机开发安装（`link:`，改完即见）

1. `package.json` 的 `dependencies`：`"dsh-custom-css": "link:<本仓库绝对路径>"`
2. `package.json` 的 `dsh.profile.bundles` 加入 `"dsh-custom-css"`
3. `profiles/web/node_modules/dsh-custom-css` 建 junction 指向本目录
4. **重启 GUI**

`pnpm install` 会重建 `node_modules`，可能抹掉该 junction；重建一次即可。

---

## 为什么必须写 `bundles`

列进 `bundles` 的包**必须自带 `dsh.bundle.patch`** —— `dsh-app-boot` 会为每个包读 `package.json` 的 `dsh.bundle.patch`，缺失即启动失败：

```
profile bundle "…" declares no dsh.bundle in its package.json
```

本仓库的 `cordis.patch.yml` 用 `- insert:` 声明自己的 loader 条目；改写它（或 `dsh.bundle` 字段）会直接让 DSH 起不来。

改完用 `dsh web --dump-default-config` 复查：该命令**只解析、不启动服务器**，输出里应出现 `# == dsh-custom-css` 段。

---

## 装错了：症状与原因

按症状查，比按步骤猜快：

| 症状 | 多半是 | 怎么确认 |
| --- | --- | --- |
| 设置页里**根本没有**「自定义 CSS」这一行，也没有报错 | 第 2 步漏了（没进 `bundles`），或者改完没重启 GUI | `dsh web --dump-default-config`，看有没有 `# == dsh-custom-css` 段 |
| DSH 直接起不来，日志里是 `declares no dsh.bundle` | 包进了 `bundles`，但它没有 `dsh.bundle.patch`（旧版本、或被改过） | 看该包 `package.json` 的 `dsh.bundle` 字段 |
| 启动失败在装依赖阶段 | 第 1 步没成功，或版本号写错 | `profiles/web/node_modules/dsh-custom-css` 是否存在 |
| 界面里那一行在，但**样式不生效** | 不是安装问题 —— 十有八九是选择器没命中，或需要 `!important` | 见 [已知坑](./known-issues.md) 的前两条 |
| 改完 `lib/index.js` 后行为没变 | host 半**不热更新**，必须重启 dsh | 对一下 dsh 进程启动时间与 `lib/index.js` 的修改时间（见 [已知坑](./known-issues.md)） |

## 卸载

1. 从 `profiles/web/package.json` 的 `dsh.profile.bundles` 里删掉 `"dsh-custom-css"`
2. `dsh plugin --profile web remove dsh-custom-css`
3. 重启 GUI

**样式表文件不会被删**：它们在自己的目录里（见 [它是什么](./getting-started.md#它是什么)），
重装后照旧生效。想彻底清掉就手动删那个目录。

## 换版本

- **升级 / 降级到某个具体版本**：把 `add` 换成 `dsh plugin --profile web add dsh-custom-css@0.2.2`，
  然后重启。
- **跟 main 分支**：用方式二（`add github:…`），之后 `dsh plugin --profile web update` 拉最新。
- 换完**一定要重启** —— 进程内的模块缓存是旧的那份。

## 相关

- [它是什么](./getting-started.md) —— 槽位、文件位置、注入时机
- [兼容性](./compat.md) —— 支持哪些 DSH 版本、怎么复跑断言
- [已知坑](./known-issues.md) —— 装完之后最容易踩的几条
