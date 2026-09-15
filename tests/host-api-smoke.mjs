#!/usr/bin/env node
/**
 * Host-half smoke test for dsh-custom-css.
 *
 * Mounts the plugin's route on a fake `webServer`, drives it with fake
 * requests, and asserts the file API plus its security boundaries — all
 * without a running DSH:
 *
 *   node tests/host-api-smoke.cjs
 */
import { Readable } from 'node:stream';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert';

const home = await mkdtemp(path.join(tmpdir(), 'dsh-custom-css-'));
process.env.DSH_HOME = home;
const stylesDir = path.join(home, 'custom-css');

/** Route registration captured from the plugin body. */
let route;
/** Fence verdict the fake Connection service returns for the next request. */
let fenceVerdict;

const ctx = {
  inject(services, body) {
    assert.deepStrictEqual(services, ['webServer'], 'the plugin mounts on webServer');
    body({
      effect: register => register(),
      webServer: {
        register(registration) {
          route = registration;
          return () => {};
        },
      },
    });
  },
  get(name) {
    if (name !== 'connection') return undefined;
    return { requestRejection: () => fenceVerdict };
  },
};

const { apply, setLauncher } = await import('../lib/index.js');

/** Spy launcher: the real one would spawn an editor window during the test. */
const launched = [];
setLauncher(full => {
  launched.push(full);
});

apply(ctx);

assert.ok(route !== undefined, 'the plugin must mount a route');
assert.strictEqual(route.kind, 'prefix');
assert.strictEqual(route.path, '/dsh-custom-css');

/**
 * Drive the mounted handler with a fake request.
 * @param method - HTTP method.
 * @param url - request URL.
 * @param body - optional JSON body.
 * @returns the captured status and decoded payload.
 */
async function call(method, url, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = url;
  req.headers = {};
  const captured = {};
  const res = {
    writeHead(status) {
      captured.status = status;
    },
    end(chunk) {
      captured.body = chunk;
    },
  };
  await route.handler(req, res);
  return {
    status: captured.status,
    payload: typeof captured.body === 'string' && captured.body.startsWith('{')
      ? JSON.parse(captured.body)
      : captured.body,
  };
}

// --- empty directory --------------------------------------------------------
const empty = await call('GET', '/dsh-custom-css/list');
assert.strictEqual(empty.status, 200, 'list succeeds on a fresh directory');
assert.deepStrictEqual(empty.payload.files, [], 'no sheets yet');
assert.strictEqual(empty.payload.active, null, 'no active sheet yet');
assert.strictEqual(empty.payload.dir, stylesDir, 'the payload names the stylesheet directory');

// --- create / read / write --------------------------------------------------
const created = await call('POST', '/dsh-custom-css/create', { name: 'theme.css', css: '.a{color:red}' });
assert.strictEqual(created.status, 200);
assert.strictEqual(created.payload.name, 'theme.css');

const listed = await call('GET', '/dsh-custom-css/list');
assert.deepStrictEqual(listed.payload.files.map(file => file.name), ['theme.css'], 'the sheet is listed');
assert.strictEqual(listed.payload.active, 'theme.css', 'creating a sheet makes it active');

const onDisk = await readFile(path.join(stylesDir, 'theme.css'), 'utf8');
assert.strictEqual(onDisk, '.a{color:red}', 'the sheet really landed on disk');

const read = await call('GET', '/dsh-custom-css/read?name=theme.css');
assert.strictEqual(read.payload.css, '.a{color:red}');

const written = await call('POST', '/dsh-custom-css/write', { name: 'theme.css', css: '.b{color:blue}' });
assert.strictEqual(written.status, 200);
assert.strictEqual(await readFile(path.join(stylesDir, 'theme.css'), 'utf8'), '.b{color:blue}', 'write replaces the file');

// --- bookkeeping file stays out of the listing ------------------------------
const activeRaw = await readFile(path.join(stylesDir, 'active.json'), 'utf8');
assert.strictEqual(JSON.parse(activeRaw).active, 'theme.css', 'the active sheet is recorded');
assert.ok(listed.payload.files.every(file => file.name.endsWith('.css')), 'active.json is never listed as a sheet');

// --- the per-sheet switch ---------------------------------------------------
const off = await call('POST', '/dsh-custom-css/toggle', { name: 'theme.css', enabled: false });
assert.strictEqual(off.status, 200, 'switching a sheet off is accepted');
assert.deepStrictEqual(off.payload.disabled, ['theme.css'], 'the switch records the sheet as off');

