/**
 * 开发实例：一个只加载本插件、不碰真机实例的 DSH。
 *
 * ── 为什么不是「复制一份 profiles/web」 ────────────────────────────────
 * 第一版方案是复制真机的 profile 目录。这条路是错的，根因在真机那份
 * `cordis.patch.yml` 里：
 *
 *     - id: webserver
 *       config:
 *         port: 3080        # ← 写死
 *
 * 而干净 profile 里同一个字段是
 *
 *     port: !!js ctx.webStartup.port ?? 3080      # ← 跟着 --port 走
 *
 * 也就是说：**写死的 3080 会把 `--port` 这个入口掐掉**，复制过来的开发实例
 * 会去抢真机正在用的端口；bind 撞上不过是起不来，更坏的情况是有人把真机停了
 * 再起开发实例，真机就被顶掉了，而且没有任何地方会提示这件事。
 *
 * 所以这里走 DSH 官方给的路子：`--from-default-profile web` 只复制**模板的
 * bundle 列表**（`dsh-app-boot` 的 `PROFILE_TEMPLATES`：base + web-app），
 * 同名内置 profile 的本地状态一个字节都不读。产出的是 factory 默认值，
 * 而不是「被二十多个插件改过的运行副本」。
 *
 * ── 端口 ────────────────────────────────────────────────────────────
 * 干净 profile 的端口来自 `--port`，所以这个脚本**不需要** `--patch` 覆盖层，
 * 也不需要任何端口相关的 YAML。3080 是硬禁的，见 assertSafePort。
 *
 * ── 幂等 ────────────────────────────────────────────────────────────
 * `up` 可以在任何状态下重复跑：profile 目录在就不重建；node_modules junction
 * 掉了就补回来（pnpm 重建真机 profile 时可能牵连到它）；package.json 里少了
 * 我们的 bundle 行就写回去。目的只有一个 —— 这个开发实例不该有「先手动跑
 * 某条命令」的前置步骤，那种步骤一定会忘。
 */

