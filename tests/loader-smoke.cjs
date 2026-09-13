#!/usr/bin/env node
/**
 * Loader smoke test for the browser half of dsh-custom-css.
 *
 * Runs `lib/client.js` inside a minimal fake of the DSH client host and drives
 * its bootstrap against a fake Host route, asserting the module shape DSH's
 * loader requires, the slot registration, and both the host-backed and the
 * offline-fallback stylesheet paths. No browser and no running DSH needed:
 *
 *   node tests/loader-smoke.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert');

const pluginRoot = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(pluginRoot, 'lib', 'client.js'), 'utf8');

/** Hook slots reused across one render pass, mirroring React's call order. */
let hookSlots = [];
let hookIndex = 0;
/** Text nodes produced by the last render pass, for copy assertions. */
const renderedText = [];
/** Class names produced by the last render pass, for structure assertions. */
const renderedClasses = [];

const fakeReact = {
  useState(initial) {
    const index = hookIndex++;
    if (hookSlots[index] === undefined) hookSlots[index] = typeof initial === 'function' ? initial() : initial;
    return [hookSlots[index], (next) => {
      hookSlots[index] = typeof next === 'function' ? next(hookSlots[index]) : next;
    }];
  },
  useEffect() {
    hookIndex += 1;
  },
  useRef(value) {
    const index = hookIndex++;
    if (hookSlots[index] === undefined) hookSlots[index] = { current: value };
    return hookSlots[index];
  },
  // Handed the accessors as bare references, exactly like React does — so an
  // accessor that reads `this` throws here the way it would in the browser.
  useSyncExternalStore(subscribe, getSnapshot) {
    hookIndex += 1;
    subscribe(() => {});
    return getSnapshot();
  },
  createElement(type, props, ...children) {
    if (typeof props?.className === 'string') renderedClasses.push(props.className);
    for (const child of children.flat()) {
      if (typeof child === 'string') renderedText.push(child);
    }
    return { type, props, children };
  },
};

/**
 * Build one JSON response double.
 * @param payload - decoded payload.
 * @param status - HTTP status.
 * @returns a fetch response double.
 */
function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

/**
 * The sheet the fake Host serves. Its comment looks like markup so the same
 * render also exercises the highlighter's escaping.
 */
const HOST_SHEET = '/* <img src=x onerror=alert(1)> */\n.from-host{color:red}';

/** Let the plugin's awaited bootstrap settle. */
async function settle() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

/**
 * Load the browser half in a fresh sandbox and drive one bootstrap pass.
 * @param options - `fetchImpl(url, init)` double and optional stored values.
 * @returns the observed host doubles and plugin state.
 */