const listedOff = await call('GET', '/dsh-custom-css/list');
assert.deepStrictEqual(listedOff.payload.disabled, ['theme.css'], 'the listing carries the switch state');
assert.deepStrictEqual(listedOff.payload.files.map(file => file.name), ['theme.css'], 'a switched-off sheet is still listed');

const keptRaw = JSON.parse(await readFile(path.join(stylesDir, 'active.json'), 'utf8'));
assert.strictEqual(keptRaw.active, 'theme.css', 'the switch never disturbs the active sheet');
assert.deepStrictEqual(keptRaw.disabled, ['theme.css'], 'the switch is persisted beside it');

const on = await call('POST', '/dsh-custom-css/toggle', { name: 'theme.css', enabled: true });
assert.deepStrictEqual(on.payload.disabled, [], 'switching back on clears the record');

const refusedToggle = await call('POST', '/dsh-custom-css/toggle', { name: '../evil.css', enabled: false });
assert.strictEqual(refusedToggle.status, 400, 'the switch refuses a traversal name');

const absentToggle = await call('POST', '/dsh-custom-css/toggle', { name: 'ghost.css', enabled: false });
assert.strictEqual(absentToggle.status, 404, 'switching a sheet that does not exist is a 404');

const badEnabled = await call('POST', '/dsh-custom-css/toggle', { name: 'theme.css', enabled: 'no' });
assert.strictEqual(badEnabled.status, 400, 'a non-boolean switch value is refused');

// --- conflict and validation ------------------------------------------------
const conflict = await call('POST', '/dsh-custom-css/create', { name: 'theme.css' });
assert.strictEqual(conflict.status, 409, 'creating an existing sheet is a conflict');

const imports = await call('POST', '/dsh-custom-css/import', { name: 'theme.css', css: '.c{}' });
assert.strictEqual(imports.status, 200, 'import overwrites by design');
assert.strictEqual(await readFile(path.join(stylesDir, 'theme.css'), 'utf8'), '.c{}');

for (const name of ['../escape.css', 'sub/dir.css', '..\\escape.css', 'no-extension', '', 'x'.repeat(80) + '.css']) {
  const bad = await call('POST', '/dsh-custom-css/write', { name, css: '.x{}' });
  assert.strictEqual(bad.status, 400, 'refused name: ' + JSON.stringify(name));
}
const traversalRead = await call('GET', '/dsh-custom-css/read?name=../../settings.yaml');
assert.strictEqual(traversalRead.status, 400, 'read refuses traversal');

const badCss = await call('POST', '/dsh-custom-css/write', { name: 'theme.css', css: 42 });
assert.strictEqual(badCss.status, 400, 'non-string css is refused');

const missing = await call('GET', '/dsh-custom-css/read?name=absent.css');
assert.strictEqual(missing.status, 404, 'a missing sheet is a 404');

// --- open in the default application ---------------------------------------
const opened = await call('POST', '/dsh-custom-css/open', { name: 'theme.css' });
assert.strictEqual(opened.status, 200, 'opening an existing sheet succeeds');
assert.deepStrictEqual(launched, [path.join(stylesDir, 'theme.css')], 'the launcher receives the absolute path');

const openMissing = await call('POST', '/dsh-custom-css/open', { name: 'absent.css' });
assert.strictEqual(openMissing.status, 404, 'opening a missing sheet is a 404, not a malformed name');

const openTraversal = await call('POST', '/dsh-custom-css/open', { name: '../../windows/system32/calc.exe' });
assert.strictEqual(openTraversal.status, 400, 'opening outside the directory is refused');
assert.strictEqual(launched.length, 1, 'a refused open never reaches the launcher');

const unknown = await call('GET', '/dsh-custom-css/nope');
assert.strictEqual(unknown.status, 404);

// --- the fence is load-bearing ---------------------------------------------
fenceVerdict = 401;
const fenced = await call('GET', '/dsh-custom-css/list');
assert.strictEqual(fenced.status, 401, 'a fence rejection is honored');

fenceVerdict = 403;
const forbidden = await call('GET', '/dsh-custom-css/list');
assert.strictEqual(forbidden.status, 403);

fenceVerdict = undefined;
let secondRoute;
apply({
  inject: (services, body) => {
    assert.deepStrictEqual(services, ['webServer']);
    body({
      effect: register => register(),
      webServer: { register(registration) { secondRoute = registration; return () => {}; } },
    });
  },
  get: () => undefined,
});
const req = Readable.from([]);
req.method = 'GET';
req.url = '/dsh-custom-css/list';
req.headers = {};
const captured = {};
await secondRoute.handler(req, { writeHead(status) { captured.status = status; }, end() {} });
assert.strictEqual(captured.status, 503, 'without the fence the route fails closed');