import { spawn, spawnSync } from 'node:child_process';
import {
	closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录：本文件在 <repo>/dev/ 下。 */
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** 本插件的包名，同时也是 profile 里那一行的名字。 */
const PLUGIN_NAME = 'dsh-custom-css';

/** 开发 profile 的名字。内置名（web/headless/sdk/acp/sdk-minimal/desktop）被保留，不能用。 */
const PROFILE = 'ccdev';

/** 开发实例的 DSH_HOME。与真机的 ~/.dsh 完全无关。 */
export const DEV_HOME = path.join(REPO, 'dev', 'home');

/** 端口与状态文件。状态文件里带令牌，所以整个 dev/ 都在 .gitignore 里。 */
const DEFAULT_PORT = 3081;

/**
 * 真机实例的端口。
 *
 * 这个常量只有一个用途：`assertSafePort` 拿它做硬拦。开发实例落在 3080 上
 * 不是「可能有问题」，而是会直接顶掉用户正在用的那个进程 —— 而这种失败在
 * 事后看起来会像是插件把界面搞坏了。
 */
const LIVE_PORT = 3080;

/**
 * dsh 的启动脚本。
 *
 * 默认用全局那份（`%APPDATA%\npm\node_modules\@deepseek-ai\dsh\lib\bin.js`）——
 * 但 **dev 与真机共用同一份二进制**，于是「升级 dev」就等于「升级真机」，
 * 而真机上跑着用户正在用的实例。要单独给 dev 换版本，有两个办法：
 *
 *   `npm run dev:alpha`   —— 用 `dev/dsh-alpha/` 下那份独立安装（见下）
 *   `$env:DSH_DEV_BIN`    —— 指向任意一份 dsh 的 `lib/bin.js`
 *
 * 独立安装这样建（**不动全局**，因此生产实例的版本与进程都不受影响）：
 *
 *     npm i --prefix dev/dsh-alpha @deepseek-ai/dsh@alpha
 *
 * 它落在 `dev/` 下，而整个 dev/ 都在 .gitignore 里，不会污染仓库。
 */
const ALPHA_BIN = path.join(REPO, 'dev', 'dsh-alpha', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');

/**
 * 解析本次要用的 dsh 启动脚本。
 *
 * 优先 `--alpha`（命令行开关优先于环境变量，因为它更显眼），
 * 然后 `DSH_DEV_BIN`，最后回退到全局安装。
 *
 * @param argv - 传给脚本的参数，用来找 `--alpha`。
 * @returns 启动脚本的绝对路径。
 */
function resolveDshBin(argv) {
	if (argv.includes('--alpha')) {
		if (!existsSync(ALPHA_BIN)) {
			throw new Error(`--alpha 指定的独立安装不存在：${ALPHA_BIN}\n`
				+ '先建它：npm i --prefix dev/dsh-alpha @deepseek-ai/dsh@alpha');
		}
		return ALPHA_BIN;
	}
	if (process.env.DSH_DEV_BIN && process.env.DSH_DEV_BIN.trim() !== '') return process.env.DSH_DEV_BIN;
	return path.join(
		process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'),
		'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js',
	);
}

const DSH_BIN = resolveDshBin(process.argv.slice(2));

const STATE_DIR = path.join(REPO, 'dev', 'state');
const STATE_FILE = path.join(STATE_DIR, 'instance.json');
export const URL_FILE = path.join(STATE_DIR, 'url.txt');
const LOG_FILE = path.join(STATE_DIR, 'instance.log');

const PROFILE_DIR = path.join(DEV_HOME, 'profiles', PROFILE);

/**
 * 打日志。
 *
 * 分等级是有意的：用户关心的是「起没起来、在哪个端口」（info），排查细节是
 * debug。都堆在 info 里，真出事的时候那一行会被淹掉。
 * @param level - 'info' | 'debug' | 'error'
 * @param message - 日志正文
 */
function log(level, message) {
	const tag = level === 'error' ? '错误' : (level === 'debug' ? '细节' : '信息');
	const stream = level === 'error' ? process.stderr : process.stdout;
	stream.write(`[开发实例·${tag}] ${message}\n`);
}

/**
 * 把 URL 里的令牌打码。
 *
 * 令牌能换到一张签名的浏览器会话 cookie —— 也就是说，谁拿到这行日志里的
 * 字符串，谁就能进这个界面。所以任何打印、任何写入日志的地方都要过这一道。
 * @param text - 可能含令牌的文本
 * @returns 令牌被替换成 ***  的文本
 */
export function maskToken(text) {
	return String(text).replace(/(token=)[A-Za-z0-9_-]+/gi, '$1***');
}

/**
 * 在凭据入口上再拦一道。
 *
 * 这里刻意用「不等于 3080」而不是「等于 3081」：改成别的空闲端口应该允许，
 * 但落到真机的端口上必须直接死掉，且要说清为什么。
 * @param port - 准备监听的端口
 */
function assertSafePort(port) {
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`端口不是一个合法端口号：${port}`);
	}
	if (port === LIVE_PORT) {
		throw new Error(
			`拒绝在 ${LIVE_PORT} 上启动开发实例：那是真机实例正在用的端口。`
			+ '开发实例必须换一个端口（默认 3081），否则两个进程会抢同一个监听。',
		);
	}
}

/**
 * 跑一条 dsh 命令，同步等它结束。
 *
 * 只在准备阶段用（初始化 profile、dump 配置），那时还没有要长期持有的子进程。
 * @param args - 传给 dsh 的参数
 * @param options - `{ json }` 为真时返回解析后的 stdout
 * @returns stdout，或解析后的对象
 */
