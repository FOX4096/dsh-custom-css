/**
 * 视觉探针：在真实 Chromium（无头 Edge）里打开开发实例，量几何、截图、收控制台错误。
 *
 * ── 它为什么存在 ──────────────────────────────────────────────────
 * 这个插件前几版的排版结论全是靠这一类探针量出来的（查找栏固定 610px 而那行只有
 * 600px、锁定框左上角那条 12×2 的横线、菜单长出屏幕底部 236px……）。那些数字
 * 靠读代码推不出来，靠截图也只能看出「有点挤」。所以验证能力必须先于功能存在。
 *
 * ── 它不是什么 ────────────────────────────────────────────────────
 * **不是 UI 测试套件**。它只测量与记录，不做断言 —— 断言是下一阶段的事（把现有
 * 测试床搬进真浏览器）。这里返回的 JSON 是给人看的证据，不是通过/失败。
 *
 * ── 为什么没有依赖 ────────────────────────────────────────────────
 * Node 22+ 自带 `WebSocket`，Node 18+ 自带 `fetch`，所以驱动 CDP 不需要
 * puppeteer。这个仓库的硬约束是「不加运行时依赖」，探针也不该破例 —— 何况
 * 拉一个浏览器自动化框架进来只为了量几个矩形，代价远大于收益。
 *
 * ── 为什么必须读 dev/state/url.txt ────────────────────────────────
 * dsh 的浏览器认证没有绕过口子：未认证请求一律 401，唯一入口是启动时打印的
 * 带令牌 URL。所以本脚本**自己拼不出**一个能进的地址，只能读实例留下的那个。
 * 这也意味着探针永远连不到真机实例上（那是另一个 DSH_HOME、另一个令牌）。
 *
 * 用法：
 *   node tests/visual-probe.mjs --sel .dshCc_row --sel .dshCc_shell --shot
 *   node tests/visual-probe.mjs --open-settings --sel .dshCc_row --shot
 *   node tests/visual-probe.mjs --show          # 有头模式，自己看着它点
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const URL_FILE = path.join(REPO, 'dev', 'state', 'url.txt');
/**
 * 截图与 JSON 的落点。
 *
 * 放 `temp/` 而不是 `dev/artifacts/`：`dev/` 是「实例的机器」（DSH_HOME、令牌、日志），
 * 而这里是「一次排查留下的记录」—— 顺手截的图、量出来的数字都属于后者，混在一起
 * 会让真正需要备份的实例状态看起来像一堆截图。
 */
const ARTIFACTS = path.join(REPO, 'temp', 'probe');

/** 无头 Edge 的位置。找不到就报出来，不去猜别的路径。 */
const EDGE_CANDIDATES = [
	'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
	'/usr/bin/microsoft-edge',
	'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

/**
 * 打日志，分等级。
 *
 * 用户关心的是「连上了没、量到了什么」（info）；CDP 的往返与浏览器 stderr 是
 * debug —— 它们只在我排查探针自身时才看。
 * @param level - 'info' | 'debug' | 'error'
 * @param message - 正文
 */
function log(level, message) {
	const tag = level === 'error' ? '错误' : (level === 'debug' ? '细节' : '信息');
	(level === 'error' ? process.stderr : process.stdout).write(`[探针·${tag}] ${message}\n`);
}

/**
 * 解析命令行。
 * @param argv - process.argv.slice(2)
 * @returns 选项对象
 */
function parseArgs(argv) {
	const options = {
		selectors: [],
		waitMs: 1200,
		timeoutMs: 120_000,
		shot: false,
		show: false,
		openSettings: false,
		width: 1440,
		height: 900,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = () => argv[++index];
		if (arg === '--sel') options.selectors.push(next());
		else if (arg === '--wait') options.waitMs = Number(next());
		else if (arg === '--timeout') options.timeoutMs = Number(next());
		else if (arg === '--width') options.width = Number(next());
		else if (arg === '--height') options.height = Number(next());
		else if (arg === '--shot') options.shot = true;
		else if (arg === '--show') options.show = true;
		else if (arg === '--open-settings') options.openSettings = true;
		else if (arg === '--help' || arg === '-h') options.help = true;
		else throw new Error(`不认识的参数：${arg}`);
	}
	return options;
}

/**
 * 找出要驱动的浏览器。
 * @returns 可执行文件路径
 */
function findBrowser() {
	const found = EDGE_CANDIDATES.find(candidate => existsSync(candidate));
	if (found === undefined) {
		throw new Error(`找不到 Edge。找过这些路径：\n  ${EDGE_CANDIDATES.join('\n  ')}`);
	}
	return found;
}

/**
 * 等 CDP 的 HTTP 端点起来。
 *
 * 浏览器启动到能接受调试连接有一段空窗；直接连会拿到 ECONNREFUSED，而那个报错
 * 看起来像「浏览器没装」。
 * @param port - 调试端口
 * @param timeoutMs - 上限
 * @returns `/json/version` 的响应
 */
async function waitForCdp(port, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let lastError = '未知';
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (response.ok) return await response.json();
			lastError = `HTTP ${response.status}`;
		}
		catch (error) {
			lastError = error?.message ?? String(error);
		}
		await new Promise(resolve => setTimeout(resolve, 200));
	}
	throw new Error(`等 CDP 端点超时（${lastError}）`);
}