// --- /active, the route nothing used to call --------------------------------
const switched = await call('POST', '/dsh-custom-css/active', { name: 'theme.css' });
assert.strictEqual(switched.status, 200, 'switching to an existing sheet succeeds');
assert.strictEqual(switched.payload.name, 'theme.css');

await call('POST', '/dsh-custom-css/toggle', { name: 'theme.css', enabled: false });
const activeKeepsSwitches = await call('POST', '/dsh-custom-css/active', { name: 'theme.css' });
assert.strictEqual(activeKeepsSwitches.status, 200);
assert.deepStrictEqual(
  JSON.parse(await readFile(path.join(stylesDir, 'active.json'), 'utf8')).disabled,
  ['theme.css'],
  'switching the active sheet leaves its own on/off switch alone',
);
await call('POST', '/dsh-custom-css/toggle', { name: 'theme.css', enabled: true });

const activeMissing = await call('POST', '/dsh-custom-css/active', { name: 'ghost.css' });
assert.strictEqual(activeMissing.status, 404, 'switching to a missing sheet is a 404');
assert.strictEqual(activeMissing.payload.error, 'not-found', 'and says so, rather than blaming the name');

const activeBadName = await call('POST', '/dsh-custom-css/active', { name: '../evil.css' });
assert.strictEqual(activeBadName.status, 400, 'switching to a traversal name is refused');
assert.strictEqual(activeBadName.payload.error, 'bad-name');

// --- a name is refused by every route that takes one ------------------------
for (const route of ['/create', '/import', '/active']) {
  const bad = await call('POST', '/dsh-custom-css' + route, { name: '../evil.css', css: '.x{}' });
  assert.strictEqual(bad.status, 400, route + ' refuses a traversal name');
}
for (const name of ['nul.css', 'CON.css', 'com1.css', 'lpt9.css']) {
  const reserved = await call('POST', '/dsh-custom-css/write', { name, css: '.x{}' });
  assert.strictEqual(reserved.status, 400, 'a Windows device name is refused: ' + name);
}

// --- the wrong method never reaches the file API ----------------------------
for (const [method, route] of [['GET', '/write'], ['POST', '/list'], ['DELETE', '/toggle'], ['GET', '/active'], ['PUT', '/import']]) {
  const wrong = await call(method, '/dsh-custom-css' + route, { name: 'theme.css' });
  assert.strictEqual(wrong.status, 404, method + ' ' + route + ' is not a route');
}

// --- the body cap is enforced, and the socket survives it -------------------
const beforeOversize = await readFile(path.join(stylesDir, 'theme.css'), 'utf8');
const oversize = await call('POST', '/dsh-custom-css/write', {
  name: 'theme.css',
  css: 'a'.repeat((1 << 20) + 1024),
});
assert.strictEqual(oversize.status, 400, 'an oversized body is refused with a JSON reply');
assert.strictEqual(oversize.payload.error, 'bad-body', 'and the reply is the body error, not a transport failure');
assert.strictEqual(
  await readFile(path.join(stylesDir, 'theme.css'), 'utf8'),
  beforeOversize,
  'an oversized write leaves the sheet alone',
);
const recovered = await call('GET', '/dsh-custom-css/list');
assert.strictEqual(recovered.status, 200, 'the connection still answers after a refused body');

const notJson = await call('POST', '/dsh-custom-css/write', undefined);
assert.strictEqual(notJson.status, 400, 'an empty body is a bad body');

// --- the fence guards writes too, not just reads ----------------------------
fenceVerdict = 401;
const fencedWrite = await call('POST', '/dsh-custom-css/write', { name: 'theme.css', css: '.fenced{}' });
assert.strictEqual(fencedWrite.status, 401, 'a fence rejection stops a write');
assert.strictEqual(
  await readFile(path.join(stylesDir, 'theme.css'), 'utf8'),
  beforeOversize,
  'a fenced write never reaches the disk',
);
fenceVerdict = undefined;