function runDsh(args, options = {}) {
	if (!existsSync(DSH_BIN)) {
		throw new Error(`找不到 dsh 的启动脚本：${DSH_BIN}\n请确认 @deepseek-ai/dsh 是全局安装的。`);
	}
	const result = spawnSync(process.execPath, [DSH_BIN, ...args], {
		env: { ...process.env, DSH_HOME: DEV_HOME },
		encoding: 'utf8',
		// 配置 dump 在 stdio:'pipe' 下已经验证可用（Node 24 + 这条路径）；
		// 沙箱对命名管道的限制在这里不适用，因为这是宿主的 pwsh 直连。
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	if (result.error !== undefined && result.error !== null) throw result.error;
	if (result.status !== 0 && !options.allowFailure) {
		throw new Error(
			`dsh ${args.join(' ')} 退出码 ${result.status}\n`
			+ maskToken(String(result.stderr ?? '').slice(0, 2000)),
		);
	}
	if (options.json === true) return JSON.parse(String(result.stdout));
	return String(result.stdout ?? '');
}

/**
 * 读一个 JSON 文件；不存在或坏掉时返回 undefined。
 *
 * 「坏掉」也要当成不存在：这个脚本的价值在于能从任何状态里恢复，为一个残留的
 * 半截文件停下来，比丢掉它更糟。
 * @param file - 文件路径
 * @returns 解析结果，或 undefined
 */
function readJsonIfAny(file) {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	}
	catch {
		return undefined;
	}
}

/**
 * 把 profile 补成本插件需要的样子。幂等。
 *
 * 两件事，各自会因为不同的原因丢失：
 * - **node_modules 里的 junction**：真机 profile 那边 `pnpm install` 重建依赖时
 *   可能牵连到它。掉了之后的报错是「模块找不到」，看起来像插件代码坏了。
 * - **package.json 里的 bundle 行**：手改过 profile、或初始化中途失败时会少。
 *
 * @param options - 为真时返回组合后的配置树（`{ dump: true }`）
 * @returns 组合后的配置树文本（仅当 dump 为真）
 */
export function ensureProfile(options = {}) {
	if (!existsSync(path.join(PROFILE_DIR, 'package.json'))) {
		log('info', `profile ${PROFILE} 不存在，用官方模板初始化（只复制 bundle 列表，不读真机状态）`);
		runDsh(['--profile', PROFILE, '--from-default-profile', 'web', '--dump-config']);
	}
	else {
		log('debug', `profile ${PROFILE} 已存在，不重建`);
	}

	// node_modules + junction：junction 在 Windows 上不需要管理员权限，
	// 而目录符号链接需要。所以这里用 junction 而不是 symlink。
	const modulesDir = path.join(PROFILE_DIR, 'node_modules');
	const linkPath = path.join(modulesDir, PLUGIN_NAME);
	mkdirSync(modulesDir, { recursive: true });
	let linked = false;
	try {
		if (!existsSync(linkPath)) {
			symlinkSync(REPO, linkPath, 'junction');
			linked = true;
		}
	}
	catch (error) {
		throw new Error(`给开发 profile 挂 ${PLUGIN_NAME} 失败：${error?.message ?? error}`);
	}
	if (linked) log('info', `已把本仓库挂进开发 profile：${PLUGIN_NAME} → ${REPO}`);
	else log('debug', `${PLUGIN_NAME} 的 junction 在位`);

	// package.json：保证 bundles 里有我们那一行。写成 2 空格缩进 —— pnpm 自己
	// 也这么写，将来某次 `dsh plugin add` 就不会产生一份整文件 diff。
	const manifestPath = path.join(PROFILE_DIR, 'package.json');
	const manifest = readJsonIfAny(manifestPath);
	if (manifest === undefined) throw new Error(`profile 的 package.json 读不出来：${manifestPath}`);
	manifest.dsh ??= {};
	manifest.dsh.profile ??= {};
	manifest.dsh.profile.bundles ??= [];
	manifest.dependencies ??= {};
	const before = JSON.stringify(manifest);
	if (!manifest.dsh.profile.bundles.includes(PLUGIN_NAME)) {
		manifest.dsh.profile.bundles.push(PLUGIN_NAME);
	}
	// link: 是给 pnpm 看的声明；真正的解析靠上面那个 junction。两者都写上，
	// 这样将来有人对 profile 跑一次 pnpm install 也不会把这个依赖抹掉。
	manifest.dependencies[PLUGIN_NAME] = `link:${REPO}`;
	if (JSON.stringify(manifest) !== before) {
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
		log('info', `已把 ${PLUGIN_NAME} 写进 profile 的 bundles 与 dependencies`);
	}

	if (options.dump === true) {
		return runDsh(['--profile', PROFILE, '--dump-config']);
	}
	return undefined;
}

/**
 * 读实例日志的末尾。
 *
 * 日志是**子进程**自己写的，里面可能带着启动时那行带令牌的 URL —— 所以读它的人
 * 必须自己过 `maskToken`，这个函数不做打码（它只负责读，打码是显示的规矩）。
 * @param tail - 取末尾多少个字符；不传则取全文
 * @returns 日志文本
 */
function readLog(tail) {
	if (!existsSync(LOG_FILE)) return '';
	const text = readFileSync(LOG_FILE, 'utf8');
	return tail === undefined ? text : text.slice(-tail);
}

/**
 * 杀一个进程，杀不掉就算了。
 *
 * 用在「失败了要收尾」的路径上：那里失败的**原因**才是重要的，收尾再抛一个错
 * 只会把真正的原因盖掉。
 * @param pid - 进程号
 */
function killQuietly(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return;
	try {
		process.kill(pid);
	}
	catch { /* 已经退了，或没有权限 —— 两种都不该盖住调用方原本的失败 */ }
}

/**
 * 从一段输出里找出带令牌的启动 URL。
 *
 * 不能自己拼 `http://127.0.0.1:<port>`：请求要过 dsh 的认证围栏，唯一入口是
 * 启动时打印的那个令牌（`dsh-client-connection` 对未认证请求一律 401）。
 * @param text - 子进程的输出
 * @param port - 期望的端口
 * @returns URL，找不到时 undefined
 */
export function findLaunchUrl(text, port) {
	const pattern = new RegExp(`https?://[^\\s"']*:${port}/\\?token=[A-Za-z0-9_-]+`);
	const match = String(text).match(pattern);
	return match === null ? undefined : match[0];
}

/** 读状态文件。 */
function readState() {
	return readJsonIfAny(STATE_FILE) ?? {};
}

/**
 * 这个 PID 还活着吗。
 *
 * `process.kill(pid, 0)` 不发信号，只问「有没有这个进程」。EPERM 也算活着 ——
 * 进程存在但没有权限给它发信号，这与「不存在」是两件事。
 * @param pid - 进程号
 * @returns 是否存活
 */
function isAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	}
	catch (error) {
		return error?.code === 'EPERM';
	}
}

