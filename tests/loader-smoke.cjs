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

/**
 * Begin one hook call, and mark the start of a render pass.
 *
 * A pass begins when the first hook runs after a test reset `hookIndex`, so the
 * effect slots collected by the previous pass stop being reachable. Keyed on "the
 * first hook of any kind" rather than on one particular hook: which hook the row
 * happens to call first is the row's business, and assuming it silently broke the
 * moment a hook was added in front of it.
 * @returns the index of this hook call within the pass.
 */
function beginHook() {
  if (hookIndex === 0) effects.length = 0;
  return hookIndex++;
}

/**
 * Shallow comparison of two deps arrays, the way React compares them.
 * @param left - the deps the effect last ran with.
 * @param right - the deps it was just registered with.
 * @returns true when React would consider them unchanged.
 */
function sameDeps(left, right) {
  if (left === undefined || right === undefined) return false;
  if (left.length !== right.length) return false;
  return left.every((entry, index) => Object.is(entry, right[index]));
}
/** Text nodes produced by the last render pass, for copy assertions. */
const renderedText = [];
/** Class names produced by the last render pass, for structure assertions. */
const renderedClasses = [];
/** Effect slots of the boot in progress, so a test can run them. */
const effects = [];
/** Pending timers of the boot in progress, so a test can fire them. */
const timers = [];