/**
 * 一个最小的 CDP 客户端。
 *
 * 只做三件事：发命令、等回包、把事件交给订阅者。够用就好 —— 真正的浏览器自动化
 * 框架在这里是负担。
 *
 * 走的是**扁平会话**（`Target.attachToTarget { flatten: true }`）：一个页面的 CDP
 * 命令带着 `sessionId` 发在浏览器那条连接上，事件也回到同一条连接。
 *
 * 我第一版想用嵌套会话（每个 page 一条自己的 WebSocket），那更干净 —— 事件天然
 * 属于一条连接，不需要分辨。但实测不可行：Edge 155 上
 * `ws://host/devtools/page/<targetId>?sessionId=<id>` 连不上（这个形态在旧版
 * DevTools 时代是通的，现在不行）。所以回到扁平会话，并且**必须在消息层过滤
 * `sessionId`** —— 它在外层消息上，不在 `params` 里，第一版就是漏了这一点。
 */
class Cdp {
	/**
	 * @param socket - 已连接的 WebSocket
	 */
	constructor(socket) {
		this.socket = socket;
		this.nextId = 1;
		this.pending = new Map();
		this.listeners = new Map();
		this.closed = false;
		socket.addEventListener('message', (event) => {
			let message;
			try {
				message = JSON.parse(typeof event.data === 'string' ? event.data : '');
			}
			catch {
				return;
			}
			if (message.id !== undefined) {
				const waiting = this.pending.get(message.id);
				if (waiting === undefined) return;
				this.pending.delete(message.id);
				if (message.error !== undefined) waiting.reject(new Error(`${message.error.message}（${message.error.code}）`));
				else waiting.resolve(message.result);
				return;
			}
			// 事件的第三个参数是外层消息上的 sessionId。订阅者用它分辨会话 ——
			// 不要试图从 params 里找，那里没有。
			for (const listener of this.listeners.get(message.method) ?? []) {
				listener(message.params, message.sessionId);
			}
		});
		socket.addEventListener('close', () => {
			this.closed = true;
			for (const waiting of this.pending.values()) waiting.reject(new Error('CDP 连接被关闭'));
			this.pending.clear();
		});
	}

