# 交接文档 — dsh-custom-css

写给接手这个仓库的人（或下一个会话）。最后更新：`main@a8ba253`。

## 一句话现状

功能完整可用、两套冒烟测试全绿、`0.1.5` 已发布；`0.1.6` 的内容（元素拾取器 + 按钮折叠 + 样式对齐 + 一串可用性修复）**已全部在 `main` 上但未发版**。剩下的都是"通道协同"的边缘修补与测试补漏，没有已知的结构性缺陷。

## 仓库与验证

| 项目 | 值 |
| --- | --- |
| 仓库 | `C:\Users\FOX\.dsh\plugin-src\dsh-custom-css`（远端 `FOX4096/dsh-custom-css`） |
| 本机安装方式 | `profiles/web/node_modules/dsh-custom-css` 是指向本仓库的 **Junction** → 浏览器半刷新即生效，宿主半要重启 dsh |
| 已发布 | `0.1.5`（npm `latest`） |
| 未发布 | `0.1.6`（`package.json` 已是 `0.1.6`，CHANGELOG 段已写好） |
| 测试 | `npm test`（`tests/loader-smoke.cjs` + `tests/host-api-smoke.mjs`）、`npm run compat` |
| 发版 | `git tag v0.1.6 && git push origin v0.1.6` → CI 校验 tag 与版本一致 → `npm publish --provenance` → 建 Release 并附 tarball |
| 推送 | 必须 `git -c credential.useHttpPath=false push`（本机 helper 的坑，见 README「已知坑」） |

## 三条通道契约（**这是当前风险最集中的地方**）

风险已经不是"某个函数写错了"，而是"一条数据从 A 流到 B 时，谁在什么时机通知对方"只存在于上一次会话的脑子里。目前有三条这样的通道：

1. **写通道**：`persist`（行内，400ms 防抖）与 `editSheetText`（模块级，拾取器立即写）。
   契约：后者写盘前必须 `absorbPendingWrite()` 接管前者的挂起写，否则过期的防抖会盖回旧文本（已修，见 `a8ba253`）。
   **残缺**：接管方没有回执，行内的 `saved` 因此会永久停在"保存中"。修法见开工单 1。
2. **回跳通道**：`pendingOpenSelector` / `pendingOpenCaret`（模块级）→ 行组件消费并打开面板、放置光标。
   契约：行组件挂载或 `state.css` 变化时消费一次。**残缺**：命中"已有规则"分支时 css 不变，effect 不重跑（开工单 2）。
3. **剪贴板外通道**：无。`store` 是唯一状态源，行组件与拾取器都读写它。

## 开工单（按优先级；每条都含"先让测试红"的验证方式）

1. **`saved` 在 pick 后卡住**（`lib/client.js`，`absorbPendingWrite` 与组件内 effect）
   症状：打字 → 400ms 内 pick → 状态栏永久"保存中"，直到下次编辑。
   修法（选严谨版）：把 `absorbPendingWrite` 升级为双向契约 `externalWrite = { takeOver(), settled(ok) }`；`editSheetText` 写盘前 `takeOver()`，POST 成功/失败后 `settled(true/false)`，行内只在 `ok === true` 时 `setSaved(true)`。
   测试：在 picker 的 boot 里先 `textarea.props.onChange(...)` 打字（起 timer）→ arm → pick → 断言 ① 那个 timer 被 cancel ② 表里是 pick 后的内容 ③ footer 已是"已保存"。
2. **`pendingOpenSelector` 在行已挂载时不被消费**（`lib/client.js` 回跳 effect）
   修法：effect 同时观察 `state.css` 与 `openIndex`，或插入后主动触发一次消费；在"已有规则"分支里同步清掉 `pendingOpenCaret`（避免之后一次无关编辑挪动光标）。
3. **`cssString` 不转义 `\n`**（`lib/client.js`，`selectorCandidates` 的 aria-label 分支）
   症状：`aria-label` 含换行 → 生成非法选择器 → 探针查询抛错 → `probeMatches` 返回 1 被当成"唯一"而胜出并写入。
   修法：转义换行；并让**探针查询失败时不计为唯一**（未知 ≠ 唯一）。
