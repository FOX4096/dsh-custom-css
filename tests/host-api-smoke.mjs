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
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
assert.strictEqual(openMissing.status, 400, 'opening a missing sheet is refused');

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

await rm(home, { recursive: true, force: true });
console.log('host-api-smoke: OK — file API, validation, traversal refusal, and fail-closed fence verified');