	/**
	 * 发一条 CDP 命令。
	 *
	 * `sessionId` 是**外层消息字段**，不能塞进 `params` —— 塞进去浏览器不认识它，
	 * 于是命令落到浏览器级会话上，回一个 `'Runtime.enable' wasn't found (-32601)`
	 * （Runtime 域只在页面会话里有）。这个错看着像「协议版本不对」，其实只是
	 * 参数放错了一层。
	 * @param method - 例如 `Runtime.evaluate`
	 * @param params - 命令参数
	 * @param sessionId - 目标会话（扁平模式用）
	 * @returns 命令结果
	 */
	send(method, params = {}, sessionId) {
		if (this.closed) return Promise.reject(new Error('CDP 连接已关闭'));
		const id = this.nextId++;
		const message = { id, method, params };
		if (sessionId !== undefined) message.sessionId = sessionId;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.socket.send(JSON.stringify(message));
		});
	}

	/**
	 * 订阅一个 CDP 事件。
	 * @param method - 事件名
	 * @param listener - 回调
	 */
	on(method, listener) {
		const list = this.listeners.get(method) ?? [];
		list.push(listener);
		this.listeners.set(method, list);
	}

	/** 关掉这条连接。 */
	close() {
		try {
			this.socket.close();
		}
		catch { /* 已经关了 */ }
	}

	/**
	 * 在页面里求值并取回 JSON 结果。
	 *
	 * `returnByValue` 是刻意的：探针要的是数字与字符串，不是远程对象句柄。
	 * @param expression - 要执行的表达式
	 * @returns 表达式的值
	 */
	async evaluate(expression) {
		const result = await this.send('Runtime.evaluate', {
			expression,
			returnByValue: true,
			awaitPromise: true,
		});
		if (result.exceptionDetails !== undefined) {
			throw new Error(`页面里求值抛错：${result.exceptionDetails.text ?? ''} ${result.exceptionDetails.exception?.description ?? ''}`);
		}
		return result.result?.value;
	}
}

/**
 * 连上一条 WebSocket。
 *
 * 失败时把浏览器侧给的**原文**带上：`连不上 CDP` 这种话说明不了任何事，而
 * WebSocket 的 `error` 事件本身不带信息（规范如此），所以要另找一句话来说 ——
 * 这里用 `close` 的 code/reason，它在握手被拒时会填上。
 * @param url - ws:// 地址
 * @returns 已连接的客户端
 */
async function connect(url) {
	const socket = new WebSocket(url);
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', () => {
			reject(new Error(`WebSocket 握手失败：${url}（code ${socket.readyState}）`));
		}, { once: true });
		socket.addEventListener('close', (event) => {
			reject(new Error(`WebSocket 在握手时被关闭：code ${event.code} reason "${event.reason}"`));
		}, { once: true });
	});
	return new Cdp(socket);
}

/**
 * 从文件里读这次要访问的入口。
 * @returns 带令牌的 URL
 */
function readLaunchUrl() {
	if (!existsSync(URL_FILE)) {
		throw new Error(
			`读不到入口文件：${URL_FILE}\n`
			+ '先跑 `npm run dev`。探针不会自己拼地址 —— dsh 的认证只能靠启动时那个令牌。',
		);
	}
	const url = readFileSync(URL_FILE, 'utf8').trim();
	if (url === '') throw new Error(`${URL_FILE} 是空的，重跑一次 \`npm run dev\`。`);
	return url;
}

/**
 * 打码令牌，给日志用。
 * @param text - 文本
 * @returns 打码后的文本
 */
function mask(text) {
	return String(text).replace(/(token=)[A-Za-z0-9_-]+/gi, '$1***');
}

/**
 * 结束浏览器，连它的子进程一起。
 *
 * `child.kill()` 在这里不够：Chromium 是「主进程 + 一堆子进程」，Windows 上没有
 * 进程组信号这回事，杀掉主进程后子进程会变成孤儿继续活着 —— 它们还占着那个
 * 临时用户目录，于是 `rmSync` 也跟着失败。实测一次留下 2 个 msedge 和 7 个
 * `dsh-probe-*` 目录。所以这里用 taskkill 的 `/T`（整棵树）。
 * @param pid - 主进程号
 */
function killTree(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return;
	if (process.platform === 'win32') {
		spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
		return;
	}
	try {
		// POSIX 上 detached 的子进程自成一个进程组，负号表示「整组」。
		process.kill(-pid, 'SIGKILL');
	}
	catch {
		try {
			process.kill(pid, 'SIGKILL');
		}
		catch { /* 已经退了 */ }
	}
}