const fakeReact = {
  useState(initial) {
    const index = beginHook();
    if (hookSlots[index] === undefined) hookSlots[index] = typeof initial === 'function' ? initial() : initial;
    return [hookSlots[index], (next) => {
      hookSlots[index] = typeof next === 'function' ? next(hookSlots[index]) : next;
    }];
  },
  useEffect(effect, deps) {
    const index = beginHook();
    // React enough for a smoke test: keep the latest effect of this slot so a test
    // can run it, and its cleanup so an unmount can be simulated. Without this the
    // debounce / flush / unmount paths never executed at all.
    const slot = hookSlots[index] ?? { effect: null, cleanup: null, deps: undefined, ranDeps: undefined, ran: false };
    slot.effect = effect;
    // Deps decide whether the effect runs again: an array re-runs only when an
    // entry changed, no array runs after every commit. Re-running everything made
    // tests pass on behaviour React would never produce.
    slot.pending = !slot.ran || deps === undefined || !sameDeps(slot.ranDeps, deps);
    slot.deps = deps;
    hookSlots[index] = slot;
    effects.push(slot);
  },
  useRef(value) {
    const index = beginHook();
    if (hookSlots[index] === undefined) hookSlots[index] = { current: value };
    return hookSlots[index];
  },
  // Handed the accessors as bare references, exactly like React does — so an
  // accessor that reads `this` throws here the way it would in the browser.
  useSyncExternalStore(subscribe, getSnapshot) {
    beginHook();
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
async function boot({ fetchImpl, stored = new Map(), supports, dom = {} }) {
  const styleTags = [];
  const storage = new Map(stored);
  const calls = [];
  effects.length = 0;
  timers.length = 0;
  // A boot is a fresh component instance: reusing the previous boot's hook slots
  // handed it that instance's refs and its leftover cleanups, so an unmount here
  // ran a stale effect (and fetched through the previous sandbox).
  hookSlots = [];
  hookIndex = 0;

  /**
   * One node: the style-tag double and, when a test wants it, a real tree node with
   * attributes, children, geometry and listeners. The picker walks the tree, so the
   * fake has to be walkable.
   */
  const makeElement = (tagName, options = {}) => {
    const node = {
      tagName,
      className: options.className ?? '',
      dataset: {},
      style: {},
      id: '',
      // Like the DOM: assignment replaces the children, reading aggregates them.
      get textContent() {
        if (node.text !== undefined) return node.text;
        return (node.children ?? []).map(child => child.textContent ?? '').join('');
      },
      set textContent(value) {
        node.text = String(value);
        node.children = [];
      },
      attributes: { ...(options.attributes ?? {}) },
      children: [],
      parentElement: null,
      appendChild(child) {
        child.parentElement = node;
        node.children.push(child);
        return child;
      },
      removeChild(child) {
        const index = node.children.indexOf(child);
        if (index >= 0) node.children.splice(index, 1);
        return child;
      },
      remove() {
        const owner = node.parentElement ?? null;
        const list = owner === null ? styleTags : owner.children;
        const index = list.indexOf(node);
        if (index >= 0) list.splice(index, 1);
      },
      // Native listeners: the picker's toolbar is plain DOM, not React.
      handlers: {},
      addEventListener(type, handler) {
        if (node.handlers[type] === undefined) node.handlers[type] = [];
        node.handlers[type].push(handler);
      },
      removeEventListener(type, handler) {
        const list = node.handlers[type] ?? [];
        const index = list.indexOf(handler);
        if (index >= 0) list.splice(index, 1);
      },
      click() {
        for (const handler of [...(node.handlers.click ?? [])]) handler({ target: node, preventDefault() {} });
      },
      fire(type) {
        for (const handler of [...(node.handlers[type] ?? [])]) handler({ target: node, preventDefault() {} });
      },
      setAttribute(name, value) {
        node.attributes[name] = String(value);
      },
      getAttribute(name) {
        return name in node.attributes ? node.attributes[name] : null;
      },
      removeAttribute(name) {
        delete node.attributes[name];
      },
      getBoundingClientRect: () => options.rect ?? { top: 0, left: 0, width: 0, height: 0 },
    };
    return node;
  };

  const listeners = [];
  const documentElement = makeElement('html');
  const body = makeElement('body');
  documentElement.appendChild(body);
  const document = {
    documentElement,
    body,
    head: { appendChild: element => { styleTags.push(element); } },
    styleSheets: dom.styleSheets ?? [],
    querySelector(selector) {
      const match = /^style\[data-plugin-css="(.*)"\]$/.exec(selector);
      return match === null ? null : (styleTags.find(element => element.dataset.pluginCss === match[1]) ?? null);
    },
    querySelectorAll: selector => (dom.elements !== undefined ? [...dom.elements] : new Array(dom.matches === undefined ? 0 : dom.matches(selector)).fill(null)),
    createElement: makeElement,
    getElementById: id => styleTags.find(element => element.id === id) ?? null,
    elementFromPoint: () => dom.hit ?? null,
    addEventListener(type, handler, capture) {
      listeners.push({ type, handler, capture: capture === true });
    },
    removeEventListener(type, handler, capture) {
      const index = listeners.findIndex(entry => entry.type === type && entry.handler === handler && entry.capture === (capture === true));
      if (index >= 0) listeners.splice(index, 1);
    },
  };

  let loaded;
  const sandbox = {
    window: {
      __ModuleLoader__: { load(module) { loaded = module; } },
      innerWidth: dom.innerWidth ?? 1200,
      innerHeight: dom.innerHeight ?? 800,
      getComputedStyle: () => dom.computed ?? { getPropertyValue: () => '' },
    },
    document,
    localStorage: {
      getItem: key => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => { storage.set(key, String(value)); },
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return fetchImpl(url, init);
    },
    setTimeout: (fn, ms) => {
      const id = timers.length + 1;
      timers.push({ id, fn, ms, cancelled: false });
      return id;
    },
    clearTimeout: (id) => {
      const entry = timers.find((item) => item.id === id);
      if (entry !== undefined) entry.cancelled = true;
    },
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

  /** Run every pending timer once, then let the awaits settle. */
  const runTimers = async () => {
    for (const entry of [...timers]) {
      if (entry.cancelled) continue;
      entry.cancelled = true;
      entry.fn();
    }
    await settle();
  };
  /** Run the effects React would have run after a commit. */
  const runEffects = async () => {
    for (const slot of effects) {
      if (slot.effect === null || typeof slot.effect !== 'function' || slot.pending === false) continue;
      // React runs the previous cleanup just before re-running an effect whose deps
      // changed, and leaves it installed otherwise.
      if (typeof slot.cleanup === 'function') slot.cleanup();
      slot.cleanup = slot.effect();
      slot.ran = true;
      slot.ranDeps = slot.deps;
      slot.pending = false;
    }
    await settle();
  };
  /** Simulate an unmount: run the cleanups in reverse order. */
  const unmount = async () => {
    for (const slot of [...effects].reverse()) {
      if (typeof slot.cleanup === 'function') slot.cleanup();
      slot.cleanup = null;
    }
    await settle();
  };

  /** Dispatch to every listener of one type, as the browser would. */
  const dispatch = (type, event) => {
    for (const entry of [...listeners]) {
      if (entry.type === type) entry.handler(event);
    }
  };

  return {
    mod,
    loaded,
    styleTags,
    storage,
    calls,
    listeners,
    dispatch,
    document,
    dom,
    effects,
    timers,
    runTimers,
    runEffects,
    unmount,
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

  // A stylesheet with an unbalanced brace is dropped from that point on by the
  // browser while still looking fine as text — an orphaned declaration block from
  // a deleted selector did exactly that once. Count the braces too.
  const sheetText = rowSheets[0].textContent;
  const opens = (sheetText.match(/\{/g) ?? []).length;
  const closes = (sheetText.match(/\}/g) ?? []).length;
  assert.strictEqual(opens, closes, 'the injected stylesheet has balanced braces');

  // Overflow guards. Grid and flex items default to min-width:auto, and a
  // <select> reports its widest option as max-content, so one long option label
  // used to push the panel's cells out of the container. These rules are the fix
  // and are asserted here so a restyle cannot quietly drop them.
  for (const guard of [
    '.dshCc_propGrid>*{min-width:0}',
    '.dshCc_prop{align-items:center;display:flex;gap:8px;min-width:0}',
    'overflow-x:hidden',
    '.dshCc_select{box-sizing:border-box;',
    '.dshCc_addPropWrap{width:100%;max-width:none}',
    '.dshCc_panel>*{flex:none}',
    '.dshCc_partName{flex:none;padding:1px 7px;border-radius:6px;background:var(--dsw-alias-markdown-tag);',
    '.dshCc_select{justify-content:space-between}',
    // The shipped settings-row spec: 36px tall, 18px pill, 14px text.
    '.dshCc_select{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:36px;padding:0 14px;',
    'border-radius:18px;background:var(--dsw-alias-bg-module-platform);',
    '.dshCc_propText{flex:1;min-width:0;max-width:100%;box-sizing:border-box;height:36px;padding:0 14px;',
  ]) {
    assert.ok(rowSheets[0].textContent.includes(guard), 'overflow guard is present: ' + guard);
  }

  // Width contract of the editor container. The shell is a single-column grid and
  // every row states width:100% plus box-sizing:border-box; without the latter a
  // row with padding measures wider than the shell and pushes its children out of
  // the container (measured: body 616px inside a 600px shell).
  const boundsGuards = [
    '.dshCc_shell{box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1fr)',
    '.dshCc_fileBar{box-sizing:border-box;',
    '.dshCc_main{box-sizing:border-box;',
    '.dshCc_foot{box-sizing:border-box;',
    '.dshCc_panel{box-sizing:border-box;',
    '.dshCc_propGrid{box-sizing:border-box;',
  ];
  for (const guard of boundsGuards) {
    assert.ok(rowSheets[0].textContent.includes(guard), 'explicit box: ' + guard);
  }

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
  /** Every string inside a node, flattened — labels sit at different depths. */
  const textOf = (node) => {
    if (typeof node === 'string') return node;
    if (node === null || typeof node !== 'object') return '';
    return (node.children ?? []).map(textOf).join('');
  };
  /** The first button whose text includes this label. */
  const buttonWith = (node, label) => {
    let found = null;
    (function walk(current) {
      if (found !== null || current === null || typeof current !== 'object') return;
      if (current.type === 'button' && textOf(current).includes(label)) {
        found = current;
        return;
      }
      for (const child of current.children ?? []) walk(child);
    })(node);
    return found;
  };
  // Six controls in one row was too many: the picker and the file selector stay out,
  // everything else unfolds from one menu — the same trigger + menu chrome the file
  // picker uses, which is the shipped dropdown's own styling.
  assert.ok(renderedText.includes('更多操作'), 'the actions fold behind one menu trigger');
  assert.ok(renderedText.includes('拾取元素'), 'the picker stays in reach without opening the menu');
  for (const label of ['打开文件', '导入', '导出', '重置']) {
    assert.ok(!renderedText.includes(label), 'the ' + label + ' action is not inline any more');
  }
  buttonWith(element, '更多操作').props.onClick();
  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  const menuView = renderRow();
  for (const label of ['打开文件', '导入', '导出', '重置']) {
    assert.ok(renderedText.includes(label), 'the menu renders the ' + label + ' action');
  }
  assert.ok(renderedClasses.some(entry => entry.includes('dshCc_menuItemDanger')), '重置 keeps its destructive styling in the menu');
  assert.ok(renderedClasses.some(entry => entry.includes('dshCc_menuHint')), 'each menu item says what it does');
  buttonWith(menuView, '更多操作').props.onClick();
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

  // The panel moved under the code and lays its rows out as a grid: both grids
  // must render, and the panel must be a sibling of the code field inside the
  // body row rather than a separate side column.
  assert.ok(renderedClasses.includes('dshCc_propGrid'), 'declarations lay out as a grid');
  assert.ok(renderedClasses.includes('dshCc_tplGrid'), 'templates lay out as a grid');

  // The selector field and its × are one control: the button sits inside the
  // field's own box, so the field spans the panel like every other control.
  assert.ok(renderedClasses.includes('dshCc_panelField'), 'the selector renders as a single field');
  const fieldNode = (function find(node) {
    if (node === null || typeof node !== 'object') return null;
    if (String(node.props?.className ?? '') === 'dshCc_panelField') return node;
    for (const child of node.children ?? []) {
      const hit = find(child);
      if (hit !== null) return hit;
    }
    return null;
  })(withPanel);
  const fieldChildren = (fieldNode.children ?? []).map(child => String(child?.props?.className ?? ''));
  assert.ok(fieldChildren.includes('dshCc_panelName'), 'the selector input is inside the field');
  assert.ok(fieldChildren.includes('dshCc_panelClose'), 'the close control is inside the field too');
  const bodyNode = (function find(node) {
    if (node === null || typeof node !== 'object') return null;
    if (String(node.props?.className ?? '') === 'dshCc_main') return node;
    for (const child of node.children ?? []) {
      const hit = find(child);
      if (hit !== null) return hit;
    }
    return null;
  })(withPanel);
  const bodyChildren = (bodyNode.children ?? []).map(child => String(child?.props?.className ?? ''));
  assert.ok(bodyChildren.includes('dshCc_editorWrap'), 'the code field is a child of the body row');
  assert.ok(bodyChildren.includes('dshCc_panel'), 'the panel is a sibling of the code field, below it');

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

  // Panel dropdowns are own-element menus — a native <select> popup cannot be
  // styled — so the harness reads each Dropdown element by its props instead.
  const dropdowns = [];
  /** Text fields of the open rule's panel, in render order. */
  const collectPropTexts = (node) => {
    const found = [];
    (function walk(current) {
      if (current === null || typeof current !== 'object') return;
      if (String(current.props?.className ?? '').includes('dshCc_propText')) found.push(current);
      for (const child of current.children ?? []) walk(child);
    })(node);
    return found;
  };

  const collectDropdowns = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (typeof node.type === 'function' && Array.isArray(node.props?.items)) dropdowns.push(node);
    for (const child of node.children ?? []) collectDropdowns(child);
  };
  collectDropdowns(panelView);
  const propertyDropdowns = dropdowns.filter(item => item.props.ariaLabel !== '添加属性');
  assert.strictEqual(propertyDropdowns.length, 2, 'only declared enum properties get a dropdown');
  assert.ok(renderedClasses.includes('dshCc_propText'), 'a non-enum declaration gets a value field');

  // The add-property control sits below the declarations grid: after reading the
  // summary of what the rule declares, that is where the next action belongs.
  const treeOrder = [];
  const walkOrder = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (typeof node.props?.className === 'string') treeOrder.push(node.props.className);
    if (typeof node.type === 'function' && node.props?.ariaLabel === '添加属性') treeOrder.push('ADD-PROPERTY');
    for (const child of node.children ?? []) walkOrder(child);
  };
  walkOrder(panelView);
  assert.ok(
    treeOrder.indexOf('ADD-PROPERTY') !== -1
      && treeOrder.indexOf('ADD-PROPERTY') > treeOrder.indexOf('dshCc_propGrid'),
    'the add-property control sits below the declarations',
  );

  const addMenu = dropdowns.find(item => item.props.ariaLabel === '添加属性');
  assert.ok(addMenu !== undefined, 'the add-property menu renders');
  const menuItems = addMenu.props.items;
  const menuGroups = [...new Set(menuItems.map(item => item.group).filter(Boolean))];
  assert.ok(menuGroups.length >= 6, 'the add-property menu is grouped, got ' + menuGroups.length);
  const menuProps = menuItems.map(item => item.value);
  assert.ok(
    !menuProps.includes('gap'),
    'a property the rule already declares (gap) is not offered again',
  );
  assert.ok(menuProps.includes('margin-top'), 'the dictionary offers margin-top');
  assert.ok(menuProps.includes('grid-template-columns'), 'the dictionary offers grid properties');
  assert.ok(menuProps.length >= 90, 'the dictionary is broad, got ' + menuProps.length);
  assert.ok(!menuProps.includes('display'), 'nor is display, also already declared');

  // Adding a free property writes its seed, and the panel then renders it as a
  // labelled text field whose placeholder is the dictionary hint.
  addMenu.props.onPick('margin-top');
  assert.ok(
    host.userStyle().textContent.includes('margin-top: 0'),
    'a free property is added with its seed value',
  );
  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  const withFree = renderRow();
  const freeInputs = [];
  const collectInputs = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (node.type === 'input' && String(node.props?.className ?? '').includes('dshCc_propText')) {
      freeInputs.push(node);
    }
    for (const child of node.children ?? []) collectInputs(child);
  };
  collectInputs(withFree);
  const marginInput = freeInputs.find(input => input.props['aria-label'] === '上外边距');
  assert.ok(marginInput !== undefined, 'a free property carries its Chinese name');
  assert.strictEqual(
    marginInput.props.placeholder,
    '0 / 8px / auto',
    'the dictionary hint becomes the placeholder',
  );

  const displayDropdown = propertyDropdowns.find(item => item.props.ariaLabel === '显示');
  assert.ok(displayDropdown !== undefined, 'the display dropdown renders');
  assert.strictEqual(displayDropdown.props.display, '弹性布局', 'the trigger shows the Chinese label');
  const displayItems = displayDropdown.props.items;
  assert.ok(
    displayItems.some(item => item.value === 'flex' && item.label === '弹性布局' && item.selected === true),
    'the current value is marked in the menu',
  );
  assert.ok(
    displayItems.some(item => item.value === '' && item.label === '（删除此项）'),
    'the menu can remove a property',
  );
  displayDropdown.props.onPick('grid');
  assert.ok(
    host.userStyle().textContent.includes('display: grid'),
    'a dropdown choice is written into the open rule',
  );

  // Writing the same property again must replace it, never stack a duplicate —
  // declarations are newline-separated, which an earlier build failed to match.
  hookIndex = 0;
  const panelAgain = renderRow();
  dropdowns.length = 0;
  collectDropdowns(panelAgain);
  const displayAgain = dropdowns.find(item => item.props.ariaLabel === '显示');
  displayAgain.props.onPick('grid');
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

  // The requested layout: one container holding header / body / footer, rather
  // than three separate boxes that only look adjacent.
  const shellClasses = (function walk(node, out = []) {
    if (node === null || typeof node !== 'object') return out;
    if (typeof node.props?.className === 'string') out.push(node.props.className);
    for (const child of node.children ?? []) walk(child, out);
    return out;
  })(barView);
  for (const part of ['dshCc_shell', 'dshCc_fileBar', 'dshCc_main', 'dshCc_foot']) {
    assert.ok(shellClasses.includes(part), 'the editor container renders ' + part);
  }
  const shellNode = (function find(node) {
    if (node === null || typeof node !== 'object') return null;
    if (String(node.props?.className ?? '').includes('dshCc_shell')) return node;
    for (const child of node.children ?? []) {
      const hit = find(child);
      if (hit !== null) return hit;
    }
    return null;
  })(barView);
  const directChildren = (shellNode.children ?? []).map(child => String(child?.props?.className ?? ''));
  for (const part of ['dshCc_fileBar', 'dshCc_main', 'dshCc_foot']) {
    assert.ok(directChildren.includes(part), 'the container holds ' + part + ' as a direct child');
  }

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

  // --- shorthand parts ------------------------------------------------------
  // A space-separated shorthand gets one field per component, each carrying its
  // own hint; the value written back is recombined, and collapsed back to the
  // shortest equivalent form so editing one part keeps the sheet tidy.
  const partsSheet = '.parts{flex: 1 0 100%;gap: 8px;margin: 8px 12px;border-radius: 8px / 12px}';
  textarea.props.onChange({
    target: { value: partsSheet, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  const partsView = renderRow();
  findNode(partsView, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  const partsPanel = renderRow();
  assert.ok(renderedClasses.includes('dshCc_partRow'), 'a shorthand renders a row of fields');

  const partInputs = [];
  const collectPartInputs = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (node.type === 'input' && String(node.props?.className ?? '').includes('dshCc_propText')) {
      partInputs.push(node);
    }
    for (const child of node.children ?? []) collectPartInputs(child);
  };
  collectPartInputs(partsPanel);

  const flexBasis = partInputs.find(input => input.props['aria-label'] === '弹性简写 · 基准尺寸');
  assert.ok(flexBasis !== undefined, 'flex exposes one field per component');
  assert.strictEqual(flexBasis.props.value, '100%', 'the field values come from the declaration');
  assert.strictEqual(
    flexBasis.props.placeholder,
    'auto / 0 / 240px',
    'the placeholder is the value hint',
  );
  assert.ok(
    renderedText.includes('放大') && renderedText.includes('基准尺寸'),
    'each field carries its own name as a label',
  );
  assert.ok(renderedClasses.includes('dshCc_partCell'), 'part fields are wrapped in label cells');

  const marginInputs = partInputs.filter(input => String(input.props['aria-label'] ?? '').startsWith('外边距 · '));
  assert.strictEqual(marginInputs.length, 4, 'a four-sided shorthand expands to four fields');
  assert.deepStrictEqual(
    marginInputs.map(input => input.props.value),
    ['8px', '12px', '8px', '12px'],
    'margin: 8px 12px expands the way CSS defines it',
  );

  const gapInputs = partInputs.filter(input => String(input.props['aria-label'] ?? '').startsWith('间距 · '));
  assert.strictEqual(gapInputs.length, 2, 'gap exposes row and column');
  assert.deepStrictEqual(gapInputs.map(input => input.props.value), ['8px', '8px'], 'gap: 8px fills both');

  const radiusInputs = partInputs.filter(input => String(input.props['aria-label'] ?? '').startsWith('圆角 · '));
  assert.strictEqual(radiusInputs.length, 0, 'the slash form of border-radius keeps the free field');

  flexBasis.props.onChange({ target: { value: 'auto' } });
  assert.ok(
    host.userStyle().textContent.includes('flex: 1 0 auto'),
    'editing one part recombines the declaration',
  );

  gapInputs[1].props.onChange({ target: { value: '12px' } });
  assert.ok(
    host.userStyle().textContent.includes('gap: 8px 12px'),
    'a differing part is written as two tokens',
  );

  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  const partsAgain = renderRow();
  collectPartInputs(partsAgain);
  const gapAgain = partInputs.filter(input => String(input.props['aria-label'] ?? '').startsWith('间距 · ')).slice(-2);
  gapAgain[1].props.onChange({ target: { value: '8px' } });
  assert.ok(
    host.userStyle().textContent.includes('gap: 8px;'),
    'matching parts collapse back to the shortest form',
  );

  // --- writeDeclaration: normalised body vs original offsets ---------------
  // `normaliseBlock` inserts a `;` and therefore lengthens the body. The fast path
  // used to slice the ORIGINAL sheet with offsets measured on that normalised copy,
  // so one missing semicolon earlier in the block shifted the cut and ate the `}`.
  const ragged = '.ragged{ color: red\n  display: block }';
  textarea.props.onChange({
    target: { value: ragged, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  renderedClasses.length = 0;
  const raggedView = renderRow();
  findNode(raggedView, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
  hookIndex = 0;
  renderedClasses.length = 0;
  const raggedPanel = renderRow();
  dropdowns.length = 0;
  collectDropdowns(raggedPanel);
  const raggedDisplay = dropdowns.find(item => item.props.ariaLabel === '显示');
  assert.ok(raggedDisplay !== undefined, 'the display dropdown renders for the ragged rule');
  raggedDisplay.props.onPick('flex');
  const afterFast = host.userStyle().textContent;
  assert.ok(afterFast.includes('display: flex'), 'the fast path wrote the new value');
  assert.strictEqual(
    (afterFast.match(/\}/g) ?? []).length,
    1,
    'the closing brace survives the fast path — got: ' + JSON.stringify(afterFast),
  );
  assert.ok(afterFast.includes('color: red;'), 'the missing semicolon is normalised in');

  // --- a comment sharing the declaration's chunk ---------------------------
  // Chunks are split on `;`, so `/* note */ display: block` starts with `/`: the
  // property went unrecognised and a second copy was appended instead of replacing.
  const commented = '.cmt{ /* note */\n  display: block }';
  textarea.props.onChange({
    target: { value: commented, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  renderedClasses.length = 0;
  const commentedView = renderRow();
  findNode(commentedView, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
  hookIndex = 0;
  renderedClasses.length = 0;
  const commentedPanel = renderRow();
  dropdowns.length = 0;
  collectDropdowns(commentedPanel);
  const commentedDisplay = dropdowns.find(item => item.props.ariaLabel === '显示');
  commentedDisplay.props.onPick('grid');
  const afterComment = host.userStyle().textContent;
  assert.strictEqual(
    (afterComment.match(/display\s*:/g) ?? []).length,
    1,
    'a declaration under a comment is replaced, not duplicated — got: ' + JSON.stringify(afterComment),
  );
  assert.ok(afterComment.includes('/* note */'), 'the comment survives the rewrite');

  // --- a comment between the property name and its colon -------------------
  // Legal CSS (comments count as whitespace between tokens), and the panel lists
  // the declaration. The fast path's head pattern, though, only accepts comments
  // *before* the name: it returned null and the unguarded `[1]` threw a TypeError
  // straight out of the dropdown's onPick, leaving the panel dead.
  const splitComment = '.two{ /* a */ display/* b */: block }';
  textarea.props.onChange({
    target: { value: splitComment, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  renderedClasses.length = 0;
  const splitView = renderRow();
  findNode(splitView, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
  hookIndex = 0;
  renderedClasses.length = 0;
  const splitPanel = renderRow();
  dropdowns.length = 0;
  collectDropdowns(splitPanel);
  const splitDisplay = dropdowns.find(item => item.props.ariaLabel === '显示');
  assert.ok(splitDisplay !== undefined, 'the display dropdown renders for the split declaration');
  assert.doesNotThrow(() => { splitDisplay.props.onPick('grid'); }, 'the comment before the colon does not break the writer');
  const afterSplit = host.userStyle().textContent;
  assert.ok(
    /display\s*(?:\/\*[\s\S]*?\*\/\s*)*: grid/.test(afterSplit),
    'the pick landed in the sheet — got: ' + JSON.stringify(afterSplit),
  );
  assert.strictEqual(
    (afterSplit.match(/display/g) ?? []).length,
    1,
    'the declaration is replaced in place, not duplicated — got: ' + JSON.stringify(afterSplit),
  );
  assert.ok(
    afterSplit.includes('/* a */') && afterSplit.includes('/* b */'),
    'both comments survive the rewrite — got: ' + JSON.stringify(afterSplit),
  );

  // --- a brace inside a string must not swallow the next rule --------------
  // parseRules finds a rule's body end by counting braces to the matching close.
  // That inner scan used to be string-blind: `content: "}"` ended the body at the
  // brace inside the string, so the panel listed a truncated body and a write from
  // it landed inside the string literal — destroying the rule that followed.
  const braceString = '.a::after{ content: "}"; }\n.b{ color: red }';
  textarea.props.onChange({
    target: { value: braceString, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  renderedClasses.length = 0;
  const braceView = renderRow();
  findNode(braceView, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
  hookIndex = 0;
  renderedClasses.length = 0;
  const bracePanel = renderRow();
  const braceFields = [];
  (function collectBraceFields(node) {
    if (node === null || typeof node !== 'object') return;
    if (String(node.props?.className ?? '').includes('dshCc_propText')) braceFields.push(node);
    for (const child of node.children ?? []) collectBraceFields(child);
  })(bracePanel);
  assert.deepStrictEqual(
    braceFields.map(field => field.props['aria-label']),
    ['生成内容'],
    'the panel lists only the first rule — a body that ran past its closing brace would show the second rule too',
  );
  assert.strictEqual(
    braceFields[0].props.value,
    '"}"',
    'the value keeps the brace that lives inside the string',
  );
  braceFields[0].props.onChange({
    target: { value: '"["', selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  const afterBrace = host.userStyle().textContent;
  assert.ok(
    afterBrace.includes('.b{ color: red }'),
    'the rule after the string is untouched — got: ' + JSON.stringify(afterBrace),
  );
  assert.strictEqual(
    (afterBrace.match(/\{/g) ?? []).length,
    (afterBrace.match(/\}/g) ?? []).length,
    'the sheet stays balanced — got: ' + JSON.stringify(afterBrace),
  );

  // --- strings, url()s and nested blocks are opaque to the scanners ---------
  // An unquoted url() may legally carry a semicolon (every base64 data URI does),
  // and a nested rule keeps its own: splitting on either truncated the value,
  // invented declaration rows and could drop a nested block's closing brace.
  const opaque = '.uri { background-image: url(data:image/svg+xml;charset=utf8,%3Csvg/%3E); color: red; }'
    + '\n.nest { color: red; &:hover { color: blue; background: green } }';
  textarea.props.onChange({
    target: { value: opaque, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  renderedClasses.length = 0;
  const scanOpaqueView = renderRow();
  assert.ok(
    !renderedClasses.includes('dshCc_error'),
    'a data URI with a semicolon is not reported as broken — status: ' + JSON.stringify(renderedText.slice(-2)),
  );
  findNode(scanOpaqueView, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
  hookIndex = 0;
  renderedClasses.length = 0;
  const scanUriPanel = renderRow();
  const scanUriFields = collectPropTexts(scanUriPanel);
  const scanImageField = scanUriFields.find(field => field.props['aria-label'] === '背景图');
  assert.strictEqual(
    scanImageField?.props.value,
    'url(data:image/svg+xml;charset=utf8,%3Csvg/%3E)',
    'the whole url() is the value, semicolon included — fields: '
      + JSON.stringify(scanUriFields.map(field => [field.props['aria-label'], field.props.value])),
  );

  findNode(scanUriPanel, 'pre').props.onClick({ target: { getAttribute: () => '1' } });
  hookIndex = 0;
  renderedClasses.length = 0;
  const scanNestPanel = renderRow();
  const scanNestFields = collectPropTexts(scanNestPanel);
  assert.deepStrictEqual(
    scanNestFields.map(field => field.props['aria-label']),
    ['文字颜色'],
    'only the outer rule declares anything: the nested rule is not declaration territory',
  );
  scanNestFields[0].props.onChange({
    target: { value: 'rebeccapurple', selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  const scanAfterNest = host.userStyle().textContent;
  assert.ok(
    scanAfterNest.includes('&:hover { color: blue; background: green }'),
    'editing the outer rule leaves the nested block intact — got: ' + JSON.stringify(scanAfterNest),
  );
  assert.strictEqual(
    (scanAfterNest.match(/\{/g) ?? []).length,
    (scanAfterNest.match(/\}/g) ?? []).length,
    'the sheet stays balanced — got: ' + JSON.stringify(scanAfterNest),
  );

  // --- an at-rule statement before a block ---------------------------------
  // An @import statement ends with its own semicolon. Keeping it in the prelude
  // buffer glued it to the next block, which was then judged as a style rule (so a
  // legal @font-face reported broken descriptors) and dropped from the rule list
  // (so the rule after it was not clickable at all).
  const scanImported = '@import "a.css";\nbody { color: red }\n@font-face { font-family: "X"; src: url("x.woff2") }';
  textarea.props.onChange({
    target: { value: scanImported, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  renderedClasses.length = 0;
  renderedText.length = 0;
  const scanImportView = renderRow();
  assert.ok(
    !renderedClasses.includes('dshCc_error'),
    'a legal @font-face after @import is not reported as broken — status: ' + JSON.stringify(renderedText.slice(-2)),
  );
  const scanImportHtml = findNode(scanImportView, 'pre').props.dangerouslySetInnerHTML.__html;
  assert.ok(
    /data-rule="0">[\s\S]{0,8}body/.test(scanImportHtml),
    'the rule after @import is a click target — markup: ' + JSON.stringify(scanImportHtml.slice(0, 220)),
  );

  // --- a pseudo-class selector is clickable as a whole ---------------------
  // The selector is tokenised on its punctuation, so '.a', ':' and 'hover' are
  // separate runs; only the run ending exactly at the selector end used to be a
  // click target, which left the rule name itself inert.
  const scanPseudo = '.hovered:hover { color: red }';
  textarea.props.onChange({
    target: { value: scanPseudo, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  renderedClasses.length = 0;
  const scanPseudoView = renderRow();
  const scanPseudoHtml = findNode(scanPseudoView, 'pre').props.dangerouslySetInnerHTML.__html;
  assert.ok(
    /data-rule="0">\.hovered</.test(scanPseudoHtml),
    'the rule name is a click target for a pseudo-class selector — markup: ' + JSON.stringify(scanPseudoHtml.slice(0, 220)),
  );

  // --- a blocking duplicate selector opens the rule that was clicked --------
  // Two rules may share a selector; looking the open one up by text bound the
  // panel (and every write it made) to the first of them.
  const scanDupes = '.dup { color: red }\n.dup { display: block }';
  textarea.props.onChange({
    target: { value: scanDupes, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  renderedClasses.length = 0;
  const scanDupView = renderRow();
  findNode(scanDupView, 'pre').props.onClick({ target: { getAttribute: () => '1' } });
  hookIndex = 0;
  renderedClasses.length = 0;
  const scanDupPanel = renderRow();
  dropdowns.length = 0;
  collectDropdowns(scanDupPanel);
  assert.ok(
    dropdowns.some(item => item.props.ariaLabel === '显示'),
    'clicking the second rule opens the second rule (its display dropdown renders)',
  );
  assert.ok(
    !collectPropTexts(scanDupPanel).some(field => field.props['aria-label'] === '文字颜色'),
    'and not the first rule, which declares color',
  );

  // --- a comment after the colon is part of the value ----------------------
  // Reading the value from the comment-blanked copy showed text that is not in
  // the file, and the writer's head pattern then deleted the comment.
  const scanCommentValue = '.cmtvalue{ font-family: /* fallback */ Arial, sans-serif }';
  textarea.props.onChange({
    target: { value: scanCommentValue, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  const scanCommentView = renderRow();
  findNode(scanCommentView, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
  hookIndex = 0;
  const scanCommentPanel = renderRow();
  const scanCommentField = collectPropTexts(scanCommentPanel).find(field => field.props['aria-label'] === '字体');
  assert.strictEqual(
    scanCommentField?.props.value,
    '/* fallback */ Arial, sans-serif',
    'the panel shows the value as written, comment included',
  );
  scanCommentField.props.onChange({
    target: { value: '/* fallback */ Arial, sans-serif', selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  assert.ok(
    host.userStyle().textContent.includes('/* fallback */ Arial, sans-serif'),
    'writing the value back keeps the comment — got: ' + JSON.stringify(host.userStyle().textContent),
  );

  // --- a completion must match the caret it is applied to ------------------
  // The list can outlive the caret that opened it: clicking inside the textarea
  // neither blurs nor re-runs completion. Accepting then spliced the remembered
  // word at the moved caret, deleting characters and inserting it in the wrong
  // place.
  const scanPartial = '.a { disp';
  textarea.props.onChange({
    target: { value: scanPartial, selectionStart: scanPartial.length },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  const scanPartialView = renderRow();
  const scanSuggestions = [];
  (function collectSuggestions(node) {
    if (node === null || typeof node !== 'object') return;
    if (String(node.props?.className ?? '') === 'dshCc_suggestItem') scanSuggestions.push(node);
    for (const child of node.children ?? []) collectSuggestions(child);
  })(scanPartialView);
  const scanDisplayItem = scanSuggestions.find(node => (node.children ?? []).includes('display'));
  assert.ok(scanDisplayItem !== undefined, 'the completion list offers display for the typed word');
  findNode(scanPartialView, 'textarea').props.ref.current = { selectionStart: 0, scrollTop: 0, clientHeight: 140 };
  assert.doesNotThrow(() => {
    scanDisplayItem.props.onMouseDown({ preventDefault() {} });
  }, 'accepting a completion whose caret moved does not throw');
  assert.strictEqual(
    host.userStyle().textContent,
    scanPartial,
    'a completion whose caret moved is dropped instead of splicing at the wrong offset',
  );

  // --- a failed write must not claim the sheet is saved --------------------
  // The debounce used to report "已保存" as soon as the write returned, success or
  // not, so the footer read "已保存" right beside its own failure notice.
  const scanFailing = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({
          ok: true,
          dir: '/tmp/custom-css',
          files: [{ name: 'custom.css', bytes: 20, mtime: 1 }],
          active: 'custom.css',
          disabled: [],
        });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.x{color:red}' });
      if (url.endsWith('/write')) throw new Error('disk full');
      throw new Error('unexpected request: ' + url);
    },
  });
  hookIndex = 0;
  renderedText.length = 0;
  const scanFailingRow = scanFailing.registrations[0].component();
  await scanFailing.runEffects();
  findNode(scanFailingRow, 'textarea').props.onChange({
    target: { value: '.x{color:blue}', selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  await scanFailing.runTimers();
  hookIndex = 0;
  renderedText.length = 0;
  scanFailing.registrations[0].component();
  assert.ok(
    renderedText.some(text => text.includes('保存失败')),
    'the write failure is reported — status was: ' + JSON.stringify(renderedText),
  );
  assert.ok(
    !renderedText.some(text => text.includes('已保存')),
    'a failed write never claims the sheet is saved — status was: ' + JSON.stringify(renderedText),
  );

  // --- the completion path skips strings as well ---------------------------
  // The parser, the validator, the highlighter, the reader, the writer and the
  // splitter all learned that a string is opaque. Completion had not, and it is
  // the one place a user meets the difference directly: `content: "}"` is how you
  // clear a float, and the brace inside it closed the block on paper — so every
  // completion after that rule silently stopped working.
  const typeInto = (text) => {
    textarea.props.onChange({
      target: { value: text, selectionStart: text.length },
      nativeEvent: { inputType: 'insertText' },
    });
    hookIndex = 0;
    renderedClasses.length = 0;
    return renderRow();
  };
  // The suggestion list is rendered from state, so a rendered list is the honest
  // signal; its slot is discovered from behaviour rather than hard-coded, because
  // the row's hook order is its own business.
  const stateOf = () => hookSlots.find(slot => slot !== null && typeof slot === 'object'
    && Array.isArray(slot.items) && typeof slot.word === 'string') ?? null;
  const suggestionsIn = (view) => {
    const labels = [];
    (function walk(node) {
      if (node === null || typeof node !== 'object') return;
      if (String(node.props?.className ?? '') === 'dshCc_suggestItem') {
        labels.push((node.children ?? []).find(child => typeof child === 'string'));
      }
      for (const child of node.children ?? []) walk(child);
    })(view);
    return labels;
  };

  const plainSuggest = typeInto('.a { color: red; disp');
  const plainState = stateOf();
  assert.deepStrictEqual(
    [...(plainState?.items ?? [])],
    ['display'],
    'the baseline: a property is completed normally',
  );
  assert.strictEqual(plainState.kind, '属性', 'and it is offered as a property name');
  assert.deepStrictEqual(suggestionsIn(plainSuggest), ['display'], 'and the list is on screen');

  const braceSuggest = typeInto('.a { content: "}"; disp');
  assert.deepStrictEqual(
    [...(stateOf()?.items ?? [])],
    ['display'],
    'a brace inside a string does not stop the completions that follow — '
      + 'the block is still open, got: ' + JSON.stringify(suggestionsIn(braceSuggest)),
  );

  const quotedSemicolon = typeInto('.a { color: red; display: ";" fl');
  const quotedState = stateOf();
  assert.strictEqual(
    quotedState?.kind,
    '值',
    'a semicolon inside a string does not start a new declaration: the caret is still '
      + 'in the display declaration, so its values are offered — got kind '
      + JSON.stringify(quotedState?.kind) + ' with ' + JSON.stringify(quotedState?.items),
  );
  assert.deepStrictEqual(
    [...quotedState.items],
    ['flex'],
    'and the offered value is the display keyword itself',
  );

  typeInto('.a { color: red; display: "f');
  assert.strictEqual(
    stateOf(),
    null,
    'nothing is completed inside an unterminated string — the caret is in a value, not at a boundary',
  );

  // The same check has to be right about a *closing* quote that is itself escaped:
  // the naive "the last character is the quote, so it closed" rule says this string
  // is finished, and the caret then gets a value list from inside a string.
  typeInto('.a { color: red; display: "ab\\"');
  assert.strictEqual(
    stateOf(),
    null,
    'a string ending in an escaped quote is still open',
  );

  // And the other direction: a string that really is closed must not suppress the
  // completion that follows it, or the fix would be a one-way door.
  typeInto('.a { color: red; display: "x" fl');
  assert.deepStrictEqual(
    [...(stateOf()?.items ?? [])],
    ['flex'],
    'a closed string does not stop the completion after it',
  );

  // --- the last three string-blind spots -----------------------------------
  // 1. A comment between the property name and its colon is legal CSS — comments
  //    are whitespace between tokens — so it must not be reported as two
  //    unparsable declarations.
  const inlineComment = '.a { color/* x */: red }';
  textarea.props.onChange({
    target: { value: inlineComment, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  renderedClasses.length = 0;
  renderedText.length = 0;
  renderRow();
  assert.ok(
    !renderedClasses.includes('dshCc_error'),
    'a comment between the name and the colon is accepted — status: ' + JSON.stringify(renderedText.slice(-2)),
  );

  // 2. The normaliser restores a missing `;` before a newline — inside the code, not
  //    inside a comment that merely reads like it.
  const codeComment = '.a { /* the fallback\n  color: red */ display: block }';
  textarea.props.onChange({
    target: { value: codeComment, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  renderedClasses.length = 0;
  const codeCommentView = renderRow();
  findNode(codeCommentView, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
  hookIndex = 0;
  renderedClasses.length = 0;
  const codeCommentPanel = renderRow();
  dropdowns.length = 0;
  collectDropdowns(codeCommentPanel);
  const codeCommentDisplay = dropdowns.find(item => item.props.ariaLabel === '显示');
  assert.ok(codeCommentDisplay !== undefined, 'the display dropdown renders beside the comment');
  codeCommentDisplay.props.onPick('grid');
  const afterCodeComment = host.userStyle().textContent;
  assert.ok(
    afterCodeComment.includes('/* the fallback\n  color: red */'),
    'writing another declaration does not edit the comment reading — got: ' + JSON.stringify(afterCodeComment),
  );
  assert.ok(afterCodeComment.includes('display: grid'), 'and the write itself landed');

  // 3. Deleting a declaration keeps a real comment that shared its chunk — and does
  //    not resurrect text that only looks like one because it sits in a string.
  const commentLookalike = '.a { content: "/* x */"; color: red }';
  textarea.props.onChange({
    target: { value: commentLookalike, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  renderedClasses.length = 0;
  const lookalikeView = renderRow();
  findNode(lookalikeView, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
  hookIndex = 0;
  renderedClasses.length = 0;
  const lookalikePanel = renderRow();
  const lookalikeField = collectPropTexts(lookalikePanel).find(field => field.props['aria-label'] === '生成内容');
  assert.ok(lookalikeField !== undefined, 'the content row renders');
  lookalikeField.props.onChange({
    target: { value: '', selectionStart: 0 },
    nativeEvent: { inputType: 'deleteContentBackward' },
  });
  const afterLookalike = host.userStyle().textContent;
  assert.ok(
    !afterLookalike.includes('/* x */'),
    'a string is not carried over as a comment — got: ' + JSON.stringify(afterLookalike),
  );
  assert.ok(
    afterLookalike.includes('color: red'),
    'the sibling declaration survives the delete — got: ' + JSON.stringify(afterLookalike),
  );

  // --- the saved indicator must not be claimed by a stale write ------------
  let releaseWrite = null;
  const slow = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({
          ok: true,
          dir: '/tmp/custom-css',
          files: [{ name: 'custom.css', bytes: 20, mtime: 1 }],
          active: 'custom.css',
          disabled: [],
        });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.slow{color:red}' });
      if (url.endsWith('/write')) {
        await new Promise((resolve) => { releaseWrite = resolve; });
        return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      }
      throw new Error('unexpected request: ' + url);
    },
  });
  hookIndex = 0;
  renderedText.length = 0;
  const slowRow = slow.registrations[0].component();
  await slow.runEffects();
  const slowArea = findNode(slowRow, 'textarea');
  slowArea.props.onChange({
    target: { value: '.slow{color:blue}', selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  assert.strictEqual(slow.timers.filter(entry => !entry.cancelled).length, 1, 'typing schedules one write');
  await slow.runTimers();
  assert.ok(releaseWrite !== null, 'the write is in flight');
  slowArea.props.onChange({
    target: { value: '.slow{color:green}', selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  releaseWrite();
  await settle();
  await settle();
  hookIndex = 0;
  renderedText.length = 0;
  slow.registrations[0].component();
  assert.ok(
    !renderedText.some(text => text.includes('已保存')),
    'a stale save does not claim the sheet is saved — status was: ' + JSON.stringify(renderedText),
  );

  // --- emptying the selector input must not strand the panel ---------------
  textarea.props.onChange({
    target: { value: '.keep{ display: block }', selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  renderedClasses.length = 0;
  const keepView = renderRow();
  findNode(keepView, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
  hookIndex = 0;
  renderedClasses.length = 0;
  const keepPanel = renderRow();
  const nameInputs = [];
  (function collectNames(node) {
    if (node === null || typeof node !== 'object') return;
    if (String(node.props?.className ?? '').includes('dshCc_panelName')) nameInputs.push(node);
    for (const child of node.children ?? []) collectNames(child);
  })(keepPanel);
  assert.strictEqual(nameInputs.length, 1, 'the selector input renders');
  nameInputs[0].props.onChange({ target: { value: '' } });
  hookIndex = 0;
  renderedClasses.length = 0;
  const afterClear = renderRow();
  assert.ok(renderedClasses.includes('dshCc_panel'), 'the panel survives an emptied selector');
  assert.ok(
    host.userStyle().textContent.includes('.keep'),
    'the sheet keeps its last valid selector',
  );

  // --- strings are not structure -------------------------------------------
  // CSS strings may legally contain \`{\`, \`}\`, \`;\` and \`:\`. Every scanner in this file used to
  // treat those as structure: \`content: "}"\` broke the depth tracking (so the next
  // rule got wrong offsets and clicking it opened the wrong block), and
  // \`url("data:…;base64,…")\` was split in half at the semicolon.
  const stringy = '.after::after{ content: "}"; }\n.b{ display: block }';
  textarea.props.onChange({
    target: { value: stringy, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  const stringyView = renderRow();
  const stringyHtml = findNode(stringyView, 'pre').props.dangerouslySetInnerHTML.__html;
  assert.ok(stringyHtml.includes('data-rule="0"'), 'the first rule is a click target');
  assert.ok(
    stringyHtml.includes('data-rule="1"'),
    'a brace inside a string does not swallow the next rule',
  );
  assert.ok(
    !renderedClasses.includes('dshCc_error'),
    'a valid sheet with a string brace is not reported as broken — status: ' + JSON.stringify(renderedText.slice(-2)),
  );

  findNode(stringyView, 'pre').props.onClick({ target: { getAttribute: () => '1' } });
  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  const secondPanel = renderRow();
  const nameFields = [];
  (function collectNameFields(node) {
    if (node === null || typeof node !== 'object') return;
    if (String(node.props?.className ?? '').includes('dshCc_panelName')) nameFields.push(node);
    for (const child of node.children ?? []) collectNameFields(child);
  })(secondPanel);
  assert.strictEqual(nameFields.length, 1, 'the selector field renders');
  // Identify the opened rule by what the panel lists: the first rule declares
  // `content`, the second declares `display`.
  dropdowns.length = 0;
  collectDropdowns(secondPanel);
  assert.ok(
    dropdowns.some(item => item.props.ariaLabel === '显示'),
    'clicking the second selector opens the second rule (its display dropdown renders)',
  );

  // A data URI keeps its semicolon: the panel must show the whole value.
  const uri = '.uri{ background-image: url("data:image/png;base64,AAA"); color: red }';
  textarea.props.onChange({
    target: { value: uri, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  renderedClasses.length = 0;
  const uriView = renderRow();
  findNode(uriView, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
  hookIndex = 0;
  renderedClasses.length = 0;
  const uriPanel = renderRow();
  const uriInputs = [];
  (function collectUriInputs(node) {
    if (node === null || typeof node !== 'object') return;
    if (node.type === 'input' && String(node.props?.className ?? '').includes('dshCc_propText')) uriInputs.push(node);
    for (const child of node.children ?? []) collectUriInputs(child);
  })(uriPanel);
  const uriField = uriInputs.find(input => input.props['aria-label'] === '背景图');
  assert.ok(uriField !== undefined, 'the background-image field renders');
  assert.strictEqual(
    uriField.props.value,
    'url("data:image/png;base64,AAA")',
    'a semicolon inside a string does not truncate the value',
  );

  // --- closing the panel must not drop an unsaved edit ---------------------
  // The unmount path flushes rather than discarding the pending write. Until the
  // harness learned to run effects and cleanups, this never executed at all.
  const writes = [];
  const closeable = await boot({
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
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.x{color:red}' });
      if (url.endsWith('/write')) {
        writes.push(JSON.parse(init.body));
        return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      }
      throw new Error('unexpected request: ' + url);
    },
  });
  hookIndex = 0;
  const closeableView = closeable.registrations[0].component();
  await closeable.runEffects();
  const closeableArea = findNode(closeableView, 'textarea');
  closeableArea.props.onChange({
    target: { value: '.x{color:rebeccapurple}', selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  assert.strictEqual(writes.length, 0, 'the write is still debounced');
  await closeable.unmount();
  assert.strictEqual(writes.length, 1, 'unmounting flushes the pending write instead of dropping it');
  assert.strictEqual(
    writes[0].css,
    '.x{color:rebeccapurple}',
    'the flushed write carries the text that was typed',
  );

  // --- element picker -------------------------------------------------------
  // Two architectural promises are what these tests are really about: the session
  // lives outside the settings row (so picking keeps working after the settings page
  // closes, which is the only way to reach the rest of the interface), and it does
  // not take the page hostage (no dimming, no intercepted clicks).
  const node = (tag, options = {}) => {
    const element = {
      tagName: tag.toUpperCase(),
      className: options.className ?? '',
      attributes: { ...(options.attributes ?? {}) },
      children: [],
      parentElement: options.parent ?? null,
      getAttribute(name) {
        return name in element.attributes ? element.attributes[name] : null;
      },
      setAttribute(name, value) {
        element.attributes[name] = String(value);
      },
      removeAttribute(name) {
        delete element.attributes[name];
      },
      getBoundingClientRect: () => options.rect ?? { top: 0, left: 0, width: 100, height: 40 },
    };
    return element;
  };
  const dialog = node('div', {
    className: 'dsh-settings-surface',
    attributes: { 'aria-modal': 'true' },
    rect: { top: 0, left: 0, width: 1200, height: 800 },
  });
  const rowInsideDialog = node('div', {
    className: 'dsh-music-list',
    parent: dialog,
    rect: { top: 10, left: 10, width: 560, height: 400 },
  });
  // A mutable rect: scrolling is simulated by moving it, which is exactly what a
  // fixed-position box has to react to.
  const movingRect = { top: 40, left: 20, width: 320, height: 180 };
  const pickedTarget = node('div', {
    className: '_card_1fywu_26 dsh-music-qq-head',
    attributes: { 'aria-label': 'QQ 音乐' },
    parent: dialog,
    rect: movingRect,
  });
  dialog.children.push(rowInsideDialog, pickedTarget);
  const outer = node('div', { className: 'dsh-app', rect: { top: 0, left: 0, width: 1280, height: 900 } });
  dialog.parentElement = outer;
  outer.children.push(dialog);

  const picker = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.x{color:red}' });
      if (url.endsWith('/write')) return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      throw new Error('unexpected request: ' + url);
    },
    dom: {
      hit: pickedTarget,
      // The aria label repeats in this interface, so the selector that cannot collide
      // has to win the default; that is a ranking decision, not a preference.
      matches: selector => (selector.includes('aria-label') ? 3 : 1),
      styleSheets: [(() => {
        const style = ['--dsw-alias-bg-layer-1'];
        style.getPropertyValue = name => (name === '--dsw-alias-bg-layer-1' ? '#101010' : '');
        return { cssRules: [{ style }] };
      })()],
      computed: { getPropertyValue: name => (name === 'background-color' ? '#101010' : '') },
    },
  });
  const panel = () => picker.document.body.children.find(child => child.className === 'dshCc_pickPanel');
  const boxOf = () => picker.document.body.children.find(child => child.className === 'dshCc_pickBox');
  const info = () => (panel()?.children ?? [])[0]?.children?.[0]?.textContent ?? '';
  const candidateTexts = () => ((panel()?.children ?? [])[1]?.children ?? []).map(child => child.textContent);
  const tokenTexts = () => ((panel()?.children ?? [])[2]?.children ?? []).map(child => child.textContent);
  const panelButton = (label) => {
    let found;
    (function walk(current) {
      if (found !== undefined || current === null || typeof current !== 'object') return;
      if (String(current.tagName ?? '').toLowerCase() === 'button' && current.textContent === label) {
        found = current;
        return;
      }
      for (const child of current.children ?? []) walk(child);
    })(panel());
    return found;
  };
  const arm = async () => {
    hookIndex = 0;
    renderedText.length = 0;
    const view = picker.registrations[0].component();
    await picker.runEffects();
    buttonWith(view, '拾取元素').props.onClick();
    hookIndex = 0;
    renderedText.length = 0;
    const armed = picker.registrations[0].component();
    await picker.runEffects();
    return armed;
  };

  const armedView = await arm();
  assert.ok(buttonWith(armedView, '取消拾取') !== undefined, 'the row shows the picker is armed');
  assert.ok(panel() !== undefined, 'and a floating panel appears');
  assert.strictEqual(
    Object.keys(dialog.attributes).includes('data-dshCc-picking'),
    false,
    'the settings surface is never touched: its close button and everything else keep working',
  );
  assert.ok(
    picker.listeners.some(entry => entry.type === 'click'),
    'a click confirms the highlighted element — the gesture people expect',
  );
  assert.ok(
    picker.listeners.some(entry => entry.type === 'pointermove') && picker.listeners.some(entry => entry.type === 'keydown'),
    'and hovering and the keys drive the level',
  );

  picker.dispatch('pointermove', { clientX: 30, clientY: 50 });
  assert.strictEqual(boxOf().dataset.label, '320×180', 'hovering previews the element under the pointer');
  assert.strictEqual(
    info(),
    '点击一个元素开始（悬停只预览，不会改变已选）',
    'but hovering never changes what is selected — got: ' + JSON.stringify(info()),
  );


  // A click locks the element and inspects it — and the click itself is left to the
  // page, which is what lets the settings surface be closed (or anything else be
  // used) in the middle of a pick.
  let cancelled = false;
  picker.dispatch('click', {
    target: pickedTarget,
    clientX: 30,
    clientY: 50,
    preventDefault() { cancelled = true; },
    stopPropagation() {},
  });
  assert.strictEqual(cancelled, false, 'the page keeps its click');
  assert.ok(panel() !== undefined, 'and the pick session stays open');
  assert.ok(
    info().includes('dsh-music-qq-head'),
    'the panel now names what was clicked — got: ' + JSON.stringify(info()),
  );
  assert.deepStrictEqual(
    candidateTexts(),
    ['div.dsh-music-qq-head语义类名仅此一个', 'div[aria-label="QQ 音乐"]无障碍名3 个命中', 'div[class*="_card_"]哈希容错仅此一个'],
    'with the candidates ranked by what survives an upgrade',
  );
  assert.deepStrictEqual(
    tokenTexts(),
    ['background-color: var(--dsw-alias-bg-layer-1)'],
    'and the token the element resolves to',
  );

  // Scrolling must move the locked box: it is fixed, so nothing else would.
  const lockedBox = () => picker.document.body.children.find(child => child.className === 'dshCc_pickBox dshCc_pickLocked');
  assert.strictEqual(lockedBox().style.top, '40px', 'the locked box starts on the element');
  movingRect.top = -120;
  picker.dispatch('scroll', {});
  assert.strictEqual(
    lockedBox().style.top, '-120px',
    'a scroll re-places it — a fixed box does not follow on its own',
  );
  assert.ok(
    info().includes('dsh-music-qq-head'),
    'and re-placing does not disturb what is selected',
  );
  movingRect.top = 40;
  picker.dispatch('scroll', {});

  // Clicking elsewhere moves the selection; the session is still open.
  picker.dom.hit = rowInsideDialog;
  picker.dispatch('click', { target: rowInsideDialog, clientX: 5, clientY: 5, preventDefault() {}, stopPropagation() {} });
  assert.ok(
    info().includes('dsh-music-list'),
    'a second click moves the selection — got: ' + JSON.stringify(info()),
  );
  assert.ok(panel() !== undefined, 'without leaving the picker');
  picker.dom.hit = pickedTarget;
  picker.dispatch('click', { target: pickedTarget, clientX: 30, clientY: 50, preventDefault() {}, stopPropagation() {} });

  // Level walking, by key and by slider.
  picker.dispatch('keydown', { key: 'ArrowUp', preventDefault() {} });
  assert.ok(info().includes('1200×800'), 'ArrowUp walks to the parent — got: ' + JSON.stringify(info()));
  picker.dispatch('keydown', { key: 'ArrowUp', preventDefault() {} });
  assert.ok(info().includes('dsh-app'), 'and again to the grandparent — got: ' + JSON.stringify(info()));

  // The reported bug: after going all the way up, coming back down must retrace the
  // route, not walk into the current node's first child (a different branch).
  picker.dispatch('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.ok(
    info().includes('1200×800'),
    'ArrowDown retraces to the parent it came from — got: ' + JSON.stringify(info()),
  );
  picker.dispatch('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.ok(
    info().includes('dsh-music-qq-head'),
    'and back to the element that was clicked — got: ' + JSON.stringify(info()),
  );
  picker.dispatch('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.ok(
    info().includes('dsh-music-qq-head'),
    'one step further down does not wander off: the anchor is the bottom',
  );

  // A sibling is a different branch, so it re-anchors.
  picker.dispatch('keydown', { key: 'ArrowLeft', preventDefault() {} });
  assert.ok(info().includes('dsh-music-list'), 'ArrowLeft moves to the sibling — got: ' + JSON.stringify(info()));
  picker.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
  assert.ok(info().includes('dsh-music-qq-head'), 'ArrowRight moves back');
  const slider = ((panel()?.children ?? [])[3]?.children ?? []).find(child => child.className === 'dshCc_pickSlider');
  assert.ok(slider !== undefined, 'the panel carries a depth slider');
  slider.value = '1';
  slider.fire('input');
  assert.ok(info().includes('1200×800'), 'the slider walks the same chain as the keys');
  assert.strictEqual(slider.value, '1', 'the slider keeps the position the user dragged it to');
  slider.value = '2';
  slider.fire('input');
  assert.ok(info().includes('dsh-app'), 'and it reaches the grandparent');
  slider.value = '0';
  slider.fire('input');
  assert.strictEqual(boxOf().dataset.label, '320×180', 'while its zero is always the element that was clicked');
  assert.strictEqual(slider.value, '0', 'and it shows that');
  picker.dispatch('keydown', { key: 'ArrowUp', preventDefault() {} });
  assert.strictEqual(slider.value, '1', 'the keys move the slider too — one level per press');
  picker.dispatch('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.strictEqual(slider.value, '0', 'and back',
  );

  // Enter commits the chosen candidate, with the token rather than the literal.
  picker.dispatch('keydown', { key: 'Enter', preventDefault() {} });
  assert.strictEqual(
    picker.userStyle().textContent,
    '.x{color:red}\n\ndiv.dsh-music-qq-head {\n  background-color: var(--dsw-alias-bg-layer-1);\n}',
    'the rule is written with the token, not the resolved literal',
  );
  assert.ok(panel() === undefined, 'and the panel is gone once it commits');

  // The session must outlive the row: closing the settings page is how a user reaches
  // the rest of the interface to pick there.
  await arm();
  picker.dispatch('pointermove', { clientX: 30, clientY: 50 });
  await picker.unmount();
  assert.ok(panel() !== undefined, 'closing the settings row does not kill the pick session');
  picker.dom.hit = rowInsideDialog;
  picker.dispatch('click', { target: rowInsideDialog, clientX: 5, clientY: 5, preventDefault() {}, stopPropagation() {} });
  assert.ok(
    info().includes('dsh-music-list'),
    'and a click still selects after the row is gone — got: ' + JSON.stringify(info()),
  );
  picker.dispatch('keydown', { key: 'ArrowUp', preventDefault() {} });
  assert.ok(info().includes('1200×800'), 'the level keys still work');
  picker.dispatch('keydown', { key: 'Enter', preventDefault() {} });
  assert.ok(
    picker.userStyle().textContent.includes('div.dsh-settings-surface'),
    'a pick made after the row unmounted still lands in the sheet — got: ' + JSON.stringify(picker.userStyle().textContent),
  );
  assert.ok(panel() === undefined, 'and the panel cleans itself up');

  // Inserting has to end where the work continues: the settings surface back on screen
  // and the caret inside the rule that was just written.
  const careful = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.x{color:red}' });
      if (url.endsWith('/write')) return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      throw new Error('unexpected request: ' + url);
    },
    dom: { hit: pickedTarget, matches: () => 1, computed: { getPropertyValue: () => '' } },
  });
  // The settings entry the plugin is allowed to click, and a record of the click.
  let settingsClicked = false;
  const settingsEntry = node('button', { attributes: { 'aria-label': '设置' } });
  settingsEntry.click = () => { settingsClicked = true; };
  careful.dom.elements = [settingsEntry];

  hookIndex = 0;
  const carefulView = careful.registrations[0].component();
  await careful.runEffects();
  buttonWith(carefulView, '拾取元素').props.onClick();
  hookIndex = 0;
  careful.registrations[0].component();
  await careful.runEffects();
  careful.dispatch('pointermove', { clientX: 30, clientY: 50 });
  careful.dispatch('click', { target: pickedTarget, clientX: 30, clientY: 50, preventDefault() {}, stopPropagation() {} });
  careful.dispatch('keydown', { key: 'Enter', preventDefault() {} });
  assert.strictEqual(settingsClicked, true, 'the settings entry is clicked for the user');

  // The settings surface is now (notionally) back: mount the row and let it consume the
  // pending rule, which also parks the caret.
  hookIndex = 0;
  renderedClasses.length = 0;
  const returnedView = careful.registrations[0].component();
  const editor = findNode(returnedView, 'textarea');
  const caretCalls = [];
  editor.props.ref.current = {
    selectionStart: 0,
    scrollTop: 0,
    clientHeight: 140,
    focus() {},
    setSelectionRange(start, end) { caretCalls.push([start, end]); },
  };
  await careful.runEffects();
  hookIndex = 0;
  renderedClasses.length = 0;
  careful.registrations[0].component();
  assert.ok(
    renderedClasses.some(entry => entry.includes('dshCc_panelName')),
    'the rule the picker wrote is open in the panel',
  );
  assert.deepStrictEqual(
    caretCalls.length, 1,
    'and the caret was placed once — calls: ' + JSON.stringify(caretCalls),
  );
  const writtenSheet = careful.userStyle().textContent;
  const expectedCaret = writtenSheet.lastIndexOf('{') + 2;
  assert.deepStrictEqual(
    caretCalls[0], [expectedCaret, expectedCaret],
    'inside the new rule, ready to type — expected ' + expectedCaret + ' for ' + JSON.stringify(writtenSheet),
  );

  // Escape and 取消 both end it.
  await arm();
  picker.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  assert.ok(panel() === undefined, 'Escape takes the panel down');
  assert.ok(!picker.listeners.some(entry => entry.type === 'keydown'), 'and detaches the session');
  hookIndex = 0;
  renderedText.length = 0;
  picker.registrations[0].component();
  await picker.runEffects();

  await arm();
  panelButton('取消').click();
  assert.ok(panel() === undefined, '取消 on the panel takes it down too');
  assert.ok(boxOf() === undefined, 'along with the highlight box');

  // An element whose selector is already in the sheet must open that rule instead of
  // appending a second one — the fastest way to make a sheet unmaintainable.
  const existing = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: 'div[aria-label="QQ 音乐"] { color: red }' });
      if (url.endsWith('/write')) return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      throw new Error('unexpected request: ' + url);
    },
    dom: { hit: pickedTarget, matches: () => 1 },
  });
  hookIndex = 0;
  const existingView = existing.registrations[0].component();
  await existing.runEffects();
  buttonWith(existingView, '拾取元素').props.onClick();
  hookIndex = 0;
  existing.registrations[0].component();
  await existing.runEffects();
  existing.dispatch('pointermove', { clientX: 1, clientY: 1 });
  existing.dispatch('keydown', { key: 'Enter', preventDefault() {} });
  assert.strictEqual(
    existing.userStyle().textContent,
    'div[aria-label="QQ 音乐"] { color: red }',
    'an existing rule is opened, not duplicated',
  );

  console.log('loader-smoke: OK — shape, slots, host apply, offline fallback, seeding, highlighting, completion, validation, rule panel, property dropdowns, sheet switch, shorthand parts, save state machine, string-aware scanning, comments in a declaration head, opaque url()s and nested blocks, comments in every scanner, panel binding, click targets, completion guards, element picker, unmount flush verified');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
