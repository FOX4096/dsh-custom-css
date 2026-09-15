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
const source = fs.readFileSync(path.join(pluginRoot, 'lib', 'client.js'), 'utf8');
/**
 * The module text this suite runs.
 *
 * A few internals are exposed by name through `__probe`: the dropdown placement math, the
 * find bar's scan and its hit markup, and the formatter. Each is pure, each decides something
 * a user sees directly, and nothing else about the text changes — the export is additive and
 * the plugin never looks at it. Everything else is asserted through the components, as usual.
 */
const EXPORTS_ANCHOR = `		exports.apply = apply;
		exports.inject = inject;`;
assert.ok(source.includes(EXPORTS_ANCHOR), 'the module still exports the way this suite patches in');
const code = source.replace(EXPORTS_ANCHOR, EXPORTS_ANCHOR + `
		exports.__probe = { placeMenu, searchHits, hitAtOrAfter, markMatches, highlightCss, formatCss, externalChange };`);

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
const renderedText = [];/** Class names produced by the last render pass, for structure assertions. */
const renderedClasses = [];
/** Effect slots of the boot in progress, so a test can run them. */
const effects = [];
/** Pending timers of the boot in progress, so a test can fire them. */
const timers = [];
/** Repeating timers of the boot in progress (the external-change poll). */
const intervals = [];

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
    return { type, props, children: children.flat() };
  },
};

/**
 * Decode the CSS escapes `cssString` writes into an attribute value.
 * @param raw - the literal's inner text.
 * @returns the decoded value.
 */
function decodeCssString(raw) {
  return raw.replace(/\\(?:([0-9a-fA-F]{1,6}) ?|(.))/g, (whole, hex, character) => (
    hex === undefined ? character : String.fromCodePoint(parseInt(hex, 16))
  ));
}

/** One compound selector: tag, `.class`, `#id`, `[attr]`, `[attr op "value"]`, `:nth-child()`. */
const COMPOUND_PART = /([a-zA-Z*][\w-]*)|\.([\w-]+)|#([\w-]+)|:nth-child\((\d+)\)|\[([^\]=*^$~|]+)(?:([*^$~|]?=)"((?:[^"\\]|\\.)*)")?\]/g;

/**
 * Split a selector into comma-separated parts, each a list of `{ combinator, compound }`
 * steps in document order.
 *
 * Brackets and quotes are respected, so the space or comma inside `[aria-label="a, b"]` is
 * not mistaken for a combinator — the same reason the plugin's own scanners treat strings
 * as opaque.
 * @param selector - the selector text.
 * @returns one step list per comma-separated part.
 */
function parseSelector(selector) {
  const parts = [[]];
  let compound = '';
  let combinator = ' ';
  let depth = 0;
  let quoted = false;
  const flush = () => {
    if (compound === '') return;
    parts[parts.length - 1].push({ combinator, compound });
    compound = '';
    combinator = ' ';
  };
  for (const character of String(selector)) {
    if (quoted) {
      compound += character;
      if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      compound += character;
      continue;
    }
    if (character === '[') depth += 1;
    if (character === ']') depth -= 1;
    if (depth === 0 && character === ',') {
      flush();
      parts.push([]);
      continue;
    }
    if (depth === 0 && character === '>') {
      flush();
      combinator = '>';
      continue;
    }
    if (depth === 0 && /\s/.test(character)) {
      flush();
      continue;
    }
    compound += character;
  }
  flush();
  return parts.filter(part => part.length > 0);
}

/**
 * Whether one node matches every part of one compound.
 *
 * A string literal that carries a raw newline is refused outright, the way a browser's
 * tokenizer ends the string there and the whole selector fails to parse.
 * @param node - a real Element or one of the doubles.
 * @param compound - the compound selector text.
 * @returns true when every part matches.
 */
function matchesCompound(node, compound) {
  if (node === null || node === undefined) return false;
  if (/"[^"]*\n/.test(compound)) throw new Error('invalid selector: unescaped newline in a string');
  const tag = String(node.tagName ?? '').toLowerCase();
  const classes = String(node.className ?? '').split(/\s+/).filter(Boolean);
  // `:root` is the node at the top of the chain in this bed; it counts as a part like any
  // other, so a compound of only `:root` is a match rather than an unparsed selector.
  const rootRequired = compound.includes(':root');
  if (rootRequired && (node.parentElement ?? null) !== null) return false;
  const rest = compound.replace(/:root/g, '');
  const readAttribute = (name) => {
    // `class` is the one attribute the doubles keep beside their attribute map.
    if (name === 'class') return String(node.className ?? '');
    if (typeof node.getAttribute === 'function') return node.getAttribute(name);
    return node.attributes?.[name] ?? null;
  };
  let seen = rootRequired;
  COMPOUND_PART.lastIndex = 0;
  let part;
  while ((part = COMPOUND_PART.exec(rest)) !== null) {
    seen = true;
    const [, name, className, id, nth, attribute, operator, rawValue] = part;
    if (name !== undefined && name !== '*' && tag !== name.toLowerCase()) return false;
    if (className !== undefined && !classes.includes(className)) return false;
    if (id !== undefined && String(readAttribute('id') ?? '') !== id) return false;
    if (/:root/.test(compound) && (node.parentElement ?? null) !== null) return false;
    if (nth !== undefined) {
      const siblings = node.parentElement?.children ?? [];
      if (siblings.indexOf(node) !== Number(nth) - 1) return false;
    }
    if (attribute !== undefined) {
      const value = readAttribute(attribute);
      if (value === null || value === undefined) return false;
      if (operator !== undefined && rawValue !== undefined) {
        const wanted = decodeCssString(rawValue);
        const actual = String(value);
        if (operator === '=' && actual !== wanted) return false;
        if (operator === '*=' && !actual.includes(wanted)) return false;
        if (operator === '^=' && !actual.startsWith(wanted)) return false;
        if (operator === '$=' && !actual.endsWith(wanted)) return false;
      }
    }
  }
  return seen;
}

/**
 * Whether a node matches a selector: comma lists, descendant and child combinators.
 * @param node - a real Element or one of the doubles.
 * @param selector - the selector text.
 * @returns true when the selector matches.
 */
function matchesSelector(node, selector) {
  return parseSelector(selector).some((steps) => {
    if (steps.length === 0) return false;
    let current = node;
    if (!matchesCompound(current, steps[steps.length - 1].compound)) return false;
    for (let index = steps.length - 2; index >= 0; index -= 1) {
      const relation = steps[index + 1].combinator;
      const wanted = steps[index].compound;
      const parent = current.parentElement ?? null;
      if (relation === '>') {
        if (!matchesCompound(parent, wanted)) return false;
        current = parent;
        continue;
      }
      let found = null;
      let walk = parent;
      while (walk !== null && walk !== undefined) {
        if (matchesCompound(walk, wanted)) {
          found = walk;
          break;
        }
        walk = walk.parentElement ?? null;
      }
      if (found === null) return false;
      current = found;
    }
    return true;
  });
}

/**
 * The node under a point: the last one in document order whose box contains it, which is
 * how a browser resolves overlapping boxes (later siblings paint on top) and how a child
 * beats the parent that also contains the point.
 * @param nodes - the pool, in document order.
 * @param x - viewport x.
 * @param y - viewport y.
 * @returns the node, or null when the point hits nothing.
 */
function hitTest(nodes, x, y) {
  let found = null;
  for (const node of nodes ?? []) {
    if (typeof node.getBoundingClientRect !== 'function') continue;
    const box = node.getBoundingClientRect();
    if (!(box.width > 0) || !(box.height > 0)) continue;
    const left = box.left ?? 0;
    const top = box.top ?? 0;
    if (x >= left && x <= left + box.width && y >= top && y <= top + box.height) found = node;
  }
  return found;
}

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
/**
 * Which sheet a request is about, as the fake Host would see it.
 *
 * `/read` carries it in the query, `/write` and `/restore` in the JSON body; anything else (the
 * listing, the switch) is about no single sheet and gets null.
 * @param url - the request URL.
 * @param init - the fetch init.
 * @returns the sheet name, or null.
 */
function nameOfRequest(url, init) {
  if (typeof url !== 'string') return null;
  if (url.includes('/read')) {
    const match = /[?&]name=([^&]*)/.exec(url);
    return match === null ? null : decodeURIComponent(match[1]);
  }
  if (url.includes('/write') || url.includes('/restore')) {
    try {
      const body = JSON.parse(init?.body ?? '{}');
      return typeof body.name === 'string' ? body.name : null;
    }
    catch {
      return null;
    }
  }
  return null;
}

async function boot({ fetchImpl, stored = new Map(), supports, dom = {} }) {
  const styleTags = [];
  const storage = new Map(stored);
  const calls = [];
  /**
   * The fake filesystem's revisions, per sheet name.
   *
   * The client's external-change policy is "the revision moved and the editor is clean → take the
   * disk copy; the revision moved and the editor has unsaved work → ask". Making every case in
   * this file construct a revision by hand would be a hundred chances to get it wrong, so the
   * fetch wrapper below stamps one on every read and bumps it on every write.
   */
  const revisions = new Map();
  effects.length = 0;
  timers.length = 0;
  intervals.length = 0;
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
    // The external-change poll only runs while the page is on screen (`visibilitychange` is the
    // other half of it). A boot starts visible; a case can switch it off by assigning here.
    visibilityState: 'visible',
    head: { appendChild: element => { styleTags.push(element); } },
    styleSheets: dom.styleSheets ?? [],
    querySelector(selector) {
      const match = /^style\[data-plugin-css="(.*)"\]$/.exec(selector);
      return match === null ? null : (styleTags.find(element => element.dataset.pluginCss === match[1]) ?? null);
    },
    querySelectorAll: selector => {
      // `dom.probe` is the deliberate simulation seam: a test that needs the engine to
      // REFUSE a selector (or answer with a count the pool cannot express) says so here.
      // Everything else is answered from the pool by actually matching the selector, so
      // "how many elements does this match" is a real question in this bed.
      if (typeof dom.probe === 'function') return new Array(dom.probe(selector)).fill(null);
      return (dom.nodes ?? []).filter(node => matchesSelector(node, selector));
    },
    createElement: makeElement,
    getElementById: id => styleTags.find(element => element.id === id) ?? null,
    // Real hit testing over the pool, so "the pointer is over this element" is decided by
    // the coordinates the test dispatches rather than by a constant.
    elementFromPoint: (x, y) => hitTest(dom.nodes, x, y),
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
      // Per-element when the case supplies a function (the var() check asks about specific
      // elements), one shared double otherwise.
      getComputedStyle: element => (typeof dom.computed === 'function'
        ? dom.computed(element)
        : (dom.computed ?? { getPropertyValue: () => '' })),
    },
    document,
    localStorage: {
      getItem: key => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => { storage.set(key, String(value)); },
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      const response = await fetchImpl(url, init);
      const name = nameOfRequest(url, init);
      if (name === null) return response;
      // The Host reports a REVISION with every read and every write, and the client's whole
      // external-change policy turns on it. Rather than make every case in this file carry one,
      // the fake filesystem tracks it here: each mutation of a name bumps its revision, and the
      // payload is stamped on the way out. A case that wants to simulate an outside edit calls
      // `touch(name)` rather than building a revision by hand.
      //
      // Stamping means going THROUGH the Response the case returned (`json()` then rebuild), and
      // jsonResponse is lazy — reading its body twice hands back the same text.
      if (response === undefined || typeof response.json !== 'function') return response;
      const payload = await response.json();
      if (payload?.ok === true) {
        if (url.includes('/write') || url.includes('/restore')) {
          revisions.set(name, (revisions.get(name) ?? 0) + 1);
        }
        payload.rev = revisions.get(name) ?? 0;
      }
      return jsonResponse(payload, response.status);
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
    // The external-change poll (`WATCH_POLL_MS`). Kept apart from `timers` — a repeating timer is
    // not a one-shot, and firing it by "run every pending timer once" would make it look like a
    // debounce — and fired on demand by `tickIntervals`.
    setInterval: (fn, ms) => {
      const id = intervals.length + 1;
      intervals.push({ id, fn, ms, cancelled: false });
      return id;
    },
    clearInterval: (id) => {
      const entry = intervals.find((item) => item.id === id);
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
  /**
   * Fire every repeating timer once, the way `WATCH_POLL_MS` would elapse.
   *
   * On demand rather than by clock: the poll is how an external save reaches the editor, and a
   * test that had to wait 1.5 real seconds for it would be a test nobody runs.
   * @returns nothing; awaits the work the tick started.
   */
  const tickIntervals = async () => {
    for (const entry of [...intervals]) {
      if (entry.cancelled) continue;
      entry.fn();
    }
    await settle();
    await settle();
  };
  /**
   * The pending timers armed with one delay.
   *
   * "How many writes are queued" is a question about the write debounce, not about every
   * timer in the page — the editor arms others too (the `var()` check waits for a pause).
   * @param ms - the delay to look for.
   * @returns the pending entries carrying that delay.
   */
  const debounces = (ms) => timers.filter(entry => !entry.cancelled && entry.ms === ms);
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
    intervals,
    runTimers,
    tickIntervals,
    runEffects,
    debounces,
    unmount,
    waits,
    registrations,
    /**
     * Simulate an edit made OUTSIDE the plugin (a text editor, another tab).
     *
     * The payload a case's `fetchImpl` serves is the file's content; this is the other half —
     * the revision the Host would report alongside it. Bumping the revision without touching
     * the payload is exactly what a re-save by an editor that normalises line endings looks
     * like from here.
     * @param name - the sheet that changed.
     * @param times - how many revisions to move it (default 1).
     */
    touch: (name, times = 1) => {
      revisions.set(name, (revisions.get(name) ?? 0) + times);
    },
    revisionOf: name => revisions.get(name) ?? 0,
    userStyle: () => styleTags.find(element => element.id === 'dsh-custom-css-user-style'),
  };
}