/**
 * 等一个 TCP 端口被监听。
 *
 * 用轮询而不是「等 stdout 出现某个字符串」：启动日志的行序不稳定，而端口被
 * 绑上是一个不会骗人的事实。
 * @param port - 端口
 * @param timeoutMs - 超时
 * @returns 是否绑上
 */
async function waitForPort(port, timeoutMs) {
	const { connect } = await import('node:net');
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const ok = await new Promise((resolve) => {
			const socket = connect({ host: '127.0.0.1', port });
			const done = (value) => {
				socket.destroy();
				resolve(value);
			};
			socket.once('connect', () => done(true));
			socket.once('error', () => done(false));
			socket.setTimeout(500, () => done(false));
		});
		if (ok) return true;
		await new Promise(resolve => setTimeout(resolve, 250));
	}
	return false;
}

/**
 * 等那行带令牌的入口 URL 出现。
 *
 * **端口绑上不等于 URL 已经打印**：dsh 先把端口听上，再建 web 包、再打印入口 ——
 * CI 上第一次跑就栽在这三秒的缝里：端口 3 秒就通了，日志还是空的，于是「起了但找不到
 * 入口」。本机因为别的事情慢一点，这行往往已经落盘，所以这个 bug 只在干净机器上显形。
 *
 * 轮询而不是 `tail -f`：日志由子进程直写文件，父进程只需重复读；退避到 1s 是为了不把
 * 一个几百 KB 的日志每秒读二十遍。
 * @param port - 期望的端口
 * @param timeoutMs - 超时（与端口同一份预算）
 * @param child - 子进程；它退出了就不必再等，早失败一次比等满四分钟诚实
 * @returns URL，找不到时 undefined
 */