4. **测试漏洞三项**（决定"以后出 bug 会不会被抓到"）
   - `tests/host-api-smoke.mjs` 的 symlink 用例在 `fs.symlink` 抛错时静默跳过（Windows 无权限即 EPERM）→ 最新那道防线可能一次都没跑过，而套件仍打印 OK。改为显式 SKIPPED（并从"已覆盖"里摘掉）或直接 fail。
   - `tests/host-api-smoke.mjs` 的"名字排序"断言是 `[...names].sort()` 与自己比 → 恒真。改为对照独立期望值。
   - `tests/loader-smoke.cjs` 的 `querySelectorAll` / `elementFromPoint` 桩忽略入参 → 选择器唯一性、指针命中目标这两类判断在桩里等于常量。让桩按入参变化（至少按注释里的具体标签值匹配）。
5. **死代码清理**：`surfaceToMoveAside`（仅定义、无调用）；`.dshCc_picked*` 七条 CSS（行内结果卡已被浮动面板取代）；`.dshCc_danger`、`.dshCc_pickBarInfo` 若无引用一并删。
6. **跨通道写序**（已记录，暂不改）：`editSheetText` 立即 POST 与 `flushSave` 防抖 POST 只协调了"挂起中的写"，已发出的请求不会被取消。当前依赖 host 单进程 FIFO。若将来出现"pick 后立刻打字、最终存下的是打字前内容"，从这里查。

## 复审结论中我判定为误推的三条（避免下一轮重复调查）

- `lib/client.js:784`「层级变化不重跑 inspect」——`lock()` 对 ascend 传的是 `silent: undefined`，接线里 `silent === true` 才跳过，因此 inspect 会重跑。
- `lib/client.js:755`「ArrowUp 后 ArrowDown 卡住」——ascend 会把父节点压入 `path`（长度变 2），ArrowDown 落在 `path[0]` 即点击的元素；`tests/loader-smoke.cjs` 里有正好覆盖这个场景的用例。
- `lib/client.js:1331`「同级后回溯错位」——同级走 `anchor: true` 会重建 `path`，不会带着旧 path 回溯。

其余复审结论（围栏 try/catch、`readBody` 的两种 undefined 混淆、`json()` 二次写、围栏桩不校验 `req`）中，前两条已在 `a8ba253` 修掉/加固，后两条仍在开工单之外，属"诊断性"改进。

## 已知边界（不是缺陷，但要知道）

- **设置入口靠猜**：插件没有打开 DSH 设置页的 API，`openSettingsSurface()` 是在文档里找 `aria-label/title` 为「设置 / Settings / 偏好 / Preferences」的 `button` / `[role=button]` / `a` 并点击它；找不到就什么都不做。若真机上没打开设置页，问题在这里。
- **拾取器不依附设置页**：会话在模块级，关掉设置页仍可拾取；点击"不 preventDefault、不进捕获阶段"，所以页面交互照常（这是"能关设置页、能去别的页面"的前提）。
- **选择器会哈希**：DSH 用 CSS Modules（`_card_1fywu_26`），哈希随构建变；拾取器按 `[data-*] > [aria-label] > 手写类名 > [class*=] 容错 > 结构路径` 排序，**绝不**输出带哈希的类名。
- **`@media` 内规则不可编辑**（面板只认顶层规则）；跨域 iframe（侧边栏浏览器面板）内拾取不到。
- **样式结论要看实测**：本机模型不支持图像输入，样式类问题靠 `%TEMP%\css-probe\render-row.mjs`（真实组件树 + 真实 ROW_CSS + 无头 Edge 量计算样式）而不是截图。

## 本机可复用的验证工具（都在 `%TEMP%\css-probe\`）

| 脚本 | 用途 |
| --- | --- |
| `render-row.mjs` | 渲染真实行并实测每个控件的计算样式（圆角/边框/底色/文字色） |
| `measure.mjs` | 600 / 420px 下的排版测量与溢出扫描（依赖 `%TEMP%\dsh-css-probe.html`） |
| `nasty-css.mjs` | 20 条刁钻 CSS 输入 × 扫描器不变量 |
| `plugin-invariants.mjs` | 真实样式表（用户那份 700 行）的偏移/写回往返不变量 |
| `picker-integration.mjs` | 真浏览器验证拾取器"不接管页面"（设置面 pointer-events 与属性不变） |
| `verify-*-tests.mjs` | **反向打补丁**验证：把修复撤回，确认对应用例会红 |

## 工作约定（这位用户明确要求过的）

1. **每条修复都要"反向打补丁确认变红"**——只写"改好了"不算。
2. 报告里区分**产品缺陷**与**测试保真度**，不要把后者说成前者。
3. 样式结论要用实测值，不要凭感觉；不确定就问，别猜。
4. 发版是用户明确点头才做（推 tag 即不可撤回）。