async function main() {
  /** The editor's write debounce, in ms (`WRITE_DELAY_MS` in lib/client.js). */
  const WRITE_TICK = 400;

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
    // The find bar is a second flex row inside the editor box, and it holds two fields plus
    // six controls in ~600px. Two things keep it from spilling: the fields may shrink below
    // their content width, and the row may not take more height than it needs.
    '.dshCc_findBar{box-sizing:border-box;display:flex;flex:none;',
    '.dshCc_findField{box-sizing:border-box;flex:1;min-width:0;',
    '.dshCc_editorRow{display:flex;flex:1;min-height:0;min-width:0}',
    // And the editor box is the column those two rows divide between them.
    '.dshCc_editorWrap{box-sizing:border-box;position:relative;display:flex;flex-direction:column;',
    // The two steps the bar takes when the row is narrower than its contents (measured:
    // 610px of content at every width, so it wrapped until these existed).
    '@media (max-width:640px){.dshCc_findCount,.dshCc_findCountBad{display:none}}',
    '@media (max-width:540px){.dshCc_findLabel{display:none}',
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
  for (const label of ['打开文件', '导入', '导出', '重置', '格式化', '历史版本']) {
    assert.ok(renderedText.includes(label), 'the menu renders the ' + label + ' action');
  }
  // The order is a decision, not an accident: the file actions together, the whole-sheet
  // actions next, and the one entry that destroys work last — where the pointer has to
  // travel to it and cannot land on it on the way to anything else.
  {
    const order = [];
    (function walk(current) {
      if (current === null || typeof current !== 'object') return;
      if (current.type === 'button' && typeof current.props?.title === 'string') order.push(textOf(current));
      for (const child of current.children ?? []) walk(child);
    })(menuView);
    const wanted = ['打开文件', '导入', '导出', '格式化', '历史版本', '重置'];
    const seen = order
      .map(entry => wanted.find(label => entry.startsWith(label)))
      .filter(label => label !== undefined);
    assert.deepStrictEqual(
      [...seen], wanted,
      'the actions menu lists the file actions, then the whole-sheet ones, then 重置 — got: ' + JSON.stringify(order),
    );
    // And the destructive one is styled as destructive, in its new place as before.
    const resetItem = buttonWith(menuView, '重置');
    assert.ok(
      String(resetItem.props.className).includes('dshCc_menuItemDanger'),
      '重置 keeps its destructive styling at the bottom — className: ' + JSON.stringify(resetItem.props.className),
    );
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
  /**
   * The open rule's panel, from the whole row render.
   *
   * `renderRow()` returns the file bar, the editor and the panel together, and the row has
   * dropdowns of its own up there (the outline), so "which properties got a dropdown" has to
   * be asked of the panel rather than of the view.
   */
  const panelRoot = (view) => {
    let found = null;
    (function walk(current) {
      if (found !== null || current === null || typeof current !== 'object') return;
      if (String(current.props?.className ?? '') === 'dshCc_panel') {
        found = current;
        return;
      }
      for (const child of current.children ?? []) walk(child);
    })(view);
    return found;
  };
  collectDropdowns(panelRoot(panelView));
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
  assert.strictEqual(slow.debounces(WRITE_TICK).length, 1, 'typing schedules one write');
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

  // --- the picker's label must not paint on a box that has none -------------
  // A visible defect, and a CSS-only one, so it needs an audit rather than a render:
  // `content: attr(data-label)` on a MISSING attribute is the empty string, not `none`, so the
  // pseudo-element is still generated — and a pseudo's box-sizing is content-box (it is not
  // inherited), so it collapses to its own padding: a 12x2 bar of brand colour at
  // `left:0; top:-22px`, i.e. a stray line just above the box's top-left corner. Only the
  // LOCKED box has no label (the hover box carries the size), so the line appeared exactly
  // when a click locked a selection. Measured in headless Edge: 12x2 there, 0 after the gate.
  const boxRules = (() => {
    const sheet = host.document.querySelector('style[data-plugin-css="dsh-custom-css/CustomCssRow.module.css"]');
    assert.ok(sheet !== null, 'the row injects its own stylesheet');
    const rules = [];
    const pattern = /([^{}]+)\{([^{}]*)\}/g;
    let match;
    while ((match = pattern.exec(sheet.textContent)) !== null) {
      if (match[1].includes('dshCc_pickBox')) rules.push({ selector: match[1].trim(), body: match[2] });
    }
    return rules;
  })();
  assert.ok(boxRules.length > 0, 'the highlight box has rules to audit');
  const boxDouble = (className, attributes) => ({
    tagName: 'DIV',
    className,
    attributes,
    parentElement: null,
    getAttribute(name) {
      return name in attributes ? attributes[name] : null;
    },
  });
  const rulesFor = (node) => boxRules.filter(rule => rule.selector
    .split(',')
    .some(part => matchesSelector(node, part.replace(/::[a-z-]+(\([^)]*\))?/g, ''))));
  const unsatisfied = [];
  for (const variant of [
    { what: 'the hover box before it has been given one', node: boxDouble('dshCc_pickBox', {}) },
    { what: 'the locked box', node: boxDouble('dshCc_pickBox dshCc_pickLocked', {}) },
  ]) {
    for (const rule of rulesFor(variant.node)) {
      const content = /content\s*:\s*attr\(\s*([\w-]+)\s*\)/.exec(rule.body);
      if (content !== null && variant.node.getAttribute(content[1]) === null) {
        unsatisfied.push(variant.what + ' ← ' + rule.selector + ' paints attr(' + content[1] + ')');
      }
    }
  }
  assert.deepStrictEqual(
    unsatisfied, [],
    'no rule paints a label from an attribute the box does not have — got: ' + JSON.stringify(unsatisfied),
  );
  // The other half of the gate: a box that DOES have a label still gets it, so "paint nothing
  // anywhere" cannot pass this audit.
  assert.ok(
    rulesFor(boxDouble('dshCc_pickBox', { 'data-label': '200×60' }))
      .some(rule => rule.body.includes('attr(data-label)')),
    'and a box that carries the label still paints it',
  );

  // --- every class the row's stylesheet styles is one the code applies ------
  // Dead CSS is invisible: a rule whose class nothing sets looks exactly like a rule that
  // works — and it is also what a renamed control leaves behind, so a typo'd class name
  // (styled as one thing, applied as another) is invisible in the same way. Four rules and a
  // whole function were pruned for real; this is the audit that keeps the list at zero.
  //
  // Two subtleties, both learned the hard way while pruning:
  //   * the stylesheet itself names every styled class, so "applied" is searched OUTSIDE it;
  //   * `'dshCc_tok' + kindOf()` builds a name by concatenation, so a styled class that
  //     extends a prefix the code emits counts as applied — `dshCc_tokProp` is live syntax
  //     colouring, and calling it dead would be a false alarm.
  const cssStart = code.indexOf('const ROW_CSS = [');
  const cssEnd = code.indexOf("].join('');", cssStart);
  assert.ok(cssStart > 0 && cssEnd > cssStart, 'the row stylesheet is findable in the source');
  const rowCssSource = code.slice(cssStart, cssEnd);
  const emittingSource = code.slice(0, cssStart) + code.slice(cssEnd);
  const styled = new Set([...rowCssSource.matchAll(/\.(dshCc_[A-Za-z0-9_-]+)/g)].map(match => match[1]));
  const emitted = new Set([...emittingSource.matchAll(/(dshCc_[A-Za-z0-9_-]*)/g)].map(match => match[1]));
  const emittedPrefixes = [...emittingSource.matchAll(/(dshCc_[A-Za-z0-9_-]*)'\s*\+/g)].map(match => match[1]);
  assert.ok(styled.size > 50, 'the audit read a real stylesheet, not a fragment');
  const orphanRules = [...styled]
    .filter(name => !emitted.has(name) && !emittedPrefixes.some(prefix => name.startsWith(prefix)))
    .sort();
  assert.deepStrictEqual(
    orphanRules, [],
    'the stylesheet has no rule for a class nothing applies — got: ' + JSON.stringify(orphanRules),
  );

  // --- the editor's own undo history ---------------------------------------
  // A controlled textarea has no usable undo stack: React writes `value` on every keystroke,
  // and that assignment clears whatever the engine had recorded — Ctrl+Z would do nothing.
  // So the plugin keeps its own. These assertions are about what a user actually types:
  // a burst of keystrokes is ONE step, Tab indents, Ctrl+S lands the debounce, and walking
  // past the end of the history does nothing rather than something surprising.
  const undoWrites = [];
  const undoable = await boot({
    fetchImpl: async (url, init) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 13, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.x{color:red}' });
      if (url.endsWith('/write')) {
        undoWrites.push(JSON.parse(init.body));
        return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      }
      throw new Error('unexpected request: ' + url);
    },
  });
  hookIndex = 0;
  const undoView = undoable.registrations[0].component();
  await undoable.runEffects();
  const undoArea = findNode(undoView, 'textarea');
  const undoCarets = [];
  undoArea.props.ref.current = {
    selectionStart: 0,
    scrollTop: 0,
    scrollLeft: 0,
    clientHeight: 140,
    focus() {},
    setSelectionRange(start) { undoCarets.push(start); },
  };
  const undoSheet = () => undoable.userStyle().textContent;
  const typeInto2 = (value, caret = value.length, inputType = 'insertText') => {
    undoArea.props.onChange({ target: { value, selectionStart: caret }, nativeEvent: { inputType } });
    hookIndex = 0;
    undoView2 = undoable.registrations[0].component();
    return undoView2;
  };
  let undoView2 = undoView;
  const press = (key, modifiers = {}) => {
    const event = { key, preventDefault() {}, ...modifiers };
    // A fresh pass first: the handler closes over the hooks of the render it came from, and
    // reading props off a render with a moved hook index hands back a different closure.
    hookIndex = 0;
    const view = undoable.registrations[0].component();
    findNode(view, 'textarea').props.onKeyDown(event);
    hookIndex = 0;
    undoable.registrations[0].component();
    return event;
  };

  typeInto2('.x{color:blue}');
  typeInto2('.x{color:blu}', 14);
  typeInto2('.x{color:bl}', 13);
  assert.strictEqual(undoSheet(), '.x{color:bl}', 'three keystrokes in one burst');
  press('z', { ctrlKey: true });
  await undoable.runEffects();
  assert.strictEqual(
    undoSheet(), '.x{color:red}',
    'one press of Ctrl+Z walks back the whole burst — got: ' + JSON.stringify(undoSheet()),
  );
  assert.deepStrictEqual(undoCarets, [0], 'and the caret returns to where the undo entry recorded it');
  press('z', { ctrlKey: true });
  assert.strictEqual(undoSheet(), '.x{color:red}', 'and pressing it again at the start does nothing');
  press('z', { ctrlKey: true, shiftKey: true });
  assert.strictEqual(undoSheet(), '.x{color:bl}', 'Ctrl+Shift+Z walks forward again');
  press('y', { ctrlKey: true });
  assert.strictEqual(undoSheet(), '.x{color:bl}', 'and Ctrl+Y at the end of the redo stack does nothing');

  // Tab indents — but only with no completion list open: with one open, Tab accepts the
  // suggestion (the long-standing behaviour). Escape closes it, which is what a user does.
  press('Escape');
  hookIndex = 0;
  renderedClasses.length = 0;
  undoable.registrations[0].component();
  assert.ok(
    !renderedClasses.includes('dshCc_suggest'),
    'Escape closes the completion list — classes: ' + JSON.stringify(renderedClasses),
  );
  undoArea.props.ref.current.selectionStart = 0;
  press('Tab');
  assert.strictEqual(undoSheet(), '  .x{color:bl}', 'Tab adds two spaces at the caret');
  await undoable.runEffects();
  assert.strictEqual(undoCarets.at(-1), 2, 'and puts the caret after them — carets: ' + JSON.stringify(undoCarets));
  undoArea.props.ref.current.selectionStart = 2;
  press('Tab', { shiftKey: true });
  assert.strictEqual(undoSheet(), '.x{color:bl}', 'Shift+Tab takes them away again');

  // Ctrl+S lands the pending write now instead of in 400 ms.
  typeInto2('.x{color:green}');
  const writesBefore = undoWrites.length;
  assert.strictEqual(undoable.debounces(WRITE_TICK).length, 1, 'the write is still debounced');
  press('s', { ctrlKey: true });
  await settle();
  assert.strictEqual(
    undoWrites.length, writesBefore + 1,
    'Ctrl+S writes immediately — writes: ' + JSON.stringify(undoWrites.map(entry => entry.css)),
  );
  assert.strictEqual(undoWrites[writesBefore].css, '.x{color:green}', 'with the text on screen');
  assert.strictEqual(
    undoable.debounces(WRITE_TICK).length, 0,
    'and the debounce it replaced does not fire a second write',
  );

  // --- a var() that cannot resolve where its rule applies -------------------
  // Another component's card can define a custom property that is simply absent everywhere
  // else: the engine drops the declarations using it and says nothing. The editor asks the
  // document instead — and stays quiet about what it cannot ask (a selector matching nothing)
  // or about what cannot fail (`var(--x, fallback)`).
  const varNode = (className) => {
    const element = {
      tagName: 'DIV',
      className,
      attributes: {},
      parentElement: null,
      getAttribute: () => null,
      matches: selector => matchesSelector(element, selector),
    };
    return element;
  };
  const varSheet = [
    '.a { color: var(--dsw-alias-label-primary); }',
    '.b { box-shadow: var(--dsl-g-shadow-card); }',
    '.c { border: 1px solid var(--not-here, red); }',
    '.nope { color: var(--whatever); }',
  ].join('\n');
  const varCheck = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 40, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: varSheet });
      if (url.endsWith('/write')) return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      throw new Error('unexpected request: ' + url);
    },
    dom: {
      nodes: [varNode('a'), varNode('b'), varNode('c')],
      // Only `.a` resolves its variable; `.c`'s use carries a fallback and `.nope` matches
      // nothing, so neither may be reported.
      computed: element => ({
        getPropertyValue: name => (element.className === 'a' && name === '--dsw-alias-label-primary' ? 'red' : ''),
      }),
    },
  });
  hookIndex = 0;
  renderedText.length = 0;
  varCheck.registrations[0].component();
  assert.ok(
    !renderedText.some(text => text.includes('变量')),
    'the var() check waits for a pause instead of running on the first render',
  );
  await varCheck.runEffects();
  await varCheck.runTimers();
  hookIndex = 0;
  renderedText.length = 0;
  varCheck.registrations[0].component();
  const status = renderedText.filter(text => text.includes('行')).join(' | ');
  assert.ok(
    status.includes('--dsl-g-shadow-card'),
    'a var() that resolves nowhere on the elements the rule matches is reported — status: ' + JSON.stringify(status),
  );
  assert.ok(status.includes('第 2 行'), 'at the line the declaration is on — status: ' + JSON.stringify(status));
  assert.ok(
    !status.includes('--dsw-alias-label-primary'),
    'a variable that does resolve is not reported — status: ' + JSON.stringify(status),
  );
  assert.ok(
    !status.includes('--not-here') && !status.includes('--whatever'),
    'and neither is one with a fallback, nor one whose rule matches nothing — status: ' + JSON.stringify(status),
  );

  // --- the outline: what the sheet contains, and what actually matches -------
  // On a long sheet two questions come up constantly: where is that rule, and is it doing
  // anything. The outline answers both, and the count is the half that is invisible today —
  // a selector that hits nothing styles nothing, and says so nowhere.
  const outlineSheet = ['.a { color: red; }', '.b { color: blue; }', '.gone { color: green; }'].join('\n');
  const outlineBoot = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 60, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: outlineSheet });
      if (url.endsWith('/write')) return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      throw new Error('unexpected request: ' + url);
    },
    dom: { nodes: [varNode('a'), varNode('a'), varNode('b')] },
  });
  hookIndex = 0;
  const outlineView = outlineBoot.registrations[0].component();
  await outlineBoot.runEffects();
  /** The outline dropdown element (the harness does not render function components). */
  const findOutline = (view) => {
    let found = null;
    (function walk(current) {
      if (found !== null || current === null || typeof current !== 'object') return;
      if (typeof current.type === 'function' && current.props?.wrapperClassName === 'dshCc_outline') found = current;
      for (const child of current.children ?? []) walk(child);
    })(view);
    return found;
  };
  const outline = findOutline(outlineView);
  assert.ok(outline !== null, 'the file bar carries an outline dropdown');
  assert.strictEqual(outline.props.display, '大纲', 'labelled as the sheet outline');
  await outlineBoot.runTimers();
  hookIndex = 0;
  const outlineReady = outlineBoot.registrations[0].component();
  const outlineDropdown = findOutline(outlineReady);
  const labels = outlineDropdown.props.items.map(item => item.label);
  // `[...labels]` is not decoration: the array was built inside the plugin's VM realm, and
  // `deepStrictEqual` compares prototypes — a sandbox Array never equals a test-realm one
  // even when every element does. Spreading rebuilds it here.
  assert.deepStrictEqual(
    [...labels],
    ['.a · 命中 2', '.b · 命中 1', '.gone · 无命中'],
    'every rule is listed with what the document says about it — got: ' + JSON.stringify(labels),
  );
  // Jumping opens that rule's panel and parks the caret on its selector.
  const carets = [];
  const outlineEditor = findNode(outlineReady, 'textarea');
  outlineEditor.props.ref.current = {
    selectionStart: 0,
    scrollTop: 0,
    scrollLeft: 0,
    clientHeight: 140,
    focus() {},
    setSelectionRange(start) { carets.push(start); },
  };
  outlineDropdown.props.onPick('2');
  hookIndex = 0;
  renderedClasses.length = 0;
  const jumped = outlineBoot.registrations[0].component();
  await outlineBoot.runEffects();
  hookIndex = 0;
  renderedClasses.length = 0;
  outlineBoot.registrations[0].component();
  assert.ok(
    renderedClasses.some(entry => entry.includes('dshCc_panelName')),
    'picking an outline entry opens that rule — classes: ' + JSON.stringify(renderedClasses),
  );
  const nameField = (() => {
    let found = null;
    (function walk(current) {
      if (found !== null || current === null || typeof current !== 'object') return;
      if (String(current.props?.className ?? '').includes('dshCc_panelName')) found = current;
      for (const child of current.children ?? []) walk(child);
    })(jumped);
    return found;
  })();
  assert.strictEqual(
    nameField?.props?.value, '.gone',
    'and it is the rule that was picked, not the first one',
  );
  assert.deepStrictEqual(
    carets, [outlineSheet.indexOf('.gone')],
    'with the caret on its selector so the line comes into view',
  );

  // --- a menu opened from the right end of a row stays inside the window ----
  // The outline sits at the right end of the file bar, and a menu laid out as
  // `left: trigger.left` ran off the screen with a long selector inside it (measured: 250px).
  // The placement is pure, so it is asserted directly rather than through a screenshot.
  const placeMenu = host.mod.__probe.placeMenu;
  assert.strictEqual(typeof placeMenu, 'function', 'the placement math is reachable in this suite');
  const triggerAt = (left, width = 50) => ({ left, right: left + width, top: 300, bottom: 328, width });
  const window900 = { width: 900, height: 600 };

  const rightEnd = placeMenu(triggerAt(830), window900, 320);
  assert.strictEqual(rightEnd.right, '20px', 'a menu that would cross the right edge hangs off it — style: ' + JSON.stringify(rightEnd));
  assert.strictEqual(rightEnd.width, '320px', 'and it gets the width it asked for');
  assert.ok(rightEnd.left === undefined, 'the left anchor is dropped, not emitted alongside');

  const roomy = placeMenu(triggerAt(40), window900, 320);
  assert.strictEqual(roomy.left, '40px', 'a menu with room keeps the familiar left anchor');
  assert.ok(roomy.right === undefined, 'and nothing else');

  const narrow = placeMenu(triggerAt(40), { width: 300, height: 600 }, 320);
  assert.strictEqual(narrow.width, '284px', 'a narrow window clamps the width instead of overflowing it');
  assert.strictEqual(narrow.right, '210px', 'and the clamped menu hangs off the right edge (300 - the trigger right edge 90)');

  const contentDriven = placeMenu(triggerAt(40, 120), window900, undefined);
  assert.strictEqual(contentDriven.minWidth, '120px', 'a content-driven menu still starts at its trigger width');
  assert.strictEqual(contentDriven.maxWidth, '884px', 'but may not grow past the window');
  assert.strictEqual(contentDriven.width, undefined, 'and is not given a width it did not ask for');

  const nearBottom = placeMenu({ left: 40, right: 90, top: 560, bottom: 588, width: 50 }, window900, 320);
  assert.ok(nearBottom.bottom !== undefined && nearBottom.top === undefined, 'a menu near the bottom flips up');
  assert.strictEqual(placeMenu(undefined, window900, 320), undefined, 'no layout, no menu placement');

  // --- nothing may switch off the app's own scrollbars ----------------------
  // DSH styles every scrollbar from one global stylesheet, with `::-webkit-scrollbar`. In
  // Chromium, a *standard* scrollbar property on an element makes the engine ignore exactly
  // that styling for that element — so one `scrollbar-width: thin` on a menu dropped it to the
  // platform bar while the rest of the app stayed styled. This audit reads the stylesheet the
  // plugin actually injects (not its JS source, which has comments talking about it) and allows
  // those properties only as `none` (hiding a scrollbar on purpose) or behind the webkit
  // feature query, which only engines without the pseudo-element ever see.
  const injected = host.document.querySelector('style[data-plugin-css="dsh-custom-css/CustomCssRow.module.css"]');
  assert.ok(injected !== null, 'the row injects its own stylesheet');
  /** Drop every `@supports not selector(::-webkit-scrollbar){…}` block, braces and all. */
  const withoutWebkitFallback = (css) => {
    const needle = '@supports not selector(::-webkit-scrollbar)';
    let out = css;
    for (let at = out.indexOf(needle); at >= 0; at = out.indexOf(needle)) {
      const open = out.indexOf('{', at);
      let depth = 0;
      let end = open;
      for (; end < out.length; end += 1) {
        if (out[end] === '{') depth += 1;
        if (out[end] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      out = out.slice(0, at) + out.slice(end + 1);
    }
    return out;
  };
  const stripped = withoutWebkitFallback(injected.textContent);
  const unguarded = (stripped.match(/scrollbar-(?:width|color)\s*:\s*[^;}]*/g) ?? [])
    .filter(declaration => !/:\s*none\s*$/.test(declaration));
  assert.deepStrictEqual(
    unguarded, [],
    'the standard scrollbar properties are only set to `none`, or inside the webkit feature query — got: ' + JSON.stringify(unguarded),
  );

  // --- every scroll container caps its own height ---------------------------
  // A list that scrolls but has no ceiling is a list that grows past the window: the sheet
  // picker's menu did exactly that (24 sheets = 968px of menu, 236px of it below an 800px
  // window, and nothing to scroll because the container itself was the overflow). Each
  // selector that opts into `overflow-y:auto` therefore has to declare a `max-height`.
  const declarationsOf = (css) => {
    const blocks = new Map();
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of match[1].split(',')) {
        const key = selector.trim();
        if (key === '' || key.includes('@')) continue;
        blocks.set(key, (blocks.get(key) ?? '') + match[2]);
      }
    }
    return blocks;
  };
  const blocks = declarationsOf(injected.textContent);
  const uncapped = [...blocks.entries()]
    .filter(([, body]) => /overflow-y\s*:\s*auto/.test(body) && !/max-height\s*:/.test(body))
    .map(([selector]) => selector);
  assert.deepStrictEqual(
    uncapped, [],
    'a scroll container with no height ceiling can leave the window — got: ' + JSON.stringify(uncapped),
  );
  assert.ok(
    [...blocks.keys()].some(selector => selector.includes('dshCc_menu')),
    'the audit actually saw the menu rule — got: ' + JSON.stringify([...blocks.keys()].slice(0, 6)),
  );

  // --- an outside edit stops the next write instead of being clobbered ------
  // A sheet is a real file, and 「打开文件」 exists so it can be edited in a real editor — so the
  // copy a row holds can go stale without anything saying so, and the next debounced write
  // would land on top of the other editor's work. That is the one failure in this row that
  // loses data rather than looking untidy. A write therefore reads first; a disagreement is a
  // question with two answers, not a failure and not a silent overwrite.
  let diskText = '.x{color:red}';
  const outsideWrites = [];
  const outside = await boot({
    fetchImpl: async (url, init) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: diskText });
      if (url.endsWith('/write')) {
        outsideWrites.push(JSON.parse(init.body));
        diskText = JSON.parse(init.body).css;
        return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      }
      throw new Error('unexpected request: ' + url);
    },
  });
  hookIndex = 0;
  const outsideView = outside.registrations[0].component();
  await outside.runEffects();
  const outsideArea = findNode(outsideView, 'textarea');
  outsideArea.props.ref.current = {
    selectionStart: 0,
    scrollTop: 0,
    scrollLeft: 0,
    clientHeight: 140,
    focus() {},
    setSelectionRange() {},
  };
  // Somebody else writes the file — VS Code via 「打开文件」, or another tab. The payload alone
  // is not the edit: the Host reports a new REVISION for it, and that is what the row compares.
  diskText = '.x{color:red}\n\n.edited-elsewhere { color: blue; }';
  outside.touch('custom.css');
  outsideArea.props.onChange({
    target: { value: '.x{color:green}', selectionStart: 14 },
    nativeEvent: { inputType: 'insertText' },
  });
  await outside.runTimers();
  await settle();
  await settle();
  assert.strictEqual(
    outsideWrites.length, 0,
    'the write is refused rather than landing on the other copy — writes: ' + JSON.stringify(outsideWrites)
      + ' revisions: ' + outside.revisionOf('custom.css')
      + ' calls: ' + JSON.stringify(outside.calls.map(call => call.url)),
  );
  hookIndex = 0;
  renderedText.length = 0;
  outside.registrations[0].component();
  assert.ok(
    renderedText.some(text => text.includes('已被改动')),
    'and the footer asks which copy to keep — status: ' + JSON.stringify(renderedText),
  );
  // 「重新载入」: the disk copy becomes the sheet. It re-reads the sheet rather than trusting the
  // text the conflict carried, so the revision the next write compares against is the real one.
  buttonWith(outside.registrations[0].component(), '重新载入').props.onClick();
  await settle();
  await settle();
  hookIndex = 0;
  renderedText.length = 0;
  outside.registrations[0].component();
  assert.ok(
    outside.userStyle().textContent.includes('.edited-elsewhere'),
    'taking the disk copy applies the text from the other editor — applied: ' + JSON.stringify(outside.userStyle().textContent),
  );
  assert.ok(
    !renderedText.some(text => text.includes('已被改动')),
    'and the question is gone',
  );

  // The same collision, answered the other way: 「覆盖它」 writes this editor's text on purpose.
  let keepDisk = '.k{color:red}';
  const keepWrites = [];
  const keep = await boot({
    fetchImpl: async (url, init) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: keepDisk });
      if (url.endsWith('/write')) {
        keepWrites.push(JSON.parse(init.body));
        keepDisk = JSON.parse(init.body).css;
        return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      }
      throw new Error('unexpected request: ' + url);
    },
  });
  hookIndex = 0;
  const keepMineView = keep.registrations[0].component();
  await keep.runEffects();
  const keepArea = findNode(keepMineView, 'textarea');
  keepArea.props.ref.current = { selectionStart: 0, scrollTop: 0, scrollLeft: 0, clientHeight: 140, focus() {}, setSelectionRange() {} };
  keepArea.props.onChange({
    target: { value: '.k{color:blue}', selectionStart: 13 },
    nativeEvent: { inputType: 'insertText' },
  });
  // The window comes back into view: the outside edit is noticed before anyone types again.
  // The editor is NOT clean here (the edit above is still inside the debounce), which is the one
  // state that must never be overwritten — so this is a question, not an adoption.
  keepDisk = '.k{color:red}\n\n.another-tab { color: lime; }';
  keep.touch('custom.css');
  keep.dispatch('visibilitychange', {});
  await settle();
  await settle();
  hookIndex = 0;
  renderedText.length = 0;
  keep.registrations[0].component();
  assert.ok(
    renderedText.some(text => text.includes('已被改动')),
    'coming back into view surfaces the outside edit — status: ' + JSON.stringify(renderedText),
  );
  buttonWith(keep.registrations[0].component(), '覆盖它').props.onClick();
  await settle();
  await settle();
  assert.strictEqual(keepWrites.length, 1, 'keeping mine writes exactly once — writes: ' + JSON.stringify(keepWrites));
  assert.strictEqual(keepWrites[0].css, '.k{color:blue}', 'with this editor text, deliberately');
  hookIndex = 0;
  renderedText.length = 0;
  keep.registrations[0].component();
  assert.ok(!renderedText.some(text => text.includes('已被改动')), 'and the question is cleared');

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
      // Real matching, so a rule scoped to another component is not mistaken for one that
      // applies here. (`:root` is the node at the top of the chain in this bed.)
      matches: selector => matchesSelector(element, selector),
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
  // A second element really carrying the same label: this interface does repeat labels, and
  // the ranking has to cope with that on the evidence rather than on a stub's say-so. Its box
  // sits away from every point the tests click, so it never wins a hit by accident.
  const twinLabel = node('div', {
    className: 'dsh-music-qq-row',
    attributes: { 'aria-label': 'QQ 音乐' },
    parent: dialog,
    rect: { top: 640, left: 700, width: 200, height: 60 },
  });
  dialog.children.push(rowInsideDialog, pickedTarget, twinLabel);
  const outer = node('div', { className: 'dsh-app', rect: { top: 0, left: 0, width: 1280, height: 900 } });
  dialog.parentElement = outer;
  outer.children.push(dialog);
  /** The whole page in document order: what the stubs hit-test and match against. */
  const pickPool = [outer, dialog, rowInsideDialog, pickedTarget, twinLabel];

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
      nodes: pickPool,
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
    ['div.dsh-music-qq-head语义类名仅此一个', 'div[aria-label="QQ 音乐"]无障碍名2 个命中', 'div[class*="_card_"]哈希容错仅此一个'],
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

  // Clicking elsewhere moves the selection; the session is still open. The point is inside
  // the row's own box but outside the card's, which is what makes it "elsewhere".
  picker.dispatch('click', { target: rowInsideDialog, clientX: 500, clientY: 300, preventDefault() {}, stopPropagation() {} });
  assert.ok(
    info().includes('dsh-music-list'),
    'a second click moves the selection — got: ' + JSON.stringify(info()),
  );
  assert.ok(panel() !== undefined, 'without leaving the picker');
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
  picker.dispatch('click', { target: rowInsideDialog, clientX: 500, clientY: 300, preventDefault() {}, stopPropagation() {} });
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
    dom: { nodes: pickPool, computed: { getPropertyValue: () => '' } },
  });
  // The settings entry the plugin is allowed to click, and a record of the click.
  let settingsClicked = false;
  const settingsEntry = node('button', { attributes: { 'aria-label': '设置' } });
  settingsEntry.click = () => { settingsClicked = true; };
  careful.dom.nodes = [settingsEntry, ...pickPool];

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
  const existingWrites = [];
  const existing = await boot({
    fetchImpl: async (url, init) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      // The selector the picker actually picks: the label repeats in this tree, so the
      // unique class is the candidate that wins the default.
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: 'div.dsh-music-qq-head { color: red }' });
      if (url.endsWith('/write')) {
        existingWrites.push(JSON.parse(init.body));
        return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      }
      throw new Error('unexpected request: ' + url);
    },
    dom: { nodes: pickPool },
  });
  const existingPanel = () => existing.document.body.children.some(child => child.className === 'dshCc_pickPanel');
  hookIndex = 0;
  const existingView = existing.registrations[0].component();
  await existing.runEffects();
  buttonWith(existingView, '拾取元素').props.onClick();
  hookIndex = 0;
  existing.registrations[0].component();
  await existing.runEffects();
  // A hover is not a selection: Enter confirms what a click LOCKED, so hovering and pressing
  // Enter must do nothing at all. This is the boundary that let the case below pass without
  // ever committing anything, back when the stub ignored the coordinates it was handed.
  existing.dispatch('pointermove', { clientX: 30, clientY: 50 });
  existing.dispatch('keydown', { key: 'Enter', preventDefault() {} });
  assert.strictEqual(existingWrites.length, 0, 'hovering the element and pressing Enter commits nothing');
  assert.ok(existingPanel(), 'and the session stays open');
  // A click, and then Enter does commit.
  existing.dispatch('click', { target: pickedTarget, clientX: 30, clientY: 50, preventDefault() {}, stopPropagation() {} });
  existing.dispatch('keydown', { key: 'Enter', preventDefault() {} });
  assert.strictEqual(
    existing.userStyle().textContent,
    'div.dsh-music-qq-head { color: red }',
    'an existing rule is opened, not duplicated',
  );
  assert.strictEqual(existingWrites.length, 0, 'and nothing was written: the rule was already there');
  assert.ok(!existingPanel(), 'and the pick really committed: the panel is gone');

  // --- a pick that opens an EXISTING rule must open it now, not later ------
  // The handoff is consumed through the store, and this is the case where the store
  // does not move: reusing a rule writes no text, so `state.css` is the identical string
  // and a consumer keyed on it never re-runs. The panel stayed shut — and the handoff
  // stayed pending, so the NEXT unrelated edit opened that stale rule and yanked the
  // caret into it long after the gesture that asked for it.
  const EXISTING_SHEET = 'div.dsh-music-qq-head { color: red }';
  /** A row whose sheet already carries the rule this element maps to. */
  const bootExistingRule = async (writes) => boot({
    fetchImpl: async (url, init) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: EXISTING_SHEET });
      if (url.endsWith('/write')) {
        writes.push(JSON.parse(init.body));
        return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      }
      throw new Error('unexpected request: ' + url);
    },
    dom: { nodes: pickPool },
  });
  /**
   * Render the row, arm the picker, select the element under the pointer and commit the
   * default candidate. Records every caret the row places, from before the pick onwards.
   */
  const pickWith = async (harness, target = pickedTarget, beforeCommit) => {
    hookIndex = 0;
    const view = harness.registrations[0].component();
    await harness.runEffects();
    const editor = findNode(view, 'textarea');
    const carets = [];
    editor.props.ref.current = {
      selectionStart: 0,
      scrollTop: 0,
      clientHeight: 140,
      focus() {},
      setSelectionRange(start, end) { carets.push([start, end]); },
    };
    buttonWith(view, '拾取元素').props.onClick();
    hookIndex = 0;
    harness.registrations[0].component();
    await harness.runEffects();
    harness.dispatch('pointermove', { clientX: 30, clientY: 50 });
    harness.dispatch('click', { target, clientX: 30, clientY: 50, preventDefault() {}, stopPropagation() {} });
    // The panel is up once the click locked the element and before Enter commits it.
    if (beforeCommit !== undefined) beforeCommit();
    harness.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    return { carets, editor };
  };

  const openedWrites = [];
  const opened = await bootExistingRule(openedWrites);
  const openedPick = await pickWith(opened);
  hookIndex = 0;
  opened.registrations[0].component();
  // The settings row is on screen the whole time; this is the pass that has to consume it.
  await opened.runEffects();
  hookIndex = 0;
  renderedClasses.length = 0;
  opened.registrations[0].component();
  assert.strictEqual(openedWrites.length, 0, 'an existing rule is not written again');
  assert.strictEqual(opened.userStyle().textContent, EXISTING_SHEET, 'and the sheet is untouched');
  assert.ok(
    renderedClasses.some(entry => entry.includes('dshCc_panelName')),
    'the rule that already exists is opened while the row is on screen — classes: ' + JSON.stringify(renderedClasses),
  );
  assert.deepStrictEqual(
    openedPick.carets, [],
    'and no caret is dropped into text this gesture did not create — carets: ' + JSON.stringify(openedPick.carets),
  );

  // The delayed half: a handoff left pending is spent by the next unrelated edit.
  const lateWrites = [];
  const late = await bootExistingRule(lateWrites);
  const latePick = await pickWith(late);
  hookIndex = 0;
  late.registrations[0].component();
  await late.runEffects();
  latePick.editor.props.onChange({
    target: { value: '/* later */\n' + EXISTING_SHEET, selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  hookIndex = 0;
  late.registrations[0].component();
  await late.runEffects();
  assert.deepStrictEqual(
    latePick.carets, [],
    'a handoff is spent by the pick itself, so a later unrelated edit cannot yank the caret '
      + 'into the picked rule — carets: ' + JSON.stringify(latePick.carets),
  );

  // --- a value with a newline must not become a broken selector ------------
  // `aria-label` and `data-*` values are free text, so they can contain a line break — and a
  // raw newline ends a CSS string: the selector stops being a selector. Every probe on it
  // throws, and a throw used to score as "one match", so the broken candidate took the
  // uniqueness bonus, won the default and was written into the sheet, where it styled
  // nothing at all. The engine rejects it here exactly like a browser does.
  const newlineNode = node('div', {
    className: 'dsh-two-line',
    attributes: { 'aria-label': '第一行\n第二行' },
    rect: { top: 10, left: 10, width: 200, height: 40 },
  });
  const newlineWrites = [];
  const newline = await boot({
    fetchImpl: async (url, init) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.x{color:red}' });
      if (url.endsWith('/write')) {
        newlineWrites.push(JSON.parse(init.body));
        return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      }
      throw new Error('unexpected request: ' + url);
    },
    // The pool does the hit testing; the matcher itself refuses a raw newline inside a
    // string, exactly like a browser's tokenizer, so this case needs no simulated probe.
    dom: { nodes: [newlineNode] },
  });
  await pickWith(newline, newlineNode);
  // The write goes through writeSheet, which reads the file first to confirm nobody moved
  // it — so it lands a microtask later than the click that started it.
  await settle();
  await settle();
  assert.strictEqual(newlineWrites.length, 1, 'the pick is written');
  assert.ok(
    newlineWrites[0].css.includes('第一行\\a 第二行'),
    'a newline in the value is escaped for the selector — written: ' + JSON.stringify(newlineWrites[0].css),
  );
  assert.ok(
    !newlineWrites[0].css.includes('第一行\n第二行'),
    'and the raw newline never reaches the sheet — written: ' + JSON.stringify(newlineWrites[0].css),
  );

  // --- an unprobeable candidate must not win as if it were unique ----------
  // "Unknown" is not "one". A candidate whose match count cannot be obtained must not take
  // the bonus uniqueness grants: otherwise the least trustworthy candidate becomes the
  // default precisely because nobody could check it.
  const unknownWrites = [];
  const unknownLabels = [];
  const unknown = await boot({
    fetchImpl: async (url, init) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.x{color:red}' });
      if (url.endsWith('/write')) {
        unknownWrites.push(JSON.parse(init.body));
        return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      }
      throw new Error('unexpected request: ' + url);
    },
    dom: {
      nodes: pickPool,
      // The best-evidence candidate is the one that cannot be probed here, which the pool
      // cannot express — this is the deliberate simulation seam: an engine that refuses to
      // answer. Everything else answers "unique", so a unique alternative exists and must win.
      probe: (selector) => {
        if (String(selector).includes('aria-label')) throw new Error('cannot probe');
        return 1;
      },
    },
  });
  await pickWith(unknown, pickedTarget, () => {
    const board = unknown.document.body.children.find(child => child.className === 'dshCc_pickPanel');
    for (const row of (board?.children ?? [])[1]?.children ?? []) unknownLabels.push(row.textContent);
  });
  await settle();
  await settle();
  assert.strictEqual(unknownWrites.length, 1, 'the pick is written');
  assert.ok(
    unknownLabels.some(label => label.includes('命中数未知')),
    'and the panel says the count is unknown instead of dressing up a failure as a number — '
      + 'labels: ' + JSON.stringify(unknownLabels),
  );
  assert.ok(
    unknownWrites[0].css.includes('div.dsh-music-qq-head'),
    'a candidate nobody could probe does not win the default — written: ' + JSON.stringify(unknownWrites[0].css),
  );

  // --- the token chips must not offer a token of the wrong kind or scope ---
  // The value → names map is keyed by VALUE, so unrelated tokens share a key: DSH really does
  // carry `--dsl-terminal-line-height: 22px` next to anything else that is 22px, and the old
  // "fall back to the first name" produced `border-radius: var(--dsl-terminal-line-height)` —
  // a rule that resolves to nothing. A token also only counts where its defining rule matches
  // the element: one declared inside another component's card is not in scope for a rule the
  // user writes for an element outside it.
  const tokenBoot = async (styleSheets, computed) => boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.x{color:red}' });
      if (url.endsWith('/write')) return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      throw new Error('unexpected request: ' + url);
    },
    dom: { nodes: pickPool, styleSheets, computed },
  });
  /** Arm the picker, select the element, and read the token chips the panel offers. */
  const chipsFor = async (harness) => {
    hookIndex = 0;
    const view = harness.registrations[0].component();
    await harness.runEffects();
    buttonWith(view, '拾取元素').props.onClick();
    hookIndex = 0;
    harness.registrations[0].component();
    await harness.runEffects();
    harness.dispatch('pointermove', { clientX: 30, clientY: 50 });
    harness.dispatch('click', { target: pickedTarget, clientX: 30, clientY: 50, preventDefault() {}, stopPropagation() {} });
    const board = harness.document.body.children.find(child => child.className === 'dshCc_pickPanel');
    const row = (board?.children ?? [])[2];
    return (row?.children ?? []).map(child => child.textContent);
  };
  /** One stylesheet double whose single rule carries these custom properties. */
  const sheetOf = (names, values, selectorText) => {
    const style = [...names];
    style.getPropertyValue = name => values[name] ?? '';
    const rule = { style };
    if (selectorText !== undefined) rule.selectorText = selectorText;
    return { cssRules: [rule] };
  };

  const wrongKind = await tokenBoot(
    [sheetOf(['--dsl-terminal-line-height'], { '--dsl-terminal-line-height': '22px' })],
    { getPropertyValue: name => (name === 'border-radius' ? '22px' : '') },
  );
  assert.deepStrictEqual(
    await chipsFor(wrongKind), [],
    'a token whose name does not read like the property is not offered at all',
  );

  const outOfScope = await tokenBoot(
    [
      sheetOf(['--dsw-alias-corner-full'], { '--dsw-alias-corner-full': '22px' }, '.CY-8Ka_terminal'),
      sheetOf(['--dsl-terminal-line-height'], { '--dsl-terminal-line-height': '22px' }, ':root'),
    ],
    { getPropertyValue: name => (name === 'border-radius' ? '22px' : '') },
  );
  assert.deepStrictEqual(
    await chipsFor(outOfScope), [],
    'and a token defined inside another component is not offered for an element outside it',
  );

  // The other half: a token that IS in scope and DOES read like the property is still offered.
  const inScope = await tokenBoot(
    [sheetOf(['--dsw-alias-corner-full'], { '--dsw-alias-corner-full': '22px' }, ':root')],
    { getPropertyValue: name => (name === 'border-radius' ? '22px' : '') },
  );
  assert.deepStrictEqual(
    await chipsFor(inScope), ['border-radius: var(--dsw-alias-corner-full)'],
    'a global token of the right kind is still suggested',
  );

  // --- a rule appended far down must be revealed, not just selected --------
  // The picker writes a new rule at the END of the sheet. The caret was moved to it, but
  // nothing brought it into view: the textarea was left wherever it was, and the colour layer
  // and gutter — which this plugin positions by transform, because they cannot scroll — were
  // never told either. So 插入规则 looked like it had done nothing to a 60-line sheet.
  const longSheet = Array.from({ length: 60 }, (_, index) => '.line-' + index + ' { color: red; }').join('\n');
  const revealed = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: longSheet });
      if (url.endsWith('/write')) return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      throw new Error('unexpected request: ' + url);
    },
    dom: { nodes: pickPool },
  });
  const revealedPick = await pickWith(revealed);
  // The two layers are positioned from refs, so a double has to be in place before the pass
  // that consumes the handoff — that is the pass this test is about.
  hookIndex = 0;
  const revealedView = revealed.registrations[0].component();
  const highlightLayer = findNode(revealedView, 'pre').props.ref;
  highlightLayer.current = { style: {} };
  let gutterLayer = null;
  (function findGutter(node) {
    if (gutterLayer !== null || node === null || typeof node !== 'object') return;
    if (String(node.props?.className ?? '') === 'dshCc_gutterInner') {
      gutterLayer = node.props.ref;
      return;
    }
    for (const child of node.children ?? []) findGutter(child);
  })(revealedView);
  gutterLayer.current = { style: {} };
  await revealed.runEffects();
  const sheetWithRule = revealed.userStyle().textContent;
  assert.strictEqual(
    revealedPick.carets.length, 1,
    'the picker places the caret once — got: ' + JSON.stringify(revealedPick.carets),
  );
  const caretOffset = revealedPick.carets[0][0];
  const caretLine = sheetWithRule.slice(0, caretOffset).split('\n').length - 1;
  const lineTop = caretLine * 19;
  const port = revealedPick.editor.props.ref.current;
  assert.ok(
    lineTop >= port.scrollTop && lineTop + 19 <= port.scrollTop + port.clientHeight,
    'the caret line is inside the scroll port — line ' + caretLine + ' at ' + lineTop
      + ', port ' + port.scrollTop + '..' + (port.scrollTop + port.clientHeight),
  );
  assert.ok(port.scrollTop > 0, 'and the view actually moved down — scrollTop: ' + port.scrollTop);
  assert.strictEqual(
    highlightLayer.current.style.transform,
    'translate(' + (-(port.scrollLeft ?? 0)) + 'px,' + (-port.scrollTop) + 'px)',
    'the colour layer follows the scroll it did not make itself',
  );
  assert.strictEqual(
    gutterLayer.current.style.transform,
    'translateY(' + (-port.scrollTop) + 'px)',
    'and so does the gutter',
  );

  // --- a pick taken mid-debounce must still report "已保存" -----------------
  // The picker takes this row's pending debounced write out of the way before it writes
  // through: without that, the stale text fires after the pick and puts the old sheet
  // back, with no error anywhere. That handoff was one-way — the take-over cancelled the
  // very timer whose completion the footer was waiting on, and nothing ever replaced it.
  // The result was a sheet written to disk and a footer stuck on "保存中" until the next
  // keystroke. The contract needs both directions: take over, then report back.
  const handoffWrites = [];
  const handoff = await boot({
    fetchImpl: async (url, init) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.x{color:red}' });
      if (url.endsWith('/write')) {
        handoffWrites.push(JSON.parse(init.body));
        return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      }
      throw new Error('unexpected request: ' + url);
    },
    dom: { nodes: pickPool },
  });
  hookIndex = 0;
  renderedText.length = 0;
  const handoffRow = handoff.registrations[0].component();
  await handoff.runEffects();
  findNode(handoffRow, 'textarea').props.onChange({
    target: { value: '.x{color:blue}', selectionStart: 13 },
    nativeEvent: { inputType: 'insertText' },
  });
  assert.strictEqual(
    handoff.debounces(WRITE_TICK).length, 1,
    'typing schedules exactly one write',
  );
  hookIndex = 0;
  renderedText.length = 0;
  const typedRow = handoff.registrations[0].component();
  await handoff.runEffects();
  assert.ok(
    renderedText.some(text => text.includes('保存中')),
    'and the footer says 保存中 while that write is pending — status was: ' + JSON.stringify(renderedText),
  );

  // Pick inside the 400 ms window: the write the footer is waiting on is taken over.
  buttonWith(typedRow, '拾取元素').props.onClick();
  hookIndex = 0;
  handoff.registrations[0].component();
  await handoff.runEffects();
  handoff.dispatch('pointermove', { clientX: 30, clientY: 50 });
  handoff.dispatch('click', { target: pickedTarget, clientX: 30, clientY: 50, preventDefault() {}, stopPropagation() {} });
  handoff.dispatch('keydown', { key: 'Enter', preventDefault() {} });

  assert.strictEqual(
    handoff.debounces(WRITE_TICK).length, 0,
    'the pending debounced write is taken over rather than left to fire',
  );
  // The pick writes through `writeSheet`, which reads the file first (see T1b), so give the
  // two round trips a chance to happen before counting writes.
  await settle();
  await settle();
  assert.strictEqual(
    handoffWrites.length, 1,
    'and it never reaches the host on its own: the pick is the only write — got: ' + JSON.stringify(handoffWrites),
  );
  assert.strictEqual(
    handoffWrites[0].css,
    '.x{color:blue}\n\ndiv.dsh-music-qq-head {\n  \n}',
    'the sheet holds the pick, not the text that was still inside the debounce',
  );
  await settle();
  hookIndex = 0;
  renderedText.length = 0;
  handoff.registrations[0].component();
  assert.ok(
    renderedText.some(text => text.includes('已保存')),
    'the take-over reports back, so the footer does not stay stuck on 保存中 — status was: ' + JSON.stringify(renderedText),
  );
  assert.ok(
    !renderedText.some(text => text.includes('保存中')),
    'and 保存中 is not left on screen — status was: ' + JSON.stringify(renderedText),
  );

  // --- the write a pick takes over must not report for the sheet either -----
  // `takeOver` cancels a *pending* debounce, but a request already on the wire cannot be
  // cancelled: its response still arrives. Before the handoff bumped the row's epoch, that
  // response announced "已保存" while the picker's own, newer write was the one still in
  // flight — the same lie the typing path's epoch was introduced for, one layer out.
  const inflight = [];
  const taken = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.x{color:red}' });
      if (url.endsWith('/write')) {
        await new Promise(resolve => inflight.push(resolve));
        return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
      }
      throw new Error('unexpected request: ' + url);
    },
    dom: { nodes: pickPool },
  });
  /** The footer as the current state renders it. */
  const footerOf = (harness) => {
    hookIndex = 0;
    renderedText.length = 0;
    harness.registrations[0].component();
    return renderedText.join(' | ');
  };
  hookIndex = 0;
  const takenRow = taken.registrations[0].component();
  await taken.runEffects();
  findNode(takenRow, 'textarea').props.onChange({
    target: { value: '.x{color:blue}', selectionStart: 13 },
    nativeEvent: { inputType: 'insertText' },
  });
  await taken.runTimers();
  assert.strictEqual(inflight.length, 1, 'the debounced write is on the wire');
  buttonWith(takenRow, '拾取元素').props.onClick();
  hookIndex = 0;
  taken.registrations[0].component();
  await taken.runEffects();
  taken.dispatch('pointermove', { clientX: 30, clientY: 50 });
  taken.dispatch('click', { target: pickedTarget, clientX: 30, clientY: 50, preventDefault() {}, stopPropagation() {} });
  taken.dispatch('keydown', { key: 'Enter', preventDefault() {} });
  // Same read-then-write as above: the second request is on the wire a microtask later.
  await settle();
  await settle();
  assert.strictEqual(inflight.length, 2, 'and the pick writes through on top of it');
  // The taken-over write answers first — it must not speak for the sheet.
  inflight[0]();
  await settle();
  await settle();
  assert.ok(
    footerOf(taken).includes('保存中'),
    'a superseded write cannot claim 已保存 while the pick is still in flight — status was: ' + footerOf(taken),
  );
  inflight[1]();
  await settle();
  assert.ok(
    footerOf(taken).includes('已保存'),
    'the pick reports back once its own write lands — status was: ' + footerOf(taken),
  );

  // --- 历史版本 (the versions page of the actions menu) ----------------------
  // The Host keeps what each write replaced (see tests/host-api-smoke.mjs). Nothing in the
  // editor can reach it — the rows and the panel are all about the CURRENT text — so the way
  // back is a menu page of its own, and these assertions are about that page: it opens from
  // the actions menu without closing it, it shows the versions the Host reported, and picking
  // one leaves the editor on the restored text.
  const RESTORED_SHEET = '.x{color:red}\n.edited { color: lime; }';
  /**
   * The text the editor holds before the restore — deliberately not what the file holds, so
   * the edit is a real one: a no-op edit records nothing in the undo history, and the
   * "Ctrl+Z must not undo a restore" assertion would then hold for the wrong reason.
   */
  const EDITED_SHEET = '.x{color:red}\n.edited { color: lime; }\n.changed { color: blue; }';
  const versionEntries = [
    { stamp: '1746147784000', bytes: 1200, mtime: 1746147784000 },
    { stamp: '1746061384000', bytes: 24, mtime: 1746061384000 },
  ];
  /** What the file holds; a write to it moves this on, the way the Host would. */
  let sheetNow = '.x{color:red}\n\n.changed { color: blue; }';
  const historyCalls = [];
  const restores = [];
  const historyWrites = [];
  const historic = await boot({
    fetchImpl: async (url, init) => {
      historyCalls.push(url);
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/history')) return jsonResponse({ ok: true, name: 'custom.css', entries: versionEntries });
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: sheetNow });
      if (url.endsWith('/restore')) {
        restores.push(JSON.parse(init.body));
        sheetNow = RESTORED_SHEET;
        return jsonResponse({ ok: true, name: 'custom.css', bytes: RESTORED_SHEET.length });
      }
      if (url.endsWith('/write')) {
        const body = JSON.parse(init.body);
        historyWrites.push(body);
        sheetNow = body.css;
        return jsonResponse({ ok: true, name: 'custom.css', bytes: body.css.length });
      }
      throw new Error('unexpected request: ' + url);
    },
  });
  /**
   * A stamp as the menu writes it — computed here, not hard-coded: `formatStamp` reads the
   * timestamp in the LOCAL zone, and pinning one would make this suite pass or fail by the
   * machine's clock rather than by the code.
   */
  const stampLabel = (stamp) => {
    const at = new Date(Number(stamp));
    const pad = (value) => String(value).padStart(2, '0');
    return pad(at.getMonth() + 1) + '-' + pad(at.getDate())
      + ' ' + pad(at.getHours()) + ':' + pad(at.getMinutes()) + ':' + pad(at.getSeconds());
  };
  hookIndex = 0;
  const historyView = historic.registrations[0].component();
  await historic.runEffects();
  const historyArea = findNode(historyView, 'textarea');
  const historyCarets = [];
  historyArea.props.ref.current = {
    selectionStart: 0,
    scrollTop: 0,
    scrollLeft: 0,
    clientHeight: 140,
    focus() {},
    setSelectionRange(start) { historyCarets.push(start); },
  };
  // An edit of this session, so the undo stack is demonstrably aimed at the text the restore
  // is about to replace — and the debounce is landed, so the edit stays reachable (an
  // unsaved edit is dropped when the sheet is reopened, and the undo stack with it).
  historyArea.props.onChange({
    target: { value: EDITED_SHEET, selectionStart: 35 },
    nativeEvent: { inputType: 'insertText' },
  });
  await historic.runTimers();
  await settle();
  hookIndex = 0;
  renderedText.length = 0;
  let versionsView = historic.registrations[0].component();
  assert.ok(!renderedText.some(text => text.includes('历史版本')), 'the versions page is not inline in the row');
  const triggerNode = buttonWith(versionsView, '更多操作');
  triggerNode.props.onClick();
  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  versionsView = historic.registrations[0].component();
  const historyEntry = buttonWith(versionsView, '历史版本');
  assert.ok(historyEntry !== null, 'the actions menu offers 历史版本 — menu: ' + JSON.stringify(renderedText));
  historyEntry.props.onClick();
  await settle();
  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  versionsView = historic.registrations[0].component();
  assert.ok(
    historyCalls.some(url => url.includes('/history?name=custom.css')),
    'the page asks the Host for this sheet versions — calls: ' + JSON.stringify(historyCalls),
  );
  for (const entry of versionEntries) {
    assert.ok(
      renderedText.some(text => text.includes(stampLabel(entry.stamp))),
      'the list shows when ' + entry.stamp + ' was taken — list: ' + JSON.stringify(renderedText),
    );
  }
  assert.ok(
    renderedText.includes('1.2 KB') && renderedText.includes('24 B'),
    'each version carries its size — list: ' + JSON.stringify(renderedText),
  );
  assert.ok(renderedClasses.includes('dshCc_versionsHead'), 'the page has a header of its own');
  // `renderedText` is the whole row — the file bar's own copy mentions 导出 in a tooltip — so
  // "the actions are gone" is asked of the menu's nodes rather than of the page's text.
  assert.ok(
    buttonWith(versionsView, '导出') === null && buttonWith(versionsView, '重置') === null,
    'and it replaces the actions rather than piling onto them — classes: ' + JSON.stringify(renderedClasses),
  );
  assert.ok(buttonWith(versionsView, '返回') !== null, 'the page offers a way back to the actions');

  // Picking a version hands the stamp to the Host and puts what comes back into the editor.
  buttonWith(versionsView, stampLabel(versionEntries[0].stamp)).props.onClick();
  await settle();
  await settle();
  assert.deepStrictEqual(
    restores.map(entry => ({ name: entry.name, stamp: entry.stamp })),
    [{ name: 'custom.css', stamp: versionEntries[0].stamp }],
    'the chosen version is the one restored — restores: ' + JSON.stringify(restores),
  );
  assert.strictEqual(
    historic.userStyle().textContent, RESTORED_SHEET,
    'the restored text is what the page is styled with — applied: ' + JSON.stringify(historic.userStyle().textContent),
  );
  assert.deepStrictEqual(
    historyWrites.map(entry => entry.css),
    [EDITED_SHEET],
    'the only save is the edit made here — the restore is the Host writing its own snapshot, not '
      + 'the editor saving over it — writes: ' + JSON.stringify(historyWrites),
  );
  hookIndex = 0;
  renderedText.length = 0;
  versionsView = historic.registrations[0].component();
  assert.strictEqual(
    findNode(versionsView, 'textarea').props.value, RESTORED_SHEET,
    'and the editor holds it too — editor: ' + JSON.stringify(findNode(versionsView, 'textarea').props.value),
  );
  assert.ok(
    renderedText.some(text => text.includes('已恢复')),
    'the outcome is reported on the page — status: ' + JSON.stringify(renderedText),
  );

  // Undo is deliberately emptied by a restore: the text it would walk back to is the text the
  // user just chose to leave, so Ctrl+Z must not reinstate it.
  const afterRestore = { key: 'z', ctrlKey: true, preventDefault() {} };
  hookIndex = 0;
  findNode(historic.registrations[0].component(), 'textarea').props.onKeyDown(afterRestore);
  await settle();
  assert.strictEqual(
    historic.userStyle().textContent, RESTORED_SHEET,
    'Ctrl+Z after a restore does not undo it — applied: ' + JSON.stringify(historic.userStyle().textContent),
  );

  // --- 查找 / 替换 与格式化 ---------------------------------------------------
  // The find bar is one of the few things here with a right answer that does not need a
  // browser: what counts as a hit, and where a hit is marked in the colour layer. The first
  // two blocks below are those two, straight against the internals; the third drives the row,
  // because "the toolbar opens it, Enter walks it, 替换 writes through the normal edit path"
  // is only true of the row.
  const probe = host.mod.__probe;

  // What counts as a hit. Case folding and overlapping are the two decisions worth pinning:
  // folding is ASCII-only (CSS identifiers ARE ASCII, and `toLowerCase()` moves offsets for
  // İ), and an overlapping query is two hits rather than one.
  assert.deepStrictEqual(
    [...probe.searchHits('border-radius: 4px; BORDER-RADIUS: 8px;', 'border-radius', false)].map(hit => hit.start),
    [0, 'border-radius: 4px; '.length],
    'a query is found however it is cased, and the hits are in document order',
  );
  assert.deepStrictEqual(
    [...probe.searchHits('border-radius: 4px; BORDER-RADIUS: 8px;', 'border-radius', true)].map(hit => hit.start),
    [0],
    'and only as written when 区分大小写 is on',
  );
  assert.strictEqual(
    probe.searchHits('.aaa { }', 'aa', false).length, 2,
    'an overlapping query is two hits, not one — stepping by the match length would miss the second',
  );
  assert.strictEqual(probe.searchHits('.a { }', '', false).length, 0, 'an empty query is no hits, not every offset');
  // A sheet holding a character that folds to MORE than one code unit: the hits are offsets
  // into the folded string, and everything after that character would be one off without the
  // map back. `.İ { }\n.A { }` is 9 characters; the `A` sits at 8, not at 7.
  const dotted = '.İ { }\n.A { }';
  assert.deepStrictEqual(
    [...probe.searchHits(dotted, 'a', false)].map(hit => hit.start), [dotted.indexOf('A')],
    'a fold that changes length does not push every later hit off by one',
  );
  assert.strictEqual(probe.searchHits('.İ { }\n.A { }', 'a', true).length, 0, 'and 区分大小写 still means case-sensitive');
  assert.strictEqual(probe.searchHits('.a { }\n.A { }', 'a', false).length, 2, 'the ordinary fold finds both spellings');
  const manyHits = probe.searchHits('.x{}\n.y{}\n.z{}', '}', false);
  assert.strictEqual(probe.hitAtOrAfter(manyHits, 0), 0, 'the bar lands on the first hit at the caret');
  assert.strictEqual(probe.hitAtOrAfter(manyHits, 6), 1, 'and on the next one once the caret has passed it');
  assert.strictEqual(probe.hitAtOrAfter(manyHits, 999), 0, 'and wraps to the top from the end of the sheet');
  assert.strictEqual(probe.hitAtOrAfter([], 0), -1, 'with no hits there is nowhere to land');

  // Where a hit is marked. The offsets the bar has are offsets into the text; the layer's
  // markup is what has to be marked, and the two stop agreeing the moment a `<` is escaped.
  const HIT_SHEET = '.a { color: red; }\n.b { color: red; }';
  const marked = probe.highlightCss(HIT_SHEET, [], probe.searchHits(HIT_SHEET, 'color', false), 1);
  assert.strictEqual(
    (marked.match(/<mark class="dshCc_hit"/g) ?? []).length, 1,
    'every hit is marked in the colour layer — layer: ' + marked,
  );
  assert.strictEqual(
    (marked.match(/<mark class="dshCc_hit dshCc_hitActive"/g) ?? []).length, 1,
    'and exactly the one the bar points at is singled out — layer: ' + marked,
  );
  assert.ok(
    marked.indexOf('dshCc_hitActive') > marked.indexOf('class="dshCc_hit"'),
    'the active mark is the second hit when the bar points at the second',
  );
  assert.ok(
    /<span class="dshCc_tokProp"> <mark class="dshCc_hit">color<\/mark><\/span>/.test(marked),
    'and the mark wraps the hit text, not the token span around it — layer: ' + marked,
  );
  // Escaping is the case the mark cannot be placed by arithmetic: `&` is one character of the
  // sheet and five of the markup, so a hit inside it would be marked five characters late.
  // The bar still counts it; the layer leaves it unmarked.
  const escaped = probe.highlightCss('.a { content: "&"; }', [], probe.searchHits('.a { content: "&"; }', '&', false), 0);
  assert.strictEqual(
    (escaped.match(/<mark/g) ?? []).length, 0,
    'a hit that lands inside an escaped character is left unmarked rather than marked off by four — layer: ' + escaped,
  );
  assert.ok(escaped.includes('&amp;'), 'and the character itself is still escaped — layer: ' + escaped);
  assert.strictEqual(
    (probe.highlightCss('.a { color: red; }', [], probe.searchHits('.a { color: red; }', 'red', false), 0)
      .match(/<mark/g) ?? []).length, 1,
    'while an ordinary hit in the same sheet is marked',
  );

  // The layer draws the same characters the textarea holds, or the two would drift apart
  // line by line. A mark adds markup, so it is stripped before comparing.
  const layerText = marked.replace(/<\/?mark[^>]*>/g, '').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.strictEqual(
    layerText, HIT_SHEET + '\n',
    'marking a hit leaves the layer drawing exactly the sheet text — layer text: ' + JSON.stringify(layerText),
  );

  // The row: the toolbar opens it, Enter walks it, 替换 writes one edit, 全部替换 writes them
  // all, Esc closes it.
  const SEARCH_SHEET = '.a { color: red; }\n.b { color: blue; }';
  let searchDisk = SEARCH_SHEET;
  const searchWrites = [];
  const searcher = await boot({
    fetchImpl: async (url, init) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: searchDisk });
      if (url.endsWith('/write')) {
        const body = JSON.parse(init.body);
        searchWrites.push(body);
        searchDisk = body.css;
        return jsonResponse({ ok: true, name: 'custom.css', bytes: body.css.length });
      }
      throw new Error('unexpected request: ' + url);
    },
  });
  hookIndex = 0;
  renderedText.length = 0;
  let searchView = searcher.registrations[0].component();
  await searcher.runEffects();
  assert.ok(buttonWith(searchView, '查找') !== null, 'the toolbar offers 查找 — text: ' + JSON.stringify(renderedText));
  assert.ok(!renderedClasses.includes('dshCc_findBar'), 'and the bar is not open until it is asked for');

  const searchArea = findNode(searchView, 'textarea');
  const searchCarets = [];
  // `.a { color: red; }` — `color` starts at 5 (the space and `{` are at 3 and 4).
  searchArea.props.ref.current = {
    selectionStart: SEARCH_SHEET.indexOf('color'),
    selectionEnd: SEARCH_SHEET.indexOf('color') + 'color'.length,
    scrollTop: 0,
    scrollLeft: 0,
    clientHeight: 140,
    focus() {},
    setSelectionRange(start) { searchCarets.push(start); },
  };
  // Ctrl+F: the selection becomes the query, the way every editor's find bar works.
  const ctrlF = { key: 'f', ctrlKey: true, preventDefault() {} };
  hookIndex = 0;
  findNode(searcher.registrations[0].component(), 'textarea').props.onKeyDown(ctrlF);
  hookIndex = 0;
  renderedClasses.length = 0;
  searchView = searcher.registrations[0].component();
  assert.ok(renderedClasses.includes('dshCc_findBar'), 'Ctrl+F opens the bar');
  const fields = [];
  (function collect(node) {
    if (node === null || typeof node !== 'object') return;
    if (node.type === 'input') fields.push(node.props);
    for (const child of node.children ?? []) collect(child);
  })(searchView);
  const findField = fields.find(field => field['aria-label'] === '查找');
  const replaceField = fields.find(field => field['aria-label'] === '替换为');
  assert.ok(findField !== undefined && replaceField !== undefined, 'the bar has a 查找 field and a 替换为 field');
  assert.strictEqual(findField.value, 'color', 'the editor selection became the query — value: ' + JSON.stringify(findField.value));
  assert.ok(renderedText.includes('1 / 2'), 'the bar says which hit it is on — text: ' + JSON.stringify(renderedText));
  // Opening the bar puts the caret on the hit it points at: the first one at or after where
  // the caret already was. It is the effect that moves it, so the layers get synced too.
  await searcher.runEffects();
  assert.deepStrictEqual(
    [...searchCarets], [SEARCH_SHEET.indexOf('color')],
    'opening the bar takes the caret to the hit it points at — carets: ' + JSON.stringify(searchCarets),
  );
  // Enter walks: the bar was pointing at the first hit, so Enter goes to the second, and one
  // more wraps to the top again. Shift+Enter walks back.
  const pressEnter = async (modifiers = {}) => {
    hookIndex = 0;
    findNode(searcher.registrations[0].component(), 'textarea')
      .props.onKeyDown({ key: 'Enter', preventDefault() {}, ...modifiers });
    await searcher.runEffects();
  };
  await pressEnter();
  await pressEnter();
  await pressEnter({ shiftKey: true });
  await pressEnter();
  assert.deepStrictEqual(
    [...searchCarets],
    [SEARCH_SHEET.indexOf('color'), SEARCH_SHEET.lastIndexOf('color'), SEARCH_SHEET.indexOf('color'),
      SEARCH_SHEET.lastIndexOf('color'), SEARCH_SHEET.indexOf('color')],
    'Enter walks to the next hit and wraps around, and Shift+Enter walks back — carets: ' + JSON.stringify(searchCarets),
  );

  // The case toggle is the one control in the bar whose state is invisible in the field's
  // text: a pressed `Aa` has to LOOK pressed, or the user cannot tell which search they are
  // running. The class is the assertion; the appearance is the user's to confirm.
  hookIndex = 0;
  searchView = searcher.registrations[0].component();
  const caseBtn = buttonWith(searchView, 'Aa');
  assert.ok(caseBtn !== null, 'the bar has a case toggle');
  assert.strictEqual(caseBtn.props['aria-pressed'], false, 'and it starts unpressed');
  assert.ok(
    !String(caseBtn.props.className).includes('dshCc_findOn'),
    'with no pressed styling while it is off',
  );
  caseBtn.props.onClick();
  hookIndex = 0;
  renderedText.length = 0;
  searchView = searcher.registrations[0].component();
  const caseBtnOn = buttonWith(searchView, 'Aa');
  assert.strictEqual(caseBtnOn.props['aria-pressed'], true, 'clicking it presses it');
  assert.ok(
    String(caseBtnOn.props.className).includes('dshCc_findOn'),
    'and the pressed state carries a class of its own — a toggle nobody can see is a toggle '
      + 'nobody can use — className: ' + JSON.stringify(caseBtnOn.props.className),
  );
  // Back to case-insensitive for the rest of the block.
  caseBtnOn.props.onClick();
  hookIndex = 0;
  searchView = searcher.registrations[0].component();
  assert.strictEqual(buttonWith(searchView, 'Aa').props['aria-pressed'], false, 'and clicking again releases it');

  // 替换: one edit through the normal path, so one debounced write and one undo step.
  hookIndex = 0;
  renderedText.length = 0;
  searchView = searcher.registrations[0].component();
  const replaceInput = (function find(node) {
    if (node === null || typeof node !== 'object') return null;
    if (node.type === 'input' && node.props['aria-label'] === '替换为') return node;
    for (const child of node.children ?? []) {
      const hit = find(child);
      if (hit !== null) return hit;
    }
    return null;
  })(searchView);
  replaceInput.props.onChange({ target: { value: 'background' } });
  hookIndex = 0;
  searchView = searcher.registrations[0].component();
  buttonWith(searchView, '替换').props.onClick();
  await searcher.runTimers();
  await settle();
  assert.deepStrictEqual(
    searchWrites.map(entry => entry.css),
    ['.a { background: red; }\n.b { color: blue; }'],
    '替换 writes the sheet with that one hit replaced — writes: ' + JSON.stringify(searchWrites),
  );
  hookIndex = 0;
  searchView = searcher.registrations[0].component();
  assert.ok(
    renderedText.includes('1 / 1'),
    'and the hit list shrank to the one that is left — text: ' + JSON.stringify(renderedText),
  );
  // 全部替换: still one edit, and now nothing is left to find.
  buttonWith(searchView, '全部替换').props.onClick();
  await searcher.runTimers();
  await settle();
  assert.deepStrictEqual(
    searchWrites.map(entry => entry.css),
    ['.a { background: red; }\n.b { color: blue; }', '.a { background: red; }\n.b { background: blue; }'],
    '全部替换 replaces every hit in one edit — writes: ' + JSON.stringify(searchWrites),
  );
  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  searchView = searcher.registrations[0].component();
  assert.ok(renderedText.includes('无命中'), 'and says so when nothing is left — text: ' + JSON.stringify(renderedText));
  assert.ok(
    renderedClasses.includes('dshCc_findCountBad'),
    'the count turns into a problem when the query matches nothing',
  );

  // Esc closes the bar and hands the caret back to the editor.
  findNode(searchView, 'input').props.onKeyDown({ key: 'Escape', preventDefault() {} });
  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  searchView = searcher.registrations[0].component();
  assert.ok(!renderedClasses.includes('dshCc_findBar'), 'Esc closes the bar');

  // 格式化: a whole-sheet edit, one undo step, and the same sheet the scanner already read.
  // 格式化 re-flows the LINES: one rule per line, two spaces per nesting level, blank lines
  // gone. It deliberately does not paraphrase what is inside a line — a missing `;` or a
  // missing space before `{` is the validator's business, and a formatter that rewrote
  // declarations would be making changes the user never asked for.
  const messy = '.a{color:red}\n\n.b { color: blue; }\n@media (min-width: 600px) {\n.c{color:lime}\n}';
  /** Every write the formatter's row makes, so the assertion can name the text it sent. */
  const formatWrites = [];
  const tidy = probe.formatCss(messy);
  assert.strictEqual(
    tidy,
    ['.a{', '  color:red', '}', '.b {', '  color: blue;', '}',
      '@media (min-width: 600px) {', '  .c{', '    color:lime', '  }', '}'].join('\n') + '\n',
    '格式化 puts each brace on its own line and indents by nesting — got: ' + JSON.stringify(tidy),
  );
  assert.strictEqual(
    probe.formatCss('.a { color: red; }\n.b { color: blue; }'),
    '.a {\n  color: red;\n}\n.b {\n  color: blue;\n}\n',
    'and a one-line rule is opened up, its declaration kept exactly as it was written',
  );
  assert.strictEqual(
    probe.formatCss('.a { color: red; }\n\n\n.b { color: blue; }'),
    '.a {\n  color: red;\n}\n.b {\n  color: blue;\n}\n',
    'while the blank lines between rules do go',
  );
  assert.deepStrictEqual(
    [...probe.formatCss(tidy)], [...tidy],
    'and running it again changes nothing, so the menu entry has a state where it is disabled',
  );
  assert.strictEqual(
    probe.formatCss('.a { content: "}"; }\n.b { color: red; }'),
    '.a {\n  content: "}";\n}\n.b {\n  color: red;\n}\n',
    'a brace inside a string does not open or close a block',
  );
  assert.strictEqual(probe.formatCss('.a { color: red;'), '.a { color: red;', 'an unclosed sheet is left exactly as it is');
  assert.strictEqual(probe.formatCss('.a { color: red; } }'), '.a { color: red; } }', 'and so is one with a brace too many');

  const messyRow = await boot({
    fetchImpl: async (url, init) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: messy });
      if (url.endsWith('/write')) {
        const body = JSON.parse(init.body);
        formatWrites.push(body);
        return jsonResponse({ ok: true, name: 'custom.css', bytes: body.css.length });
      }
      throw new Error('unexpected request: ' + url);
    },
  });  hookIndex = 0;
  let messyView = messyRow.registrations[0].component();
  buttonWith(messyView, '更多操作').props.onClick();
  hookIndex = 0;
  messyView = messyRow.registrations[0].component();
  const formatItem = buttonWith(messyView, '格式化');
  assert.ok(formatItem !== null, 'the actions menu offers 格式化');
  assert.notStrictEqual(formatItem.props.disabled, true, 'and it is offered while the sheet is unformatted');
  formatItem.props.onClick();
  await messyRow.runTimers();
  await settle();
  assert.deepStrictEqual(
    formatWrites.map(entry => entry.css), [tidy],
    'the formatted sheet is what lands on disk — writes: ' + JSON.stringify(formatWrites),
  );
  hookIndex = 0;
  renderedText.length = 0;
  messyView = messyRow.registrations[0].component();
  const tidyLayer = findNode(messyView, 'pre').props.dangerouslySetInnerHTML.__html;
  const tidyText = tidyLayer.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.strictEqual(
    tidyText, tidy + '\n',
    'and the colour layer draws the formatted text, not the text that was there when it landed',
  );

  // --- 外部改动自动同步 ------------------------------------------------------
  // The user's report: 「我用文本编辑器修改 css 文件后保存为什么同步不到插件？」 The row now polls
  // the Host (see `WATCH_POLL_MS`), and the whole policy is the pure `externalChange` — so the
  // three outcomes are asserted directly first, and then through the row, because "the timer
  // calls it" is the half a pure function cannot say anything about.
  assert.strictEqual(probe.externalChange(7, 7, false), 'idle', 'the same revision is not a change');
  assert.strictEqual(probe.externalChange(7, 7, true), 'idle', 'even while the editor is dirty');
  assert.strictEqual(
    probe.externalChange(7, 8, false), 'adopt',
    'a moved revision with a clean editor is adopted — nothing can be lost',
  );
  assert.strictEqual(
    probe.externalChange(7, 8, true), 'conflict',
    'a moved revision with unsaved work is a question, never an overwrite',
  );
  assert.strictEqual(probe.externalChange(undefined, 8, false), 'idle', 'a sheet never looked at is not a change');
  assert.strictEqual(probe.externalChange(7, null, false), 'idle', 'an unreadable revision is not a change');

  let syncDisk = '.a { color: red; }';
  const syncWrites = [];
  const synced = await boot({
    fetchImpl: async (url, init) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: syncDisk });
      if (url.endsWith('/write')) {
        const body = JSON.parse(init.body);
        syncWrites.push(body);
        syncDisk = body.css;
        return jsonResponse({ ok: true, name: 'custom.css', bytes: body.css.length });
      }
      throw new Error('unexpected request: ' + url);
    },
  });
  hookIndex = 0;
  let syncView = synced.registrations[0].component();
  await synced.runEffects();
  const syncArea = findNode(syncView, 'textarea');
  const syncCarets = [];
  syncArea.props.ref.current = {
    selectionStart: 0,
    scrollTop: 0,
    scrollLeft: 0,
    clientHeight: 140,
    focus() {},
    setSelectionRange(start) { syncCarets.push(start); },
  };
  assert.ok(synced.intervals.length > 0, 'the row starts a poll for outside changes');
  assert.ok(
    synced.intervals.some(entry => entry.ms === 1500),
    'and it runs on the external-change interval — intervals: ' + JSON.stringify(synced.intervals.map(entry => entry.ms)),
  );

  // 1. A clean editor and a save in a text editor: the disk copy is adopted, with no prompt.
  syncDisk = '.a { color: blue; }\n.from-my-editor { color: lime; }';
  synced.touch('custom.css');
  await synced.tickIntervals();
  hookIndex = 0;
  renderedText.length = 0;
  syncView = synced.registrations[0].component();
  assert.strictEqual(
    findNode(syncView, 'textarea').props.value, syncDisk,
    'a save made outside shows up in the editor — editor: ' + JSON.stringify(findNode(syncView, 'textarea').props.value),
  );
  assert.strictEqual(
    synced.userStyle().textContent, syncDisk,
    'and it is applied to the page — applied: ' + JSON.stringify(synced.userStyle().textContent),
  );
  assert.ok(
    !renderedText.some(text => text.includes('已被改动')),
    'without asking anything: there was nothing to lose — status: ' + JSON.stringify(renderedText),
  );
  assert.ok(renderedText.some(text => text.includes('已保存')), 'and the footer reads as saved');

  // 2. The next poll finds nothing new: adoption advanced the baseline, so this cannot loop.
  const callsBefore = synced.calls.filter(call => call.url.includes('/read')).length;
  await synced.tickIntervals();
  await synced.tickIntervals();
  hookIndex = 0;
  syncView = synced.registrations[0].component();
  assert.strictEqual(
    findNode(syncView, 'textarea').props.value, syncDisk,
    'a second poll changes nothing',
  );
  assert.ok(
    synced.calls.filter(call => call.url.includes('/read')).length > callsBefore,
    'while still asking the Host each time — polls are cheap and the answer is what decides',
  );

  // 3. Unsaved work in the editor + an outside save: a question, not an adoption, and no write.
  syncArea.props.onChange({
    target: { value: '.a { color: teal; }', selectionStart: 19 },
    nativeEvent: { inputType: 'insertText' },
  });
  syncDisk = '.a { color: red; }\n.somebody-else { color: pink; }';
  synced.touch('custom.css');
  await synced.tickIntervals();
  hookIndex = 0;
  renderedText.length = 0;
  syncView = synced.registrations[0].component();
  assert.ok(
    renderedText.some(text => text.includes('已被改动')),
    'an outside save while the editor has unsaved work is raised as a conflict — status: '
      + JSON.stringify(renderedText),
  );
  assert.strictEqual(
    findNode(syncView, 'textarea').props.value, '.a { color: teal; }',
    'and the text the user was typing is still in the editor — editor: '
      + JSON.stringify(findNode(syncView, 'textarea').props.value),
  );

  // 4. A hidden page does not poll: nothing on screen to update, and the Host does not need the
  // load from a background tab.
  buttonWith(syncView, '重新载入').props.onClick();
  await settle();
  await settle();
  synced.document.visibilityState = 'hidden';
  const hiddenReads = synced.calls.length;
  await synced.tickIntervals();
  assert.strictEqual(
    synced.calls.length, hiddenReads,
    'a hidden page does not ask — calls: ' + JSON.stringify(synced.calls.slice(hiddenReads).map(call => call.url)),
  );
  synced.document.visibilityState = 'visible';

  // 5. The plugin's own write is not mistaken for somebody else's: the Host answers a write with
  // the revision that write produced, so the very next poll must find nothing to do.
  const beforeOwnWrite = syncWrites.length;
  syncArea.props.onChange({
    target: { value: '.a { color: orchid; }', selectionStart: 21 },
    nativeEvent: { inputType: 'insertText' },
  });
  await synced.runTimers();
  await settle();
  await settle();
  assert.strictEqual(syncWrites.length, beforeOwnWrite + 1, 'typing lands once');
  await synced.tickIntervals();
  hookIndex = 0;
  renderedText.length = 0;
  syncView = synced.registrations[0].component();
  assert.strictEqual(
    findNode(syncView, 'textarea').props.value, '.a { color: orchid; }',
    'and the next poll does not try to adopt it back over the editor — editor: '
      + JSON.stringify(findNode(syncView, 'textarea').props.value),
  );
  assert.ok(
    !renderedText.some(text => text.includes('已被改动')),
    'nor does it raise a conflict against this plugin own write — status: ' + JSON.stringify(renderedText),
  );

  // 6. Adoption drops the undo stack: it belongs to the text that was just replaced, and Ctrl+Z
  // stepping back into a version the file no longer has is exactly the kind of surprise this
  // feature is supposed to remove rather than add.
  syncArea.props.onChange({
    target: { value: '.a { color: plum; }', selectionStart: 18 },
    nativeEvent: { inputType: 'insertText' },
  });
  await synced.runTimers();
  await settle();
  syncDisk = '.a { color: gold; }\n.typed-elsewhere { color: navy; }';
  synced.touch('custom.css');
  await synced.tickIntervals();
  assert.strictEqual(synced.userStyle().textContent, syncDisk, 'the disk copy is adopted');
  hookIndex = 0;
  findNode(synced.registrations[0].component(), 'textarea').props.onKeyDown({ key: 'z', ctrlKey: true, preventDefault() {} });
  await settle();
  assert.strictEqual(
    synced.userStyle().textContent, syncDisk,
    'and Ctrl+Z does not undo it back to the text that was replaced — applied: '
      + JSON.stringify(synced.userStyle().textContent),
  );

  console.log('loader-smoke: OK — shape, slots, host apply, offline fallback, seeding, highlighting, completion, validation, rule panel, property dropdowns, sheet switch, shorthand parts, save state machine, editor undo, sheet outline, variable check, capped scroll containers, picker write handoff, rule reopen handoff, string-aware scanning, comments in a declaration head, opaque url()s and nested blocks, comments in every scanner, panel binding, click targets, completion guards, element picker, selector escaping, picker label gate, no orphan CSS, honest DOM stubs, caret reveal, token scope and kind, unmount flush verified, history versions verified, find and replace verified, format verified, external sync verified');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