async function waitForLaunchUrl(port, timeoutMs, child) {
	const deadline = Date.now() + timeoutMs;
	let delay = 200;
	while (Date.now() < deadline) {
		const found = findLaunchUrl(readLog(), port);
		if (found !== undefined) return found;
		if (child !== undefined && child.exitCode !== null) return undefined;
		await new Promise(resolve => setTimeout(resolve, delay));
		delay = Math.min(1000, Math.round(delay * 1.5));
	}
	return findLaunchUrl(readLog(), port);
}

/**
 * 起开发实例。
 * @param {object} options - `{ port, timeoutMs }`
 */
async function up(options) {
	const port = options.port ?? DEFAULT_PORT;
	assertSafePort(port);

	const previous = readState();
	if (isAlive(previous.pid)) {
		log('info', `开发实例已经在跑（PID ${previous.pid}，端口 ${previous.port}）`);
		if (existsSync(URL_FILE)) log('info', `入口：${maskToken(readFileSync(URL_FILE, 'utf8').trim())}`);
		return;
	}

	ensureProfile();

	mkdirSync(STATE_DIR, { recursive: true });
	// 上一次的入口与日志先清掉：留着旧的 URL 会让探针去连一个已经不在的实例，
	// 而那个失败看起来像「页面打不开」。
	rmSync(URL_FILE, { force: true });
	rmSync(LOG_FILE, { force: true });

	log('info', `启动：DSH_HOME=${DEV_HOME}  --profile ${PROFILE}  --port ${port}`);

	// 日志直接由**子进程**写进文件，不经过管道。
	//
	// 第一版是把 stdout/stderr 接成 pipe 再自己转发，结果 `npm run dev` 起完就
	// 不退出：管道是父进程持有的句柄，即使 `child.unref()` 了，只要那两个管道
	// 还开着，Node 的事件循环就一直有活儿干。而一旦 Ctrl+C 掐掉父进程，管道
	// 断开、子进程也跟着死了 —— 一个「后台实例」被前台命令的生死绑住，这正好
	// 是这套东西最不该有的样子。
	//
	// 交给文件之后父子之间没有任何连接：父进程起完就退，子进程独立活着，
	// 日志照样落盘（令牌仍然打码 —— 见 readLog）。
	const logStream = openSync(LOG_FILE, 'a');
	const child = spawn(process.execPath, [
		DSH_BIN, '--profile', PROFILE, '--port', String(port), '--no-open',
	], {
		env: { ...process.env, DSH_HOME: DEV_HOME },
		stdio: ['ignore', logStream, logStream],
		detached: true,
		windowsHide: true,
	});
	child.unref();
	// 父进程用完这个句柄就还回去：不还的话，它同样会吊住事件循环，`npm run dev`
	// 就又不退出了 —— 子进程已经拿到自己那份副本，父进程留着它没有任何用处。
	closeSync(logStream);

	const bound = await waitForPort(port, options.timeoutMs ?? 120_000);
	if (!bound) {
		log('error', `${port} 端口在超时前没被绑上。日志末尾：`);
		process.stderr.write(`${readLog(2000)}\n`);
		killQuietly(child.pid);
		process.exitCode = 1;
		return;
	}

	const launchUrl = await waitForLaunchUrl(port, options.timeoutMs ?? 120_000, child);
	if (launchUrl === undefined) {
		log('error', '端口起来了，但日志里一直没有带令牌的入口 URL —— 探针需要它才进得去。日志末尾：');
		process.stderr.write(`${readLog(2000)}\n`);
		process.exitCode = 1;
		return;
	}

	writeFileSync(URL_FILE, `${launchUrl}\n`, 'utf8');
	writeFileSync(STATE_FILE, `${JSON.stringify({
		pid: child.pid,
		port,
		startedAt: new Date().toISOString(),
		home: DEV_HOME,
		profile: PROFILE,
	}, null, 2)}\n`, 'utf8');

	log('info', `已就绪：PID ${child.pid}，端口 ${port}`);
	log('info', `入口（令牌已打码，完整值在 dev/state/url.txt）：${maskToken(launchUrl)}`);
	log('info', '实例在后台继续跑；停止：npm run dev:down');
}

