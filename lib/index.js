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
import { promises as fs, watch } from 'node:fs';
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
/** Subdirectory holding the previous contents of each sheet; never listed as a sheet. */
const HISTORY_DIR = '.history';
/** How many snapshots one sheet keeps, newest first. */
const MAX_SNAPSHOTS = 20;
/** Snapshot file names: a millisecond timestamp, nothing else. */
const STAMP_PATTERN = /^\d{1,16}$/;
/**
 * Whether a filesystem notification is about a sheet this plugin should announce.
 *
 * Two kinds of name arrive that are not sheets, and both are dropped here rather than downstream:
 * `active.json` (the plugin's own bookkeeping) and an editor's temporary file — VS Code writes
 * `custom.css.tmp-1234` and then renames it, so the rename ONTO the real name is the event that
 * matters, and it follows immediately. The leading dot is checked separately because a temporary
 * file is not a sheet NAME and must not be reported as one.
 * @param filename - the name the watcher reported.
 * @returns true when it is a sheet.
 */
function isWatchedSheet(filename) {
  if (typeof filename !== 'string' || filename === '') return false;
  if (filename.startsWith('.')) return false;
  return isSheetName(filename);
}

/** How long a burst of filesystem notifications is gathered before the sheets are announced. */
const WATCH_COALESCE_MS = 120;

/**
 * The directory holding one sheet's snapshots: `$dir/.history/<name>/`.
 *
 * A per-sheet directory rather than a name prefix, because a sheet name may itself contain
 * dots (`my.theme.css`) and parsing one back out of a file name is guesswork. The directory
 * sits inside the stylesheet directory but below its top level, which is the only level
 * `/list` reads — so snapshots are never offered as sheets.
 * @param name - an accepted sheet name.
 * @returns the absolute directory path.
 */
function snapshotDir(name) {
  return path.join(stylesDir(), HISTORY_DIR, name);
}

/**
 * Keep the current contents of one sheet, unless they are already the newest snapshot.
 *
 * Called before anything overwrites a sheet. The comparison is deliberate: the editor
 * writes the whole text on every pause, and snapshotting identical content would fill the
 * history with copies of the same sheet and push the useful entries out.
 * @param name - the sheet being overwritten.
 * @param css - its contents right now.
 */
async function snapshotSheet(name, css) {
  const dir = snapshotDir(name);
  const entries = await listSnapshots(name).catch(() => []);
  if (entries.length > 0) {
    const newest = await fs.readFile(path.join(dir, entries[0].stamp + '.css'), 'utf8').catch(() => undefined);
    if (newest === css) return;
  }
  await fs.mkdir(dir, { recursive: true });
  // A millisecond timestamp is the name, but a burst of writes can land in the same
  // millisecond — and the second one would overwrite the first snapshot instead of following
  // it, losing exactly the version worth keeping. Step forward until the name is free.
  let stamp = Date.now();
  while (await fs.stat(path.join(dir, stamp + '.css')).then(() => true, () => false)) stamp += 1;
  await fs.writeFile(path.join(dir, stamp + '.css'), css, 'utf8');
  // Prune by age, oldest first, so a sheet that is edited all day cannot grow without bound.
  const after = await listSnapshots(name);
  for (const entry of after.slice(MAX_SNAPSHOTS)) {
    await fs.rm(path.join(dir, entry.stamp + '.css'), { force: true });
  }
}

/**
 * One sheet's snapshots, newest first.
 * @param name - an accepted sheet name.
 * @returns `{ stamp, bytes, mtime }` records.
 */
async function listSnapshots(name) {
  const dir = snapshotDir(name);
  const names = await fs.readdir(dir).catch(() => []);
  const entries = [];
  for (const file of names) {
    const stamp = file.endsWith('.css') ? file.slice(0, -4) : '';
    if (!STAMP_PATTERN.test(stamp)) continue;
    const stat = await fs.stat(path.join(dir, file)).catch(() => undefined);
    if (stat === undefined || !stat.isFile()) continue;
    entries.push({ stamp, bytes: stat.size, mtime: Math.round(stat.mtimeMs) });
  }
  entries.sort((left, right) => Number(right.stamp) - Number(left.stamp));
  return entries;
}

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
 * The filesystem's revision of one sheet: `size/mtimeMs`, the same shape `/read` reports.
 *
 * Every route that changes a sheet answers with this, so the browser's baseline advances with
 * its own write instead of re-reading it later and calling it somebody else's change.
 * @param full - an absolute path inside the stylesheet directory.
 * @returns the revision string, or null when the file cannot be stat-ed.
 */
