/**
 * Host half of dsh-custom-css.
 *
 * Owns the stylesheet directory (`$DSH_HOME/custom-css`) and exposes it to the
 * browser half over a loopback-only route. The Host is deliberately the side
 * that touches the filesystem: a browser cannot read a local file without a
 * user gesture, so a stylesheet kept only in browser storage cannot be resolved
 * and applied before the shell paints. Files here are plain `.css` on disk —
 * editable in any editor, backup-able, and independent of the origin the GUI
 * happens to be served from.
 *
 * The route is mounted on `webServer` behind the Connection service's own
 * request fence — the same path `dsh-smooth-stream` uses. On this kernel
 * generation `connection.rpc.handle()` resolves `webServer` from inside the
 * service through a Context that never injected it, so the service-owned
 * channel is unusable; mounting directly on the Web server is the supported
 * fallback. A missing fence fails closed (503) rather than exposing the
 * directory to whoever can reach the port.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Absolute route prefix owned by this plugin. */
const ROUTE = '/dsh-custom-css';
/** Largest accepted request body; stylesheets are small text. */
const MAX_BODY_BYTES = 1 << 20;
/** Upper bound on listed files, so a runaway directory cannot wedge the row. */
const MAX_FILES = 200;
/** Longest accepted file name. */
const MAX_NAME_LENGTH = 64;
/**
 * Accepted file names: a single path segment ending in `.css`. Deliberately
 * strict — the name arrives from the browser and is joined onto the stylesheet
 * directory, so separators, dot-dot, and anything exotic are refused up front.
 */
const NAME_PATTERN = /^[A-Za-z0-9._\u4e00-\u9fa5-]+\.css$/;
/** Bookkeeping file recording the active stylesheet; never listed as a sheet. */
const ACTIVE_FILE = 'active.json';

/**
 * The stylesheet directory: `$DSH_HOME/custom-css`, falling back to `~/.dsh`.
 * @returns absolute directory path.
 */
export function stylesDir() {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
  return path.join(home, 'custom-css');
}

/**
 * Resolve one user-supplied file name to an absolute path inside the
 * directory, or `undefined` when the name is unacceptable.
 * @param name - the bare file name.
 * @returns the absolute path, or `undefined` when refused.
 */
function safePath(name) {
  if (typeof name !== 'string') return undefined;
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return undefined;
  if (!NAME_PATTERN.test(name) || name.includes('..')) return undefined;
  const dir = stylesDir();
  const full = path.join(dir, name);
  // Defence in depth: the joined path must still sit directly in the directory.
  if (path.dirname(full) !== dir) return undefined;
  return full;
}

/**
 * Write one JSON reply.
 * @param res - the response to write.
 * @param status - HTTP status code.
 * @param payload - JSON-serializable body.
 */
function json(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

/**
 * Read and parse a JSON request body within the size cap.
 * @param req - the request to drain.
 * @returns the parsed body, or `undefined` when oversized or not JSON.
 */
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  catch {
    return undefined;
  }
}

/**
 * List the stylesheets in the directory, creating it when absent.
 * @returns name/size/mtime records, name-sorted.
 */
async function listFiles() {
  const dir = stylesDir();
  await fs.mkdir(dir, { recursive: true });
  const names = await fs.readdir(dir);
  const files = [];
  for (const name of names) {
    if (!NAME_PATTERN.test(name)) continue;
    const stat = await fs.stat(path.join(dir, name)).catch(() => undefined);
    if (stat === undefined || !stat.isFile()) continue;
    files.push({ name, bytes: stat.size, mtime: Math.round(stat.mtimeMs) });
  }
  files.sort((left, right) => left.name.localeCompare(right.name));
  return files.slice(0, MAX_FILES);
}

/**
 * Read the bookkeeping file: which sheet is active and which sheets are
 * switched off. Malformed entries are dropped rather than trusted — the file
 * is user-editable, so a hand-written `disabled` list must not become a path.
 * @returns the active name (possibly undefined) and the disabled set.
 */