// --- bookkeeping: malformed file, then the ghost of a deleted sheet ---------
const warnings = [];
const realWarn = console.warn;
console.warn = (...args) => { warnings.push(args.join(' ')); };
await writeFile(path.join(stylesDir, 'active.json'), '{"active": "theme.css", ', 'utf8');
const afterGarbage = await call('GET', '/dsh-custom-css/list');
console.warn = realWarn;
assert.strictEqual(afterGarbage.payload.active, null, 'a malformed active.json does not invent an active sheet');
assert.ok(
  warnings.some(line => line.includes('active.json')),
  'the host says the bookkeeping file was unreadable instead of silently resetting it',
);
const rewritten = await call('POST', '/dsh-custom-css/toggle', { name: 'theme.css', enabled: false });
assert.strictEqual(rewritten.status, 200, 'a toggle rewrites the bookkeeping file');
assert.deepStrictEqual(
  JSON.parse(await readFile(path.join(stylesDir, 'active.json'), 'utf8')),
  { disabled: ['theme.css'] },
  'the rewritten file is valid JSON again',
);

// Toggle a sheet off, delete it, and create a file of the same name: a switch
// left over from the deleted file would mute the new one on sight.
await rm(path.join(stylesDir, 'theme.css'));
const ghostList = await call('GET', '/dsh-custom-css/list');
assert.deepStrictEqual(ghostList.payload.disabled, [], 'deleting a sheet drops its switch from the listing');
const recreate = await call('POST', '/dsh-custom-css/create', { name: 'theme.css', css: '.fresh{}' });
assert.strictEqual(recreate.status, 200, 'the sheet can be created again');
const recreated = await call('GET', '/dsh-custom-css/list');
assert.deepStrictEqual(recreated.payload.disabled, [], 'the fresh sheet starts switched on');
assert.strictEqual(recreated.payload.active, 'theme.css');

// --- a hand-dropped name the picker offers must also be usable --------------
const longName = 'x'.repeat(66) + '.css';
await writeFile(path.join(stylesDir, longName), '.long{}', 'utf8');
await writeFile(path.join(stylesDir, 'nul.css'), '.nul{}', 'utf8');
const handDropped = await call('GET', '/dsh-custom-css/list');
const offered = handDropped.payload.files.map(file => file.name);
assert.ok(!offered.includes(longName), 'a name past the length cap is not offered');
assert.ok(!offered.includes('nul.css'), 'a device name is not offered');
for (const name of offered) {
  const usable = await call('GET', '/dsh-custom-css/read?name=' + encodeURIComponent(name));
  assert.strictEqual(usable.status, 200, 'every listed sheet is readable: ' + name);
}

// --- a symlink inside the directory must not reach outside it ---------------
// The case can only run where the process may create a symbolic link. On Windows that needs
// Developer Mode or an elevated shell; a plain `fs.symlink` there fails with EPERM, which is
// a property of the machine and not of the plugin. Anywhere else a failure is real and must
// be loud. Either way the outcome is reported: a skipped boundary may not be printed as a
// verified one — that is how the newest defence line goes unrun while the suite still says OK.
const outside = path.join(home, 'outside.yaml');
await writeFile(outside, 'secret: true', 'utf8');
let linked = true;
try {
  await symlink(outside, path.join(stylesDir, 'link.css'));
}
catch (error) {
  if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error;
  linked = false;
}
if (linked) {
  const linkRead = await call('GET', '/dsh-custom-css/read?name=link.css');
  assert.strictEqual(linkRead.status, 400, 'reading through a symlink is refused');
  const linkWrite = await call('POST', '/dsh-custom-css/write', { name: 'link.css', css: '.pwn{}' });
  assert.strictEqual(linkWrite.status, 400, 'writing through a symlink is refused');
  assert.strictEqual(await readFile(outside, 'utf8'), 'secret: true', 'the link target is untouched');
}
else {
  console.log('host-api-smoke: SKIPPED — symlink refusal: this machine cannot create a symbolic link without elevated rights (fs.symlink: EPERM). That boundary is UNVERIFIED here.');
}

