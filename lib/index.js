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
/**
 * Windows device names, with or without an extension: a name like nul.css is not a file
 * there, so a write "succeeds" into the void and the sheet never appears.
 */
const RESERVED_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
/** Bookkeeping file recording the active stylesheet; never listed as a sheet. */
const ACTIVE_FILE = 'active.json';

/**
 * Whether a bare name may be used as a sheet at all: one path segment ending in
 * '.css', inside the length cap, and not a Windows device name.
 *
 * The directory scan, the bookkeeping reader and the path resolver all go through
 * this, so a name the picker offers is also one the routes accept — the two used to
 * disagree on length, and a hand-dropped 66-character sheet became unopenable.
 * @param name - the candidate name.
 * @returns true when the name is acceptable.
 */
function isSheetName(name) {
  if (typeof name !== 'string') return false;
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return false;
  if (!NAME_PATTERN.test(name) || name.includes('..')) return false;
  return !RESERVED_PATTERN.test(name);
}

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
  if (!isSheetName(name)) return undefined;
  const dir = stylesDir();
  const full = path.join(dir, name);
  // Defence in depth: the joined path must still sit directly in the directory.
  if (path.dirname(full) !== dir) return undefined;
  return full;
}

/**
 * Whether a resolved sheet path is a symbolic link.
 *
 * Containment is lexical — path.dirname(full) === dir holds for a link sitting
 * inside the directory — so a link would let a write land outside it, and a read
 * return a file that is not a sheet. A path that does not exist is not a link.
 * @param full - absolute path.
 * @returns true when the path exists and is a symlink.
 */
async function isSymlink(full) {
  const stat = await fs.lstat(full).catch(() => undefined);
  return stat !== undefined && stat.isSymbolicLink();
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
  const declared = Number(req.headers?.['content-length'] ?? 0);
  const chunks = [];
  let size = 0;
  let oversized = Number.isFinite(declared) && declared > MAX_BODY_BYTES;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      // Keep draining instead of returning: leaving a Readable's async iterator
      // runs its return(), which destroys the request — the caller's JSON reply
      // would then reach the browser as a transport error, not a 400.
      oversized = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(chunk);
  }
  if (oversized) return undefined;
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
    if (!isSheetName(name)) continue;
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
    const active = isSheetName(parsed?.active) ? parsed.active : undefined;
    const disabled = Array.isArray(parsed?.disabled)
      ? [...new Set(parsed.disabled.filter(name => isSheetName(name)))]
      : [];
    return { active, disabled };
  }
  catch {
    // Say so rather than silently reporting "nothing active, nothing disabled":
    // the next mutation would otherwise write that emptied state back for good.
    console.warn('dsh-custom-css: ' + ACTIVE_FILE + ' is unreadable; starting from empty bookkeeping');
    return { active: undefined, disabled: [] };
  }
}

/**
 * Write the bookkeeping file back. The active key is omitted when no sheet is
 * active; a sheet is listed as disabled only while it actually is, so the file
 * stays readable.
 *
 * The bytes land in a temporary file that is then renamed over the real one: a
 * plain write truncates first, and a crash in that window would leave the file
 * unreadable — which the reader reports as "nothing active, nothing disabled",
 * resetting both on the next mutation.
 * @param next - the active name and the disabled set to record.
 */
async function writeBookkeeping(next) {
  const dir = stylesDir();
  await fs.mkdir(dir, { recursive: true });
  const payload = {};
  if (next.active !== undefined) payload.active = next.active;
  if (next.disabled.length > 0) payload.disabled = next.disabled;
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  const target = path.join(dir, ACTIVE_FILE);
  const temp = `${target}.tmp`;
  await fs.writeFile(temp, text, 'utf8');
  await fs.rename(temp, target);
}

/** Serialises bookkeeping mutations: each one is a whole-file read-modify-write. */
let bookkeepingQueue = Promise.resolve();

/**
 * Run one bookkeeping mutation after every mutation already queued.
 *
 * Two tabs switching two sheets off at once used to read the same file and each
 * write its own view, so the last write won and one switch silently came back on.
 * @param mutate - the read-modify-write to run.
 * @returns whatever the mutation resolves to.
 */