/** 停开发实例。 */
function down() {
	const state = readState();
	if (!isAlive(state.pid)) {
		log('info', '开发实例没有在跑');
		// 残留的状态文件会让 status 说假话，顺手清掉。
		rmSync(STATE_FILE, { force: true });
		rmSync(URL_FILE, { force: true });
		return;
	}
	try {
		process.kill(state.pid);
		log('info', `已停止开发实例（PID ${state.pid}）`);
	}
	catch (error) {
		log('error', `停止失败：${error?.message ?? error}`);
		process.exitCode = 1;
	}
	rmSync(STATE_FILE, { force: true });
	rmSync(URL_FILE, { force: true });
}

/** 看状态。 */
function status() {
	const state = readState();
	const alive = isAlive(state.pid);
	log('info', alive
		? `运行中：PID ${state.pid}，端口 ${state.port}，起于 ${state.startedAt}`
		: '未运行');
	log('info', `DSH_HOME：${DEV_HOME}`);
	log('info', `profile ：${PROFILE}${existsSync(PROFILE_DIR) ? '（已初始化）' : '（还没初始化）'}`);
	if (alive && existsSync(URL_FILE)) {
		log('info', `入口：${maskToken(readFileSync(URL_FILE, 'utf8').trim())}`);
	}
}

/** 一个给探针和数据核对用的补充入口：打印组合后的配置树。 */
function dump() {
	ensureProfile();
	const text = runDsh(['--profile', PROFILE, '--dump-config']);
	const hasOurRow = /# == dsh-custom-css/.test(text);
	log('info', hasOurRow
		? '组合配置树里有本插件的行（# == dsh-custom-css）'
		: '组合配置树里没有本插件的行 —— profile 没加载它，先查 package.json 的 bundles');
	process.stdout.write(text);
	if (!hasOurRow) process.exitCode = 1;
}

const USAGE = `
用法：node dev/instance.mjs <命令> [选项]

命令
  up        起开发实例（幂等：profile 缺就建、junction 掉了就补）
  down      停掉它
  status    看它现在什么状态
  dump      打印组合后的配置树，并确认本插件的行在里面

选项
  --port <n>  监听端口，默认 ${DEFAULT_PORT}（${LIVE_PORT} 被硬禁：那是真机实例的端口）
  --timeout <ms>  up 等端口绑定的上限，默认 120000
`;

/**
 * 入口。
 *
 * 被 import 时不执行任何东西 —— 探针要 import 本模块拿 DEV_HOME 与 URL_FILE，
 * 如果 import 就启动实例，那个副作用会让探针莫名其妙地起服务。
 */
/* c8 ignore next 3 -- 只有直接执行时才走这里 */
const invokedDirectly = process.argv[1] !== undefined
	&& path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
	const argv = process.argv.slice(2);
	const command = argv[0];
	const portIndex = argv.indexOf('--port');
	const port = portIndex < 0 ? DEFAULT_PORT : Number(argv[portIndex + 1]);
	const timeoutIndex = argv.indexOf('--timeout');
	const timeoutMs = timeoutIndex < 0 ? 120_000 : Number(argv[timeoutIndex + 1]);

	try {
		if (command === 'up') await up({ port, timeoutMs });
		else if (command === 'down') down();
		else if (command === 'status') status();
		else if (command === 'dump') dump();
		else {
			process.stdout.write(`${USAGE}\n`);
			process.exitCode = command === undefined ? 0 : 1;
		}
	}
	catch (error) {
		log('error', `${error?.message ?? error}`);
		process.exitCode = 1;
	}
}