/**
 * 删一个目录，删不掉就等一下再试。
 *
 * 进程刚被杀掉时内核还没把文件句柄收回去，第一次 rmSync 常常失败。删不掉不报错，
 * 但要**说出来** —— 「%TEMP% 里多出几百 MB」这种事，不说就没人会发现。
 * @param dir - 目录
 */
function removeDirEventually(dir) {
	for (let attempt = 0; attempt < 5; attempt += 1) {
		try {
			rmSync(dir, { recursive: true, force: true });
			return;
		}
		catch {
			// 同步 sleep：这里在收尾路径上，等不了异步 —— 进程马上就要退出了。
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
		}
	}
	log('info', `临时用户目录没删干净（浏览器还占着句柄）：${dir}`);
}

/**
 * 主流程。
 * @param options - 解析后的命令行选项
 */
async function run(options) {
	const launchUrl = readLaunchUrl();
	const browser = findBrowser();
	const debugPort = 9222 + Math.floor(Math.random() * 500);
	const profileDir = await mkdtemp(path.join(tmpdir(), 'dsh-probe-'));
	mkdirSync(ARTIFACTS, { recursive: true });

	log('info', `浏览器：${browser}`);
	log('info', `入口：${mask(launchUrl)}`);
	log('debug', `调试端口 ${debugPort}，临时用户目录 ${profileDir}`);

	// 无头是默认：它不抢焦点，跑完就退。`--show` 是给「我要亲眼看它点一遍」用的。
	const browserArgs = [
		options.show ? '--headless=false' : '--headless=new',
		`--remote-debugging-port=${debugPort}`,
		`--user-data-dir=${profileDir}`,
		`--window-size=${options.width},${options.height}`,
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-features=msEdgeSidebarV2,msSmartScreenProtection',
		'about:blank',
	];

	const child = spawn(browser, browserArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: !options.show });
	let browserLog = '';
	child.stderr.on('data', (chunk) => { browserLog += String(chunk); });

	const result = {
		url: mask(launchUrl),
		viewport: { width: options.width, height: options.height },
		authenticated: false,
		title: null,
		consoleErrors: [],
		consoleWarnings: [],
		pageErrors: [],
		failedRequests: [],
		settings: { opened: false, steps: [] },
		selectors: [],
	};

	let browserCdp;
	try {
		const version = await waitForCdp(debugPort, 30_000);
		log('debug', `浏览器 ${version.Browser}，协议 ${version['Protocol-Version']}`);

		browserCdp = await connect(version.webSocketDebuggerUrl);
		const { targetId } = await browserCdp.send('Target.createTarget', { url: 'about:blank' });
		const { sessionId } = await browserCdp.send('Target.attachToTarget', { targetId, flatten: true });

		// 扁平会话：命令带着 sessionId 发在同一条连接上，事件也回到这里 ——
		// 所以每条事件都要按外层消息的 sessionId 过滤（见 Cdp 的注释）。
		const session = {
			send: (method, params = {}) => browserCdp.send(method, params, sessionId),
			on: (method, listener) => browserCdp.on(method, (params, from) => {
				if (from === sessionId) listener(params);
			}),
			evaluate: async (expression) => {
				const result = await browserCdp.send('Runtime.evaluate', {
					expression, returnByValue: true, awaitPromise: true,
				}, sessionId);
				if (result.exceptionDetails !== undefined) {
					throw new Error(`页面里求值抛错：${result.exceptionDetails.text ?? ''} ${result.exceptionDetails.exception?.description ?? ''}`);
				}
				return result.result?.value;
			},
		};

		session.on('Runtime.consoleAPICalled', (params) => {
			const text = (params.args ?? [])
				.map(argument => argument.value ?? argument.description ?? argument.type)
				.join(' ');
			// 警告与错误分开收：一个插件的普通运行不该产出 error，而 warning
			// （弃用提示之类）是另一类信号，混在一起会让人以为界面坏了。
			if (params.type === 'error') result.consoleErrors.push(text);
			else if (params.type === 'warning') result.consoleWarnings.push(text);
		});
		session.on('Runtime.exceptionThrown', (params) => {
			result.pageErrors.push(params.exceptionDetails?.exception?.description
				?? params.exceptionDetails?.text ?? '未知异常');
		});
		session.on('Network.loadingFailed', (params) => {
			// canceled 是浏览器自己中止的请求（比如页面在加载中被导航走了），
			// 那不是失败；把它算进来会让探针天天报假警。
			if (params.canceled === true) return;
			result.failedRequests.push(`${params.type ?? '?'} ${params.errorText ?? '?'}`);
		});

		await session.send('Runtime.enable');
		await session.send('Network.enable');
		await session.send('Page.enable');
		await session.send('Emulation.setDeviceMetricsOverride', {
			width: options.width,
			height: options.height,
			deviceScaleFactor: 1,
			mobile: false,
		});

		const loaded = new Promise((resolve) => {
			const timer = setTimeout(resolve, options.timeoutMs);
			session.on('Page.loadEventFired', () => {
				clearTimeout(timer);
				resolve();
			});
		});
		await session.send('Page.navigate', { url: launchUrl });
		// 等页面自己说加载完；超时也往下走 —— 那时「认证失败」会由下面的检查
		// 说出来，比起一个笼统的「加载超时」，那个信息有用得多。
		await loaded;
		await new Promise(resolve => setTimeout(resolve, options.waitMs));

		const bodyText = await session.evaluate('document.body ? document.body.innerText.slice(0, 400) : ""');
		// 401 页面长得非常朴素，只有一行英文。先认它，否则后面所有断言都会
		// 报成「找不到元素」，把人引到错误的方向上去。
		if (String(bodyText).includes('authentication required')) {
			throw new Error(
				'认证被拒（401）。dev/state/url.txt 里的令牌已经过期或不对 —— '
				+ '重跑一次 `npm run dev:down` 再 `npm run dev`。',
			);
		}
		result.authenticated = true;
		result.title = await session.evaluate('document.title');

		if (options.openSettings) {
			result.settings.opened = await openSettings(session, result);
			await new Promise(resolve => setTimeout(resolve, options.waitMs));
		}

		for (const selector of options.selectors) {
			result.selectors.push(await measureSelector(session, selector));
		}

		// 截图：视觉确认用。结论不靠它 —— PNG 是给人看的，数字是给判断用的。
		if (options.shot) {
			const name = `probe-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
			const file = path.join(ARTIFACTS, name);
			const shot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
			writeFileSync(file, Buffer.from(shot.data, 'base64'));
			result.screenshot = path.relative(REPO, file).replace(/\\/g, '/');
			log('info', `截图：${result.screenshot}`);
		}
	}
	catch (error) {
		result.failure = String(error?.message ?? error);
		log('error', result.failure);
		process.exitCode = 1;
	}
	finally {
		browserCdp?.close();
		// 先结束浏览器（连子进程），再删目录：顺序反过来的话，那些还活着的子进程
		// 会把文件句柄按在那里，删除一定失败。
		killTree(child.pid);
		removeDirEventually(profileDir);
	}

	// 浏览器自己的 stderr 里有「DevTools listening on ...」这类噪音，只在失败时
	// 才值得看，而且要打码。
	if (process.exitCode === 1 && browserLog !== '') {
		log('debug', `浏览器输出末尾：${mask(browserLog.slice(-600))}`);
	}

	const jsonFile = path.join(ARTIFACTS, 'last-probe.json');
	writeFileSync(jsonFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
	log('info', `结果：${path.relative(REPO, jsonFile).replace(/\\/g, '/')}`);
	if (result.consoleErrors.length > 0) log('info', `控制台错误 ${result.consoleErrors.length} 条`);
	if (result.pageErrors.length > 0) log('info', `页面异常 ${result.pageErrors.length} 条`);

	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

/**
 * 打开设置面板。
 *
 * 这一步是「开发实例到底能不能用」的核心证据：设置面板是本插件那一行唯一的家，
 * 它打不开，后面所有视觉验证都无从谈起。
 * @param session - CDP 会话
 * @param result - 结果对象，用来记步骤
 * @returns 是否打开了
 */
async function openSettings(session, result) {
	const step = (name, detail) => {
		result.settings.steps.push({ name, detail });
		log('debug', `设置面板：${name} —— ${detail}`);
	};

	// 设置入口不写死选择器：DSH 换代时类名会变，而这几条是语义线索。
	const candidates = [
		'[data-slot="sidebar.settings"]',
		'[aria-label*="设置"]',
		'[title*="设置"]',
		'button[aria-label*="Settings"]',
	];
	const found = await session.evaluate(`(() => {
		const candidates = ${JSON.stringify(candidates)};
		for (const selector of candidates) {
			const nodes = [...document.querySelectorAll(selector)];
			const visible = nodes.find(node => node.getBoundingClientRect().width > 0);
			if (visible !== undefined) return { selector, tag: visible.tagName.toLowerCase(), text: (visible.innerText || visible.getAttribute('aria-label') || '').trim().slice(0, 40) };
		}
		return null;
	})()`);
	if (found === null) {
		step('找入口', '没找到设置入口（候选选择器都没命中）');
		return false;
	}
	step('找入口', `${found.selector} → <${found.tag}> ${found.text}`);

	await session.evaluate(`(() => {
		const node = document.querySelector(${JSON.stringify(found.selector)});
		if (node) node.click();
		return true;
	})()`);
	await new Promise(resolve => setTimeout(resolve, 900));

	const panel = await session.evaluate(`(() => {
		const dialog = document.querySelector('[role="dialog"], [aria-modal="true"]');
		return dialog === null
			? { present: false }
			: { present: true, text: (dialog.innerText || '').slice(0, 120) };
	})()`);
	step('面板', panel.present ? `已打开，正文开头：${String(panel.text).split('\\n')[0]}` : '点了入口但没看到对话框');
	return panel.present;
}

/**
 * 量一个选择器。
 *
 * 返回的每个字段都是可以直接下结论的数字：`rect` 用来定位、`overflowX/Y` 用来看
 * 有没有溢出（比 `scrollWidth > clientWidth` 更贴近「真的溢出到外面」这个现象）、
 * `styles` 里带盒模型，免得为了几个数再开一次探针。
 * @param session - CDP 会话
 * @param selector - CSS 选择器
 * @returns 测量结果
 */
async function measureSelector(session, selector) {
	return await session.evaluate(`(() => {
		const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
		if (nodes.length === 0) return { selector: ${JSON.stringify(selector)}, count: 0, found: false };
		const node = nodes[0];
		const rect = node.getBoundingClientRect();
		const style = getComputedStyle(node);
		const round = (value) => Math.round(value * 100) / 100;
		return {
			selector: ${JSON.stringify(selector)},
			found: true,
			count: nodes.length,
			tag: node.tagName.toLowerCase(),
			className: String(node.className || '').slice(0, 120),
			rect: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) },
			overflowX: round(node.scrollWidth - node.clientWidth),
			overflowY: round(node.scrollHeight - node.clientHeight),
			visible: rect.width > 0 && rect.height > 0,
			styles: {
				display: style.display,
				height: style.height,
				maxHeight: style.maxHeight,
				minHeight: style.minHeight,
				borderRadius: style.borderRadius,
				borderTopWidth: style.borderTopWidth,
				backgroundColor: style.backgroundColor,
				resize: style.resize,
			},
			text: (node.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
		};
	})()`);
}

const options = parseArgs(process.argv.slice(2));
if (options.help === true) {
	process.stdout.write(`
用法：node tests/visual-probe.mjs [选项]

选项
  --sel <选择器>     量这个选择器（可出现多次）
  --open-settings    先点开设置面板，再量
  --shot             存一张 PNG 到 dev/artifacts/
  --wait <ms>        页面就绪后额外等多久，默认 1200（前端渲染是异步的）
  --timeout <ms>    等页面加载的上限，默认 120000
  --width/--height   视口尺寸，默认 1440x900
  --show             有头模式：浏览器窗口会显示出来，你能看着它点

前置：先跑 \`npm run dev\` —— 探针读 dev/state/url.txt 里的带令牌入口，
自己拼不出能进的地址。
`);
}
else {
	await run(options);
}