async function revisionOf(full) {
  const stat = await fs.stat(full).catch(() => undefined);
  return stat === undefined ? null : stat.size + '/' + Math.round(stat.mtimeMs);
}

/**
 * Read one sheet together with the filesystem's revision of it.
 *
 * The revision is what lets the browser tell "the file changed" from "the file changed
 * because WE wrote it": every write answers with the stat the write produced, and the
 * external-change check asks about the stat instead of comparing the whole text. Comparing
 * text got a false positive — and a data-loss prompt — the moment an editor rewrote the same
 * content with a CRLF, and it could not tell a touch from an edit at all.
 *
 * Unreadable (no file, refused read) comes back as undefined, which the route turns into 404.
 * @param name - an acceptable sheet name.
 * @returns `{ css, rev }`, or undefined when the file cannot be read.
 */
async function readSheetWithRev(name) {
  const full = safePath(name);
  if (full === undefined) return undefined;
  const css = await fs.readFile(full, 'utf8').catch(() => undefined);
  if (css === undefined) return undefined;
  return { css, rev: await revisionOf(full) };
}

/**
 * Watch the stylesheet directory and tell the plugin when a sheet changes.
 *
 * The browser polls (see the client half), so this is an optimisation — a save is announced in
 * milliseconds instead of at the next poll — and it is strictly optional: an unwatchable
 * directory (a network share, a filesystem without inotify) degrades to polling rather than
 * failing the route. Nothing here reads a sheet or decides anything; it is a doorbell.
 *
 * A DIRECTORY watch, not `watch(file)`: every editor that saves by writing a temporary file and
 * renaming it over the target (VS Code does, by default) replaces the file's identity, and a
 * watch on the old file sees nothing afterwards. Measured in
 * `%TEMP%\css-probe\watch-editor-saves.mjs`, which also shows a burst of saves arriving as six
 * notifications — hence the coalescing timer.
 * @param listener - called with the changed sheet's name, coalesced.
 */
function watchSheets(listener) {
  let timer = null;
  const pending = new Set();
  let watcher = null;
  const flush = () => {
    timer = null;
    const names = [...pending];
    pending.clear();
    for (const name of names) listener(name);
  };
  const onChange = (_eventType, filename) => {
    // A rename arrives as the temporary name first (`.custom.css-1234`), which is not a sheet
    // name and is deliberately dropped: the rename onto the real name follows immediately.
    if (!isWatchedSheet(filename)) return;
    pending.add(filename);
    if (timer !== null) clearTimeout(timer);
    // The timer must not outlive the watch: a pending notification keeping the process alive
    // is exactly what `persistent: false` is there to prevent.
    timer = setTimeout(flush, WATCH_COALESCE_MS);
    timer.unref?.();
  };
  try {
    const dir = stylesDir();
    // The directory may not exist yet on a first run; `listFiles` creates it on the first
    // listing anyway, and the watch is retried on the next boot.
    watcher = watch(dir, { persistent: false }, onChange);
    watcher.on('error', () => {
      // A watcher that cannot watch is not an error worth reporting to the user: the poll
      // still finds the change, only later.
      watcher?.close();
      watcher = null;
    });
  }
  catch {
    watcher = null;
  }
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending.clear();
    watcher?.close();
    watcher = null;
  };
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
 * The watcher's name filter, exposed for the host smoke test.
 *
 * Pure, and the part of the watcher that a test can hold on to: the notifications themselves come
 * from the OS, so the assertions that matter are "which names count as a sheet" and "a burst is
 * coalesced", and only the first is a question about this function.
 * @param filename - the name a filesystem notification carried.
 * @returns true when the plugin should treat it as a change to a sheet.
 */