async function readBookkeeping() {
  const raw = await fs.readFile(path.join(stylesDir(), ACTIVE_FILE), 'utf8').catch(() => undefined);
  if (raw === undefined) return { active: undefined, disabled: [] };
  try {
    const parsed = JSON.parse(raw);
    const active = typeof parsed?.active === 'string' && NAME_PATTERN.test(parsed.active) && !parsed.active.includes('..')
      ? parsed.active
      : undefined;
    const disabled = Array.isArray(parsed?.disabled)
      ? [...new Set(parsed.disabled.filter(name => typeof name === 'string'
        && NAME_PATTERN.test(name) && !name.includes('..')))]
      : [];
    return { active, disabled };
  }
  catch {
    return { active: undefined, disabled: [] };
  }
}

/**
 * Write the bookkeeping file back. The active key is omitted when no sheet is
 * active; a sheet is listed as disabled only while it actually is, so the file
 * stays readable.
 * @param next - the active name and the disabled set to record.
 */
async function writeBookkeeping(next) {
  const dir = stylesDir();
  await fs.mkdir(dir, { recursive: true });
  const payload = {};
  if (next.active !== undefined) payload.active = next.active;
  if (next.disabled.length > 0) payload.disabled = next.disabled;
  await fs.writeFile(path.join(dir, ACTIVE_FILE), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * Record which sheet is active, leaving every per-sheet switch untouched.
 * @param name - an accepted file name.
 */
async function setActiveSheet(name) {
  const book = await readBookkeeping();
  await writeBookkeeping({ active: name, disabled: book.disabled });
}

/**
 * Launch one file with the platform's default handler.
 *
 * Editors are the point: a sheet kept as a real file can be edited in a real
 * tool while DSH stays open. The child is detached and unreferenced so the GUI
 * never waits on — or dies with — the editor process.
 * @param full - absolute path of an existing stylesheet.
 */
function defaultLaunchFile(full) {
  const [command, args] = process.platform === 'win32'
    ? ['explorer.exe', [full]]
    : process.platform === 'darwin'
      ? ['open', [full]]
      : ['xdg-open', [full]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  // A missing handler surfaces as a spawn error, not a crash.
  child.on('error', () => {});
  child.unref();
}

/** Active launcher; swapped only by tests so no editor window is ever spawned. */
let launchFile = defaultLaunchFile;

/**
 * Replace the launcher.
 * @param next - replacement launcher, receiving an absolute path.
 */
export function setLauncher(next) {
  launchFile = next;
}

/**
 * Dispatch one fenced request onto the plugin's small JSON API.
 *
 * `GET  /list`                  → `{ files, active, disabled, dir }`
 * `GET  /read?name=<name>`      → `{ name, css }`
 * `POST /write  {name, css}`    → write a sheet
 * `POST /create {name}`         → create an empty sheet (409 when it exists)
 * `POST /import {name, css}`    → store an imported sheet (overwrites)
 * `POST /active {name}`         → record the active sheet
 * `POST /toggle {name, enabled}` → switch one sheet on or off (its file stays)
 * `POST /open   {name}`         → hand the sheet to the OS default application
 *
 * @param req - fenced request.
 * @param res - response to write.
 */
async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://dsh.internal');
  const route = url.pathname.slice(ROUTE.length) || '/';
  const method = req.method ?? 'GET';

  if (method === 'GET' && route === '/list') {
    const [files, book] = await Promise.all([listFiles(), readBookkeeping()]);
    // A switch whose sheet is gone is dropped, so the file never keeps ghosts.
    const disabled = book.disabled.filter(name => files.some(file => file.name === name));
    json(res, 200, { ok: true, dir: stylesDir(), files, active: book.active ?? null, disabled });
    return;
  }

  if (method === 'GET' && route === '/read') {
    const name = url.searchParams.get('name');
    const full = safePath(name);
    if (full === undefined) {
      json(res, 400, { ok: false, error: 'bad-name' });
      return;
    }
    const css = await fs.readFile(full, 'utf8').catch(() => undefined);
    if (css === undefined) {
      json(res, 404, { ok: false, error: 'not-found' });
      return;
    }
    json(res, 200, { ok: true, name, css });
    return;
  }

  if (method !== 'POST') {
    json(res, 404, { ok: false, error: 'not-found' });
    return;
  }

  const body = await readBody(req);
  if (body === undefined || typeof body !== 'object' || body === null) {
    json(res, 400, { ok: false, error: 'bad-body' });
    return;
  }

  if (route === '/write') {
    const full = safePath(body.name);
    if (full === undefined) {
      json(res, 400, { ok: false, error: 'bad-name' });
      return;
    }
    if (typeof body.css !== 'string') {
      json(res, 400, { ok: false, error: 'bad-css' });
      return;
    }
    await fs.mkdir(stylesDir(), { recursive: true });
    await fs.writeFile(full, body.css, 'utf8');
    json(res, 200, { ok: true, name: body.name, bytes: Buffer.byteLength(body.css) });
    return;
  }

  if (route === '/create' || route === '/import') {
    const full = safePath(body.name);
    if (full === undefined) {
      json(res, 400, { ok: false, error: 'bad-name' });
      return;
    }
    const css = typeof body.css === 'string' ? body.css : '';
    if (route === '/create' && await fs.stat(full).then(() => true, () => false)) {
      json(res, 409, { ok: false, error: 'exists' });
      return;
    }
    await fs.mkdir(stylesDir(), { recursive: true });
    await fs.writeFile(full, css, 'utf8');
    await setActiveSheet(body.name);
    json(res, 200, { ok: true, name: body.name, bytes: Buffer.byteLength(css) });
    return;
  }

  if (route === '/active') {
    const full = safePath(body.name);
    if (full === undefined || !(await fs.stat(full).then(() => true, () => false))) {
      json(res, 400, { ok: false, error: 'bad-name' });
      return;
    }
    await setActiveSheet(body.name);
    json(res, 200, { ok: true, name: body.name });
    return;
  }

  if (route === '/toggle') {
    const full = safePath(body.name);
    if (full === undefined || typeof body.enabled !== 'boolean') {
      json(res, 400, { ok: false, error: 'bad-body' });
      return;
    }
    if (!(await fs.stat(full).then(() => true, () => false))) {
      json(res, 404, { ok: false, error: 'not-found' });
      return;
    }
    const book = await readBookkeeping();
    const disabled = body.enabled
      ? book.disabled.filter(name => name !== body.name)
      : [...new Set([...book.disabled, body.name])];
    await writeBookkeeping({ active: book.active, disabled });
    json(res, 200, { ok: true, name: body.name, enabled: body.enabled, disabled });
    return;
  }

  if (route === '/open') {
    const full = safePath(body.name);
    if (full === undefined || !(await fs.stat(full).then(() => true, () => false))) {
      json(res, 400, { ok: false, error: 'bad-name' });
      return;
    }
    launchFile(full);
    json(res, 200, { ok: true, name: body.name });
    return;
  }

  json(res, 404, { ok: false, error: 'not-found' });
}

/**
 * Host plugin body: mount the stylesheet API behind the Connection fence.
 * Absent `webServer` (a non-Web composition) leaves the Host half inert — the
 * browser half then runs without file persistence instead of failing to load.
 * @param ctx - host cordis context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: async (req, res) => {
        const connection = ctx.get('connection');
        const reject = connection?.requestRejection;
        if (typeof reject !== 'function') {
          // Fail closed: without the fence this route would be reachable by any
          // client that can reach the port, including unpaired LAN hosts.
          res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('dsh-custom-css: connection fence unavailable');
          return;
        }
        const rejection = reject.call(connection, req);
        if (rejection !== undefined) {
          res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
          return;
        }
        try {
          await handle(req, res);
        }
        catch (error) {
          json(res, 500, { ok: false, error: String(error) });
        }
      },
    }), 'dsh-custom-css: stylesheet api');
  });
}