async function boot({ fetchImpl, stored = new Map(), supports }) {
  const styleTags = [];
  const storage = new Map(stored);
  const calls = [];
  const makeElement = tagName => ({
    tagName,
    dataset: {},
    id: '',
    textContent: '',
    remove() {
      const index = styleTags.indexOf(this);
      if (index >= 0) styleTags.splice(index, 1);
    },
  });
  const document = {
    head: { appendChild: element => { styleTags.push(element); } },
    querySelector(selector) {
      const match = /^style\[data-plugin-css="(.*)"\]$/.exec(selector);
      return match === null ? null : (styleTags.find(element => element.dataset.pluginCss === match[1]) ?? null);
    },
    createElement: makeElement,
    getElementById: id => styleTags.find(element => element.id === id) ?? null,
  };

  let loaded;
  const sandbox = {
    window: { __ModuleLoader__: { load(module) { loaded = module; } } },
    document,
    localStorage: {
      getItem: key => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => { storage.set(key, String(value)); },
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return fetchImpl(url, init);
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    console,
    // The engine's validity oracle; absent unless a case supplies one.
    ...(supports === undefined ? {} : { CSS: { supports } }),
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const mod = loaded.factory((name) => {
    if (name === 'react') return fakeReact;
    throw new Error('unexpected require: ' + name);
  });

  const waits = [];
  const registrations = [];
  mod.apply({
    slots: {
      inject(name, factory) {
        waits.push(name);
        return factory();
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  });
  await settle();

  return {
    mod,
    loaded,
    styleTags,
    storage,
    calls,
    waits,
    registrations,
    userStyle: () => styleTags.find(element => element.id === 'dsh-custom-css-user-style'),
  };
}

async function main() {
  // --- 1. host-backed path --------------------------------------------------
  const host = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({
          ok: true,
          dir: '/tmp/custom-css',
          files: [{ name: 'custom.css', bytes: 20, mtime: 1 }],
          active: 'custom.css',
        });
      }
      if (url.includes('/read')) {
        return jsonResponse({ ok: true, name: 'custom.css', css: HOST_SHEET });
      }
      throw new Error('unexpected request: ' + url);
    },
  });

  assert.ok(host.loaded, 'client.js must call window.__ModuleLoader__.load');
  assert.strictEqual(host.loaded.id, 'dsh-custom-css', 'module id must equal the package name');
  assert.strictEqual(typeof host.loaded.factory, 'function', 'load() must receive a factory');
  assert.strictEqual(typeof host.mod.apply, 'function', 'exports.apply must be a function');
  assert.deepStrictEqual([...host.mod.inject], ['slots'], 'exports.inject must declare the slots service');

  assert.deepStrictEqual(host.waits, ['settings.general.item'], 'apply waits for the General item seat');
  assert.strictEqual(host.registrations.length, 1, 'apply registers exactly one row');
  assert.strictEqual(host.registrations[0].options.id, 'custom-css');
  assert.strictEqual(host.registrations[0].options.order, 12, 'order 12 sits below Appearance (10) and Font size (11)');
  assert.strictEqual(host.registrations[0].options.registrant, 'dsh-custom-css');
  assert.strictEqual(typeof host.registrations[0].component, 'function', 'the registered row must be a component');

  assert.ok(host.userStyle(), 'the active host sheet is applied on load, without opening settings');
  assert.strictEqual(host.userStyle().textContent, HOST_SHEET);
  assert.ok(host.calls.some(call => call.url === '/dsh-custom-css/list'), 'bootstrap lists sheets');
  assert.ok(host.calls.some(call => call.url.startsWith('/dsh-custom-css/read')), 'bootstrap reads the active sheet');

  const rowSheets = host.styleTags.filter(element => element.dataset.pluginCss === 'dsh-custom-css/CustomCssRow.module.css');
  assert.strictEqual(rowSheets.length, 1, 'the row stylesheet is injected exactly once');
  assert.ok(rowSheets[0].textContent.includes('--dsw-alias-label-primary'), 'row styles consume DSH tokens');

  // The row must actually render. The settings shell turns a thrown render into
  // an invisible `data-slot-error` placeholder, so a broken accessor shows up as
  // "the row is missing" — render it here, with the accessors handed over as
  // bare references exactly like React does.
  const renderRow = host.registrations[0].component;
  hookSlots = [];
  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  let element;
  assert.doesNotThrow(() => { element = renderRow(); }, 'the row component renders without throwing');
  assert.ok(hookIndex > 0, 'the row component ran its hooks');
  for (const label of ['打开文件', '导入', '导出', '重置']) {
    assert.ok(renderedText.includes(label), 'the row renders the ' + label + ' action');
  }
  assert.ok(renderedClasses.includes('dshCc_picker'), 'the picker is wrapped for menu positioning');
  assert.ok(renderedClasses.includes('dshCc_trigger'), 'the sheet picker renders as a DSH-style trigger button');
  assert.ok(renderedClasses.includes('dshCc_gutterLine'), 'the editor renders a line-number gutter');
  // The gutter is `overflow: hidden`, so its own scrollTop can never move — the
  // numbers have to ride a translated layer instead.
  assert.ok(renderedClasses.includes('dshCc_gutterInner'), 'line numbers ride a translate layer, not scrollTop');

  // Typing must run the completion path. The textarea is driven directly because
  // the harness never re-renders: `display: fl` has to offer `flex`, which only
  // works when the property is read from the LAST identifier before the colon.
  const findNode = (node, type) => {
    if (node === null || typeof node !== 'object') return null;
    if (node.type === type) return node;
    for (const child of node.children ?? []) {
      const found = findNode(child, type);
      if (found !== null) return found;
    }
    return null;
  };
  const textarea = findNode(element, 'textarea');
  assert.ok(textarea !== null, 'the editor textarea renders');

  // The colour layer tokenises the sheet for the DevTools-style editor, and must
  // escape it: a stylesheet is user text and never markup.
  const highlight = findNode(element, 'pre');
  assert.ok(highlight !== null, 'the highlighted code layer renders');
  const highlighted = highlight.props.dangerouslySetInnerHTML.__html;
  assert.ok(highlighted.includes('dshCc_tokSel'), 'selectors are tokenised');
  assert.ok(highlighted.includes('dshCc_tokProp'), 'property names are tokenised');
  assert.ok(highlighted.includes('dshCc_tokComment'), 'comments are tokenised');
  assert.ok(!highlighted.includes('<img'), 'sheet text is escaped, never injected as markup');
  const typed = '.a { display: fl';
  assert.doesNotThrow(() => {
    textarea.props.onChange({
      target: { value: typed, selectionStart: typed.length },
      nativeEvent: { inputType: 'insertText' },
    });
  }, 'typing runs the completion path without throwing');
  const suggest = hookSlots.find(slot => slot !== null && typeof slot === 'object'
    && Array.isArray(slot.items) && typeof slot.word === 'string');
  assert.ok(suggest !== undefined, 'typing offered completions');
  assert.strictEqual(suggest.word, 'fl', 'the completion word is the one under the caret');
  assert.ok(suggest.items.includes('flex'), 'value completion for `display: fl` offers `flex`');

  // --- rule panel -----------------------------------------------------------
  // Restore the host sheet first: the completion case above rewrote the editor
  // text, and the panel addresses the sheet's *current* rules.
  textarea.props.onChange({
    target: { value: HOST_SHEET, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  renderedClasses.length = 0;
  renderedText.length = 0;
  const restored = renderRow();
  const pre = findNode(restored, 'pre');
  const restoredHtml = pre.props.dangerouslySetInnerHTML.__html;
  assert.ok(restoredHtml.includes('dshCc_clickable'), 'rule selectors become click targets');
  assert.ok(restoredHtml.includes('data-rule="0"'), 'the selector carries its rule index');

  pre.props.onClick({ target: { getAttribute: () => '0' } });
  hookIndex = 0;
  renderedClasses.length = 0;
  renderedText.length = 0;
  const withPanel = renderRow();
  assert.ok(renderedClasses.includes('dshCc_panel'), 'clicking a selector opens the rule panel');
  assert.ok(renderedText.includes('容器'), 'the panel offers the container template');

  const panelButtons = [];
  const collect = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (node.type === 'button') panelButtons.push(node);
    for (const child of node.children ?? []) collect(child);
  };
  collect(withPanel);
  const containerTemplate = panelButtons.find(button => (button.children ?? []).includes('容器'));
  assert.ok(containerTemplate !== undefined, 'the container template renders as a button');
  containerTemplate.props.onClick();
  assert.ok(
    host.userStyle().textContent.includes('display: flex'),
    'template declarations land inside the sheet',
  );

  // --- property dropdowns ---------------------------------------------------
  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  const panelView = renderRow();
  assert.ok(renderedText.includes('显示'), 'the panel lists Chinese property names');
  assert.ok(renderedText.includes('主轴方向'), 'property values carry Chinese labels');

  const selects = [];
  const collectSelects = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (node.type === 'select') selects.push(node);
    for (const child of node.children ?? []) collectSelects(child);
  };
  collectSelects(panelView);
  // Only declared properties get a row: the container template declared exactly
  // `display` and `flex-direction`, and `gap` shows up as a value field instead.
  const propertySelects = selects.filter(select => select.props['aria-label'] !== '添加属性');
  assert.strictEqual(propertySelects.length, 2, 'only declared enum properties get a dropdown');
  assert.ok(renderedClasses.includes('dshCc_propText'), 'a non-enum declaration gets a value field');
  assert.ok(
    renderedClasses.includes('dshCc_addProp'),
    'unset properties live behind the add-property menu',
  );

  const displaySelect = propertySelects.find(select => select.props['aria-label'] === '显示');
  assert.ok(displaySelect !== undefined, 'the display dropdown renders');
  displaySelect.props.onChange({ target: { value: 'flex' } });
  assert.ok(
    host.userStyle().textContent.includes('display: flex'),
    'a dropdown choice is written into the open rule',
  );

  // Writing the same property again must replace it, never stack a duplicate —
  // declarations are newline-separated, which an earlier build failed to match.
  hookIndex = 0;
  const panelAgain = renderRow();
  collectSelects(panelAgain);
  const displayAgain = selects.filter(select => select.props['aria-label'] === '显示').pop();
  displayAgain.props.onChange({ target: { value: 'grid' } });
  const written = host.userStyle().textContent;
  assert.strictEqual(
    (written.match(/display\s*:/g) ?? []).length,
    1,
    'writing the same property twice replaces it instead of stacking — got: ' + JSON.stringify(written),
  );
  assert.ok(/display:\s*grid/.test(written), 'the second value is the one that survives');

  // --- 2. offline fallback -------------------------------------------------
  const offline = await boot({
    stored: new Map([['dsh.custom-css', '.local{color:blue}']]),
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.ok(offline.userStyle(), 'a failed host route falls back to the browser-local sheet');
  assert.strictEqual(offline.userStyle().textContent, '.local{color:blue}');
  const renderOfflineRow = offline.registrations[0].component;
  hookSlots = [];
  hookIndex = 0;
  assert.doesNotThrow(() => { renderOfflineRow(); }, 'the row renders in the offline fallback mode too');

  // --- 3. first run seeds the default sheet from browser storage -----------
  let seeded;
  let listCalls = 0;
  await boot({
    stored: new Map([['dsh.custom-css', '.seed{color:green}']]),
    fetchImpl: async (url, init) => {
      if (url.endsWith('/list')) {
        listCalls += 1;
        return jsonResponse(listCalls === 1
          ? { ok: true, dir: '/tmp/custom-css', files: [], active: null }
          : { ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 17, mtime: 2 }], active: 'custom.css' });
      }
      if (url.endsWith('/create')) {
        seeded = JSON.parse(init.body);
        return jsonResponse({ ok: true, name: 'custom.css', bytes: 17 });
      }
      if (url.includes('/read')) {
        return jsonResponse({ ok: true, name: 'custom.css', css: '.seed{color:green}' });
      }
      throw new Error('unexpected request: ' + url);
    },
  });
  assert.ok(seeded, 'an empty directory gets a default sheet');
  assert.strictEqual(seeded.name, 'custom.css');
  assert.strictEqual(seeded.css, '.seed{color:green}', 'the previous browser-local sheet is migrated into the file');

  // --- 4. validation reports a value the engine refuses ---------------------
  const validated = await boot({
    supports: (property, value) => !(property === 'color' && value === 'notacolor'),
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({
          ok: true,
          dir: '/tmp/custom-css',
          files: [{ name: 'custom.css', bytes: 1, mtime: 1 }],
          active: 'custom.css',
        });
      }
      if (url.includes('/read')) {
        return jsonResponse({ ok: true, name: 'custom.css', css: '.a { color: notacolor; }' });
      }
      throw new Error('unexpected request: ' + url);
    },
  });
  renderedText.length = 0;
  hookSlots = [];
  hookIndex = 0;
  assert.doesNotThrow(() => { validated.registrations[0].component(); }, 'a sheet with a bad value still renders');
  assert.ok(
    renderedText.some(text => text.includes('第 1 行') && text.includes('notacolor')),
    'a rejected value is reported with its line number',
  );

  // --- 5. `!important` is a flag, not part of the value ---------------------
  const important = await boot({
    supports: (property, value) => !(property === 'color' && value === 'notacolor'),
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({
          ok: true,
          dir: '/tmp/custom-css',
          files: [{ name: 'custom.css', bytes: 1, mtime: 1 }],
          active: 'custom.css',
        });
      }
      if (url.includes('/read')) {
        return jsonResponse({ ok: true, name: 'custom.css', css: '.a { color: #fff !important; }' });
      }
      throw new Error('unexpected request: ' + url);
    },
  });
  renderedText.length = 0;
  hookSlots = [];
  hookIndex = 0;
  important.registrations[0].component();
  assert.ok(
    !renderedText.some(text => text.includes('值无效')),
    '`!important` is stripped before the engine judges the value',
  );

  // --- 5b. @property descriptor blocks are not declarations -----------------
  // The engine rejects `syntax` / `inherits` / `initial-value` as properties, so
  // asking CSS.supports() about them reported a perfectly good @property block
  // as three broken declarations. The stub below mirrors that engine behaviour.
  const descriptorStub = (property) => !['syntax', 'inherits', 'initial-value'].includes(property);
  const descriptorBlocks = await boot({
    supports: descriptorStub,
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({
          ok: true,
          dir: '/tmp/custom-css',
          files: [{ name: 'custom.css', bytes: 1, mtime: 1 }],
          active: 'custom.css',
        });
      }
      if (url.includes('/read')) {
        return jsonResponse({
          ok: true,
          name: 'custom.css',
          css: "@property --accent {\n  syntax: '<color>';\n  inherits: true;\n  initial-value: #2f9e6e;\n}\n.a { color: red; }",
        });
      }
      throw new Error('unexpected request: ' + url);
    },
  });
  renderedText.length = 0;
  hookSlots = [];
  hookIndex = 0;
  descriptorBlocks.registrations[0].component();
  assert.ok(
    !renderedText.some(text => text.includes('值无效') || text.includes('无法解析')),
    'a valid @property block reports nothing (descriptors are judged by their own rules)',
  );

  // ...and a descriptor that really is wrong still gets caught.
  const badDescriptor = await boot({
    supports: descriptorStub,
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({
          ok: true,
          dir: '/tmp/custom-css',
          files: [{ name: 'custom.css', bytes: 1, mtime: 1 }],
          active: 'custom.css',
        });
      }
      if (url.includes('/read')) {
        return jsonResponse({
          ok: true,
          name: 'custom.css',
          css: '@property --accent {\n  syntax: <color>;\n  inherits: maybe;\n}',
        });
      }
      throw new Error('unexpected request: ' + url);
    },
  });
  renderedText.length = 0;
  hookSlots = [];
  hookIndex = 0;
  badDescriptor.registrations[0].component();
  // The row renders the first issue plus a count, so both descriptors are
  // covered by asserting the message and the 「等 2 处」 tail.
  assert.ok(
    renderedText.some(text => text.includes('syntax 必须是带引号的字符串') && text.includes('等 2 处')),
    'both broken @property descriptors are reported (first message + count)',
  );

  // --- 6. completion stops after a semicolon --------------------------------
  const typing = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({
          ok: true,
          dir: '/tmp/custom-css',
          files: [{ name: 'custom.css', bytes: 1, mtime: 1 }],
          active: 'custom.css',
        });
      }
      if (url.includes('/read')) {
        return jsonResponse({ ok: true, name: 'custom.css', css: '.a { color: red; }' });
      }
      throw new Error('unexpected request: ' + url);
    },
  });
  hookIndex = 0;
  const typingElement = typing.registrations[0].component();
  const typingArea = findNode(typingElement, 'textarea');
  const offerOf = () => hookSlots.find(slot => slot !== null && typeof slot === 'object'
    && Array.isArray(slot.items) && typeof slot.word === 'string');

  // The caret sits right after `; ` — a fresh declaration, but the line already
  // holds a colon, so completing a value there would be plain wrong.
  const afterSemi = '.a { color: red; ';
  typingArea.props.onChange({
    target: { value: afterSemi, selectionStart: afterSemi.length },
    nativeEvent: { inputType: 'insertText' },
  });
  assert.strictEqual(offerOf(), undefined, 'no completion is offered straight after a semicolon');

  const midProperty = '.a { disp';
  typingArea.props.onChange({
    target: { value: midProperty, selectionStart: midProperty.length },
    nativeEvent: { inputType: 'insertText' },
  });
  const offered = offerOf();
  assert.ok(offered !== undefined, 'property completion still fires inside a block');
  assert.ok(offered.items.includes('display'), 'the property list still offers display');

  // Deleting is not typing: the list must close rather than re-open.
  const deleted = '.a { di';
  typingArea.props.onChange({
    target: { value: deleted, selectionStart: deleted.length },
    nativeEvent: { inputType: 'deleteContentBackward' },
  });
  assert.strictEqual(offerOf(), undefined, 'deleting does not raise the completion list');

  // --- the sheet switch -----------------------------------------------------
  // The file bar carries a pill switch: turning a sheet off must drop its styles
  // from the page while leaving its text on the Host, and the flip must be
  // written back. The double echoes the switch route so that write path runs.
  const toggles = [];
  const switched = await boot({
    fetchImpl: async (url, init) => {
      if (url.endsWith('/list')) {
        return jsonResponse({
          ok: true,
          dir: '/tmp/custom-css',
          files: [{ name: 'custom.css', bytes: 20, mtime: 1 }],
          active: 'custom.css',
          disabled: [],
        });
      }
      if (url.includes('/read')) {
        return jsonResponse({ ok: true, name: 'custom.css', css: HOST_SHEET });
      }
      if (url.endsWith('/toggle')) {
        const body = JSON.parse(init.body);
        toggles.push(body);
        return jsonResponse({ ok: true, name: body.name, enabled: body.enabled, disabled: body.enabled ? [] : [body.name] });
      }
      throw new Error('unexpected request: ' + url);
    },
  });
  assert.ok(switched.userStyle(), 'the sheet is applied while the switch is on');

  const findSwitch = (node) => {
    if (node === null || typeof node !== 'object') return null;
    if (node.type === 'button' && node.props?.role === 'switch') return node;
    for (const child of node.children ?? []) {
      const found = findSwitch(child);
      if (found !== null) return found;
    }
    return null;
  };

  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  const barView = switched.registrations[0].component();
  const switchButton = findSwitch(barView);
  assert.ok(switchButton !== null, 'the file bar renders a switch');
  assert.ok(renderedClasses.includes('dshCc_fileBar'), 'the file bar renders above the editor');
  assert.ok(renderedText.includes('custom.css'), 'the file bar names the sheet');
  assert.ok(renderedText.includes('CSS'), 'the file bar badges the language');
  assert.strictEqual(switchButton.props['aria-checked'], true, 'the switch starts on');
  assert.ok(String(switchButton.props.className).includes('dshCc_switchOn'), 'the on state is styled');

  switchButton.props.onClick();
  await settle();
  assert.strictEqual(toggles.length, 1, 'the switch writes to the Host');
  assert.deepStrictEqual(toggles[0], { name: 'custom.css', enabled: false }, 'the Host learns the sheet is off');
  assert.strictEqual(switched.userStyle(), undefined, 'a switched-off sheet contributes no styles');

  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  const offView = switched.registrations[0].component();
  const offSwitch = findSwitch(offView);
  assert.strictEqual(offSwitch.props['aria-checked'], false, 'the switch reports the off state');
  assert.ok(!String(offSwitch.props.className).includes('dshCc_switchOn'), 'the off state drops the on styling');
  assert.ok(renderedText.includes('已关闭'), 'the switch labels the off state');
  assert.strictEqual(switched.userStyle(), undefined, 'the style tag stays out while off');

  offSwitch.props.onClick();
  await settle();
  assert.deepStrictEqual(toggles[1], { name: 'custom.css', enabled: true }, 'switching back on writes again');
  assert.ok(switched.userStyle(), 'switching back on re-applies the sheet');
  assert.strictEqual(switched.userStyle().textContent, HOST_SHEET, 'the sheet text was never touched');

  // A Host half that predates the switch route must not break the row: the
  // toggle falls back to this browser instead of raising an error.
  const legacyToggles = [];
  const legacy = await boot({
    fetchImpl: async (url, init) => {
      if (url.endsWith('/list')) {
        return jsonResponse({
          ok: true,
          dir: '/tmp/custom-css',
          files: [{ name: 'custom.css', bytes: 20, mtime: 1 }],
          active: 'custom.css',
        });
      }
      if (url.includes('/read')) {
        return jsonResponse({ ok: true, name: 'custom.css', css: HOST_SHEET });
      }
      if (url.endsWith('/toggle')) {
        legacyToggles.push(JSON.parse(init.body));
        return jsonResponse({ ok: false, error: 'not-found' }, 404);
      }
      throw new Error('unexpected request: ' + url);
    },
  });
  hookIndex = 0;
  const legacyView = legacy.registrations[0].component();
  findSwitch(legacyView).props.onClick();
  await settle();
  assert.strictEqual(legacyToggles.length, 1, 'the switch still tries the Host');
  assert.strictEqual(legacy.userStyle(), undefined, 'a route-less Host still honours the switch');
  const legacySnapshot = JSON.parse(legacy.storage.get('dsh-custom-css:disabled') ?? 'null');
  assert.deepStrictEqual(legacySnapshot, ['custom.css'], 'the fallback records the switch for this browser');

  console.log('loader-smoke: OK — shape, slots, host apply, offline fallback, seeding, highlighting, completion, validation, rule panel, property dropdowns, sheet switch verified');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
