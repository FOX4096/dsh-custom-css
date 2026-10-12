/**
 * 让 ego 浏览器进入开发实例的取件窗口。
 *
 * ── 为什么要有这个文件 ────────────────────────────────────────────
 * dsh 的认证没有绕过口子：未认证请求一律 401，唯一入口是启动时那个带令牌的
 * URL。而 ego 浏览器有自己的 profile、自己的 cookie 罐，所以它必须**带着那个
 * 令牌进一次**才能换到 cookie。
 *
 * 问题是那个令牌不该出现在对话里、终端输出里、日志里 —— 它等同于一张进界面的
 * 通行证。所以这里绕一步：
 *
 *   1. 本模块在 `127.0.0.1` 上临时开一个只有本机能访问的 HTTP 服务；
 *   2. 它把带令牌的 URL 放在那个服务的 `/go` 响应里；
 *   3. 接着用 `ego_navigate` 打开那个本地地址，页面自己 `fetch` 拿到 URL 并跳转。
 *
 * 令牌于是从「磁盘上的文件」直接走到「浏览器的地址栏」，中间不经过我的上下文。
 * 取件窗口在交出 URL 之后**立刻关掉**，所以它为这件事存在的时间只有那一瞬。
 *
 * 用法：`node dev/ego.mjs`
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_FILE = path.join(REPO, 'dev', 'state', 'url.txt');

/**
 * 打日志。中文，分等级 —— 与仓库其余部分一致。
 * @param message - 正文
 */
function log(message) {
	process.stdout.write(`[开发实例·信息] ${message}\n`);
}

if (!existsSync(URL_FILE)) {
	process.stderr.write(
		'[开发实例·错误] 读不到 dev/state/url.txt —— 先跑 `npm run dev` 把开发实例起起来。\n',
	);
	process.exit(1);
}

const launchUrl = readFileSync(URL_FILE, 'utf8').trim();
if (launchUrl === '') {
	process.stderr.write('[开发实例·错误] dev/state/url.txt 是空的，重跑一次 `npm run dev`。\n');
	process.exit(1);
}

/**
 * 取件窗口的 HTML。
 *
 * 不用模板字符串拼 `launchUrl` —— 那样令牌会出现在这个进程的源码位置虽无害、
 * 但更糟的是出现在任何一次 `--trace` 输出里。它只以 JSON 从 `/go` 接口取。
 * @returns 页面 HTML
 */
const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>正在进入开发实例…</title>
<body style="font:14px/1.6 system-ui;padding:24px;color:#333">
<p id="state">正在进入开发实例…</p>
<script>
fetch('/go')
  .then(r => r.json())
  .then(({ url }) => { document.getElementById('state').textContent = '已取得入口，正在跳转…'; location.replace(url); })
  .catch(error => { document.getElementById('state').textContent = '取件失败：' + error; });
</script>
</body>`;

let handedOver = false;

const server = createServer((request, response) => {
	// 只认本机回环：取件窗口没必要让局域网上别的机器也能敲。
	const remote = request.socket.remoteAddress ?? '';
	const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
	if (!loopback) {
		response.writeHead(403).end('只允许本机');
		return;
	}

	if (request.url === '/go') {
		handedOver = true;
		response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
		response.end(JSON.stringify({ url: launchUrl }));
		// 交出去就收摊：这个窗口只为一件事存在。延迟一点点关，免得响应还没
		// 写完就把 socket 拆了（浏览器那边会看到一个空响应）。
		setTimeout(() => {
			server.close();
			log('入口已交给浏览器，取件窗口已关闭');
		}, 1500);
		return;
	}

	response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
	response.end(PAGE);
});

server.listen(0, '127.0.0.1', () => {
	const { port } = server.address();
	log(`取件窗口：http://127.0.0.1:${port}/`);
	log('下一步：用 ego_navigate 打开上面这个地址，页面会自己跳进开发实例。');
	// 没人来取就自己退，别在后台挂着。
	setTimeout(() => {
		if (!handedOver) {
			server.close();
			log('十五分钟没人来取，窗口已关闭（重跑一次即可）');
		}
	}, 15 * 60 * 1000).unref();
});