// --- the listing cap cannot hide the active sheet ---------------------------
await writeFile(path.join(stylesDir, 'active.json'), '{"active": "theme.css"}', 'utf8');
const cappedNames = [];
for (let index = 0; index < 200; index += 1) {
  const name = 'aaa' + String(index).padStart(3, '0') + '.css';
  cappedNames.push(name);
  await writeFile(path.join(stylesDir, name), '.x{}', 'utf8');
}
const capped = await call('GET', '/dsh-custom-css/list');
assert.strictEqual(capped.payload.files.length, 201, 'the listing is capped, plus the pinned active sheet');
assert.ok(
  capped.payload.files.some(file => file.name === 'theme.css'),
  'the active sheet is listed even when the cap would have dropped it',
);
// The expectation is written out here rather than derived from the reply. Comparing the
// reply against its own sorted copy does catch a mis-sorted listing (verified by handing
// the sheets back in reverse), but it cannot say WHICH sheets came back or where the pinned
// one landed — and `aaa…` sorts below every other sheet, so the cap keeps exactly these 200
// and the pinned active sheet joins them at the end.
assert.deepStrictEqual(
  capped.payload.files.map(file => file.name),
  [...cappedNames, 'theme.css'].sort((left, right) => left.localeCompare(right)),
  'the listing holds the first 200 names by name-order, with the pinned active sheet among them',
);

// --- snapshots: what a write replaces is kept -------------------------------
// A sheet is a file the user may have spent an hour on, and every write replaces all of it.
// The newest few versions live beside it, under a directory `/list` never reads. Counts here
// are relative: the tests above have been writing theme.css all along, and those writes are
// snapshots too.
const seeded = (await call('GET', '/dsh-custom-css/history?name=theme.css')).payload.entries.length;
const beforeWrite = await readFile(path.join(stylesDir, 'theme.css'), 'utf8');
await call('POST', '/dsh-custom-css/write', { name: 'theme.css', css: '.snap-one{}' });
const kept = (await call('GET', '/dsh-custom-css/history?name=theme.css')).payload.entries;
assert.strictEqual(kept.length, seeded + 1, 'the replaced contents are kept — entries: ' + JSON.stringify(kept));
assert.strictEqual(
  await readFile(path.join(stylesDir, '.history', 'theme.css', kept[0].stamp + '.css'), 'utf8'),
  beforeWrite,
  'and the newest snapshot is exactly what was there before the write',
);

await call('POST', '/dsh-custom-css/write', { name: 'theme.css', css: '.snap-one{}' });
const unchanged = (await call('GET', '/dsh-custom-css/history?name=theme.css')).payload.entries;
assert.strictEqual(
  unchanged.length, kept.length,
  'writing the same text again adds no copy of the same sheet — entries: ' + JSON.stringify(unchanged),
);

const restored = await call('POST', '/dsh-custom-css/restore', { name: 'theme.css', stamp: kept[0].stamp });
assert.strictEqual(restored.status, 200, 'a snapshot can be restored');
assert.strictEqual(await readFile(path.join(stylesDir, 'theme.css'), 'utf8'), beforeWrite, 'the sheet holds what the snapshot held');
const afterRestore = (await call('GET', '/dsh-custom-css/history?name=theme.css')).payload.entries;
assert.ok(
  afterRestore.length >= kept.length,
  'and the restore is itself reversible — entries: ' + JSON.stringify(afterRestore),
);

assert.strictEqual((await call('GET', '/dsh-custom-css/history?name=../evil.css')).status, 400, 'the history refuses a traversal name');
assert.strictEqual(
  (await call('POST', '/dsh-custom-css/restore', { name: 'theme.css', stamp: 'not-a-stamp' })).status, 400,
  'a stamp that is not a timestamp is refused',
);
assert.strictEqual(
  (await call('POST', '/dsh-custom-css/restore', { name: 'theme.css', stamp: '1' })).status, 404,
  'a snapshot that is not there is a 404',
);
assert.strictEqual(
  (await call('POST', '/dsh-custom-css/restore', { name: '../evil.css', stamp: '1' })).status, 400,
  'and so is a traversal name',
);

for (let index = 0; index < 26; index += 1) {
  await call('POST', '/dsh-custom-css/write', { name: 'theme.css', css: '.prune-' + index + '{}' });
}
const pruned = (await call('GET', '/dsh-custom-css/history?name=theme.css')).payload.entries;
assert.strictEqual(
  pruned.length, 20,
  'one sheet keeps a bounded number of versions — entries: ' + pruned.length,
);
const listedAfterSnapshots = await call('GET', '/dsh-custom-css/list');
assert.ok(
  !listedAfterSnapshots.payload.files.some(file => file.name.includes('history')),
  'and the history directory is never offered as a sheet',
);

await rm(home, { recursive: true, force: true });
const verified = [
  'file API', 'per-sheet switch', '/active', 'validation', 'reserved names', 'body cap',
  ...(linked ? ['symlink refusal'] : []),
  'bookkeeping recovery', 'listing cap', 'version snapshots', 'and fail-closed fence',
];
console.log('host-api-smoke: OK — ' + verified.join(', ') + ' verified');