function queueBookkeeping(mutate) {
  const run = bookkeepingQueue.then(mutate, mutate);
  bookkeepingQueue = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Drop disabled entries whose sheet is no longer on disk, so a deleted sheet does
 * not come back switched off when a file of that name is created again.
 * @param disabled - recorded names.
 * @returns the names that still exist.
 */
async function pruneDisabled(disabled) {
  if (disabled.length === 0) return disabled;
  const present = new Set((await listFiles()).map(file => file.name));
  return disabled.filter(name => present.has(name));
}

/**
 * Record which sheet is active, leaving every per-sheet switch untouched.
 * @param name - an accepted file name.
 * @param options - enable: true also clears that sheet's switch, for a sheet that
 * was just created or imported and is meant to be in use.
 */
async function setActiveSheet(name, options = {}) {
  await queueBookkeeping(async () => {
    const book = await readBookkeeping();
    const kept = await pruneDisabled(book.disabled);
    const disabled = options.enable === true ? kept.filter(entry => entry !== name) : kept;
    await writeBookkeeping({ active: name, disabled });
  });
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
    // The active sheet is listed even past MAX_FILES. Without it the row cannot
    // find the sheet it should show and silently falls back to the first one.
    if (book.active !== undefined && !files.some(file => file.name === book.active)) {
      const stat = await fs.stat(path.join(stylesDir(), book.active)).catch(() => undefined);
      if (stat !== undefined && stat.isFile()) {
        files.push({ name: book.active, bytes: stat.size, mtime: Math.round(stat.mtimeMs) });
        files.sort((left, right) => left.name.localeCompare(right.name));
      }
    }
    // A switch whose sheet is gone is dropped, so the file never keeps ghosts.
    const listed = new Set(files.map(file => file.name));
    const disabled = book.disabled.filter(name => listed.has(name));
    json(res, 200, { ok: true, dir: stylesDir(), files, active: book.active ?? null, disabled });
    return;
  }

  if (method === 'GET' && route === '/read') {
    const name = url.searchParams.get('name');
    const full = safePath(name);
    if (full === undefined || await isSymlink(full)) {
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
    if (full === undefined || await isSymlink(full)) {
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
    if (full === undefined || await isSymlink(full)) {
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
    // A sheet that was just created or imported is meant to be in use: a switch
    // left over from a previous file of the same name would mute it on sight.
    await setActiveSheet(body.name, { enable: true });
    json(res, 200, { ok: true, name: body.name, bytes: Buffer.byteLength(css) });
    return;
  }

  if (route === '/active') {
    const full = safePath(body.name);
    if (full === undefined || await isSymlink(full)) {
      json(res, 400, { ok: false, error: 'bad-name' });
      return;
    }
    // A name that is merely missing is a separate case from a malformed one: the
    // client renders them differently, and "切换失败：bad-name" was a lie.
    if (!(await fs.stat(full).then(() => true, () => false))) {
      json(res, 404, { ok: false, error: 'not-found' });
      return;
    }
    await setActiveSheet(body.name);
    json(res, 200, { ok: true, name: body.name });
    return;
  }

  if (route === '/toggle') {
    const full = safePath(body.name);
    if (full === undefined || await isSymlink(full)) {
      json(res, 400, { ok: false, error: 'bad-name' });
      return;
    }
    if (typeof body.enabled !== 'boolean') {
      json(res, 400, { ok: false, error: 'bad-body' });
      return;
    }
    if (!(await fs.stat(full).then(() => true, () => false))) {
      json(res, 404, { ok: false, error: 'not-found' });
      return;
    }
    const disabled = await queueBookkeeping(async () => {
      const book = await readBookkeeping();
      const kept = await pruneDisabled(book.disabled);
      const next = body.enabled
        ? kept.filter(name => name !== body.name)
        : [...new Set([...kept, body.name])];
      await writeBookkeeping({ active: book.active, disabled: next });
      return next;
    });
    json(res, 200, { ok: true, name: body.name, enabled: body.enabled, disabled });
    return;
  }

  if (route === '/open') {
    const full = safePath(body.name);
    if (full === undefined || await isSymlink(full)) {
      json(res, 400, { ok: false, error: 'bad-name' });
      return;
    }
    if (!(await fs.stat(full).then(() => true, () => false))) {
      json(res, 404, { ok: false, error: 'not-found' });
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