export function isWatchedSheetName(filename) {
  return isWatchedSheet(filename);
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
    const sheet = await readSheetWithRev(name);
    if (sheet === undefined) {
      json(res, 404, { ok: false, error: 'not-found' });
      return;
    }
    json(res, 200, { ok: true, name, css: sheet.css, rev: sheet.rev });
    return;
  }

  if (method === 'GET' && route === '/history') {
    const name = url.searchParams.get('name');
    if (safePath(name) === undefined) {
      json(res, 400, { ok: false, error: 'bad-name' });
      return;
    }
    json(res, 200, { ok: true, name, entries: await listSnapshots(name) });
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
    // Whatever is being replaced is worth keeping: a sheet is a file the user may have spent
    // an hour on, and this write is the moment it would otherwise be gone.
    const previous = await fs.readFile(full, 'utf8').catch(() => undefined);
    if (previous !== undefined && previous !== body.css) await snapshotSheet(body.name, previous);
    await fs.writeFile(full, body.css, 'utf8');
    // The revision the write produced, so the browser's baseline advances with it instead of
    // re-reading its own change and calling it somebody else's.
    json(res, 200, {
      ok: true,
      name: body.name,
      bytes: Buffer.byteLength(body.css),
      rev: await revisionOf(full),
    });
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
    // An import overwrites by design, which is exactly when a snapshot matters.
    const previous = await fs.readFile(full, 'utf8').catch(() => undefined);
    if (previous !== undefined && previous !== css) await snapshotSheet(body.name, previous);
    await fs.writeFile(full, css, 'utf8');
    // A sheet that was just created or imported is meant to be in use: a switch
    // left over from a previous file of the same name would mute it on sight.
    await setActiveSheet(body.name, { enable: true });
    json(res, 200, { ok: true, name: body.name, bytes: Buffer.byteLength(css), rev: await revisionOf(full) });
    return;
  }

  if (route === '/restore') {
    const full = safePath(body.name);
    if (full === undefined) {
      json(res, 400, { ok: false, error: 'bad-name' });
      return;
    }
    if (typeof body.stamp !== 'string' || !STAMP_PATTERN.test(body.stamp)) {
      json(res, 400, { ok: false, error: 'bad-stamp' });
      return;
    }
    const snapshot = await fs.readFile(path.join(snapshotDir(body.name), body.stamp + '.css'), 'utf8').catch(() => undefined);
    if (snapshot === undefined) {
      json(res, 404, { ok: false, error: 'not-found' });
      return;
    }
    // The restore is reversible: what it replaces is snapshotted first, like any other write.
    const previous = await fs.readFile(full, 'utf8').catch(() => undefined);
    if (previous !== undefined && previous !== snapshot) await snapshotSheet(body.name, previous);
    await fs.mkdir(stylesDir(), { recursive: true });
    await fs.writeFile(full, snapshot, 'utf8');
    json(res, 200, {
      ok: true,
      name: body.name,
      stamp: body.stamp,
      bytes: Buffer.byteLength(snapshot),
      rev: await revisionOf(full),
    });
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
 * @param options - `{ watch: false }` skips the filesystem watcher.
 */
export function apply(ctx, options = {}) {
  ctx.inject(['webServer'], (webCtx) => {
    // The sheet watcher: a doorbell for the browser half, which polls `/read` on its own timer
    // (see the client half). Started here rather than at module scope so a composition without a
    // web server does not open a directory handle it has nothing to do with.
    //
    // It can be skipped on request because it watches the STYLESHEET DIRECTORY, which the host
    // smoke test deletes at the end — and on Windows a watcher whose directory has been removed
    // keeps the process alive even after `close()`, so a test cannot outlive its own teardown.
    // Production never disposes this effect, so nothing about the real path depends on that.
    if (options.watch !== false) {
      webCtx.effect(() => watchSheets(() => {
        // Nothing to deliver: the browser asks. The listener exists so the watcher is not a
        // fire-and-forget handle nobody can see in a stack trace.
      }), 'dsh-custom-css: sheet watcher');
    }
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
        // A fence that throws must fail closed: an escaping exception would skip the
        // 503 path entirely and reach the client as a hung or 500 request.
        let rejection;
        try {
          rejection = reject.call(connection, req);
        }
        catch {
          res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('dsh-custom-css: connection fence failed');
          return;
        }
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
