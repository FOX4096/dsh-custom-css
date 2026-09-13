# 参与开发

这是一个**没有构建步骤、没有运行时依赖**的 DSH 插件：`lib/client.js` 与 `lib/index.js` 就是产物，改完即生效（浏览器半还会被 `dsh-client-hmr` 热更新）。所以门槛很低，但有些约束是刻意的。

## 本地跑起来

```bash
git clone https://github.com/FOX4096/dsh-custom-css.git
```

按 README 的「方式三：本机开发安装（`link:`）」挂进 profile —— 关键是两步：`profiles/web/package.json` 的 `dsh.profile.bundles` 里要有 `dsh-custom-css`，`profiles/web/node_modules/dsh-custom-css` 要指向本仓库。**改 host 半（`lib/index.js`）后必须重启 dsh**，只有浏览器半走热更新。

## 提交前必须跑

```bash
npm test          # 两套冒烟测试：浏览器半 + host 半
npm run compat    # 跨版本兼容断言（需要网络：要拉各版本 DSH 的包比对槽位与 inject id）
```

`npm test` 是离线的、几秒跑完；`npm run compat` 会访问 npm registry，CI 里单跑一档。CI 还会跑四个 `node --check`。

## 改动的硬约束

| 约束 | 为什么 |
| --- | --- |
| **不加运行时依赖** | 插件装进的是宿主进程与浏览器页面，任何依赖都会跟着进去；目前 `dependencies` 为空 |
| **浏览器半不 `require` 平台包** | 这是本插件跨 DSH 版本存活的原因：只用 `dsh.client.inject` 声明可用 id、从 Context 取 `slots` 服务。硬编码平台包会在换代时报 `missed the module table`（见 README「已知坑」） |
| **只注册一个槽位** | `settings.general.item`，`order: 12`（`ui-theme` 占了 10/11） |
| **注入的样式表大括号必须平衡** | 失衡会让浏览器从该点起**丢弃后面所有规则**，而文本断言看不出来 —— 测试里已加断言 |
| **`lib/` 用制表符缩进** | 与 DSH 自身客户端产物一致，避免整文件 diff 噪音 |
| **host 路由必须走围栏** | 拿不到 Connection 围栏时 fail-closed（503），不能裸奔 |

## 新增能力时

- 改属性字典（`PROPERTY_UI`）：枚举型给 `values`（值 + 中文标签），长度/颜色/阴影型给 `seed` + `hint`，多分量简写给 `parts` + `join`（必要时 `collapse`）。加完请跑一次 `node --check lib/client.js` 与 `npm test`。
- 改面板布局：README 的「设计一致性」表列了每条控件规格的来源（都取自 DSH 自身），改样式请同时更新那张表。
- 加测试：`tests/loader-smoke.cjs` 用假 host 真跑 `lib/client.js`（有极简 React 与 DOM 替身），`tests/host-api-smoke.mjs` 用假 `webServer` 驱动 host 路由。

## 发版

版本号在 `package.json`，同时更新 `CHANGELOG.md`。发版只需一个 tag：

```bash
git tag -a v0.1.4 -m "0.1.4 — …"
git push origin main --follow-tags
```

推上去后 `publish.yml` 会跑测试 → 用 **OIDC 受信发布**（带 provenance 签名，不需要任何长期令牌或动态码）→ 自动建 GitHub Release。前置条件只有一条：npmjs.com 上该包的 Settings → Trusted Publisher 已填本仓库与本文件名。

## 报告问题

用 [Issue 模板](https://github.com/FOX4096/dsh-custom-css/issues/new/choose)；安全相关问题请走 [SECURITY.md](./SECURITY.md) 里的私密渠道。
