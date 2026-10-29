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
/**
 * The module text this suite runs, with line endings normalised to LF.
 *
 * The anchor below is compared against this text, and it is a multi-line literal: a file that has
 * been rewritten by a tool that mixes CRLF and LF makes the literal and the file disagree by one
 * `\r` — which reads as "the module no longer exports the way this suite patches in" while the
 * export is in plain sight. Line endings carry no meaning in JavaScript, so normalising here is
 * honest rather than a workaround: the suite asserts the CODE, not the byte style.
 */
const source = fs.readFileSync(path.join(pluginRoot, 'lib', 'client.js'), 'utf8').replace(/\r\n/g, '\n');
/**
 * The module text this suite runs.
 *
 * A few internals are exposed by name through `__probe`: the dropdown placement math, the
 * find bar's scan and its hit markup, the formatter, the rule-highlight resolver, and the
 * highlight painter itself. Each decides something a user sees directly, and nothing else
 * about the text changes — the export is additive and the plugin never looks at it.
 * Everything else is asserted through the components, as usual.
 */
const EXPORTS_ANCHOR = `		exports.apply = apply;
		exports.inject = inject;`;
assert.ok(source.includes(EXPORTS_ANCHOR), 'the module still exports the way this suite patches in');
const code = source.replace(EXPORTS_ANCHOR, EXPORTS_ANCHOR + `
		exports.__probe = { placeMenu, searchHits, hitAtOrAfter, markMatches, highlightCss, formatCss, externalChange, resolveSelector, diagnoseElement, sheetFindings, sheetStyleFindings, glassEnabled, colorAlpha, pageBackdropOf, canvasFitScale, canvasTranslate, canvasDragTo, readCanvasBackground, CANVAS_BACKGROUNDS, paintHighlightBoxes, clearHighlights, paintRoot, valueInvalid, previewChipsFor, clampPan, previewModel, buildSample, captureSampleStyles, previewTargetSelector, hashText, paintModelInto, applyCanvasPan, applyCanvasFit, canvasBoundsOf, PreviewBlock, liveHighlightBoxes: () => highlightBoxes, ui, fitMenuToTrigger, openSettingsSurface, authoringApi: () => window.dshCss, createAuthoringApi, wallpaperCss, normalizeWallpaper, wallpaperUrlAllowed, applyWallpaper, commitWallpaper, openWallpaperSection, normalizeSettings, rotateIntervalMs, commitSettings, settingsSnapshot: () => settingsStore.snapshot(), wallpaperSnapshot: () => wallpaperStore.snapshot(), syncWallpaperClock, rotateWallpaperOnce, syncWallpaperRotation, clockId: () => CLOCK_ELEMENT_ID, bodyList: () => document.body.children.map(child => child.tagName + '#' + child.id).join(','), appendStray: (id) => { const made = document.createElement('div'); made.id = id; document.body.appendChild(made); return document.body.children.length; } };`);

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
/**
 * Bundle ids the plugin manager was asked to open, across boots.
 *
 * Module scope rather than per-boot on purpose: the navigation double is created inside `boot`,
 * while the click that talks to it happens in the case body — and each boot builds its own module
 * instance, so a per-boot list would be read from the wrong instance and look empty. `boot` clears
 * it, so a call recorded here is always this boot's.
 */
const navigationCalls = [];

/**
 * The effect a hook slot records.
 *
 * Shared by `useEffect` and `useLayoutEffect` because the harness has no paint, so
 * the ONLY thing that separates them here is that React runs one earlier — a
 * distinction nothing in a headless smoke test can observe. Extracted rather than
 * aliased because the object literal cannot reference itself while it is being
 * built (`fakeReact.useEffect` inside `fakeReact`'s own literal is a TDZ throw).
 * @param effect - the callback React would run.
 * @param deps - the dependency array, or undefined for "every commit".
 */
function runEffect(effect, deps) {
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
}

/**
 * Run `fn` with a fresh hook-slot array, then put the caller's slots back.
 *
 * The harness keeps ONE slot array for «whatever is rendering», the way React keeps one per
 * component instance. A test that renders a second component (the preview block, which is a real
 * component now) and leaves its slots in place makes the next row render read the wrong state —
 * a corruption that looks exactly like a product bug. Renders that need to share state across
 * calls go in the SAME `fn`, which is what one component instance is.
 * @param fn - the render work.
 * @returns whatever `fn` returns.
 */
function withFreshSlots(fn) {
  const saved = hookSlots.splice(0, hookSlots.length);
  hookIndex = 0;
  try {
    return fn();
  }
  finally {
    hookSlots.splice(0, hookSlots.length);
    for (const slot of saved) hookSlots.push(slot);
    hookIndex = 0;
  }
}

/**
 * A component "instance" for tests: its own hook-slot array, swapped in on demand.
 *
 * `useState`'s setter writes into the CURRENT slot array, so a test cannot render a component,
 * swap its slots out, click one of its buttons, and expect the click to land — it would write
 * into whatever component is mounted at that moment. Everything that touches the component
 * (render, click, key) therefore goes through `act`.
 * @param render - `(props) => element` for the component.
 * @returns `{ render, act }`.
 */
function componentIsland(render) {
  let slots = [];
  const run = (fn) => {
    const saved = hookSlots.splice(0, hookSlots.length);
    for (const slot of slots) hookSlots.push(slot);
    hookIndex = 0;
    try {
      return fn();
    }
    finally {
      slots = hookSlots.splice(0, hookSlots.length);
      for (const slot of saved) hookSlots.push(slot);
      hookIndex = 0;
    }
  };
  return {
    render: (props) => run(() => render(props)),
    act: (fn) => run(fn),
  };
}

const fakeReact = {
  useState(initial) {
    const index = beginHook();
    if (hookSlots[index] === undefined) hookSlots[index] = typeof initial === 'function' ? initial() : initial;
    return [hookSlots[index], (next) => {
      hookSlots[index] = typeof next === 'function' ? next(hookSlots[index]) : next;
    }];
  },
  useEffect: runEffect,
  /**
   * `useMemo`, with React's own caching rule: recompute only when the deps array changed.
   *
   * Not just `factory()`: the preview block's whole "don't recompute the model on every keystroke"
   * contract is this hook, and an uncached double would hide a broken deps array by recomputing
   * anyway. Cached, a wrong deps array shows up as a stale model — which is a visible failure.
   * @param factory - the computation.
   * @param deps - the dependency array.
   * @returns the cached or fresh value.
   */
  useMemo(factory, deps) {
    const index = beginHook();
    const slot = hookSlots[index] ?? { value: undefined, deps: undefined, ran: false };
    slot.hit = slot.ran === true && sameDeps(slot.deps, deps);
    if (!slot.hit) {
      slot.value = factory();
      slot.deps = deps;
      slot.ran = true;
    }
    hookSlots[index] = slot;
    return slot.value;
  },
  useRef(value) {
    const index = beginHook();
    if (hookSlots[index] === undefined) hookSlots[index] = { current: value };
    return hookSlots[index];
  },
  // React runs this one before paint, which is the entire reason the plugin uses it:
  // it measures its anchor there so the menu never paints at a stale position. There
  // is no paint in this harness, so it shares useEffect's implementation — but it has
  // to EXIST, or the row throws instead of rendering and every assertion below would
  // be measuring a crashed component rather than the behaviour it names.
  useLayoutEffect: runEffect,
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

/**
 * Every node under one root, in document order.
 *
 * The harness needs this in two places now: the selector pool it matches against, and
 * `document.getElementById` — a real lookup walks the tree, and a stub that only knew about the
 * style tags it keeps a list of could not find the wallpaper clock the plugin had just appended.
 * @param root - the node to walk.
 * @returns every descendant, excluding the root.
 */
function collectNodes(root) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children ?? []) {
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
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

/**
 * Boot one client module into a fake page.
 *
 * `supports` is the `CSS.supports` the sandbox gets, and `undefined` is a **meaningful**
 * configuration rather than a missing one: the plugin's own `supported()` answers `true` when
 * the engine cannot be asked, which is the right behaviour for a browser without the API. A
 * boot that wants to observe "this value was rejected" has to supply a stub — and a boot that
 * does not want that should leave it alone.
 *
 * Writing a general-purpose stub for the value-field assertions was attempted and abandoned:
 * it rejected `space-between` and `var(--dsw-…)`, and re-implementing a CSS engine inside a
 * test bed is the wrong shape of solution. Those assertions are scoped to the half that needs
 * no engine, and the rest of that behaviour is verified in the browser.
 */
async function boot({ fetchImpl, stored = new Map(), supports, dom = {}, serviceMissing = false, seatsIdle = false, locale = null }) {
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
  navigationCalls.length = 0;
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
      // `Node.contains`, which the plugin needs to tell "this matched element is my own chrome"
      // from "this matched element is page content". Its absence was not a missing convenience:
      // the plugin filters with `owner.contains(node)`, so an undefined answer read as "no, this
      // is not mine" for every node, and the filter emptied the result set instead of narrowing
      // it — which took the pick session down with it.
      contains(other) {
        for (let el = other; el !== null && el !== undefined; el = el.parentElement) {
          if (el === node) return true;
        }
        return false;
      },
      remove() {
        // The head owns a style tag and holds no `children` list of its own, so a tag that was
        // never explicitly parented is taken out of `styleTags` — which is where the head put it.
        const owner = node.parentElement ?? null;
        const list = owner === null || !Array.isArray(owner.children) ? styleTags : owner.children;
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
    // A real document has one, and the wallpaper clock reads it before repainting: a page that is
    // hidden has nothing to show, and the readout it would paint is the one it will paint again
    // when it comes back.
    hidden: false,
    head: {
      appendChild: element => {
        styleTags.push(element);
        // The head is the owner, and `remove()` asks it to take the tag out. `head.insertBefore`
        // sets the same thing, because both routes into the head are used.
        element.parentElement = document.head;
        return element;
      },
      /**
       * The position the wallpaper sheet is inserted at is a contract, not an accident: it goes
       * BEFORE the user's sheet so the user's own rules win on a tie. `styleTags` is already the
       * ordered list the real head would hold, so honouring the anchor here is what makes that
       * order assertable at all.
       */
      insertBefore: (element, anchor) => {
        const at = styleTags.indexOf(anchor);
        if (at < 0) styleTags.push(element);
        else styleTags.splice(at, 0, element);
        element.parentElement = document.head;
        return element;
      },
    },
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
      if (typeof dom.probe === 'function') {
        // Real nodes, not `null` placeholders. A browser returns elements, and the plugin now
        // FILTERS what it gets back — it drops its own chrome from every match set — so a list
        // of placeholders asked a question the filter could not answer and changed what the
        // probe-based cases observed. One stand-in element per count keeps the seam's promise
        // ("the engine answered n") without pretending the answer is empty.
        const count = dom.probe(selector);
        return Array.from({ length: count }, (_, index) => ({
          ...makeElement('div'),
          standInFor: selector + '#' + index,
        }));
      }
      // The pool, plus whatever has been appended under the body since boot. A real
      // `querySelectorAll` walks the tree, so elements the plugin appends are findable there —
      // and "is this element mine?" is a question about exactly those. Searching the pool alone
      // made that question unanswerable: the plugin's own container was invisible to the stub,
      // so the code that excludes it looked like it worked while doing nothing.
      const appended = [];
      const collect = (node) => {
        for (const child of node.children ?? []) {
          appended.push(child);
          collect(child);
        }
      };
      collect(body);
      return [...(dom.nodes ?? []), ...appended].filter(node => matchesSelector(node, selector));
    },
    createElement: makeElement,
    /**
     * `document.getElementById`, as the browser does it: over the WHOLE document, not just the
     * style tags this harness happens to keep a list of.
     *
     * The old stub searched only `styleTags`, so a real DOM element carrying an id was invisible
     * to the plugin — and the wallpaper clock reads exactly that. Two things followed, both
     * measured: `syncWallpaperClock` could never find the clock it had created (so the "switch it
     * off" assertion was testing the harness, not the code), and in a real session an id lookup
     * miss would have meant one clock element per sync. Fixed here rather than worked around in
     * the plugin: the stub was lying about a documented DOM API.
     */
    getElementById(id) {
      const inStyles = styleTags.find(element => element.id === id);
      if (inStyles !== undefined) return inStyles;
      const pool = [...(dom.nodes ?? []), ...collectNodes(body)];
      return pool.find(node => node.id === id) ?? null;
    },
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
    /**
     * The browser's own file reader, as far as the wallpaper upload uses it: hand it a file,
     * get a data URL back. Synchronous here — the plugin awaits the promise either way, so the
     * only thing the real one adds is a tick, and `settle()` already covers that. `result` is
     * built from the file's own type, so a case that wants a rejected payload supplies a type
     * the Host would refuse instead of reaching into this double.
     */
    FileReader: class {
      readAsDataURL(file) {
        const result = 'data:' + String(file?.type ?? 'application/octet-stream') + ';base64,AAAA';
        this.result = result;
        if (typeof this.onload === 'function') this.onload();
      }
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
    get(name) {
      // `serviceMissing` models the composition this matters for: one whose plugin manager is not
      // installed, so `pluginNavigation` does not exist. Cordis answers a missing service with
      // `undefined` (it does not throw), and the row must still load and its link still be
      // clickable — a REQUIRED dependency on that service would take the plugin out of such a
      // composition entirely, which is the mistake this flag exists to catch.
      if (serviceMissing) return undefined;
      // 语言服务：字典注册与绑定都经由它，测试传一个假实现就能渲染另一种语言。
      if (name === 'locale') return locale ?? undefined;
      if (name !== 'pluginNavigation') return undefined;
      return { openBundle: (id) => navigationCalls.push(id) };
    },
    slots: {
      inject(name, factory) {
        waits.push(name);
        // `seatsIdle` models the composition where DSH never serves the seat — a renamed slot after
        // a DSH upgrade. The factory is simply never called, which is exactly the failure the
        // client half's watchdog exists to make visible; nothing else about it is observable.
        if (seatsIdle) return () => {};
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

  assert.deepStrictEqual(
    host.waits, ['settings.general.item', 'plugins.detail.section', 'plugins.detail.section'],
    'apply waits for the General item seat and registers two sections on this plugin\'s own page',
  );
  assert.strictEqual(host.registrations.length, 3, 'apply registers the row and two sections');
  assert.strictEqual(host.registrations[0].options.id, 'custom-css');
  assert.strictEqual(host.registrations[0].options.order, 12, 'order 12 sits below Appearance (10) and Font size (11)');
  assert.strictEqual(host.registrations[0].options.registrant, 'dsh-custom-css');
  assert.strictEqual(typeof host.registrations[0].component, 'function', 'the registered row must be a component');
  assert.strictEqual(host.registrations[1].options.id, 'custom-css-wallpaper');
  assert.strictEqual(host.registrations[1].options.registrant, 'dsh-custom-css');
  assert.strictEqual(typeof host.registrations[1].component, 'function', 'the wallpaper section must be a component');
  assert.strictEqual(host.registrations[2].options.id, 'custom-css-wallpaper-settings');
  assert.strictEqual(host.registrations[2].options.registrant, 'dsh-custom-css');
  assert.strictEqual(typeof host.registrations[2].component, 'function', 'the settings section must be a component');
  // The page reads 「壁纸 → 壁纸设置」, which is an order contract between the two sections and
  // nothing else: the seat sorts by order, and equal orders would leave the reading order to
  // registration timing.
  assert.ok(
    host.registrations[2].options.order > host.registrations[1].options.order,
    'the settings section sits below the wallpaper section on the page',
  );

  assert.ok(host.userStyle(), 'the active host sheet is applied on load, without opening settings');
  assert.strictEqual(host.userStyle().textContent, HOST_SHEET);
  assert.ok(host.calls.some(call => call.url === '/dsh-custom-css/list'), 'bootstrap lists sheets');
  assert.ok(host.calls.some(call => call.url.startsWith('/dsh-custom-css/read')), 'bootstrap reads the active sheet');

  // 三条都走 `/read` 但带 `optional=1`：新装的机器上没有这些文件，普通 GET 会在每次加载时
  // 在 DevTools 里留下一条 404。断言 URL（而不只是「发生过读」）才守得住这个标志不被悄悄去掉。
  const recordReads = host.calls.map(call => String(call.url)).filter(url => url.includes('optional=1'));
  assert.deepStrictEqual(
    recordReads.map(url => url.split('name=')[1].split('&')[0]).sort(),
    ['settings.json.css', 'tokens.css', 'wallpaper.json.css'],
    'the two records and the token overrides are read as optional — got: ' + JSON.stringify(recordReads),
  );

  // 公共层：一张独立的样式表，先于用户表注入 —— 用户规则天然赢过它，不需要 !important。
  const baseSheet = host.styleTags.find(element => element.dataset.pluginCss === 'dsh-custom-css/shared-base.css');
  assert.ok(baseSheet, 'the shared base stylesheet is installed at load');
  assert.ok(
    String(baseSheet.textContent).includes('--dsl-g-radius-surface'),
    'and carries the shared design tokens',
  );
  assert.ok(
    host.styleTags.indexOf(baseSheet) < host.styleTags.findIndex(element => element.id === 'dsh-custom-css-user-style' || element.textContent === HOST_SHEET),
    'installed before the user sheet, so the user rules win without !important',
  );

  const rowSheets = host.styleTags.filter(element => element.dataset.pluginCss === 'dsh-custom-css/CustomCssRow.module.css');
  assert.strictEqual(rowSheets.length, 1, 'the row stylesheet is injected exactly once');
  assert.ok(rowSheets[0].textContent.includes('--dsw-alias-label-primary'), 'row styles consume DSH tokens');

  // 控件（dshUi_*）已抽到公共层（Base.module.css），编辑器只留 dshCc_*。断言按
  // 「扩展自己的 CSS」整体看，同时保留每张表各自的完整性检查。
  const componentSheets = host.styleTags.filter(element => element.dataset.pluginCss === 'dsh-custom-css/Base.module.css');
  assert.strictEqual(componentSheets.length, 1, 'the component stylesheet is injected exactly once');
  assert.ok(
    componentSheets[0].textContent.includes('.dshUi_button'),
    'and carries the shared control styles',
  );
  const ownSheet = componentSheets[0].textContent + rowSheets[0].textContent;

  // The host fix: a one-rule sheet that makes DSH's markdown image buttons block-level.
  // It is a patch for the HOST, not for this plugin's UI, so it gets its own tag — one that
  // can be found (and removed) without touching the two sheets above.
  const hostFix = host.styleTags.filter(element => element.dataset.pluginCss === 'dsh-custom-css/host-fix.css');
  assert.strictEqual(hostFix.length, 1, 'the host-fix stylesheet is injected exactly once');
  assert.ok(
    hostFix[0].textContent.includes('[class*="_imageButton_"]'),
    'and targets markdown image buttons by their module-name prefix (the hash suffix changes per build)',
  );

  // 上游装了修好的版本（规则里带 `:not(:has(img…))`）时，本插件不该再注入这段补丁 ——
  // 补丁的寿命应该止于上游修复，而不是永久成为本插件的一部分。
  const upstreamFixed = await boot({
    dom: {
      styleSheets: [{ cssRules: [{ selectorText: '._root :is(p, h1):not(:has(img, video))' }] }],
    },
  });
  assert.strictEqual(
    upstreamFixed.styleTags.filter(tag => tag.dataset.pluginCss === 'dsh-custom-css/host-fix.css').length,
    0,
    'the host fix is not injected when the upstream stylesheet already excludes image paragraphs',
  );

  assert.ok(
    hostFix[0].textContent.includes('display:block'),
    'with the one declaration that makes the wrapper participate in block layout — got: '
      + hostFix[0].textContent,
  );

  // A stylesheet with an unbalanced brace is dropped from that point on by the
  // browser while still looking fine as text — an orphaned declaration block from
  // a deleted selector did exactly that once. Count the braces too.
  const sheetText = ownSheet;
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
    '.dshUi_choice{box-sizing:border-box;',
    '.dshCc_addPropWrap{width:100%;max-width:none}',
    '.dshCc_panel>*{flex:none}',
    '.dshCc_partName{flex:none;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-markdown-tag);',
    '.dshUi_choice{justify-content:space-between}',
    // The shipped settings-row spec: 36px tall, radius-md (12px), 14px text.
    '.dshUi_choice{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:36px;padding:0 14px;',
    'border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);',
    // The text fields' last layout declaration: the shared box rule carries height, stroke,
    // fill and type; each of the three keeps only what its own container needs.
    '.dshCc_propText{flex:1;min-width:0;max-width:100%;font-family:var(--ds-font-family-code)}',
  ]) {
    assert.ok(ownSheet.includes(guard), 'overflow guard is present: ' + guard);
  }

  // --- 一个永远不会就位的设置槽位，必须变成一条能搜索的 warn -----------------
  //
  // DSH 换代改了槽位名时，插件不报错：`slots.inject` 的回调永远不被调用，于是「设置 → 通用」里
  // 少了一行，用户以为插件没装，作者这边零信号。这是这个插件最后一个盲区，所以那条 warn 要有
  // 用例守着 —— 顺手也守「正常情况下不许出现这条警告」，否则兜底日志会把真问题淹掉。
  const seatWarnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { seatWarnings.push(args.join(' ')); };
  try {
    let idleReply;
    const idleHost = await boot({
      seatsIdle: true,
      fetchImpl: async (url) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [], active: null });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '', rev: null, absent: true });
        if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: '0.2.1-rc.2', dshCommit: 'abc1234' });
        throw new Error('unexpected request: ' + url);
      },
    });
    assert.deepStrictEqual(idleHost.registrations, [], 'with an idle seat the row is never registered');
    assert.ok(
      idleHost.timers.some(entry => entry.ms === 3000 && !entry.cancelled),
      'the watchdog is armed with a 3s timer',
    );
    assert.deepStrictEqual(seatWarnings, [], 'and says nothing while the seat may still arrive');
    await idleHost.runTimers();
    idleReply = seatWarnings.join('\n');
    assert.ok(idleReply.includes('settings.general.item'), 'the warning names the slot that never arrived');
    assert.ok(idleReply.includes('known-issues'), 'and points at the known-issues page');
    assert.ok(idleReply.includes('0.2.1-rc.2'), 'and carries the DSH release from /about — the number a report needs');
    assert.ok(idleReply.includes('9.9.9'), 'plus this plugin\'s own version');

    // 正常路径：槽位立刻到位，定时器被撤掉，一条警告都不该有。
    seatWarnings.length = 0;
    const healthySeat = await boot({
      fetchImpl: async (url) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [], active: null });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '', rev: null, absent: true });
        if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
        throw new Error('unexpected request: ' + url);
      },
    });
    assert.strictEqual(healthySeat.registrations.length, 3, 'a live seat registers the row and the two detail sections');
    assert.strictEqual(healthySeat.registrations[0].options.id, 'custom-css', 'the row keeps its seat id');
    assert.ok(
      healthySeat.timers.every(entry => entry.ms !== 3000 || entry.cancelled),
      'and the watchdog is cleared the moment the seat arrives',
    );
    await healthySeat.runTimers();
    assert.deepStrictEqual(seatWarnings, [], 'no warning on the healthy path');
  }
  finally {
    console.warn = originalWarn;
  }


  // --- radii come from DSH's ladder, not from literals ----------------------
  // A regression guard with a specific history: every control in this row used to carry
  // `border-radius:18px`, copied value-for-value from a class (`_button_cfgyt_4`) that no
  // longer exists in this DSH generation. A literal survives a redesign silently — it
  // keeps looking like the number someone measured once — while every real control in the
  // same settings sheet had moved to `--dsw-radius-md`. Reading the token means a reskin
  // carries this row with it, and a mistyped token is wrong in one place instead of seven.
  //
  // The list below is every literal that is allowed to stay, with why. Anything not on it
  // fails, so a new `border-radius:8px` cannot be slipped in beside the tokenised ones:
  //   • 8px   — editorBox / findField / panelClose, where it IS the ladder's step sm and
  //             the value has been stable since before the ladder was introduced
  //   • 4px   — the small `CSS` badge, the picker's target box and its label
  //   • 2px / 3px / 6px — decoration on inline spans (hit mark, clickable selector,
  //             component-name chip, candidate row, token chip)
  //   • 50%   — a round dot (status dot, switch thumb)
  //   • 999px — a capsule (the switch and its track); no step expresses half the height
  {
    const sheet = ownSheet;
    const allowedShapes = ['2px', '3px', '4px', '6px', '8px', '50%', '999px'];
    const literals = [...sheet.matchAll(/border-radius:([^;}]+)/g)]
      .map(match => match[1].trim())
      .filter(value => !value.startsWith('var(--dsw-radius-'));
    for (const value of literals) {
      assert.ok(
        allowedShapes.includes(value),
        'a radius literal outside the allowed shapes: border-radius:' + value,
      );
    }
    assert.ok(
      literals.length > 0,
      'the allowed literals are still present — this check would pass vacuously otherwise',
    );
    for (const step of ['sm', 'md', 'lg']) {
      assert.ok(
        sheet.includes('border-radius:var(--dsw-radius-' + step + ')'),
        'the sheet takes at least one radius from DSH: --dsw-radius-' + step,
      );
    }
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
    assert.ok(ownSheet.includes(guard), 'explicit box: ' + guard);
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
  for (const label of ['打开文件', '导入', '导出', '重置', '格式化', '问题检测', '历史版本', '重命名', '打开目录', '删除']) {
    assert.ok(renderedText.includes(label), 'the menu renders the ' + label + ' action');
  }
  // The order is a decision, not an accident: the file actions together, the whole-sheet
  // actions next, the file-level operations on the directory after those, and the two entries
  // that destroy work last — where the pointer has to travel to them and cannot land on one on
  // the way to anything else.
  {
    const order = [];
    (function walk(current) {
      if (current === null || typeof current !== 'object') return;
      if (current.type === 'button' && typeof current.props?.title === 'string') order.push(textOf(current));
      for (const child of current.children ?? []) walk(child);
    })(menuView);
    const wanted = ['打开文件', '导入', '导出', '格式化', '问题检测', '历史版本', '重命名', '打开目录', '删除', '重置'];
    const seen = order
      .map(entry => wanted.find(label => entry.startsWith(label)))
      .filter(label => label !== undefined);
    assert.deepStrictEqual(
      [...seen], wanted,
      'the actions menu lists the file actions, then the whole-sheet ones, then the file-level ones, then 重置 — got: ' + JSON.stringify(order),
    );
    // And the destructive one is styled as destructive, in its new place as before.
    const resetItem = buttonWith(menuView, '重置');
    assert.ok(
      String(resetItem.props.className).includes('dshCc_menuItemDanger'),
      '重置 keeps its destructive styling at the bottom — className: ' + JSON.stringify(resetItem.props.className),
    );
    // Deleting asks twice: the entry arms itself on the first click and only the second one
    // spends the sheet. Asserted by driving the click, because "it asks" is the whole safety story.
    const deleteItem = buttonWith(menuView, '删除');
    assert.ok(
      String(deleteItem.props.className).includes('dshCc_menuItemDanger'),
      '删除 is styled as destructive too',
    );
    // ⚠ The arming path cannot be driven from THIS boot, and the reason is worth writing down:
    // the row's file list comes from the fake Host's `/list` at bootstrap, so a case that needs two
    // sheets has to boot with two. This one has one, which is itself the state worth asserting —
    // 删除 is disabled for the only sheet, because the Host refuses to leave the directory empty
    // (`last-sheet`) and the entry says so up front instead of failing when clicked.
    assert.strictEqual(
      deleteItem.props.disabled, true,
      'the only sheet cannot be deleted, so the entry is disabled',
    );
  }
  assert.ok(renderedClasses.some(entry => entry.includes('dshCc_menuItemDanger')), '重置 keeps its destructive styling in the menu');
  assert.ok(renderedClasses.some(entry => entry.includes('dshUi_menuHint')), 'each menu item says what it does');
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
  /**
   * Is this node one of the panel's value fields?
   *
   * They are `PropValueInput` elements rather than raw `<input>`s — the field owns the "is this
   * valid CSS" judgement, and it can only own that as a component. So recognising them means
   * looking at props, never at `className`: the class is applied on the inside, and the harness
   * does not expand function components, so it never reaches `renderedClasses` either.
   *
   * One predicate rather than four copies — there were four places looking for the old class,
   * and a rule that has to be remembered in four places is a rule that gets forgotten in one.
   */
  const isValueField = (node) => node !== null && typeof node === 'object'
    && node.type !== 'input'
    && typeof node.props?.property === 'string'
    && node.props.value !== undefined;

  /** Text fields of the open rule's panel, in render order. */
  const collectPropTexts = (node) => {
    const found = [];
    (function walk(current) {
      if (current === null || typeof current !== 'object') return;
      if (isValueField(current)) found.push(current);
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
  const propertyDropdowns = dropdowns.filter(item => item.props.ariaLabel !== '添加属性' && item.props.ariaLabel !== '画布背景');
  assert.strictEqual(propertyDropdowns.length, 2, 'only declared enum properties get a dropdown');
  // The value fields are `PropValueInput` elements rather than raw `<input>`s: the field owns
  // the "is this valid CSS" judgement, and it can only own that as a component. So the
  // assertion looks for the component by the prop that identifies it, not by class name —
  // `renderedClasses` collects when `createElement` runs, and the harness does not expand
  // function components, so a className set inside one never reaches that list.
  const valueFields = [];
  (function walk(current) {
    if (current === null || typeof current !== 'object') return;
    const props = current.props ?? {};
    if (current.type !== 'input' && typeof props.property === 'string' && props.value !== undefined) {
      valueFields.push(current);
    }
    for (const child of current.children ?? []) walk(child);
  })(panelRoot(panelView));
  assert.ok(
    valueFields.length > 0,
    'a non-enum declaration gets a value field — found ' + valueFields.length,
  );
  assert.ok(
    valueFields.every(field => field.props['aria-label'] !== undefined),
    'and every value field is named',
  );

  // 预览块：现在是一个**组件**（PreviewBlock），状态与绘制都在它里面。测试床不展开函数组件，
  // 所以这里按它的 props 直接渲染 —— 那正是 React 要做的事，只是这里手动做一次。
  {
    const probe = host.mod.__probe;
    const byClass = (view, wanted) => {
      const found = [];
      (function walk(current) {
        if (current === null || typeof current !== 'object') return;
        if (String(current.props?.className ?? '') === wanted) found.push(current);
        for (const child of current.children ?? []) walk(child);
      })(view);
      return found;
    };
    const previewElement = findNode(panelView, probe.PreviewBlock);
    assert.ok(previewElement !== null,
      'the panel asks for the preview block — the panel only hands it data, the block owns its state');
    // 两次渲染共用一套槽位 = 同一个组件实例（「拖过之后归位可点」要靠 state 保留）。
    withFreshSlots(() => {
    const preview = probe.PreviewBlock(previewElement.props);
    const canvasNodes = byClass(preview, 'dshCc_canvas');
    assert.strictEqual(canvasNodes.length, 1, 'the preview has exactly one canvas — got: ' + canvasNodes.length);
    const canvasNode = canvasNodes[0];
    assert.strictEqual(canvasNode.props['data-canvas'], 'page', 'and it starts on the page background (the preview looks like it always did)');
    const resetButtons = [];
    (function walk(current) {
      if (current === null || typeof current !== 'object') return;
      if (current.type === 'button' && current.props?.['aria-label'] === '归位') resetButtons.push(current);
      for (const child of current.children ?? []) walk(child);
    })(preview);
    assert.strictEqual(resetButtons.length, 1, 'with a reset control in its corner — got: ' + resetButtons.length);
    assert.strictEqual(typeof resetButtons[0].props.onClick, 'function', 'that does something when clicked');
    // 键盘：画布可聚焦、方向键能挪（拖动之外的第二条路）。
    assert.strictEqual(canvasNode.props.tabIndex, 0, 'the canvas can take focus');
    assert.strictEqual(typeof canvasNode.props.onKeyDown, 'function', 'and handles arrow keys');
    // 没拖过时归位是禁用的：一颗「点了也不会变」的按钮比没有更让人困惑。
    assert.strictEqual(resetButtons[0].props.disabled, true, 'reset starts disabled because nothing has moved yet');
    // 工具条里的控件全部来自组件库：分段（视图）+ 28px 按钮 + 28px 下拉。
    // 这一条是 v4 的核心要求（docs/preview-v4.md §4）——不给预览块留一套自绘控件。
    const bar = byClass(preview, 'dshCc_previewBar');
    assert.strictEqual(bar.length, 1, 'one toolbar row — got: ' + bar.length);
    const barClasses = (bar[0].children ?? []).map(child => String(child?.props?.className ?? ''));
    assert.ok(barClasses.some(name => name.includes('dshUi_segments')), 'with the view segmented control — got: ' + JSON.stringify(barClasses));
    assert.ok(barClasses.some(name => name.includes('dshUi_button')), 'and kit buttons');
    // 这条规则的选择器里没有状态伪类 → 芯片一个都不出现（见 previewChipsFor）。
    assert.strictEqual(byClass(preview, 'dshCc_stateChips').length, 0, 'no chips for a rule without a state pseudo');
    // 干净的样本没有提示区：漏报比误报重要，这一块不该空着占位。
    assert.strictEqual(byClass(preview, 'dshCc_previewHints').length, 0, 'a clean sample shows no hints block');
    // 拖动一次不该抛：ref 在测试床里是空的（假 React 不挂 DOM），所以这条同时钉住「形状变了也
    // 不能让面板崩」—— 面板一崩，整行的预览就没了。
    assert.strictEqual(typeof canvasNode.props.onPointerDown, 'function', 'the canvas takes a pointerdown');
    const fakePane = { dataset: { pane: 'modified' } };
    // 假 target 要按选择器回答：`closest('.dshCc_canvasReset')` 必须给 null，否则会被当成「按在归位上」。
    const pressedInPane = {
      clientX: 10,
      clientY: 10,
      button: 0,
      target: { closest: (selector) => (String(selector).includes('canvasReset') ? null : fakePane) },
    };
    canvasNode.props.onPointerDown(pressedInPane);
    canvasNode.props.onPointerMove({ clientX: 30, clientY: 40 });
    canvasNode.props.onPointerUp({});
    assert.ok(true, 'dragging a canvas with no DOM behind it does not throw');
    // 按在画布空白处（不在任何窗格上）不该开始拖：那里没有可拖的对象。
    canvasNode.props.onPointerDown({ clientX: 10, clientY: 10, button: 0, target: { closest: () => null } });
    canvasNode.props.onPointerMove({ clientX: 90, clientY: 90 });
    canvasNode.props.onPointerUp({});
    assert.ok(true, 'pressing the padding does not throw either');
    // 拖过之后，同一颗按钮要变成可点 —— 这条钉的是「拖动状态确实传到了渲染层」。
    hookIndex = 0;
    const dragged = probe.PreviewBlock(previewElement.props);
    const resetAfterDrag = (function find(node) {
      if (node === null || typeof node !== 'object') return null;
      if (node.type === 'button' && node.props?.['aria-label'] === '归位') return node;
      for (const child of node.children ?? []) {
        const hit = find(child);
        if (hit !== null) return hit;
      }
      return null;
    })(dragged);
    assert.ok(resetAfterDrag !== null, 'the canvas is still there after a drag');
    assert.strictEqual(resetAfterDrag.props.disabled, false, 'after a drag, 归位 becomes clickable');
    resetAfterDrag.props.onClick();
    assert.ok(true, 'and resetting from there does not throw');
    });
  }

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
  const inputsIn = (node) => {
    if (node === null || typeof node !== 'object') return;
    // The value field is `PropValueInput` now, so it is recognised by its props rather than by
    // a className it only applies on the inside (see the note above).
    if (node.type !== 'input' && typeof node.props?.property === 'string' && node.props.value !== undefined) {
      freeInputs.push(node);
    }
    for (const child of node.children ?? []) inputsIn(child);
  };
  inputsIn(withFree);
  const marginInput = freeInputs.find(input => input.props['aria-label'] === '上外边距');
  assert.ok(marginInput !== undefined, 'a free property carries its Chinese name');
  assert.strictEqual(
    marginInput.props.placeholder,
    '0 / 8px / auto',
    'the dictionary hint becomes the placeholder',
  );

  // The value field carries the "is this valid CSS" judgement, and it is a *deferred* one.
  // Half-typed values are invalid by definition — measured with `CSS.supports`: `re`, `rgb(`,
  // `calc(` and a bare `8` are all rejected — so a live check would mark the field wrong on
  // nearly every keystroke and hold it there until the value happened to become legal. The
  // verdict is taken on blur instead, which is what the platform does too (`:user-invalid`
  // exists for exactly this reason).
  //
  // What is asserted here is the half that does NOT need a CSS engine, because the harness has
  // none and inventing one in the bed broke unrelated tests (the first attempt rejected
  // `space-between` and `var(--dsw-…)`). So: how the field *renders* a verdict it has been
  // given, and the one value rule the plugin owns rather than delegating — emptiness.
  assert.strictEqual(
    marginInput.props['aria-invalid'], undefined,
    'a field nobody has finished with is not marked invalid',
  );

  // What is NOT asserted here, and why.
  //
  // The rest of this behaviour is "render the field with a verdict already decided" — the
  // attribute and the tooltip that explains it. Reaching that frame in this bed means seeding
  // the component's two hook slots, and an attempt at it (`hookSlots = [null, verdict]`) broke
  // an unrelated assertion further down: `hookSlots` is shared by every render in the boot, so
  // replacing it clobbered the slot the panel's `openIndex` lives in and the panel stopped
  // opening. A test that reaches its subject by corrupting another one's state is not worth
  // having, so this half is verified in the browser instead — where the field is the real
  // component, the engine is real, and the rendered attribute can simply be read.
  //
  // Emptiness, though, is the one value rule the plugin owns rather than delegating to the
  // engine, so it is asked directly. It has to own it: measured, `CSS.supports` answers false
  // for the empty string for every property — `color`, `gap`, `width` — so a field would go
  // red the moment it was cleared.
  const { valueInvalid } = host.mod.__probe;
  assert.strictEqual(typeof valueInvalid, 'function', 'the emptiness rule is reachable for testing');
  assert.strictEqual(valueInvalid('color', ''), false, 'an empty field is not an invalid one');
  assert.strictEqual(valueInvalid('color', '   '), false, 'and neither is whitespace');
  assert.strictEqual(valueInvalid('margin-top', ''), false, 'for a free property too');
  assert.strictEqual(valueInvalid('color', 'red'), false, 'a value the engine takes is fine');

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
  // The checked look is written against `aria-checked` in the stylesheet, so there is no
  // parallel "on" class to get out of step with it. The stylesheet half of that pair is
  // asserted in the stylesheet section below, where the injected text is in scope.
  assert.ok(
    !String(switchButton.props.className).includes('switchOn'),
    'the switch paints from aria-checked rather than from a class that could disagree with it',
  );

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
    if (isValueField(node)) {
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
    if (isValueField(node)) braceFields.push(node);
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
    if (isValueField(node)) uriInputs.push(node);
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

  // --- the anchored menu keeps up with its anchor ---------------------------
  // The panel's dropdown is `position: fixed` from the trigger's viewport rect, so three
  // things invalidate that measurement and every one of them has to be listened for:
  // the window resizing, anything scrolling (the settings dialog is the scroller here,
  // and it is NOT the document — so the listener has to be in the capture phase), and
  // the menu's own size changing while it is open. Each of these was missing at some
  // point, and each one is invisible in a screenshot: the menu simply sits where the
  // trigger used to be.
  // Guarded as source text because there is no DOM here to scroll; the behaviour itself
  // is measured in the real browser with `npm run probe`.
  assert.ok(
    code.includes("window.addEventListener('resize', reanchor)"),
    'the anchored menu re-measures when the window resizes',
  );
  assert.ok(
    code.includes("window.addEventListener('scroll', reanchor, true)"),
    'and when anything scrolls — capture phase, or a nested scroller is missed',
  );
  assert.ok(
    code.includes('new ResizeObserver(reanchor)'),
    'and when the menu itself grows while it is open',
  );
  assert.ok(
    /removeEventListener\('scroll', reanchor, true\)/.test(code),
    'and all three are taken back down when the menu closes',
  );

  // --- no JavaScript placeholder syntax ends up inside a CSS string ---------
  // A real defect, and the one this suite did NOT catch: a sweep replaced
  // `outline:2px solid …;outline-offset:1px` with the literal text `+ FOCUS_RING +`
  // INSIDE the quoted string (this file builds CSS by concatenating string literals,
  // not by templating). Every assertion here still passed — the rule was present, the
  // `focus-visible` text was present — while the browser threw the whole rule away
  // because `{+ FOCUS_RING +}` is not CSS. Measured in the real browser: zero focus
  // rings in the injected sheet. The suite only noticed after a reload made the
  // missing rules visible in a different probe.
  //
  // The invariant is simply that a CSS string never contains the concatenation
  // syntax that was meant to happen outside it.
  {
    const cssStart = code.indexOf('const ROW_CSS = [');
    const cssEnd = code.indexOf("].join('');", cssStart);
    const sheetSource = code.slice(cssStart, cssEnd);
    // `{+` / `+}` — a bare `+` directly against a brace is never valid CSS in any of
    // these rules, so those two cannot false-alarm.
    for (const marker of ['{+', '+}']) {
      assert.ok(
        !sheetSource.includes(marker),
        'no JS placeholder text inside a CSS string (found ' + JSON.stringify(marker) + ')',
      );
    }
    // The constant-name form needs a tighter test than a substring: the legitimate
    // concatenation also contains `+ FOCUS_RING +`. A placeholder is that text sitting
    // in a position where a brace is right before the `+`.
    assert.ok(
      !/\{[^']*\+\s*[A-Z_]{3,}\s*\+/.test(sheetSource),
      'no constant name is embedded inside a CSS string (it belongs outside the quotes)',
    );
  }

  // --- the focus ring is DSH's, and we only add the two parts it omits -------
  // This started as "every focusable control used `outline:2px solid
  // var(--dsw-alias-brand-primary)` — nine hand-rolled copies". The first attempt at a
  // fix rewrote them to read `--dsw-focus-ring-width` / `--dsw-focus-ring-color`, which
  // looked right and was still wrong: DSH's theme ships a GLOBAL focus ring
  //
  //     :root { --dsw-focus-ring-width: 2px }
  //     :focus-visible { outline-color: var(--…-color, var(--…state-business-primary));
  //                      outline-width: var(--…-width) }
  //     html[data-input-modality=pointer] body :focus-visible:not(:read-write) {
  //       --dsw-focus-ring-color: transparent; outline-color: #0000 }
  //
  // so the colour, the width AND the pointer-modality suppression are already handled.
  // Pinning the colour here would have overridden that: measured with the keyboard in
  // the real browser, the ring colour comes from DSH's fallback
  // (`rgb(65,118,230)`), and our rule only had to supply the two things the global one
  // leaves out — `outline-style` (it defaults to `none`, so nothing would paint) and
  // `outline-offset` (it defaults to 0).
  //
  // The assertion therefore checks the intent, not a token name: the sheet sets the
  // style and the offset, and never hard-codes a ring colour. Asserting the token names
  // was what made the first version look correct while it was pinning the colour.
  {
    const sheet = ownSheet;
    // Two offsets, because DSH's own components use two: input-height controls and buttons
    // take 1px, and the switch takes 2px (it is a 20px control, and the ring needs the extra
    // room to clear its capsule). Both are asserted, so neither can silently become the other.
    const ringsAtOne = [...sheet.matchAll(/outline-style:solid;outline-offset:1px/g)];
    const ringsAtTwo = [...sheet.matchAll(/outline-style:solid;outline-offset:2px/g)];
    assert.ok(
      ringsAtOne.length + ringsAtTwo.length >= 6,
      'the row supplies outline-style and outline-offset for the controls that need a ring — found '
      + ringsAtOne.length + ' at 1px and ' + ringsAtTwo.length + ' at 2px',
    );
    assert.ok(
      sheet.includes('.dshUi_switch:focus-visible{outline-style:solid;outline-offset:2px}'),
      'the switch keeps the 2px offset its own spec uses',
    );
    for (const banned of ['outline:2px solid', 'outline-color:', 'outline-width:']) {
      assert.ok(
        !sheet.includes(banned),
        'the ring colour and width are DSH\'s business, not the row\'s (found ' + banned + ')',
      );
    }
    // The text fields are the deliberate exception, and it is the change batch B made: a
    // field in DSH's settings form does not draw a ring on focus, it moves its border
    // colour to the business state. Asserted both ways so the exception stays a decision
    // rather than becoming "some fields lost their focus styling".
    assert.ok(
      sheet.includes('.dshUi_field:focus-visible,.dshCc_panelField:focus-within,.dshCc_propText:focus-visible{border-color:var(--dsw-alias-state-business-primary)}'),
      'a focused text field shows it by its border colour, the way DSH\'s form fields do',
    );
    for (const field of ['dshUi_field', 'dshCc_panelField', 'dshCc_propText']) {
      assert.ok(
        !new RegExp('\\.' + field + ':[a-z-]+\\{[^}]*outline-style').test(sheet),
        'the text field ' + field + ' does not also draw a ring',
      );
    }
  }

  // --- text on a filled surface reads DSH's foreground token ---------------
  // Two defects, found by resolving every token this sheet uses against the theme:
  //   • `color: #fff` on the picker's primary button — a hard-coded white that ignores
  //     the theme entirely;
  //   • `color: var(--dsw-alias-label-inverse, #fff)` on the picker's size label — the
  //     token in that var() DOES NOT EXIST anywhere in DSH, so the #fff fallback was the
  //     only thing painting it. A fallback is not a colour choice: it means the name is
  //     wrong, and it fails silently.
  // DSH paints text on a filled surface with `--dsw-alias-label-primary-foreground`
  // (Button's `.primary`, and the theme defines it per colour scheme).
  {
    const sheet = ownSheet;
    assert.ok(
      sheet.includes('var(--dsw-alias-label-primary-foreground)'),
      'text on a filled surface uses DSH\'s foreground token',
    );
    for (const banned of ['--dsw-alias-label-inverse', 'color:#fff']) {
      assert.ok(
        !sheet.includes(banned),
        'no non-existent token or hard-coded white paints text (found ' + banned + ')',
      );
    }
  }

  // --- state changes are announced, and the switch respects a write in flight --------
  // Measured before this existed: the row had ZERO live regions. Every state transition
  // it produces — the debounce landing, a validation failing, a sheet being restored —
  // was information only sighted users received.
  //
  // And DSH's Switch documents the other half as the owner's job: "owners also set it
  // while a write is in flight, not only when a deployment locks the toggle". The switch
  // here writes through the same Host route the editor debounces into, so a second press
  // during a write is a race rather than a preference.
  {
    const sheet = ownSheet;
    // Each assertion names the DECLARATIONS that make the state work, not a substring
    // that happens to appear somewhere. The first version of this guard checked for
    // `dshCc_statusDot[data-state=ongoing]{animation:none`, which is satisfied by the
    // reduced-motion override further down the sheet — so deleting the actual ongoing
    // rule left the guard green. A guard that an unrelated rule can satisfy is not a
    // guard; both halves are asserted together now.
    assert.ok(
      sheet.includes('.dshCc_statusDot[data-state=ongoing]{color:var(--dsw-alias-state-warn-primary);animation:dshCc-status-pulse'),
      'the status dot has the loading semantic DSH\'s StateDot uses, with its own animation',
    );
    // All three states paint the same way — the colour on the box, the core reading it
    // through `currentColor`. Asserted because the first version of the ongoing rule set
    // `background` while the other two set `color`, which would have left the loading dot
    // with two colours fighting over one element.
    assert.ok(
      sheet.includes('.dshCc_statusDot::after{content:"";position:absolute;inset:20%;border-radius:50%;background:currentColor}'),
      'the dot is a 10px box painting a 6px core, the way DSH\'s StateDot draws it',
    );
    for (const state of ['on', 'off', 'ongoing']) {
      assert.ok(
        sheet.includes('.dshCc_statusDot[data-state=' + state + ']{color:var(--dsw-alias-state-'),
        'the ' + state + ' state reads from DSH\'s state family rather than from a colour of its own',
      );
    }
    assert.ok(
      sheet.includes('@keyframes dshCc-status-pulse'),
      'the animation is namespaced — piggy-backing on another module\'s keyframes would '
        + 'break silently if that module renamed them',
    );
    assert.ok(
      sheet.includes('@media (prefers-reduced-motion: reduce){.dshCc_statusDot[data-state=ongoing]{animation:none'),
      'and it can be switched off for reduced motion, the way DSH\'s own animations can',
    );
  }
  // The live region and the in-flight switch are asserted against the rendered tree,
  // because they are props rather than stylesheet text.
  {
    const view = host.registrations[0].component();
    const find = (predicate) => {
      let found = null;
      (function walk(node) {
        if (found !== null || node === null || typeof node !== 'object') return;
        if (predicate(node)) found = node;
        for (const child of node.children ?? []) walk(child);
      })(view);
      return found;
    };
    const live = find(node => String(node.props?.className ?? '').split(' ')[0] === 'dshCc_status'
      && node.props?.['aria-live'] !== undefined);
    assert.ok(live !== null, 'the status line is a live region — without it, silence');
    assert.strictEqual(live.props['aria-live'], 'polite', 'ordinary transitions do not interrupt');
    assert.strictEqual(live.props['aria-atomic'], true, 'and the whole line is read, not just the fragment that changed');

    const alert = find(node => String(node.props?.className ?? '').split(' ')[0] === 'dshCc_error');
    if (alert !== null) {
      assert.strictEqual(alert.props.role, 'alert', 'a validation failure is assertive, not polite');
      assert.strictEqual(alert.props['aria-live'], 'assertive', 'and says so on the live attribute too');
    }

    const dot = find(node => String(node.props?.className ?? '').split(' ')[0] === 'dshCc_statusDot');
    assert.ok(dot !== null, 'the status dot renders');
    assert.ok(
      ['on', 'off', 'ongoing'].includes(dot.props['data-state']),
      'the dot speaks DSH\'s state vocabulary — got ' + JSON.stringify(dot.props['data-state']),
    );
    const toggle = find(node => node.props?.role === 'switch');
    assert.ok(toggle !== null, 'the switch renders');
    assert.ok(
      typeof toggle.props.disabled === 'boolean',
      'the switch states its disabled condition explicitly rather than leaving it undefined',
    );
  }

  // --- type scale comes from DSH's font tokens ------------------------------
  // Same reasoning as the radii above, and the same history: the sheet carried 50 literal
  // `font-size` and 29 literal `line-height` declarations, and ZERO font tokens. A literal
  // pair that happens to equal a ladder step looks right until a theme changes the step —
  // then this row alone keeps the old size.
  //
  // A pair is written as the token's shorthand (`font: var(--dsw-font-xxs-12)`), which
  // also carries the font family, so the row picks up DSH's own stack instead of the
  // browser's default for a bare `font-size`.
  //
  // Pairs that do NOT match a ladder step are the exception, and they are listed here so
  // the count is explicit rather than accidental: 10px/16px, 11px/16px and 11px/18px have
  // no step, so tokenising them would silently resize them — that belongs to a visible
  // change, not to this one.
  {
    const sheet = ownSheet;
    for (const token of ['--dsw-font-s-14', '--dsw-font-xxs-12', '--dsw-font-xs-13']) {
      assert.ok(
        sheet.includes('font:var(' + token + ')'),
        'the sheet takes at least one type size from DSH: ' + token,
      );
    }
    const TOKENISED = new Set(['14px/22px', '12px/18px', '13px/20px']);
    const pairs = [...sheet.matchAll(/font-size:(\d+px);line-height:(\d+px)/g)]
      .map(match => match[1] + '/' + match[2]);
    for (const pair of pairs) {
      assert.ok(
        !TOKENISED.has(pair),
        'a ladder step is written as its token rather than as a literal pair: ' + pair,
      );
    }
    assert.ok(
      pairs.length < TOKENISED.size + 8,
      'the exceptions stay a short, deliberate list — found ' + pairs.length + ': ' + JSON.stringify(pairs),
    );
  }

  // --- both menus share DSH's menu material --------------------------------
  // The fill was already the same token the sheet picker used (`--dsw-menu-surface-fill`
  // and `--dsw-specific-menu` both resolve to #f8f9fa94), so swapping tokens changed
  // nothing. What was missing is the blur DSH pairs with it — and that one is visible:
  // the fill is 58% opaque, so with no blur the page scrolls *through* the menu.
  //
  // Counted rather than spot-checked: this row has exactly two menus, and the interesting
  // failure is one of them getting the material and the other not. That is not
  // hypothetical — while writing this, a replace meant for the panel menu landed on the
  // sheet menu instead, so the two disagreed and the guard below is what caught it.
  {
    const sheet = ownSheet;
    const fills = [...sheet.matchAll(/background:var\(--dsw-menu-surface-fill\)/g)].length;
    const blurs = [...sheet.matchAll(/backdrop-filter:var\(--dsw-menu-backdrop-filter\)/g)].length;
    assert.strictEqual(
      blurs, fills,
      'every surface using the menu fill also pairs the backdrop filter DSH pairs with it — '
        + fills + ' fills, ' + blurs + ' blurs',
    );
    assert.ok(fills >= 2, 'both of this row\'s menus use the shared menu material — got ' + fills);
    assert.ok(
      sheet.includes('--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2)'),
      'the elevated surfaces take the l2 scrollbar tokens, the way DSH binds them on the card',
    );
  }

  // --- the controls DSH gives specific metrics get those metrics --------------
  // Three shapes that had drifted to sizes of their own. Each one is asserted with the
  // declaration that carries it, because "the rule exists" is not the same claim.
  {
    const sheet = ownSheet;
    // Switch: 36x20 track with a 16x16 thumb, from `Switch.module.css`. Ours was 30x16 with a
    // 12x12 thumb, and the 14px travel that went with them.
    assert.ok(
      sheet.includes('.dshUi_switchTrack{position:relative;flex:none;width:36px;height:20px;'),
      'the switch track is 36x20, the size DSH\'s Switch uses',
    );
    assert.ok(
      sheet.includes('.dshUi_switchThumb{position:absolute;top:2px;left:2px;width:16px;height:16px;'),
      'and its thumb is 16x16',
    );
    // The checked state paints from the attribute rather than from a class, so the paint
    // cannot disagree with what assistive technology reads (DSH states this outright).
    assert.ok(
      sheet.includes('.dshUi_switch[aria-checked="true"] .dshUi_switchTrack{background:var(--dsw-alias-brand-primary)}'),
      'the switch paints its checked state from aria-checked',
    );
    assert.ok(
      sheet.includes('.dshUi_switchThumb{') && sheet.includes('background:var(--dsw-alias-switch-thumb)'),
      'the thumb takes DSH\'s thumb token rather than a hard-coded white',
    );
    // Status dot: DSH's StateDot draws a 10px box with a 6px core.
    assert.ok(
      sheet.includes('.dshCc_statusDot{position:relative;flex:none;width:10px;height:10px;border-radius:50%}'),
      'the status dot is a 10px box, the way StateDot draws it',
    );
    // The `CSS` badge: DSH's Tag outline tone — a capsule on a border-l4 hairline.
    assert.ok(
      sheet.includes('.dshUi_badge{flex:none;padding:1px 8px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:999px;'),
      'the language badge is a capsule on DSH\'s tag hairline',
    );
    // And the switch keeps its own focus offset: 2px, where buttons use 1.
    assert.ok(
      sheet.includes('.dshUi_switch:focus-visible{outline-style:solid;outline-offset:2px}'),
      'the switch uses the 2px offset its spec gives it',
    );
  }

  // --- controls carry an accessible name, not only a tooltip ----------------
  // Measured before this: seven controls in this row relied on a `title` for their name,
  // the find bar's chevrons among them. A `title` is not an accessible name — assistive
  // technology may announce "button" and drop the tooltip entirely, and a touch device
  // never shows one at all.
  //
  // `aria-label` is used rather than a visually-hidden span: it takes precedence over
  // `title` in the accessible-name computation, so the tooltip can stay for the mouse
  // without the two disagreeing.
  //
  // Asserted against the rendered tree, which is where the naming actually lives.
  {
    const view = host.registrations[0].component();
    // Text can sit at any depth — the dropdown's label is a span inside the trigger, and
    // reading only the direct children made every wrapped control look unnamed.
    const textOf = (node) => {
      if (typeof node === 'string') return node;
      if (node === null || typeof node !== 'object') return '';
      return (node.children ?? []).map(textOf).join('');
    };
    const unnamed = [];
    (function walk(node) {
      if (node === null || typeof node !== 'object') return;
      const isInteractive = node.type === 'button'
        || String(node.props?.role ?? '') === 'switch'
        || String(node.props?.className ?? '').includes('dshCc_editor');
      if (isInteractive) {
        const props = node.props ?? {};
        if (props['aria-label'] === undefined && textOf(node).trim() === '') {
          unnamed.push(String(props.className ?? node.type));
        }
      }
      for (const child of node.children ?? []) walk(child);
    })(view);
    assert.deepStrictEqual(
      unnamed, [],
      'every control has an accessible name or visible text — unnamed: ' + JSON.stringify(unnamed),
    );
    // The icon-only find-bar buttons are the ones this was written for; named here so the
    // assertion says which controls it is talking about when it fails.
    //
    // 名字现在来自 `t()`（国际化），而查找栏只有打开时才在树里 —— 这一处只能按源码断言：
    // 每个名字既要有 `t('键')` 的调用点，也要在词典里（两份语言各一条，所以出现两次）。
    for (const key of ['find.prevAria', 'find.nextAria', 'find.close', 'find.case']) {
      assert.ok(code.includes(`t('${key}')`), 'the find bar translates ' + key);
      const defined = code.split(`'${key}':`).length - 1;
      assert.ok(defined === 2, 'the dictionary defines ' + key + ' in both locales — got ' + defined);
    }
  }

  // --- the rule-highlight toggle --------------------------------------------
  // The panel's selector field can outline every element the rule matches. Three states that
  // must not be collapsed into one another, because the count is exactly the number the user
  // is reading it to interpret:
  //
  //   a selector that matches nothing   → "无命中",   disabled
  //   text that is not a selector       → "不是选择器", disabled
  //   a rule against a pseudo-element   → "伪元素",  disabled
  //
  // The pseudo case is the one that needed a decision rather than a lookup. `a::before`
  // matches no element, so reporting "0 matches" is technically true and practically a lie —
  // it tells the user their selector is wrong when it is merely unoutlineable, and it hides
  // the useful half of the answer, which is that the host element does match.
  {
    const probe = host.mod.__probe;
    assert.ok(typeof probe.resolveSelector === 'function', 'the resolver is reachable for testing');

    // The harness answers selector queries from a pool, and the pool is empty until a case
    // fills it — so this block says what the page contains rather than assuming it. `probe` is
    // the seam the harness documents for exactly this: "a test that needs the engine to REFUSE
    // a selector (or answer with a count the pool cannot express) says so here".
    const savedNodes = host.dom.nodes;
    const savedProbe = host.dom.probe;
    host.dom.nodes = [{ selectorSet: new Set(['div']), childNodes: [], tagName: 'DIV' }];
    host.dom.probe = (selector) => {
      if (selector === '@media (min-width: 600px)') {
        // What a browser does with an at-rule: a SyntaxError, not an empty list.
        const error = new Error("Failed to execute 'querySelectorAll'");
        error.name = 'SyntaxError';
        throw error;
      }
      return selector === 'div' ? 3 : 0;
    };

    // A real selector, against the page this block just described.
    const found = probe.resolveSelector('div');
    assert.ok(Array.isArray(found.nodes), 'a real selector resolves to a node list');
    assert.strictEqual(found.nodes.length, 3, 'and carries the count the engine answered');
    assert.strictEqual(found.invalid, undefined, 'without claiming it is invalid');
    assert.strictEqual(found.pseudo, undefined, 'and without claiming it is a pseudo-element');

    // Whitespace is a field being typed in, not an error. Compared by content rather than with
    // `deepStrictEqual`: the harness answers with `new Array(n).fill(null)`, which is a
    // different object from a literal `[]` even at n = 0.
    const blank = probe.resolveSelector('   ');
    assert.strictEqual(blank.nodes.length, 0, 'an empty selector matches nothing');
    assert.strictEqual(blank.invalid, undefined, 'and is not an error');
    assert.strictEqual(blank.pseudo, undefined, 'and is not a pseudo-element');

    // Not a selector at all. `@media` is an at-rule; the engine throws on it, and reporting
    // "0 matches" for it would tell the user their syntax is fine.
    const atRule = probe.resolveSelector('@media (min-width: 600px)');
    assert.strictEqual(atRule.invalid, true, 'an at-rule is reported as invalid, not as zero matches');
    assert.strictEqual(atRule.nodes, undefined, 'and carries no node list to be misread as a count');

    // Pseudo-elements: both spellings, and every name that takes one.
    for (const selector of ['a::before', 'a:before', '.x::after', '.x:after', 'li::marker', 'p::first-line']) {
      const result = probe.resolveSelector(selector);
      assert.strictEqual(result.pseudo, true, 'a pseudo-element is its own case: ' + selector);
      assert.strictEqual(result.invalid, undefined, 'and is not reported as invalid: ' + selector);
    }
    // The pseudo check must not swallow the pseudo-*classes* that do match real elements.
    for (const selector of ['a:hover', '.x:not(.y)', 'div:first-child', 'input:focus']) {
      const result = probe.resolveSelector(selector);
      assert.strictEqual(result.pseudo, undefined, 'a pseudo-class still resolves normally: ' + selector);
    }

    host.dom.nodes = savedNodes;
    host.dom.probe = savedProbe;
  }

  // --- the highlight toggle's markup and lifecycle --------------------------
  {
    const sheet = ownSheet;
    // The box: the picker's own recipe (fixed, top of the stack, clicks pass through) on the
    // warn step rather than the brand colour, so the two can be told apart when both are up.
    assert.ok(
      sheet.includes('.dshCc_hlBox{position:fixed;z-index:2147483000;pointer-events:none;')
        && sheet.includes('border:1px solid var(--dsw-alias-state-warn-primary)'),
      'the highlight box is the picker box on the warn step',
    );
    assert.ok(
      sheet.includes('.dshCc_hlBox[data-sole="true"]{border-width:2px;background:transparent}'),
      'a single match is outlined harder and not filled, so it does not hide what is being styled',
    );
    // The toggle's label must not be painted in the warm colour.
    //
    // Measured in the browser, not guessed: `state-warn-primary` on a 12% wash of itself comes
    // to 1.96:1 in the light theme, under the 4.5:1 floor for text this size — and faint enough
    // to be visible as faint in a screenshot. `label-primary` measures 17.22:1 light and
    // 9.41:1 dark, because being the text colour on a surface is its whole job. The warm colour
    // still carries the state through the border (4.58:1 against the wash) and the fill.
    assert.ok(
      sheet.includes('.dshCc_hlToggle[aria-pressed="true"]{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-label-primary);'),
      'the pressed label uses the text colour token, not the warm graphic colour',
    );
    assert.ok(
      !sheet.includes('.dshCc_hlToggle[aria-pressed="true"]{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)'),
      'and the unreadable warm-on-warm combination cannot come back',
    );
    // Nothing from DSH's red: its one red means "something failed", and a selector that
    // matches three elements has not failed.
    assert.ok(
      !sheet.includes('.dshCc_hlBox') || !/dshCc_hlBox\{[^}]*state-error/.test(sheet),
      'the highlight is not painted in the error colour',
    );
    // The toggle's own box is DSH's Tag recipe — measured at 21px — rather than a fresh
    // invented height sitting next to the conflict button that was fixed for exactly that.
    assert.ok(
      sheet.includes('.dshCc_hlToggle{appearance:none;flex:none;display:inline-flex;align-items:center;gap:5px;padding:1px 8px;')
        && sheet.includes('font-size:11px;line-height:17px;cursor:pointer;white-space:nowrap}'),
      'the toggle uses the Tag recipe rather than a height this row invented',
    );
    // Lifecycle, asserted in the source: the boxes must outlive the panel and must not outlive
    // the row. Both halves matter — the first is the feature, the second is the reason it is
    // safe to leave them on the page at all.
    assert.ok(
      code.includes('React.useEffect(() => clearHighlights, [])'),
      'the row clears its highlights when it goes away, so none are left with no control to remove them',
    );
    assert.ok(
      code.includes('const highlightSelector = highlightOn ? rememberedSelector.current : draftSelector;'),
      'the highlight reads the REMEMBERED selector while it is on — asserting the name alone was '
        + 'satisfied by a leftover declaration of it that nothing used, so this asserts the wiring',
    );
    assert.ok(
      code.includes("window.addEventListener('scroll', repaint, true)"),
      'and the boxes are re-measured on scroll, since position:fixed does not follow the page',
    );
  }

  // --- what the highlight painter actually draws ----------------------------
  // The one piece of this row whose behaviour was only ever verified by eye in a browser —
  // and it had a bug that only that kind of check could have found (closing the panel emptied
  // the selector, and the boxes went with it). Driving the painter directly turns "I looked at
  // it and it seemed right" into something a future change has to keep true.
  //
  // The units are the interesting part. `position:fixed` means the box is placed from VIEWPORT
  // coordinates, so the painter must copy `getBoundingClientRect()` verbatim - not add scroll
  // offsets, not read `offsetTop`. A box that drifts by the scroll amount looks correct at the
  // top of the page, which is exactly where a manual check usually happens.
  {
    const probe = host.mod.__probe;
    assert.ok(typeof probe.paintHighlightBoxes === 'function', 'the painter is reachable for testing');
    assert.ok(typeof probe.clearHighlights === 'function', 'so is the cleanup');

    const elementAt = (rect) => host.document.createElement('div', { rect });
    const boxes = () => probe.liveHighlightBoxes();

    probe.clearHighlights();
    assert.strictEqual(boxes().length, 0, 'nothing is painted to start with');

    // ── one match: positioned from the element's own rect ──
    probe.paintHighlightBoxes([elementAt({ top: 120, left: 40, width: 300, height: 50 })]);
    assert.strictEqual(boxes().length, 1, 'one element gets one box');
    assert.strictEqual(boxes()[0].style.top, '120px', 'positioned from the viewport rect, not the document');
    assert.strictEqual(boxes()[0].style.left, '40px');
    assert.strictEqual(boxes()[0].style.width, '300px');
    assert.strictEqual(boxes()[0].style.height, '50px');
    assert.strictEqual(boxes()[0].dataset.sole, 'true', 'a lone match is marked so it can be outlined harder and left unfilled');

    // ── several matches: one box each, none marked as the only one ──
    probe.paintHighlightBoxes([
      elementAt({ top: 10, left: 10, width: 100, height: 20 }),
      elementAt({ top: 200, left: 30, width: 200, height: 40 }),
      elementAt({ top: 400, left: 50, width: 300, height: 60 }),
    ]);
    assert.strictEqual(boxes().length, 3, 'three elements get three boxes');
    for (const box of boxes()) {
      assert.strictEqual(box.dataset.sole, undefined, 'no box claims to be the only match when there are three');
    }
    assert.strictEqual(boxes()[1].style.top, '200px', 'each box is placed from its own element');

    // ── shrinking: fewer matches must not leave the old boxes on the page ──
    probe.paintHighlightBoxes([elementAt({ top: 5, left: 5, width: 5, height: 5 })]);
    assert.strictEqual(boxes().length, 1, 'a narrower match set takes the extra boxes away');
    assert.strictEqual(boxes()[0].style.top, '5px', 'and the survivor is re-positioned');

    // ── zero-sized elements are not drawn ──
    // `display:none` measures 0x0, and a box at the viewport corner is a stray dot that points
    // at nothing. Measured in the browser: a `button` selector matched 63 elements and drew 61
    // boxes, and the two it skipped were exactly the hidden ones.
    probe.paintHighlightBoxes([
      elementAt({ top: 0, left: 0, width: 0, height: 0 }),
      elementAt({ top: 60, left: 0, width: 0, height: 30 }),
      elementAt({ top: 60, left: 0, width: 30, height: 0 }),
      elementAt({ top: 60, left: 0, width: 30, height: 30 }),
    ]);
    assert.strictEqual(boxes().length, 1, 'only the element with a real box is outlined');
    assert.strictEqual(boxes()[0].style.width, '30px');

    // ── and the cleanup really takes them off the document ──
    const attached = boxes().length;
    assert.ok(attached > 0, 'there is something to clean up');
    probe.clearHighlights();
    assert.strictEqual(boxes().length, 0, 'cleanup empties the list');
    assert.strictEqual(
      host.document.querySelector('[data-dshcc-owned]')?.children.filter(child => String(child.className).includes('dshCc_hlBox')).length ?? 0,
      0,
      'and removes the nodes from the page rather than only forgetting them',
    );
  }

  // --- control heights come from DSH's two button steps ---------------------
  // DSH's Button ships exactly two heights: 36px (14px text, `0 14px`) and 28px (12px text,
  // `0 10px`). A sweep for invented sizes found two controls that were neither:
  //
  //   · `.dshCc_conflictBtn` at 22px — below every step the app ships, i.e. a button that is
  //     merely harder to hit, in a notice the user has to act on;
  //   · `.dshCc_pickInsert` at 30px with 14px text — between the steps and matching neither,
  //     sitting in the same row as secondary buttons at 28px.
  //
  // The allow-list below is the full set of heights this sheet may declare for something that
  // is sized like a control. Decoration is not in scope and is skipped by selector.
  {
    const sheet = ownSheet;
    const CONTROL_STEPS = new Set(['28px', '34px', '36px']);
    // Rows that are sized, not controls: the editor's drag-resizable default, and the two
    // menus' scroll ceilings.
    const SKIP = /dshCc_editorWrap|dshCc_suggest|dshUi_menu\b|dshUi_choiceMenu|dshCc_panel\b/;
    const offenders = [];
    for (const rule of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim().split('\n').pop().trim();
      if (selector.startsWith('@') || SKIP.test(selector)) continue;
      for (const match of rule[2].matchAll(/(?:^|;)(?:min-)?height:(\d+px)/g)) {
        if (CONTROL_STEPS.has(match[1])) continue;
        offenders.push(selector + ' → ' + match[1]);
      }
    }
    // 16/17/18/20/22/26/10px all legitimately appear as line heights and icon or dot sizes,
    // so the assertion names the two that are controls rather than banning every small number.
    const controlOffenders = offenders.filter(entry => /conflictBtn|pickInsert|dshUi_button|dshCc_trigger|dshUi_choice\b|dshCc_findBtn|dshCc_findField|dshCc_pickBarBtn/.test(entry));
    assert.deepStrictEqual(
      controlOffenders, [],
      'controls are sized on DSH\'s button ladder — off-step: ' + JSON.stringify(controlOffenders),
    );
    assert.ok(
      sheet.includes('.dshCc_conflictBtn{appearance:none;flex:none;height:28px;padding:0 10px;'),
      'the conflict notice\'s buttons are the smallest DSH step rather than 22px',
    );
    assert.ok(
      sheet.includes('.dshCc_pickInsert{appearance:none;margin-left:auto;height:28px;padding:0 10px;')
        && sheet.includes('background:var(--dsw-alias-button-primary-fill)'),
      'and the picker\'s primary action is the same 28px step as the buttons beside it',
    );
  }

  // --- every corner in the sheet is a ladder step or a capsule --------------
  // Generalised from a sweep that found five literal radii: 8px and 4px (which happened to
  // equal `radius-sm` and `radius-xs`, so nothing looked wrong — they would simply have
  // stopped tracking the scale), 6px twice, 3px and 2px.
  //
  // The two that were guesswork are worth naming. `.dshCc_partName` is a `Tag` — its fill is
  // `--dsw-alias-markdown-tag` — and DSH's Tag is a capsule with `padding: 1px 8px`; ours sat
  // exactly one step inside it on both counts (`1px 7px`, 6px corner), which reads as "not
  // quite that component" without anything looking broken. `.dshCc_candidate` already had the
  // menu row's `6px 8px`, so only its corner was off.
  //
  // `999px` is the one literal allowed, because DSH writes capsules that way in its own Tag
  // and Pill stylesheets rather than through a token.
  {
    const sheet = ownSheet;
    // Decoration blocks carry percentages (`::after{inset:20%;border-radius:50%}`) and are not
    // corners in the component sense; everything else must resolve through the ladder.
    const bad = [];
    for (const rule of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim().split('\n').pop().trim();
      if (selector.startsWith('@')) continue;
      for (const match of rule[2].matchAll(/border-radius:([^;}]+)/g)) {
        const value = match[1].trim();
        if (value.startsWith('var(--dsw-radius-') || value === '999px' || value === '50%' || value.includes('inherit')) continue;
        bad.push(selector + ' → ' + value);
      }
    }
    assert.deepStrictEqual(
      bad, [],
      'every corner resolves through the radius ladder or is a 999px capsule — off-scale: '
        + JSON.stringify(bad),
    );
    assert.ok(
      sheet.includes('border-radius:var(--dsw-radius-xs)') && sheet.includes('border-radius:var(--dsw-radius-sm)'),
      'and the two steps the sweep found are actually in use',
    );
    // The part label is a Tag: capsule, `1px 8px`, weight 500.
    assert.ok(
      sheet.includes('.dshCc_partName{flex:none;padding:1px 8px;border-radius:999px;')
        && sheet.includes('line-height:16px;font-weight:500;white-space:nowrap}'),
      'the part label matches DSH\'s Tag box and weight',
    );
  }

  // --- monospace text uses DSH's code font, not a stack of our own ----------
  // Found by measuring: DSH resolves `--ds-font-family-code` to
  //   "SF Mono","JetBrains Mono","Fira Code",Consolas,…,"PingFang SC","Microsoft YaHei"
  // while this row carried its own stack beginning `ui-monospace,SFMono-Regular,…`. A
  // generic `ui-monospace` wins every race it enters, so none of the design faces DSH names
  // were ever selected — the code in this editor and the code everywhere else in the app
  // were being drawn in different typefaces. That is the plainest possible reading of
  // "elements don't match DSH", and a token audit cannot see it: the value was fine, it was
  // simply the wrong font stack.
  {
    const sheet = ownSheet;
    assert.ok(
      sheet.includes('var(--ds-font-family-code)'),
      'monospace text takes DSH\'s code font token',
    );
    // Scoped to the stylesheet, not to the whole source: the property editor offers
    // `ui-monospace` as a *hint string* for the `font-family` field, which is text the user
    // sees, not a font this row chooses. Scanning the whole file flagged that hint.
    assert.ok(
      !sheet.includes('ui-monospace') && !sheet.includes('--dshCc-mono'),
      'and no private font stack is left behind in the stylesheet for it to fall back to',
    );
    // The editor's line height is a different matter and stays literal: the JS that anchors
    // the completion list computes with the same number, so the two have to agree.
    assert.ok(
      sheet.includes('--dshCc-line:19px'),
      'the editor line metric stays in step with the JS that reads it',
    );
    assert.ok(
      code.includes('LINE_HEIGHT'),
      'and that JS constant still exists to be kept in step with',
    );
  }

  // --- the completion popup is the third floating surface -------------------
  // It shares the menus' material and, measured, its geometry maths agrees with its CSS:
  // one row renders 34px tall, which is 1 × 26 + 8 — the formula in the layout code. That
  // agreement is what the flip direction depends on, so it is asserted rather than assumed.
  {
    const sheet = ownSheet;
    assert.ok(
      sheet.includes('.dshCc_suggest{position:absolute;z-index:120;min-width:164px;max-width:280px;box-sizing:border-box;')
        && sheet.includes('padding:4px;display:flex;flex-direction:column;border:0;border-radius:var(--dsw-radius-lg);'),
      'the completion popup pads like the menus rather than the 2px it used to carry',
    );
    assert.ok(
      code.includes('found.items.length * 26 + 8'),
      'and its anchor maths still matches the row height and the popup padding',
    );
    // Deliberate differences, asserted so they read as decisions rather than as leftover
    // inconsistencies: a compact row, and a width tied to the caret rather than to a
    // container edge.
    assert.ok(
      sheet.includes('.dshCc_suggestItem{') && sheet.includes('min-height:26px;padding:3px 7px;')
        && sheet.includes('border-radius:var(--dsw-radius-sm)'),
      'the popup keeps its compact 26px row on radius-sm, which is what an autocomplete wants',
    );
  }

  // --- the sheet menu is as wide as its content, not a made-up number --------
  // `min-width:218px` used to stand here, and it was pure excess: measured, the menu was
  // 218px while everything in it needed 106px (`custom.css` is 62px, `＋ 新建…` is 82px),
  // and nothing was truncated — so the extra 112px was blank.
  //
  // 218px was invented by this row. DSH's menu list is `min-width:144px`. This keeps the
  // intent but anchors it to something real: `100%` resolves against `.dshCc_picker`, the
  // positioned wrapper whose right edge the menu already aligns to, so the menu opens at
  // least as wide as its trigger and grows only when a sheet name asks it to.
  //
  // Verified in the browser: short name → 121px (= the trigger), long name → 282px with no
  // truncation, right edges aligned in both cases, capped at 360px.
  {
    const sheet = ownSheet;
    assert.ok(
      sheet.includes('.dshUi_menu{position:absolute;top:calc(100% + 4px);right:0;z-index:100;min-width:100%;width:max-content;max-width:360px;'),
      'the sheet menu is sized from its trigger and its own content',
    );
    for (const banned of ['min-width:218px', '.dshUi_menu{position:absolute;top:calc(100% + 4px);right:0;z-index:100;min-width:2']) {
      assert.ok(
        !sheet.includes(banned),
        'no invented width comes back to the menu (found ' + banned + ')',
      );
    }
    // `max-content` is load-bearing: without it the menu is a block child of the wrapper and
    // stretches to the wrapper's width, which would undo the whole point.
    assert.ok(
      /\.dshUi_menu\{[^}]*width:max-content/.test(sheet),
      'the menu sizes to its content rather than stretching to its container',
    );
  }

  // --- the plugin's own chrome is never counted as page content -------------
  // Found in the browser, from one question: with `[class]` in the selector field, the page
  // answered **336** matches with the highlight off and **653** with it on. The 317 extra were
  // the plugin's own highlight boxes — `div`s with a class, indistinguishable from page content
  // to `querySelectorAll`. The count was self-referential, and so was every other count in this
  // row: the outline's per-rule hit column, the picker's candidate ranking (which decides which
  // selector wins by uniqueness), and the token sampler.
  //
  // The worse half is not a wrong number. Those boxes were siblings of the app's root, and the
  // picker offers structural paths like `body > div:nth-child(36) > …` — computed from
  // `siblings.indexOf(node)`. An overlay that shifts that index breaks the selectors its own
  // plugin hands out.
  {
    const probe = host.mod.__probe;
    const savedNodes = host.dom.nodes;
    const savedProbe = host.dom.probe;
    // The page: one element with a class, plus the plugin's own container holding two boxes.
    host.dom.nodes = [{ selectorSet: new Set(['.page']), childNodes: [], tagName: 'DIV' }];
    delete host.dom.probe;

    const body = host.document.body;
    for (const child of [...body.children]) child.remove();
    const owned = host.document.createElement('div');
    owned.setAttribute('data-dshcc-owned', '');
    body.appendChild(owned);
    const realBox = host.document.createElement('div', { className: 'dshCc_hlBox' });
    const realPane = host.document.createElement('div', { className: 'dshCc_hlBox' });
    owned.appendChild(realBox);
    owned.appendChild(realPane);

    // `resolveSelector` reports what the plugin would act on.
    const found = probe.resolveSelector('div');
    assert.ok(
      found.nodes.every(node => node.getAttribute?.('data-dshcc-owned') === null
        || node.getAttribute?.('data-dshcc-owned') === undefined),
      'a match set never contains the plugin\'s own chrome',
    );
    assert.ok(
      !found.nodes.includes(realBox) && !found.nodes.includes(realPane),
      'and never contains a box it painted',
    );

    // The count the toggle shows must be re-measured, not read off the resolved selector.
    //
    // Measured: with the panel closed the page answered 292 matches for `[class]`; opening the
    // panel makes it 336, because the panel is 44 more elements with classes — and the toggle
    // went on showing 292. The page had changed without the selector changing, so a count
    // computed from the memoised resolution described a state that no longer existed.
    assert.ok(
      code.includes('const [highlightCount, setHighlightCount] = React.useState(0)'),
      'the count is state, so a page that changes under a fixed selector still moves it',
    );
    assert.ok(
      code.includes('setHighlightCount(highlight.invalid === true || highlight.pseudo === true'),
      'and it is refreshed on every commit rather than only when the selector text changes',
    );
    assert.ok(
      code.includes("t('panel.labelNone')") && code.includes("t('panel.labelCount', { count: highlightCount })"),
      'the toggle renders that count (through the dictionary, so both locales show it)',
    );
    assert.ok(
      !code.includes("highlight.nodes.length + ' 个命中'"),
      'and does not render a possibly-stale length the resolution happened to carry',
    );

    // The container is one body child, reused — not one per paint. That is the difference
    // between a stable `nth-child` offset and one that moves with how many things happen to be
    // highlighted.
    assert.ok(typeof probe.paintRoot === 'function', 'the container accessor is reachable for testing');
    probe.paintRoot();
    probe.paintRoot();
    const ownedChildren = body.children.filter(child => child.getAttribute?.('data-dshcc-owned') !== null
      && child.getAttribute?.('data-dshcc-owned') !== undefined);
    assert.strictEqual(
      ownedChildren.length, 1,
      'the plugin appends exactly one container to the body, no matter how often it paints — got '
        + ownedChildren.length,
    );

    // Put the bed back.
    for (const child of [...body.children]) child.remove();
    host.dom.nodes = savedNodes;
    if (savedProbe !== undefined) host.dom.probe = savedProbe;
  }

  // --- the row does not overflow a narrow dialog ----------------------------
  // Measured before this: at a 420px viewport the row carried 291px of horizontal overflow,
  // essentially all of it from `.dshCc_head` — a fixed-size title beside a row of labelled
  // buttons that had `flex:none`, so nothing could give. The row pushed out past the dialog
  // instead. (The file bar was only 37px of it, and the breakpoints further up the sheet show
  // narrow widths were designed for; the head had simply never joined in.)
  //
  // Two things are load-bearing and neither works alone: `flex-wrap` on the head moves the
  // actions to their own line, and giving up `flex:none` for `min-width: 0` on the actions is
  // what actually lets that line be narrower than the buttons. With `flex:none` and no
  // `min-width`, wrapping the children changed the outer width not at all — measured, 256px of
  // overflow remained.
  {
    const sheet = ownSheet;
    assert.ok(
      sheet.includes('.dshCc_head{align-items:center;justify-content:space-between;gap:12px;display:flex;flex-wrap:wrap}'),
      'the head wraps rather than pushing the row past the dialog',
    );
    assert.ok(
      sheet.includes('.dshCc_actions{align-items:center;gap:8px;display:flex;flex-wrap:wrap;min-width:0}'),
      'and the action row can be narrower than its buttons, which is what makes wrapping help',
    );
    assert.ok(
      !sheet.includes('.dshCc_actions{align-items:center;gap:8px;display:flex;flex:none}'),
      'the unshrinkable action row cannot come back',
    );
  }

  // --- menu cells keep DSH's menu metrics ----------------------------------
  // Taken from `Menu.module.css` (`.item` 34px / `6px 8px` / `gap: 6px` / 13px over 20px,
  // `.check` in label-primary, `.danger:hover` on the danger hover fill). Ours used to be
  // a 40px row with 14px text — a size nothing else in the settings sheet uses, which is
  // what made two menus opened from the same row look like they came from two plugins.
  //
  // Asserted with the declarations, not with the class name: a rule that keeps its
  // selector but loses its numbers is exactly the regression this is for.
  {
    const sheet = ownSheet;
    // Every entry names the SELECTOR it is about, not just a declaration. A declaration-only
    // substring is satisfied by any rule that happens to share it — and this pair of menus
    // shares most of its metrics, so `min-height:34px;padding:6px 8px` alone stayed true
    // while the rule it was supposed to protect had already been changed back to 40px.
    // That is the third time in this sweep a guard turned out to be satisfiable by an
    // unrelated rule; the fix is always the same: assert the rule, not the fragment.
    const required = [
      ['menu rows are menu-sized', '.dshUi_menuItem{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;'],
      ['dropdown rows are menu-sized', '.dshUi_choiceItem{display:flex;align-items:center;gap:8px;min-height:34px;padding:6px 8px;'],
      ['menu row type', 'cursor:pointer;font:var(--dsw-font-xs-13);'],
      ['the list has no row gaps', '.dshUi_choiceMenu{z-index:60;box-sizing:border-box;display:flex;flex-direction:column;gap:0;'],
      ['selected check colour', '.dshCc_menuCheck{flex:none;color:var(--dsw-alias-label-primary)}'],
      ['danger hover fill', '.dshCc_menuItemDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}'],
      ['group heading', '.dshUi_choiceGroup{position:sticky;top:0;z-index:1;padding:4px 7px 2px;color:var(--dsw-alias-label-tertiary);font-weight:500;'],
    ];
    for (const [what, declaration] of required) {
      assert.ok(sheet.includes(declaration), what + ' — expected ' + JSON.stringify(declaration));
    }
    // The brand colour must be gone from the check mark specifically: a selected row is
    // marked, not emphasised. Scoped to the rule, since the brand colour legitimately
    // appears elsewhere in the sheet.
    assert.ok(
      !sheet.includes('.dshCc_menuCheck{flex:none;color:var(--dsw-alias-brand-primary)}'),
      'the selected check is not painted in the brand colour',
    );
    // The sticky heading's fill is now a live rule rather than a hook nobody set. It matters
    // more than it sounds: the add-property menu is ~4000px of content in a 260px scrolling
    // box across ten groups, so a heading does sit over the rows below it — measured, and the
    // fill appears there (`rgba(248,249,250,.94)` at 4px from the list's top edge).
    assert.ok(
      sheet.includes('.dshUi_choiceGroup[data-stuck]{background:var(--dsw-alias-menu-group-header-fill)}'),
      'the sticky group heading has its fill rule',
    );
    assert.ok(
      sheet.includes('.dshUi_choiceGroup{position:sticky;top:0;'),
      'and it is the sticky positioning that gives the fill something to do',
    );
    // The attribute comes from an IntersectionObserver rooted on the list, the way DSH does it,
    // and not from a scroll handler: the callback fires exactly when a heading crosses the
    // list's top edge. Guarded on the API existing — without it the heading stays plain sticky,
    // which is the correct degradation.
    assert.ok(
      code.includes("typeof IntersectionObserver !== 'function'"),
      'the observer is optional rather than assumed',
    );
    assert.ok(
      code.includes("entry.target.setAttribute('data-stuck', '')"),
      'and something actually sets the attribute',
    );
    assert.ok(
      code.includes("root: menu, rootMargin: '0px 0px -90% 0px'"),
      'rooted on the list itself, so only the top contact counts — a heading on its way out does not flip it',
    );
    assert.ok(
      code.includes("heading.removeAttribute('data-stuck')"),
      'and closing the menu leaves no heading carrying a stale attribute',
    );
  }

  // --- the dropdown's keyboard contract ------------------------------------
  // Two of these come from DSH's own Menu documentation ("Escape or Shift+Tab close it
  // and return focus to the anchor's first button"; arrow keys walk the list). The third
  // was found by testing in the real browser, and it is the one that mattered most:
  //
  //   **Escape must not escape.**
  //
  // Measured: with the menu focused, one Escape closed the menu AND the settings dialog
  // around it — the whole row vanished and focus landed on whatever the page had
  // underneath. The panel treats Escape as "close the settings", so a dismissal that
  // leaks upward takes the dialog with it. That is why the handlers stop propagation,
  // and it is exactly the kind of thing a suite that only reads props cannot see.
  //
  // Asserted against the source for the handlers (the harness renders no function
  // components) and against the rendered props for the wiring.
  {
    assert.ok(
      code.includes('function onMenuKeyDown(event)'),
      'the dropdown owns its list keys',
    );
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      assert.ok(
        code.includes("event.key === '" + key + "'"),
        'the list walks with ' + key,
      );
    }
    // Every Escape path in the dropdown stops the event before the dialog sees it.
    //
    // Written as one slice per branch, from the marker to the branch's own closing
    // `}` — found by brace matching rather than by searching for the next `closeMenu(`,
    // because that call ALSO appears in `closeMenu`'s own definition earlier in the file
    // and the search would land there instead. (That is how the first version of this
    // guard reported one branch instead of two.)
    const escapeBranches = [];
    for (let at = code.indexOf("event.key === 'Escape'"); at >= 0; at = code.indexOf("event.key === 'Escape'", at + 1)) {
      const open = code.indexOf('{', at);
      if (open < 0) continue;
      let depth = 0;
      let end = open;
      for (; end < code.length; end += 1) {
        if (code[end] === '{') depth += 1;
        else if (code[end] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const snippet = code.slice(at, end + 1);
      // The dropdown's two branches are the ones that dismiss the menu.
      if (snippet.includes('closeMenu')) escapeBranches.push({ snippet, line: code.slice(0, at).split('\n').length });
    }
    assert.ok(
      escapeBranches.length >= 2,
      'both the trigger and the list handle Escape — got ' + escapeBranches.length
        + ' at lines ' + JSON.stringify(escapeBranches.map(branch => branch.line)),
    );
    for (const branch of escapeBranches) {
      assert.ok(
        branch.snippet.includes('stopPropagation'),
        'dismissing the menu must not also dismiss the panel around it (line ' + branch.line + ')',
      );
    }
    assert.ok(
      code.includes('focusRow('),
      'the list moves focus between rows rather than only tracking a virtual index',
    );
    assert.ok(
      code.includes("'aria-activedescendant'"),
      'the list tells assistive technology which row the keyboard is on',
    );
  }

  // --- a keyboard user can see where they are in a menu ---------------------
  // Both list surfaces give the pointer a fill on hover; without the same fill on
  // `:focus-visible` (and with the browser's default ring suppressed, the way DSH's own
  // menu does it) walking the list with the arrow keys highlights nothing at all.
  const rowCss = ownSheet;
  for (const surface of ['dshUi_choiceItem', 'dshUi_menuItem']) {
    assert.ok(
      rowCss.includes('.' + surface + ':focus-visible'),
      'the ' + surface + ' shows keyboard focus, not only hover',
    );
  }

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
  assert.notStrictEqual(outline.props.disabled, true, 'a sheet with rules has an outline to open');
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

  // --- 下拉菜单必须在 top layer ----------------------------------------------
  // 从用户那里来的：`aurora-nexus.css` 的**大纲点不了**。真机量到的原因不是大纲本身：设置对话框带
  // `transform`，菜单是 `position:fixed`，于是它变成「相对那个祖先定位」，又被编辑器外壳的
  // `overflow:hidden` 整块裁掉（菜单 rect 364–624，外壳 720–952）—— 菜单在 DOM 里、`aria-expanded`
  // 也是 true，屏幕上一个像素都没有，当然点不到。现在菜单是 `popover="manual"`，进 top layer。
  //
  // 这条测试直接渲染 `Choice` 本身：原先的测试走的是 `Dropdown.props.onPick`，把组件跳过了，
  // 所以这类「画不出来」的问题一次都没被抓住。
  {
    const boxy = (className) => ({
      className,
      children: [],
      textContent: '',
      appendChild(child) { this.children.push(child); return child; },
    });
    const choiceHost = await boot({
      fetchImpl: async (url) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.a{color:red}\n.b{color:blue}' });
        if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
        throw new Error('unexpected request: ' + url);
      },
      dom: { nodes: [{ tagName: 'DIV', className: 'a', children: [] }] },
    });
    hookIndex = 0;
    const rowView = choiceHost.registrations[0].component();
    findNode(rowView, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
    hookIndex = 0;
    const withPanel = choiceHost.registrations[0].component();
    // 找到 Choice 组件节点（wrapperClassName 是它的 props），把它渲染出来。
    const findChoice = (node) => {
      let found = null;
      (function walk(current) {
        if (found !== null || current === null || typeof current !== 'object') return;
        if (typeof current.type === 'function' && current.props?.wrapperClassName === 'dshCc_outline') found = current;
        for (const child of current.children ?? []) walk(child);
      })(node);
      return found;
    };
    const choice = findChoice(withPanel);
    assert.ok(choice !== null, 'the outline is a Choice');
    hookSlots.length = 0;
    hookIndex = 0;
    const choiceTree = choice.type(choice.props ?? {});
    // 打开菜单：触发按钮的 onClick 就是 toggle。
    const trigger = (function find(node) {
      if (node === null || typeof node !== 'object') return null;
      if (node.type === 'button' && String(node.props?.className ?? '').includes('dshUi_choice')) return node;
      for (const child of node.children ?? []) {
        const hit = find(child);
        if (hit !== null) return hit;
      }
      return null;
    })(choiceTree);
    assert.ok(trigger !== null, 'the choice has a trigger button');
    trigger.props.onClick();
    hookIndex = 0;
    const openedTree = choice.type(choice.props ?? {});
    const menu = (function find(node) {
      if (node === null || typeof node !== 'object') return null;
      if (String(node.props?.className ?? '') === 'dshUi_choiceMenu') return node;
      for (const child of node.children ?? []) {
        const hit = find(child);
        if (hit !== null) return hit;
      }
      return null;
    })(openedTree);
    assert.ok(menu !== null, 'clicking the trigger renders the menu');
    assert.strictEqual(menu.props.popover, 'manual', 'the menu is a manual popover, so it renders in the top layer');
    // 假 DOM 没有 showPopover：效果里的调用必须是可选的，否则组件在这里就崩了。
    assert.doesNotThrow(() => { choiceHost.runEffects(); }, 'a DOM without showPopover does not break opening');
    const rows = [];
    (function walk(node) {
      if (node === null || typeof node !== 'object') return;
      if (node.type === 'button' && String(node.props?.className ?? '').includes('dshUi_choiceItem')) rows.push(node);
      for (const child of node.children ?? []) walk(child);
    })(openedTree);
    assert.ok(rows.length >= 2, 'the menu lists the sheet\'s rules — got: ' + rows.length);
    let picked = null;
    const props = { ...choice.props, onPick: (value) => { picked = value; } };
    hookSlots.length = 0;
    hookIndex = 0;
    const liveTree = choice.type(props);
    const liveTrigger = (function find(node) {
      if (node === null || typeof node !== 'object') return null;
      if (node.type === 'button' && String(node.props?.className ?? '').includes('dshUi_choice')) return node;
      for (const child of node.children ?? []) {
        const hit = find(child);
        if (hit !== null) return hit;
      }
      return null;
    })(liveTree);
    liveTrigger.props.onClick();
    hookIndex = 0;
    const openTree = choice.type(props);
    const liveRows = [];
    (function walk(node) {
      if (node === null || typeof node !== 'object') return;
      if (node.type === 'button' && String(node.props?.className ?? '').includes('dshUi_choiceItem')) liveRows.push(node);
      for (const child of node.children ?? []) walk(child);
    })(openTree);
    liveRows[1].props.onClick();
    assert.strictEqual(picked, '1', 'clicking a row hands its value to onPick — got: ' + JSON.stringify(picked));
  }

  // --- an empty sheet has no outline to show --------------------------------
  // Reported from use: the file starts out empty, and the outline was still clickable.
  // Opening it showed a menu with no rows, which reads as broken rather than as
  // "there is nothing here yet". The rule this row follows is the same one the rest of
  // the interface follows: **a control is disabled when its action would produce
  // nothing**, not when it is inconvenient.
  const emptyBoot = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 0, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '' });
      if (url.endsWith('/write')) return jsonResponse({ ok: true, name: 'custom.css', bytes: 0 });
      throw new Error('unexpected request: ' + url);
    },
    dom: { nodes: [] },
  });
  hookIndex = 0;
  emptyBoot.registrations[0].component();
  await emptyBoot.runEffects();
  hookIndex = 0;
  const emptyView = emptyBoot.registrations[0].component();
  const emptyOutline = findOutline(emptyView);
  assert.ok(emptyOutline !== null, 'the empty sheet still renders the file bar');
  assert.strictEqual(
    emptyOutline.props.disabled, true,
    'an empty sheet disables the outline instead of offering an empty menu',
  );
  assert.deepStrictEqual(
    [...emptyOutline.props.items], [],
    'and it has no entries to offer — got: ' + JSON.stringify(emptyOutline.props.items),
  );

  // The disabled look itself: one treatment for the row, not a second invention.
  assert.ok(
    ownSheet.includes('.dshUi_choice:disabled{opacity:.4;cursor:not-allowed}'),
    'a disabled dropdown looks disabled (opacity + a cursor that says why)',
  );

  // ...and the prop has to actually REACH the button.
  //
  // This one came out of a reverse test that quietly passed: deleting the prop's use
  // inside `Dropdown` still left every assertion green, because they read
  // `outline.props.disabled` — the value the *caller* passes. Nothing checked that the
  // component does anything with it, so a refactor could have dropped the wiring while
  // the suite stayed green and the outline stayed clickable. The harness does not render
  // function components, so this is asserted against the source: the trigger's own
  // attribute object must carry the prop.
  {
    const cssStart = code.indexOf('const ROW_CSS = [');
    const triggerAt = code.indexOf("className: 'dshUi_choice'", cssStart);
    assert.ok(triggerAt > 0, 'the dropdown trigger is findable in the source');
    const trigger = code.slice(triggerAt, triggerAt + 700);
    assert.ok(
      /disabled:\s*props\.disabled/.test(trigger),
      'the dropdown trigger actually applies the disabled prop it is handed',
    );
  }

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

  // --- the height ceiling is the space that exists, not a constant ----------
  // The cap used to be `MENU_MAX_HEIGHT` flat, which is only right while the window is
  // tall. A menu opened near the bottom of a short window then promised 260px it did
  // not have, and its last rows sat under the window edge with no way to reach them.
  const shortWindow = { width: 900, height: 250 };
  const deepInShortWindow = { left: 40, right: 90, top: 220, bottom: 248, width: 50 };
  const squeezed = placeMenu(deepInShortWindow, shortWindow, 320);
  const squeezedHeight = Number.parseFloat(squeezed.maxHeight);
  assert.ok(
    squeezedHeight < 260,
    'a menu in a short window is capped by the space above it, not by the constant — got ' + squeezed.maxHeight,
  );
  // above = 220 - 8*2 = 204
  assert.strictEqual(squeezed.maxHeight, '204px', 'and the ceiling is exactly the room above the trigger');
  assert.ok(squeezed.bottom !== undefined, 'which is also why it sits above the trigger');

  const roomyHeight = placeMenu(triggerAt(40), window900, 320);
  assert.strictEqual(roomyHeight.maxHeight, '260px', 'a tall window still gets the preferred height');

  // Flipping and sizing read the same side of the trigger. When they disagree the menu
  // is placed on one side and measured against the other, which is how a menu ends up
  // half outside the window while looking correctly anchored.
  const tallWindow = { width: 900, height: 900 };
  const justFits = placeMenu({ left: 40, right: 90, top: 400, bottom: 428, width: 50 }, tallWindow, 320);
  assert.strictEqual(justFits.top, '432px', 'a trigger with room below keeps the menu below it');
  assert.strictEqual(justFits.maxHeight, '260px', 'and is capped by the preferred height, not by the room below');
  // 500 - 428 - 16 = 56 below, 400 - 16 = 384 above → flips, and the ceiling is the
  // room above capped at the preferred height.
  const flips = placeMenu({ left: 40, right: 90, top: 400, bottom: 428, width: 50 }, { width: 900, height: 500 }, 320);
  assert.ok(flips.bottom !== undefined, 'the same trigger flips once the window is too short below it');
  assert.strictEqual(flips.maxHeight, '260px', 'and the room above it (384) is capped at the preferred 260');
  // The two sides disagree in this one, which is the case the shared helper exists for:
  // below is larger than above, so the menu stays below even though it does not fit
  // there — and the ceiling has to agree with that placement.
  const staysPut = placeMenu({ left: 40, right: 90, top: 120, bottom: 148, width: 50 }, { width: 900, height: 300 }, 320);
  assert.strictEqual(staysPut.top, '152px', 'a menu stays below when that side has more room');
  assert.strictEqual(staysPut.maxHeight, '136px', 'and the ceiling follows the side it was placed on (300 - 148 - 16)');

  // --- nothing may switch off the app's own scrollbars ----------------------
  // DSH styles every scrollbar from one global stylesheet, with `::-webkit-scrollbar`. In
  // Chromium, a *standard* scrollbar property on an element makes the engine ignore exactly
  // that styling for that element — so one `scrollbar-width: thin` on a menu dropped it to the
  // platform bar while the rest of the app stayed styled. This audit reads the stylesheet the
  // plugin actually injects (not its JS source, which has comments talking about it) and allows
  // those properties only as `none` (hiding a scrollbar on purpose) or behind the webkit
  // feature query, which only engines without the pseudo-element ever see.
  // 控件样式在公共层、编辑器在行表：这两条断言都按「扩展自己的 CSS」整体看。
const injected = { textContent: ownSheet };
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
    [...blocks.keys()].some(selector => selector.includes('dshUi_menu')),
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
  // The picker's chrome lives inside the plugin's marked container rather than directly under
  // the body — one extra body child instead of one per overlay, so the app's own root does not
  // move along the `body > *` axis every time the picker arms. These helpers follow it there.
  //
  // `!== null` rather than a truthy test: a bare attribute reads back as the empty string, so
  // `if (getAttribute(...))` answers "no" for a container that is right there. The plugin made
  // that mistake once and made one container per call; this is the same comparison.
  const isOwned = (child) => child.getAttribute?.('data-dshcc-owned') !== null
    && child.getAttribute?.('data-dshcc-owned') !== undefined;
  // Takes the harness rather than closing over one: this file boots several, and a helper that
  // silently reads a different document is worse than no helper.
  const ownedRoot = (harness = picker) => harness.document.body.children.find(isOwned);
  const ownedChildren = (harness = picker) => ownedRoot(harness)?.children ?? [];
  const panel = (harness = picker) => ownedChildren(harness).find(child => child.className === 'dshCc_pickPanel');
  const boxOf = (harness = picker) => ownedChildren(harness).find(child => child.className === 'dshCc_pickBox');
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
  const lockedBox = () => ownedChildren().find(child => child.className === 'dshCc_pickBox dshCc_pickLocked');
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
  assert.ok(
    info().includes('排除名单'),
    'and again to the grandparent, which is the tree root — the exclude list refuses it — got: ' + JSON.stringify(info()),
  );

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
  assert.ok(info().includes('排除名单'), 'and it reaches the grandparent (refused by the exclude list)');
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
  const existingPanel = () => panel(existing) !== undefined;
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
  const newlineHost = node('div', { className: 'host-shell', rect: { top: 0, left: 0, width: 400, height: 200 } });
  const newlineNode = node('div', {
    className: 'dsh-two-line',
    attributes: { 'aria-label': '第一行\n第二行' },
    parent: newlineHost,
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
    dom: { nodes: [newlineHost, newlineNode] },
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
    const board = panel(unknown);
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
    const board = panel(harness);
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

  // --- 拾取之后把设置拉回来（openSettingsSurface）------------------------
  // 真机复现过的那条：拾取时点到设置对话框外面 → 对话框关掉、行被卸载；再点「插入规则」，
  // 规则写进去了，但什么都没回来 —— 面板自然也不会出现（也就是「拾取之后面板不自动打开」）。
  // 根因不是拾取，而是「重新打开设置」的找法：这一代 DSH 的侧栏入口在一个
  // `data-slot="sidebar.settings"` 的包装里（盒子 0×0、文字写着「更多」），名字叫「设置」的
  // 按钮根本不存在；而且旧实现点一下就当成功了，从没回头看过结果。
  {
    const double = (tagName, props = {}) => {
      const node = {
        tagName,
        className: props.className ?? '',
        children: [],
        parentElement: null,
        attributes: props.attributes ?? {},
        style: {},
        dataset: {},
        rect: props.rect ?? { width: 120, height: 32, top: 0, left: 0 },
        getAttribute(name) { return name in node.attributes ? node.attributes[name] : null; },
        setAttribute(name, value) { node.attributes[name] = String(value); },
        getBoundingClientRect() { return node.rect; },
        closest() { return null; },
        appendChild(child) { child.parentElement = node; node.children.push(child); return child; },
        querySelectorAll(selector) {
          const found = [];
          const walk = (current) => {
            for (const child of current.children ?? []) {
              if (matchesSelector(child, selector)) found.push(child);
              walk(child);
            }
          };
          walk(node);
          return found;
        },
        click() { if (typeof props.onClick === 'function') props.onClick(); },
      };
      return node;
    };
    const bootWith = async (nodes) => boot({
      dom: { nodes },
      fetchImpl: async (url) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.x{color:red}' });
        if (url.endsWith('/write')) return jsonResponse({ ok: true, name: 'custom.css', bytes: 1 });
        throw new Error('unexpected request: ' + url);
      },
    });

    // ① 侧栏 slot 里的入口：点开它就出现一行。
    const slotNodes = [];
    const slotHost = double('div', { attributes: { 'data-slot': 'sidebar.settings' } });
    slotHost.appendChild(double('button', { onClick: () => { slotNodes.push(double('div', { className: 'dshCc_row' })); } }));
    slotNodes.push(slotHost);
    const slotBoot = await bootWith(slotNodes);
    assert.strictEqual(
      await slotBoot.mod.__probe.openSettingsSurface(), true,
      'the sidebar slot entry is clicked, and the row it opens is detected',
    );

    // ② 名字就叫「设置」的控件：同样要能开。
    const namedNodes = [];
    namedNodes.push(double('button', {
      attributes: { 'aria-label': '设置' },
      onClick: () => { namedNodes.push(double('div', { className: 'dshCc_row' })); },
    }));
    const namedBoot = await bootWith(namedNodes);
    assert.strictEqual(await namedBoot.mod.__probe.openSettingsSurface(), true, 'a control named 设置 is clicked too');

    // ③ 一条入口都没有：返回 false，不抛（测试床没有 KeyboardEvent，这一步必须自己兜住）。
    const emptyBoot = await bootWith([]);
    assert.strictEqual(await emptyBoot.mod.__probe.openSettingsSurface(), false,
      'nothing to click and no shortcut support: it reports "not reopened" instead of throwing');
  }

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

  // --- 国际化：有 locale 服务时按当前语言渲染 --------------------------------
  //
  // 机制是「两份词典交给 DSH 的 locale 服务，再绑成 t」；没有该服务的组合（默认那种 boot）
  // 保持中文 —— 上面那一整段断言跑的就是这条路径。这一节守另外两件事：英文词典真的被用上了，
  // 以及**两份词典的键集完全一致**（少一条就会在英文界面里漏出中文，而单测抓不到）。
  const localeCalls = [];
  const dictionaries = {};
  /** 当前语言，测试可以改它并触发订阅者 —— 模拟用户在设置里切换语言。 */
  let activeLocale = 'en';
  const localeListeners = [];
  const fakeLocale = {
    register(namespace, tag, dict) {
      localeCalls.push({ namespace, tag });
      dictionaries[tag] = dict;
      return () => {};
    },
    // 假 `t`：查当前语言那一份，占位符替换与真的实现同样处理。
    bind() {
      return (key, vars) => String(dictionaries[activeLocale]?.[key] ?? key).replace(/\{(\w+)\}/g, (whole, name) => (
        vars !== undefined && Object.hasOwn(vars, name) ? String(vars[name]) : whole
      ));
    },
    subscribe(listener) {
      localeListeners.push(listener);
      return () => {};
    },
    // 内容词典（属性名 / 值名 / 模板名）按当前 tag 选表，所以真服务也有这一项。
    getLocale() {
      return { active: activeLocale, locales: [], revision: 0 };
    },
  };
  /**
   * 切换语言：和真的服务一样，只通知订阅者 —— 换字靠插件自己订阅后让组件重渲染。
   */
  const switchLocale = (tag) => {
    activeLocale = tag;
    for (const listener of localeListeners) listener();
  };
  const localized = await boot({
    locale: fakeLocale,
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.x{color:red}' });
      if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
      throw new Error('unexpected request: ' + url);
    },
  });
  assert.deepStrictEqual(
    localeCalls.map(entry => entry.tag).sort(), ['en', 'zh'],
    'both dictionaries are handed to the locale service — got: ' + JSON.stringify(localeCalls),
  );
  assert.ok(
    localeCalls.every(entry => entry.namespace === 'custom-css'),
    'under this plugin namespace — got: ' + JSON.stringify(localeCalls),
  );
  const zhKeys = Object.keys(dictionaries.zh).sort();
  const enKeys = Object.keys(dictionaries.en).sort();
  assert.deepStrictEqual(
    enKeys, zhKeys,
    'the two dictionaries carry exactly the same keys — only in zh: '
      + JSON.stringify(zhKeys.filter(key => !enKeys.includes(key)))
      + ', only in en: ' + JSON.stringify(enKeys.filter(key => !zhKeys.includes(key))),
  );
  hookIndex = 0;
  renderedText.length = 0;
  const localizedRow = localized.registrations[0].component();
  for (const english of ['Custom CSS', 'More actions', 'Pick element', 'Find']) {
    assert.ok(renderedText.includes(english), 'the row renders English chrome (' + english + ') — got: ' + JSON.stringify(renderedText.slice(0, 12)));
  }
  for (const chinese of ['自定义 CSS', '更多操作', '拾取元素']) {
    assert.ok(!renderedText.includes(chinese), 'and no Chinese chrome leaks through (' + chinese + ')');
  }
  // 菜单里也是英文：一条键漏翻译时这里会露出来。点的是**这一遍渲染**的节点 —— 再渲染一遍去点，
  // hook 槽位会写到新槽里，菜单永远不会开（这一行第一版就是这么写错的）。
  buttonWith(localizedRow, 'More actions').props.onClick();
  hookIndex = 0;
  renderedText.length = 0;
  const localizedMenu = localized.registrations[0].component();
  for (const label of ['Check for problems', 'Versions', 'Rename', 'Delete', 'Reset']) {
    assert.ok(renderedText.includes(label), 'the menu is translated too (' + label + ') — got: ' + JSON.stringify(renderedText));
  }
  assert.ok(buttonWith(localizedMenu, 'Check for problems') !== null, 'and the entries stay clickable');

  // 切语言：服务只通知订阅者，换字靠插件自己订阅后让 store 前进一步、组件重渲染。
  // 「重渲染就够了、不必重新挂载」是这套接法的全部承诺，所以这里直接验它。
  switchLocale('zh');
  hookIndex = 0;
  renderedText.length = 0;
  const localizedAgain = localized.registrations[0].component();
  assert.ok(
    renderedText.includes('自定义 CSS') && renderedText.includes('更多操作'),
    '切回中文后同一份组件重渲染即换字 — got: ' + JSON.stringify(renderedText.slice(0, 8)),
  );
  assert.ok(
    !renderedText.includes('Custom CSS'),
    'and the English copy is gone',
  );


  // --- 英文界面里不该出现一个汉字 --------------------------------------------
  //
  // 国际化最容易漏的地方不是「翻错」，而是「漏翻」：新加一条文案、忘了在词典里补英文，界面就混进
  // 一句中文 —— 而这件事在中文界面下肉眼完全看不见。这一节用自己的一遍 boot（状态干净）把设置行
  // 能展开的每个面都用英文渲染一次，逐字找汉字，同时守住两种漏法：`t('key')` 漏键、`content()` 漏条。
  const HAN = /[\u4e00-\u9fff]/;
  const leaks = [];
  const sweep = (label) => {
    for (const text of renderedText) {
      if (typeof text === 'string' && HAN.test(text)) leaks.push(label + ' → ' + text.slice(0, 50));
    }
  };
  const sweepHost = await boot({
    locale: fakeLocale,
    dom: {
      styleSheets: [{
        ownerNode: { dataset: { pluginCss: 'ext/theme.css' } },
        cssRules: [{
          selectorText: ':root',
          style: (() => {
            const style = ['--dsw-alias-bg-base'];
            style.getPropertyValue = () => '#ffffff';
            return style;
          })(),
          cssText: ':root{--dsw-alias-bg-base:#ffffff}.a{background:var(--dsw-alias-bg-base)}',
        }],
      }],
    },
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      if (url.includes('/history')) return jsonResponse({ ok: true, name: 'custom.css', entries: [] });
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.demo { color: red; border-radius: 8px; }' });
      if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: '0.2.1-rc.2', dshCommit: 'abc1234' });
      throw new Error('unexpected request: ' + url);
    },
  });
  const renderEnglish = () => {
    hookIndex = 0;
    renderedText.length = 0;
    renderedClasses.length = 0;
    return sweepHost.registrations[0].component();
  };
  // 切到英文：上一段结尾把语言切回了中文（它验的正是「切回去也能换字」）。
  switchLocale('en');
  renderEnglish();
  sweep('row');
  // 更多操作菜单
  buttonWith(renderEnglish(), 'More actions').props.onClick();
  const sweepMenu = renderEnglish();
  sweep('menu');
  // 历史版本页（这条 boot 的 Host 回答「没有历史」，正好走空状态那句）
  buttonWith(sweepMenu, 'Versions').props.onClick();
  await settle();
  sweep('versions');
  // 问题检测页：先从历史版本页的「返回」回到操作列表
  buttonWith(renderEnglish(), 'Back').props.onClick();
  buttonWith(renderEnglish(), 'Check for problems').props.onClick();
  await settle();
  sweep('audit');
  // 规则面板：点高亮层里的选择器（假 React 不渲染 dangerouslySetInnerHTML，直接调 onClick）
  findNode(renderEnglish(), 'pre').props.onClick({ target: { getAttribute: () => '0' } });
  sweep('rule panel');
  // 全屏视图（原生 dialog 里的文案也要扫）。
  // 预览块是组件：它的工具条与 dialog 都在它自己的树里，所以要在它自己的槽位里渲染。
  const previewSlots = [];
  const renderPreview = (view) => {
    const element = findNode(view, sweepHost.mod.__probe.PreviewBlock);
    if (element === null) return null;
    const rowSlots = hookSlots.splice(0, hookSlots.length);
    for (const slot of previewSlots) hookSlots.push(slot);
    hookIndex = 0;
    const tree = sweepHost.mod.__probe.PreviewBlock(element.props);
    previewSlots.length = 0;
    for (const slot of hookSlots.splice(0, hookSlots.length)) previewSlots.push(slot);
    for (const slot of rowSlots) hookSlots.push(slot);
    hookIndex = 0;
    return tree;
  };
  const findButtonNamed = (root, label) => (function find(node) {
    if (node === null || typeof node !== 'object') return null;
    if (node.type === 'button' && node.props?.['aria-label'] === label) return node;
    for (const child of node.children ?? []) {
      const hit = find(child);
      if (hit !== null) return hit;
    }
    return null;
  })(root);
  findButtonNamed(renderPreview(renderEnglish()), 'Full screen').props.onClick();
  const fullTree = renderPreview(renderEnglish());
  sweep('full screen');
  const leaveFull = findButtonNamed(fullTree, 'Leave full screen');
  if (leaveFull !== null) leaveFull.props.onClick();
  renderPreview(renderEnglish());
  // 令牌页（更多操作 → 令牌）
  buttonWith(renderEnglish(), 'Back').props.onClick();
  buttonWith(renderEnglish(), 'Tokens').props.onClick();
  await settle();
  sweep('tokens');
  // 查找栏
  findNode(renderEnglish(), 'textarea').props.onKeyDown({ key: 'f', ctrlKey: true, preventDefault() {} });
  sweep('find bar');
  // 插件详情页的两节（壁纸面板 / 壁纸设置）这一遍不扫：它们要的是一份完整的壁纸记录才能渲染，
  // 而这里只关心「设置行能展开的面」。那两节由视觉探针在真机上按英文采集（见 docs/testing.md）。
  assert.deepStrictEqual(leaks, [], '英文界面里漏出中文的地方：\n' + leaks.join('\n'));

  // --- 材质令牌：默认值随插件发布 -------------------------------
  // 为什么默认值必须由插件给：预设只写 `var(--dsh-material-mica-bg)` 这类引用，而 `var()` 没有
  // 回退值时，令牌缺失会让**整条声明被丢弃**（不报错）—— 等用户先填就等于预设点了没反应。
  const materialTag = host.styleTags.find(element => element.id === 'dsh-custom-css-material-style');
  assert.ok(materialTag !== undefined, 'the material tokens ship with the plugin — tags: '
    + JSON.stringify(host.styleTags.map(element => element.id)));
  assert.ok(
    materialTag.textContent.includes('body,\nbody[data-ds-dark-theme] {'),
    'with the same `body, body[data-ds-dark-theme]` prelude as the overrides (a bare `body` loses in dark mode)',
  );
  for (const name of [
    '--dsh-material-acrylic-bg', '--dsh-material-acrylic-blur', '--dsh-material-acrylic-saturate', '--dsh-material-acrylic-border',
    '--dsh-material-frost-bg', '--dsh-material-frost-blur', '--dsh-material-frost-saturate',
    '--dsh-material-mica-bg', '--dsh-material-mica-blur', '--dsh-material-mica-saturate', '--dsh-material-mica-grain',
  ]) {
    assert.ok(materialTag.textContent.includes(name + ':'), 'material token ' + name + ' is defined');
  }
  assert.ok(
    materialTag.textContent.includes('--dsh-material-mica-bg: light-dark('),
    'the fills are light-dark() pairs, so one value is right in both themes',
  );
  assert.ok(
    host.styleTags.indexOf(materialTag) < host.styleTags.indexOf(host.userStyle()),
    'and the defaults are injected before the user sheet, so the user can override them',
  );

  // --- 预览块：三个按钮 + 对比模式 --------------------------------------------
  // 位置与存在条件：只在打开某条规则时出现（与规则面板同进同退），所以这一节同时守住
  // 「没打开规则时不应该有预览块」—— 那会让没在编辑的行无故变高。
  {
    const previewHost = await boot({
      dom: { nodes: [{ tagName: 'DIV', className: 'card', children: [] }] },
      fetchImpl: async (url) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 30, mtime: 1 }], active: 'custom.css', disabled: [] });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.card { color: red; }' });
        if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
        throw new Error('unexpected request: ' + url);
      },
    });
    // 每次渲染前把 hookIndex 归零：它决定这次渲染从哪个状态槽开始读，错位会让点击写进
    // 别的组件留下的槽里（表现为「点了没反应」）。
    hookIndex = 0;
    renderedText.length = 0;
    renderedClasses.length = 0;
    const previewRow = previewHost.registrations[0].component();
    assert.strictEqual(findNode(previewRow, previewHost.mod.__probe.PreviewBlock), null,
      'no preview block while no rule is open');
    findNode(previewRow, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
    hookIndex = 0;
    renderedText.length = 0;
    renderedClasses.length = 0;
    const previewPanel = previewHost.registrations[0].component();
    assert.ok(findNode(previewPanel, previewHost.mod.__probe.PreviewBlock) !== null,
      'opening a rule brings the preview block — the panel hands it data and nothing else');

    // 预览块是一个组件：它有自己的状态槽（同一实例跨多次渲染保留），所以这里按实例渲染。
    const island = componentIsland((props) => previewHost.mod.__probe.PreviewBlock(props));
    const renderPreview = (view) => {
      const element = findNode(view, previewHost.mod.__probe.PreviewBlock);
      return element === null ? null : island.render(element.props);
    };
    const byClass = (view, wanted) => {
      const found = [];
      (function walk(current) {
        if (current === null || typeof current !== 'object') return;
        if (String(current.props?.className ?? '') === wanted) found.push(current);
        for (const child of current.children ?? []) walk(child);
      })(view);
      return found;
    };
    const allText = (view) => {
      const out = [];
      (function walk(current) {
        if (current === null || typeof current !== 'object') return;
        for (const child of current.children ?? []) {
          if (typeof child === 'string') out.push(child);
          else walk(child);
        }
      })(view);
      return out;
    };
    const buttonWithText = (view, label) => {
      let found = null;
      (function walk(current) {
        if (found !== null || current === null || typeof current !== 'object') return;
        if (current.type === 'button' && JSON.stringify(current.children ?? []).includes(label)) found = current;
        for (const child of current.children ?? []) walk(child);
      })(view);
      return found;
    };
    const buttonWithAria = (view, label) => {
      let found = null;
      (function walk(current) {
        if (found !== null || current === null || typeof current !== 'object') return;
        if (current.type === 'button' && current.props?.['aria-label'] === label) found = current;
        for (const child of current.children ?? []) walk(child);
      })(view);
      return found;
    };

    let preview = renderPreview(previewPanel);
    assert.strictEqual(byClass(preview, 'dshCc_previewBar').length, 1, 'the block has one toolbar row');
    assert.ok(allText(preview).includes('单屏') && allText(preview).includes('对比'),
      'with the view segmented control — got: ' + JSON.stringify(allText(preview).slice(0, 8)));
    const fullButton = buttonWithAria(preview, '全屏');
    assert.ok(fullButton !== null, 'and a full-screen button');
    assert.ok(String(fullButton.props.title ?? '').includes('全屏'),
      'whose tooltip says what it opens — got: ' + JSON.stringify(fullButton.props.title));
    // 单屏：只有「修改后」一块。
    assert.ok(byClass(preview, 'dshCc_previewAfter').length === 1, 'single-screen shows the modified sample');
    assert.strictEqual(byClass(preview, 'dshCc_previewCurrent').length, 0, 'and not the current one');
    assert.ok(!allText(preview).includes('当前'), 'no current label in single-screen mode');
    // 口径说明一直在：预览的价值取决于它说的这句实话。
    assert.ok(allText(preview).some(text => text.includes('冻结')), 'the freeze caveat is always shown');

    // 点对比：左边多出「当前」那一块；还没改过时说清楚，而不是摆一个空盒子。
    island.act(() => buttonWithText(preview, '对比').props.onClick());
    preview = renderPreview(previewPanel);
    assert.ok(allText(preview).includes('当前') && allText(preview).includes('修改后'), 'with both labels');
    assert.ok(allText(preview).some(text => text.includes('还没改动')),
      'compare mode on an unchanged rule says so — got: ' + JSON.stringify(allText(preview).slice(-5)));
    // 改一行之后再比：左边那块才真的出现（它代表「打开时」的样子）。
    hookIndex = 0;
    findNode(previewHost.registrations[0].component(), 'textarea').props.onChange({
      target: { value: '.card { color: blue; }', selectionStart: 0 },
      nativeEvent: { inputType: 'insertText' },
    });
    hookIndex = 0;
    const editedPanel = previewHost.registrations[0].component();
    preview = renderPreview(editedPanel);
    assert.strictEqual(byClass(preview, 'dshCc_previewCurrent').length, 1, 'after an edit the current sample appears');
    assert.ok(!allText(preview).some(text => text.includes('还没改动')), 'and the "nothing changed" note is gone');
  }

  // --- 预览块：状态芯片 / 合成样本 / 全屏视图 --------------------------------
  // 这一节第一次真正跑到 paintPreview：把行里的 ref 换成一个假面板，于是「克隆 + 冻结样式」
  // 这条路在单测里也走一遍，而不是只靠真机。
  {
    const fakeElement = (className) => {
      const node = {
        className,
        children: [],
        text: undefined,
        style: {},
        get textContent() {
          return node.text !== undefined ? node.text : node.children.map(child => child.textContent ?? '').join('');
        },
        set textContent(value) {
          node.text = String(value);
          node.children = [];
        },
        appendChild(child) { node.children.push(child); return child; },
        insertBefore(child) { node.children.unshift(child); return child; },
        removeAttribute() {},
        cloneNode() { return fakeElement(className); },
      };
      return node;
    };
    const card = fakeElement('card');
    card.tagName = 'DIV';
    const chipHost = await boot({
      dom: {
        nodes: [card],
        // 计算样式：背景给一个具体颜色，content 给文本 —— 伪元素合成才有东西可抄。
        computed: () => ({
          length: 2,
          0: 'color',
          1: 'content',
          getPropertyValue: name => (name === 'content' ? '"→"' : 'rgb(255, 0, 0)'),
        }),
      },
      fetchImpl: async (url) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 30, mtime: 1 }], active: 'custom.css', disabled: [] });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.card { color: red; }\n.card:hover { color: blue; }\n.card::before { content: "→"; }' });
        if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
        throw new Error('unexpected request: ' + url);
      },
    });
    const findByClass = (node, cls, found = []) => {
      if (node === null || typeof node !== 'object') return found;
      if (String(node.props?.className ?? '').includes(cls)) found.push(node);
      for (const child of node.children ?? []) findByClass(child, cls, found);
      return found;
    };
    const nodesMatching = (node, predicate, found = []) => {
      if (node === null || typeof node !== 'object') return found;
      if (predicate(node)) found.push(node);
      for (const child of node.children ?? []) nodesMatching(child, predicate, found);
      return found;
    };
    const buttonsByAria = (root) => nodesMatching(root, node => node.type === 'button' && typeof node.props?.['aria-label'] === 'string')
      .map(node => ({ label: node.props['aria-label'], node }));

    const island = componentIsland((props) => chipHost.mod.__probe.PreviewBlock(props));
    const previewOf = (view) => {
      const element = findNode(view, chipHost.mod.__probe.PreviewBlock);
      return element === null ? null : island.render(element.props);
    };
    const findNodesByClass = (view, cls) => findByClass(view, cls);
    const chipLabelsOf = (view) => buttonsByAria(view)
      .map(entry => entry.label)
      .filter(label => ['悬停', '聚焦', '占位符', '::before', '::after'].includes(label));
    const buttonByLabel = (view, label) => buttonsByAria(view).find(entry => entry.label === label).node;
    const buttonWithTextIn = (view, label) => nodesMatching(view, node => node.type === 'button'
      && JSON.stringify(node.children ?? []).includes(label))[0];
    // 打开一条规则再渲染面板：`openRule` 只负责点那条规则的 <pre>，返回新面板的树。
    let chipPanel = null;
    const openRule = (view, index) => {
      const tree = chipHost.registrations[0].component();
      findNode(tree, 'pre').props.onClick({ target: { getAttribute: () => String(index) } });
      hookIndex = 0;
      return chipHost.registrations[0].component();
    };

    // 规则 0 是 .card：选择器里没有任何状态伪类 —— 芯片一个都不出现。
    // 以前它照样摆五枚，其中四枚点下去是空操作（临时表注入了，但改写后的选择器根本不存在）。
    const cardPanel = openRule(null, 0);
    let preview = previewOf(cardPanel);
    assert.deepStrictEqual(chipLabelsOf(preview), [],
      'and none of the five chips is rendered — got: ' + JSON.stringify(chipLabelsOf(preview)));

    // 规则 1 是 .card:hover：芯片**只**有它真有的那个状态。
    const hoverPanel = openRule(null, 1);
    preview = previewOf(hoverPanel);
    assert.strictEqual(chipLabelsOf(preview).length, 1, 'the toolbar carries one chip for this rule');
    assert.deepStrictEqual(chipLabelsOf(preview), ['悬停'],
      'and only the states this selector really has — got: ' + JSON.stringify(chipLabelsOf(preview)));
    // 悬停：真页面上加类 + 注入强制表，选择器被改写成状态类。
    island.act(() => buttonByLabel(preview, '悬停').props.onClick());
    preview = previewOf(hoverPanel);
    await chipHost.runEffects();
    const forceTag = chipHost.styleTags.find(element => element.id === 'dsh-custom-css-preview-force');
    assert.ok(forceTag !== undefined, 'the hover chip injects the force sheet');
    assert.ok(String(forceTag.textContent).includes('color: blue'),
      'carrying the rule body — got: ' + String(forceTag.textContent));
    assert.ok(String(forceTag.textContent).includes('.dshCcStateHover'),
      'and its selector was rewritten — got: ' + String(forceTag.textContent));
    assert.ok(String(card.className).includes('dshCcStateHover'),
      'and the target element carries it — got: ' + card.className);
    // 关掉：表和类都撤掉，页面上不留痕迹。
    preview = previewOf(hoverPanel);
    island.act(() => buttonByLabel(preview, '悬停').props.onClick());
    preview = previewOf(hoverPanel);
    await chipHost.runEffects();
    assert.strictEqual(chipHost.styleTags.find(element => element.id === 'dsh-custom-css-preview-force'), undefined,
      'turning the chip off removes the force sheet');
    assert.ok(!String(card.className).includes('dshCcStateHover'), 'and the class — got: ' + card.className);

    // 对比模式：芯片隐藏（左右会被强制态一起污染），而切过去时强制态本身也要撤掉。
    preview = previewOf(hoverPanel);
    island.act(() => buttonByLabel(preview, '悬停').props.onClick());
    preview = previewOf(hoverPanel);
    await chipHost.runEffects();
    island.act(() => buttonWithTextIn(preview, '对比').props.onClick());
    preview = previewOf(hoverPanel);
    await chipHost.runEffects();
    assert.deepStrictEqual(chipLabelsOf(preview), [], 'chips are hidden in compare mode');
    assert.strictEqual(chipHost.styleTags.find(element => element.id === 'dsh-custom-css-preview-force'), undefined,
      'and the forced state is cleared when the comparison needs a clean left pane');

    // 规则 2 是 .card::before：伪元素规则预览的是**宿主元素**（::before 以前让整条规则掉进
    // 合成样本分支），芯片只有 ::before。视图是「看的时候的偏好」，换规则不重置 —— 先切回单屏。
    const pseudoPanel = openRule(null, 2);
    preview = previewOf(pseudoPanel);
    island.act(() => buttonWithTextIn(preview, '单屏').props.onClick());
    preview = previewOf(pseudoPanel);
    assert.deepStrictEqual(chipLabelsOf(preview), ['::before'],
      'a pseudo-element rule offers only that pseudo-element chip — got: ' + JSON.stringify(chipLabelsOf(preview)));
  }

  // --- 绘制：合成样本与真样本（paintModelInto 直接驱动）---------------------
  // 绘制这一层只碰 DOM、不碰 React（组件只负责「什么时候画」），所以测试可以自己造假盒子。
  {
    const probe = host.mod.__probe;
    const box = (className) => {
      const node = {
        className,
        children: [],
        text: undefined,
        style: {},
        dataset: {},
        get textContent() {
          return node.text !== undefined ? node.text : node.children.map(child => child.textContent ?? '').join('');
        },
        set textContent(value) {
          node.text = String(value);
          node.children = [];
        },
        appendChild(child) { node.children.push(child); return child; },
        insertBefore(child) { node.children.unshift(child); return child; },
        removeAttribute() {},
        cloneNode() { return box(className); },
      };
      return node;
    };
    // 真样本要被克隆，所以池子里的节点要带 cloneNode（测试床的通用 double 没有）。
    const makePageNode = (className) => {
      const node = {
        tagName: 'DIV',
        className,
        children: [],
        style: {},
        attributes: {},
        appendChild(child) { node.children.push(child); return child; },
        insertBefore(child) { node.children.unshift(child); return child; },
        removeAttribute(name) { delete node.attributes[name]; },
        cloneNode() { return makePageNode(className); },
        matches: (selector) => matchesSelector(node, selector),
      };
      return node;
    };
    const host4 = await boot({
      dom: {
        nodes: [makePageNode('card')],
        computed: () => ({
          length: 2,
          0: 'color',
          1: 'content',
          getPropertyValue: name => (name === 'content' ? '"→"' : 'rgb(255, 0, 0)'),
        }),
      },
      fetchImpl: async (url) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 30, mtime: 1 }], active: 'custom.css', disabled: [] });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.card { color: red; }\n.nowhere { background: red; }' });
        if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
        throw new Error('unexpected request: ' + url);
      },
    });
    const probe4 = host4.mod.__probe;
    const boxes = [box('dshCc_previewAfter'), box('dshCc_previewCurrent')];
    const root = {
      querySelectorAll: (selector) => (String(selector).includes('dshCc_canvas') ? [] : boxes),
    };

    // a) 命中 0 个：合成样本，并**明确标注**它不是页面上的元素。
    const nowhereCss = '.nowhere { background: red; border-radius: 8px; }';
    // 合成样本用的是规则**自己的声明**，所以 rule 要带上正文偏移（面板里那份是 parseRules 给的）。
    const nowhereRule = { selector: '.nowhere', bodyStart: nowhereCss.indexOf('{') + 1, bodyEnd: nowhereCss.indexOf('}') };
    const syntheticModel = probe4.previewModel({
      rule: nowhereRule,
      css: nowhereCss,
      baselineCss: nowhereCss,
      index: 0,
      exclusions: [],
    });
    assert.strictEqual(syntheticModel.synthetic, true, 'a selector with no match asks for a synthetic sample');
    probe4.paintModelInto(root, { model: syntheticModel, rule: nowhereRule, css: nowhereCss, compare: false, pseudos: [] });
    assert.ok(boxes[0].children.length >= 1, 'the synthetic sample is painted into the box');
    assert.ok(String(boxes[0].children[0].className).includes('dshCc_sampleSynthetic'),
      'and it is marked as synthetic — got: ' + String(boxes[0].children[0].className));
    assert.ok(String(boxes[0].children[0].style.cssText ?? '').includes('background:red'),
      'carrying the rule’s own declarations — got: ' + String(boxes[0].children[0].style.cssText));

    // b) 真样本：克隆 + 冻结的计算样式 + 伪元素合成。
    const realCss = '.card { color: red; }\n.card::before { content: "→"; }';
    const cardModel = probe4.previewModel({
      rule: { selector: '.card' },
      css: realCss,
      baselineCss: '.card { color: blue; }',
      index: 0,
      exclusions: [],
    });
    assert.strictEqual(cardModel.synthetic, false, 'a real match is drawn');
    assert.strictEqual(cardModel.dirty, true, 'and the model knows the sheet changed since it was opened');
    probe4.paintModelInto(root, {
      model: cardModel,
      rule: { selector: '.card' },
      css: realCss,
      compare: true,
      pseudos: ['::before'],
    });
    assert.ok(boxes[0].children.length >= 1, 'the modified sample is painted');
    const painted = boxes[0].children[0];
    assert.ok(String(painted.style.cssText ?? '').includes('rgb(255, 0, 0)'),
      'with the frozen computed style — got: ' + String(painted.style.cssText).slice(0, 60));
    assert.ok((painted.children ?? []).some(child => String(child.className).includes('dshCc_samplePseudo')),
      'and the ::before content is synthesised into it');
    assert.ok(boxes[1].children.length >= 1, 'the current side is painted too when comparing');
  }

  // --- 全屏视图：同一个组件、同一棵树 ---------------------------------------
  {
    const fullHost = await boot({
      dom: { nodes: [{ tagName: 'DIV', className: 'card', children: [] }] },
      fetchImpl: async (url) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 30, mtime: 1 }], active: 'custom.css', disabled: [] });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.card { color: red; }' });
        if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
        throw new Error('unexpected request: ' + url);
      },
    });
    const nodesMatching = (node, predicate, found = []) => {
      if (node === null || typeof node !== 'object') return found;
      if (predicate(node)) found.push(node);
      for (const child of node.children ?? []) nodesMatching(child, predicate, found);
      return found;
    };
    const island = componentIsland((props) => fullHost.mod.__probe.PreviewBlock(props));
    const previewOf = (view) => {
      const element = findNode(view, fullHost.mod.__probe.PreviewBlock);
      return element === null ? null : island.render(element.props);
    };
    hookIndex = 0;
    const fullRow = fullHost.registrations[0].component();
    findNode(fullRow, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
    hookIndex = 0;
    const openPanel = fullHost.registrations[0].component();
    let preview = previewOf(openPanel);
    const fullButton = nodesMatching(preview, node => node.type === 'button' && node.props?.['aria-label'] === '全屏')[0];
    assert.ok(fullButton !== undefined, 'the block has a full-screen button');
    island.act(() => fullButton.props.onClick());
    preview = previewOf(openPanel);
    const dialogs = nodesMatching(preview, node => node.type === 'dialog');
    assert.strictEqual(dialogs.length, 1, 'opening full screen renders one dialog — got: ' + dialogs.length);
    assert.strictEqual(dialogs[0].props.className, 'dshCc_full', 'with its own class');
    // 同一个组件：dialog 里的画布与行内那块是同一份渲染逻辑，两块窗格由 showCompare 决定。
    assert.ok(nodesMatching(dialogs[0], node => String(node.props?.className ?? '').includes('dshCc_fullStage')).length === 1,
      'the two-up stage is inside it');
    assert.ok(nodesMatching(dialogs[0], node => String(node.props?.className ?? '').includes('dshCc_fullBody')).length === 1,
      'and the same rule body');
    const dialogText = [];
    (function walk(current) {
      if (current === null || typeof current !== 'object') return;
      for (const child of current.children ?? []) {
        if (typeof child === 'string') dialogText.push(child);
        else walk(child);
      }
    })(dialogs[0]);
    assert.ok(dialogText.includes('当前') && dialogText.includes('修改后'), 'both labels are forced on');
    // 关掉：× 收起 dialog。
    const closeButton = nodesMatching(dialogs[0], node => node.type === 'button' && node.props?.['aria-label'] === '退出全屏');
    assert.strictEqual(closeButton.length, 1, 'the dialog has its own close control');
    island.act(() => closeButton[0].props.onClick());
    preview = previewOf(openPanel);
    assert.strictEqual(nodesMatching(preview, node => node.type === 'dialog').length, 0, 'closing removes the dialog');
  }

  // --- 元素诊断：纯函数 + 注入样式 -----------------------------------------
  // 三个检查都是「真的会坏」的：祖先还有一层毛玻璃、opacity 把 backdrop-filter 废掉、
  // fixed 被带 transform 的祖先捕获。判定函数不碰真实 DOM —— 样式读取是参数，所以这里
  // 用假节点 + 假样式表驱动，既快又能说清每条断言在证明什么。
  {
    const probe = host.mod.__probe;
    assert.ok(typeof probe.diagnoseElement === 'function', 'the diagnostic is reachable for testing');
    const fake = (className, parent) => ({ className, parentElement: parent ?? null });
    const styleMap = new Map();
    const styleOf = (element) => styleMap.get(element) ?? { backdropFilter: 'none', opacity: '1', position: 'static', transform: 'none', filter: 'none', perspective: 'none' };

    // a) 干净的卡片：什么都不报。
    const plain = fake('card');
    styleMap.set(plain, { backdropFilter: 'blur(8px)', opacity: '1', position: 'static', transform: 'none', filter: 'none', perspective: 'none' });
    assert.deepStrictEqual([...probe.diagnoseElement(plain, styleOf)].map(f => f.id), [], 'a plain glass card has nothing to report');

    // b) 祖先还有一层毛玻璃。
    const outer = fake('shell');
    const inner = fake('panel', outer);
    styleMap.set(outer, { backdropFilter: 'blur(24px)', opacity: '1', position: 'static', transform: 'none', filter: 'none', perspective: 'none' });
    styleMap.set(inner, { backdropFilter: 'blur(12px)', opacity: '1', position: 'static', transform: 'none', filter: 'none', perspective: 'none' });
    assert.deepStrictEqual([...probe.diagnoseElement(inner, styleOf)].map(f => f.id), ['stackedGlass'], 'a glass card inside a glass shell is reported');

    // c) opacity 杀掉 backdrop-filter（自身与祖先各一例）。
    const faded = fake('faded');
    styleMap.set(faded, { backdropFilter: 'blur(12px)', opacity: '0.6', position: 'static', transform: 'none', filter: 'none', perspective: 'none' });
    assert.deepStrictEqual([...probe.diagnoseElement(faded, styleOf)].map(f => f.id), ['opacityKillsGlass'], 'opacity on the layer itself is reported');
    const fadedParent = fake('faded-shell');
    const child = fake('card', fadedParent);
    styleMap.set(fadedParent, { backdropFilter: 'none', opacity: '0.8', position: 'static', transform: 'none', filter: 'none', perspective: 'none' });
    styleMap.set(child, { backdropFilter: 'blur(12px)', opacity: '1', position: 'static', transform: 'none', filter: 'none', perspective: 'none' });
    assert.deepStrictEqual([...probe.diagnoseElement(child, styleOf)].map(f => f.id), ['opacityKillsGlass'], 'and opacity on an ancestor counts too');

    // d) fixed 被 transform 的祖先捕获（上一轮菜单点不了的根因）。
    const moved = fake('moved');
    const pinned = fake('pinned', moved);
    styleMap.set(moved, { backdropFilter: 'none', opacity: '1', position: 'static', transform: 'translateY(2px)', filter: 'none', perspective: 'none' });
    styleMap.set(pinned, { backdropFilter: 'none', opacity: '1', position: 'fixed', transform: 'none', filter: 'none', perspective: 'none' });
    assert.deepStrictEqual([...probe.diagnoseElement(pinned, styleOf)].map(f => f.id), ['fixedTrapped'], 'a fixed overlay under a transformed ancestor is reported');
  }

  // --- 整表诊断：同一套判据跑在每条规则的样本上 ------------------------------
  // 页面里的提示只看得见「正在预览的那一个元素」，而问题在别的规则上（写死 fixed 的菜单被哪个
  // 祖先捕获，取决于祖先，不取决于用户此刻在预览哪条）。这里只证明两件事：它按源码顺序把有问题的
  // 规则挑出来并带上位置，以及它和体检页其余部分判得一样严（命不中 / 状态相关的不报）。
  {
    const probe = host.mod.__probe;
    assert.ok(typeof probe.sheetFindings === 'function', 'the sheet-wide scan is reachable for testing');
    const fake = (className, parent) => ({ className, parentElement: parent ?? null });
    const styleMap = new Map();
    const styleOf = (element) => styleMap.get(element) ?? { backdropFilter: 'none', opacity: '1', position: 'static', transform: 'none', filter: 'none', perspective: 'none' };
    const clean = { backdropFilter: 'none', opacity: '1', position: 'static', transform: 'none', filter: 'none', perspective: 'none' };
    const glass = { backdropFilter: 'blur(16px)', opacity: '1', position: 'static', transform: 'none', filter: 'none', perspective: 'none' };

    const shell = fake('shell');
    styleMap.set(shell, glass);
    const glassCard = fake('card', shell);
    styleMap.set(glassCard, glass);
    const moved = fake('moved');
    styleMap.set(moved, { ...clean, transform: 'translateY(2px)' });
    const pinned = fake('pinned', moved);
    styleMap.set(pinned, { ...clean, position: 'fixed' });
    const fine = fake('plain');
    styleMap.set(fine, clean);
    const hovered = fake('hovered');
    styleMap.set(hovered, glass);

    const nodes = { '.a': [glassCard], '.b': [pinned], '.c': [fine], '.d:hover': [hovered] };
    const doc = { querySelectorAll: (selector) => nodes[selector] ?? [] };
    const sheet = '.a{backdrop-filter:blur(8px)}\n.b{position:fixed}\n.c{color:red}\n.d:hover{backdrop-filter:blur(8px)}\n';

    // 摊进本文件自己的数组/对象里再比：模块在自己的作用域里造出来的数组，原型和这边不是同一个，
    // deepStrictEqual 会把「看起来一模一样」判成不等。
    const found = [...probe.sheetFindings(sheet, doc, styleOf)]
      .map(entry => ({ ...entry, findings: [...entry.findings].map(finding => ({ ...finding })) }));
    const idsOf = (entries) => entries.map(entry => entry.findings.map(finding => finding.id));
    assert.deepStrictEqual(found.map(entry => entry.selector), ['.a', '.b'],
      'only the rules whose samples really have a problem are listed, in source order — got: ' + JSON.stringify(found.map(entry => entry.selector)));
    assert.deepStrictEqual(found.map(entry => entry.line), [1, 2], 'each entry carries its line');
    assert.deepStrictEqual(idsOf(found), [['stackedGlass'], ['fixedTrapped']],
      'with the ids the preview panel would show — got: ' + JSON.stringify(idsOf(found)));
    assert.ok(found.every(entry => typeof entry.start === 'number' && entry.end > entry.start),
      'and a source range, so the row can jump to it');
    // `.c` 干净、`.d:hover` 是状态相关（静止页面上它的声明根本没生效），都不该出现在表里。
    assert.ok(!found.some(entry => entry.selector === '.c'), 'a clean rule is not listed');
    assert.ok(!found.some(entry => entry.selector.includes(':hover')), 'a state-dependent rule is not listed');
    assert.deepStrictEqual([...probe.sheetFindings('', doc, styleOf)], [], 'an empty sheet has nothing to report');
  }

  // --- 动效与性能：只看文本的三件事 -----------------------------------------
  // `transition: all`、动画在动布局属性、大模糊半径 —— 它们的共同点是「规则是生效的」，只是代价
  // 比看起来大。所以判据必须是**读文本**（命不中的规则也算），并且宁漏勿误：正常的透明度过渡、
  // 小的模糊、「transform 位移动画」都不该被点名。
  {
    const probe = host.mod.__probe;
    assert.ok(typeof probe.sheetStyleFindings === 'function', 'the text-level scan is reachable for testing');
    const sheet = [
      '.a{transition:all .2s}',                              // 1 该报
      '.b{transition:opacity .2s}',                          // 2 正常过渡
      '.c{backdrop-filter:blur(32px)}',                       // 3 该报（大模糊）
      '.d{filter:blur(4px)}',                                // 4 小模糊
      '.e{transition:opacity .2s, all .3s}',                  // 5 分量里有 all，同样该报
      '@keyframes grow{from{width:0}to{width:100%}}',         // 6 布局动画的来源
      '@keyframes fade{to{opacity:0}}',                       // 7 合成器动画，不报
      '@keyframes spaced{to{box-shadow:0 0 0 4px red;/* width: 1px */}}', // 8 注释不算数
      '.f{animation:grow .3s ease}',                          // 9 该报（动 width）
      '.g{animation:fade .3s}',                               // 10 不报
      '.h{animation-name:spaced}',                            // 11 该报（动 box-shadow）
      '.i:hover{transition:all .2s}',                         // 12 状态相关，不报
      '@media (min-width:9999px){ .j{transition:all .2s} }',  // 13 断点里，不在这一张表
    ].join('\n');
    const found = [...probe.sheetStyleFindings(sheet)]
      .map(entry => ({ ...entry, findings: [...entry.findings].map(finding => ({ ...finding, params: finding.params ? { ...finding.params } : undefined })) }));
    const bySelector = new Map(found.map(entry => [entry.selector, entry.findings]));
    assert.deepStrictEqual([...bySelector.keys()], ['.a', '.c', '.e', '.f', '.h'],
      'only the expensive ones are listed, in source order — got: ' + JSON.stringify([...bySelector.keys()]));
    assert.deepStrictEqual(bySelector.get('.a').map(f => f.id), ['transitionAll'], 'transition: all is reported');
    assert.deepStrictEqual(bySelector.get('.e').map(f => f.id), ['transitionAll'], 'and so is all inside a list of properties');
    assert.deepStrictEqual(bySelector.get('.c').map(f => f.id + ':' + f.params.radius), ['bigBlur:32px'], 'a big blur radius is reported, with the radius it read');
    assert.deepStrictEqual(bySelector.get('.f').map(f => f.id + ':' + f.params.list), ['layoutAnimation:width'], 'an animation that drives width is reported, naming the property');
    assert.deepStrictEqual(bySelector.get('.h').map(f => f.id + ':' + f.params.list), ['layoutAnimation:box-shadow'],
      'box-shadow counts too — and the commented-out "width" does not');
    assert.ok(!bySelector.has('.b') && !bySelector.has('.d') && !bySelector.has('.g'),
      'a normal transition, a small blur and an opacity animation are all left alone');
    assert.ok(!bySelector.has('.i') && !bySelector.has('.j'),
      'a state-dependent rule and one inside a media query are not part of this sheet’s report');
    assert.deepStrictEqual([...probe.sheetStyleFindings('')], [], 'an empty sheet has nothing to report');
  }

  // --- 「适应」档的比例 ----------------------------------------------------
  // 组件按真实尺寸排版，比窗口宽就必然被裁；「适应」只缩显示、不改尺寸。这条纯函数决定缩多少：
  // 取两个方向里更小的那个比例，并且**只往下**（放大只会让画面比页面更虚）。
  {
    const probe = host.mod.__probe;
    const surface = { offsetWidth: 800, offsetHeight: 400 };
    const viewport = { clientWidth: 400, clientHeight: 400 };
    assert.strictEqual(probe.canvasFitScale(surface, viewport, true), 0.5, 'a too-wide sample is scaled to the window width');
    assert.strictEqual(probe.canvasFitScale(surface, viewport, false), 1, 'with fit off the scale is exactly 1');
    assert.strictEqual(probe.canvasFitScale({ offsetWidth: 100, offsetHeight: 100 }, viewport, true), 1,
      'a sample smaller than the window is never scaled up');
    assert.strictEqual(probe.canvasFitScale(surface, { clientWidth: 800, clientHeight: 200 }, true), 0.5,
      'the height is the tighter constraint here — got the smaller ratio');
    assert.strictEqual(probe.canvasFitScale({ offsetWidth: 0, offsetHeight: 0 }, viewport, true), 1,
      'an unmeasured sample falls back to 1 instead of dividing by zero');
  }

  // --- 组件「身后」那层颜色 ------------------------------------------------
  // 用户报过「明明在对话里有背景，预览里没有」：组件自己的 background 常常是 transparent，
  // 看着有底是页面给的。这两条纯函数就是「找那层底」的全部逻辑。
  {
    const probe = host.mod.__probe;
    assert.strictEqual(probe.colorAlpha('rgba(0, 0, 0, 0.58)'), 0.58, 'rgba alpha is read');
    assert.strictEqual(probe.colorAlpha('rgb(255, 255, 255)'), 1, 'rgb without alpha is opaque');
    assert.strictEqual(probe.colorAlpha('color(srgb 1 1 1 / 0.58)'), 0.58, 'the color() spelling DSH tokens use is read too');
    assert.strictEqual(probe.colorAlpha('transparent'), 0, 'transparent is zero');
    assert.ok(Math.abs(probe.colorAlpha('#00000080') - 0.5) < 0.01, 'hex alpha is read');
    assert.strictEqual(probe.colorAlpha(''), 0, 'an empty string is not a colour');

    const make = (className, parent, style) => ({ className, parentElement: parent ?? null, style });
    const styles = new Map();
    const styleOf = (node) => styles.get(node) ?? { backgroundColor: '', backgroundImage: 'none' };
    const white = make('page', null);
    styles.set(white, { backgroundColor: 'rgb(250, 250, 250)', backgroundImage: 'none' });
    const card = make('card', white);
    styles.set(card, { backgroundColor: 'color(srgb 1 1 1 / 0.58)', backgroundImage: 'none' });
    const inner = make('bubble', card);
    styles.set(inner, { backgroundColor: 'transparent', backgroundImage: 'none' });
    assert.strictEqual(probe.pageBackdropOf(inner, styleOf), 'rgb(250, 250, 250)',
      'a transparent component inherits the first opaque ancestor colour');
    const patterned = make('wall', white);
    styles.set(patterned, { backgroundColor: 'transparent', backgroundImage: 'linear-gradient(red, blue)' });
    const onWall = make('bubble', patterned);
    styles.set(onWall, { backgroundColor: 'transparent', backgroundImage: 'none' });
    assert.strictEqual(probe.pageBackdropOf(onWall, styleOf), '',
      'a patterned ancestor is left to the canvas背景 rather than painted over');
  }

  // --- 预览画布：平移的算术，和背景记忆 --------------------------------
  // 拖动是「每帧直接写 DOM」的（一帧一次 React 渲染会把克隆出来的样本一起重画），所以真正要钉住的是
  // 两件纯算术：归位时给空串而不是 `translate(0px, 0px)`（后者仍然会建合成层、仍然会改 fixed 的包含块），
  // 以及「从这一份起点再拖 40px」算得对。
  {
    const probe = host.mod.__probe;
    assert.strictEqual(probe.canvasTranslate({ x: 0, y: 0 }), '',
      'at rest the transform is empty, not translate(0px, 0px)');
    assert.strictEqual(probe.canvasTranslate({ x: -12, y: 7 }), 'translate(-12px, 7px)', 'a moved canvas carries its offset');
    assert.strictEqual(probe.canvasTranslate({ x: Number.NaN, y: 0 }), '', 'a broken pan is treated as "at rest"');
    const first = probe.canvasDragTo({ x: 100, y: 100, panX: 0, panY: 0 }, { clientX: 140, clientY: 80 });
    assert.deepStrictEqual({ ...first }, { x: 40, y: -20 }, 'dragging from the origin follows the pointer — got: ' + JSON.stringify(first));
    const second = probe.canvasDragTo({ x: 100, y: 100, panX: 40, panY: -20 }, { clientX: 120, clientY: 100 });
    assert.deepStrictEqual({ ...second }, { x: 60, y: -20 }, 'and a second drag starts from where the first one left it — got: ' + JSON.stringify(second));
    // 六个背景 id 就是 CSS 里 `[data-canvas="…"]` 的那六个，多一个少一个都会变成一块没样式的空白。
    assert.deepStrictEqual(
      [...probe.CANVAS_BACKGROUNDS].map(entry => entry.id).sort(),
      ['checker', 'dots', 'gradient', 'grid', 'page', 'plain', 'stripes'],
      'the presets are exactly the ids the stylesheet paints',
    );
    assert.strictEqual(probe.readCanvasBackground(), 'page', 'with nothing stored the canvas starts on the page background');
    const stored = await boot({
      stored: new Map([['dsh-custom-css:canvas', 'stripes']]),
      fetchImpl: async (url) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 2, mtime: 1 }], active: 'custom.css', disabled: [] });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '' });
        if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
        throw new Error('unexpected request: ' + url);
      },
    });
    assert.strictEqual(stored.mod.__probe.readCanvasBackground(), 'stripes',
      'a remembered background is the one that comes back');
    // 玻璃判定：只有它决定「画布底板要不要让开」，所以三种写法都得认。
    assert.strictEqual(probe.glassEnabled({ backdropFilter: 'blur(36px) saturate(1.2)' }), true, 'a real blur counts as glass');
    assert.strictEqual(probe.glassEnabled({ backdropFilter: 'none' }), false, 'none does not');
    assert.strictEqual(probe.glassEnabled({ webkitBackdropFilter: 'blur(4px)' }), true, 'the webkit spelling is read too');
    assert.strictEqual(probe.glassEnabled({}), false, 'a style with no backdrop-filter at all is not glass');
  }

  // --- 预览块的模型层（v4）---------------------------------------------------
  // 四个纯函数是这一版的可测边界：它们不改页面、不建 React，所以「命中谁 / 哪些芯片该出现 /
  // 拖到哪儿该停 / 样本怎么造」可以在没有浏览器的情况下断言（设计见 docs/preview-v4.md）。
  {
    const probe = host.mod.__probe;

    // 芯片跟着选择器走。以前芯片是固定五枚，选择器里没有 :hover 时点下去是空操作：
    // 强制表注入了，但改写后的选择器在页面上根本不存在。
    assert.deepStrictEqual([...probe.previewChipsFor('.card')], [], 'a plain class has no state to force');
    assert.deepStrictEqual([...probe.previewChipsFor('button:hover')], ['hover'], 'hover is offered when it is written');
    assert.deepStrictEqual([...probe.previewChipsFor('a::before')], ['before'], 'a pseudo-element offers its own chip');
    assert.deepStrictEqual([...probe.previewChipsFor('input:focus-visible::after')], ['focus', 'after'],
      'focus-visible counts as focus, and the order is states first, pseudo-elements last');
    assert.deepStrictEqual([...probe.previewChipsFor('input:placeholder-shown')], ['placeholder'],
      'placeholder-shown is its own state (and not a pseudo-element)');
    assert.deepStrictEqual([...probe.previewChipsFor('[data-x="a:hover"]')], [],
      'a colon inside an attribute value is data, not a state');

    // 平移量的边界：至少露 48px。上界 = (样本 + 窗口) / 2 - 48。
    const sample = { width: 800, height: 400 };
    const viewport = { width: 400, height: 200 };
    assert.deepStrictEqual({ ...probe.clampPan({ x: 5000, y: 5000 }, sample, viewport) }, { x: 552, y: 252 },
      'a wild drag is clamped to "48px of the sample still shows"');
    assert.deepStrictEqual({ ...probe.clampPan({ x: -600, y: -300 }, sample, viewport) }, { x: -552, y: -252 },
      'and the same bound holds the other way');
    assert.deepStrictEqual({ ...probe.clampPan({ x: 12, y: -7 }, sample, viewport) }, { x: 12, y: -7 },
      'a pan inside the bound is left alone');
    assert.deepStrictEqual({ ...probe.clampPan({ x: 5, y: 5 }, { width: 10, height: 10 }, { width: 20, height: 20 }) },
      { x: 0, y: 0 }, 'a bound below zero collapses to "cannot move" instead of flipping sign');
    assert.deepStrictEqual({ ...probe.clampPan({ x: 40, y: 40 }, { width: 0, height: 0 }, viewport) }, { x: 40, y: 40 },
      'an unmeasured sample is not clamped — there is nothing to compute a bound from');

    // 模型：命中、越界索引、基线、排除、合成样本。
    const cardA = { tagName: 'DIV', className: 'card', id: 'a', children: [] };
    const cardB = { tagName: 'DIV', className: 'card', id: 'b', children: [] };
    for (const node of [cardA, cardB]) node.matches = (selector) => matchesSelector(node, selector);
    const modelHost = await boot({
      dom: {
        nodes: [cardA, cardB],
        // 伪元素合成要读 `content`：只给这一条，别的属性按空串读。
        computed: () => ({
          length: 1,
          0: 'content',
          getPropertyValue: name => (name === 'content' ? '"→"' : ''),
        }),
      },
      fetchImpl: async (url) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.card { color: red; }' });
        if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
        throw new Error('unexpected request: ' + url);
      },
    });
    const modelProbe = modelHost.mod.__probe;
    const rule = { selector: '.card' };
    const base = { rule, css: '.card { color: red; }', baselineCss: '.card { color: red; }', index: 0, exclusions: [] };
    const first = modelProbe.previewModel(base);
    assert.strictEqual(first.count, 2, 'the model resolves the host selector — got: ' + first.count);
    assert.strictEqual(first.target, cardA, 'and index 0 is the first match');
    assert.strictEqual(first.synthetic, false, 'a real match is drawn, not synthesised');
    assert.strictEqual(first.dirty, false, 'the sheet has not changed since it was opened');
    assert.strictEqual(first.chips.length, 0, 'and `.card` has no state worth a chip');
    const second = modelProbe.previewModel({ ...base, index: 1, baselineCss: '.card { }' });
    assert.strictEqual(second.target, cardB, 'index 1 picks the second match');
    assert.strictEqual(second.dirty, true, 'a changed sheet marks the model dirty');
    assert.strictEqual(modelProbe.previewModel({ ...base, index: 9 }).index, 1,
      'an out-of-range index falls back to the last match');
    const nowhere = modelProbe.previewModel({ ...base, rule: { selector: '.nowhere' } });
    assert.strictEqual(nowhere.count, 0, 'a selector with no match resolves to nothing');
    assert.strictEqual(nowhere.synthetic, true, 'and asks for a synthetic sample');
    const excluded = modelProbe.previewModel({ ...base, exclusions: ['.card'] });
    assert.strictEqual(excluded.excluded, true, 'an element on the exclusion list is flagged');
    assert.strictEqual(excluded.synthetic, true, 'and is not cloned into the preview');
    // `a::before` 预览的是**宿主元素**：`resolveSelector` 对伪元素返回「没有节点」，
    // 所以宿主选择器必须先把伪元素去掉，否则整条规则掉进合成样本分支。
    const hostOnly = modelProbe.previewModel({ ...base, rule: { selector: '.card::before' } });
    assert.strictEqual(hostOnly.synthetic, false, 'a pseudo-element rule previews its host element');
    assert.strictEqual(hostOnly.count, 2, 'and the host selector is what gets resolved');
    assert.deepStrictEqual([...hostOnly.chips], ['before'], 'with the pseudo-element chip');
    // `hashText` 只要求稳定与区分度（撞了多画一次，不会画错）。
    assert.strictEqual(modelProbe.hashText('abc'), modelProbe.hashText('abc'), 'the same text fingerprints the same');
    assert.notStrictEqual(modelProbe.hashText('abc'), modelProbe.hashText('abd'), 'and different text does not');
    assert.strictEqual(modelProbe.previewTargetSelector('button:hover'), 'button', 'state pseudos are stripped');
    assert.strictEqual(modelProbe.previewTargetSelector('a::before'), 'a', 'and so are pseudo-elements');
    assert.strictEqual(modelProbe.previewTargetSelector(':hover'), '*', 'a selector with nothing left falls back to *');
    assert.strictEqual(modelProbe.previewTargetSelector('.x:not(.y)'), '.x:not(.y)',
      'structural pseudos stay — they decide what the selector matches');

    // 样本：表格零件要补包装（游离的 <tr> 没有布局），伪元素要合成到首尾。
    const makeTarget = (tagName) => {
      const clone = () => {
        const node = {
          tagName,
          className: '',
          attributes: {},
          children: [],
          firstChild: null,
          style: { cssText: '' },
          appendChild(child) { node.children.push(child); return child; },
          insertBefore(child) { node.children.unshift(child); return child; },
          removeAttribute(name) { delete node.attributes[name]; },
          setAttribute(name, value) { node.attributes[name] = value; },
        };
        return node;
      };
      const target = clone();
      target.id = 'target';
      target.attributes.id = 'target';
      target.cloneNode = () => clone();
      return target;
    };
    const rowSample = modelProbe.buildSample(makeTarget('TR'), { styleText: 'color: red' });
    const tagOf = (node) => String(node?.tagName ?? '').toUpperCase();
    assert.strictEqual(tagOf(rowSample), 'TABLE', 'a <tr> sample is wrapped in a table — got: ' + tagOf(rowSample));
    assert.strictEqual(tagOf(rowSample.children[0]), 'TBODY', 'with a tbody in between');
    const wrappedRow = rowSample.children[0].children[0];
    assert.strictEqual(tagOf(wrappedRow), 'TR', 'and the clone sits inside the tbody');
    assert.strictEqual(wrappedRow.style.cssText, 'color: red', 'and the frozen style lands on the clone');
    assert.strictEqual(wrappedRow.attributes.id, undefined,
      'the id is dropped so the sample cannot collide with the page');
    const plain = makeTarget('DIV');
    const divSample = modelProbe.buildSample(plain, { styleText: 'color: blue' });
    assert.strictEqual(tagOf(divSample), 'DIV', 'an ordinary element is not wrapped');
    const pseudoSample = modelProbe.buildSample(makeTarget('DIV'), { styleText: '', pseudos: ['::before', '::after'] });
    assert.strictEqual(pseudoSample.children.length, 2, 'both pseudo-elements are synthesised — got: '
      + JSON.stringify(pseudoSample.children.map(child => child.className)));
    assert.ok(String(pseudoSample.children[0].className).includes('dshCc_samplePseudo'), 'as spans carrying the sample class');
    assert.strictEqual(pseudoSample.children[1].textContent, '→', 'and their content becomes text — got: '
      + JSON.stringify(pseudoSample.children[1].textContent));
  }

  // --- 查找：跳转不抢焦点；编辑器里的 Esc 关条 --------------------------------
  // 用户报过两条：搜索「不会跳转到行」，以及「必须关闭才退出」。根因是同一个 —— 放光标的
  // effect 每次都 editor.focus()，焦点离开查找框之后 Esc 就再也关不掉条。
  {
    const doc = { tagName: 'DIV', className: 'card', children: [] };
    const mini = await boot({
      dom: { nodes: [doc] },
      fetchImpl: async (url) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 40, mtime: 1 }], active: 'custom.css', disabled: [] });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.a{color:red}\n.b{color:blue}\n' });
        if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
        throw new Error('unexpected request: ' + url);
      },
    });
    hookIndex = 0;
    const row = mini.registrations[0].component();
    const editor = findNode(row, 'textarea');
    const focuses = [];
    const carets = [];
    editor.props.ref.current = {
      selectionStart: 0,
      selectionEnd: 0,
      scrollTop: 0,
      scrollLeft: 0,
      clientHeight: 140,
      focus() { focuses.push('focus'); },
      setSelectionRange(start) { carets.push(start); },
    };
    hookIndex = 0;
    findNode(mini.registrations[0].component(), 'textarea').props.onKeyDown({ key: 'f', ctrlKey: true, preventDefault() {} });
    hookIndex = 0;
    let view = mini.registrations[0].component();
    await mini.runEffects();
    const inputs = [];
    (function collect(node) {
      if (node === null || typeof node !== 'object') return;
      if (node.type === 'input') inputs.push(node.props);
      for (const child of node.children ?? []) collect(child);
    })(view);
    const field = inputs.find(props => props['aria-label'] === '查找');
    assert.ok(field !== undefined, 'Ctrl+F opens a find field');
    // 打开查找条时允许把焦点交给编辑器（那是「开始搜索」），之后不允许。
    focuses.length = 0;
    carets.length = 0;
    hookIndex = 0;
    field.onChange({ target: { value: 'color' } });
    hookIndex = 0;
    view = mini.registrations[0].component();
    const liveField = (() => {
      const found = [];
      (function collect(node) {
        if (node === null || typeof node !== 'object') return;
        if (node.type === 'input') found.push(node.props);
        for (const child of node.children ?? []) collect(child);
      })(view);
      return found.find(props => props['aria-label'] === '查找');
    })();
    hookIndex = 0;
    liveField.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault() {} });
    hookIndex = 0;
    view = mini.registrations[0].component();
    await mini.runEffects();
    assert.ok(carets.length > 0, '按 Enter 把光标放到命中上');
    assert.strictEqual(focuses.length, 0, '跳转不抢焦点（抢了 Esc 就关不掉查找条）');
    // 编辑器里的 Esc：查找条开着时它属于查找条。
    renderedClasses.length = 0;
    hookIndex = 0;
    findNode(view, 'textarea').props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    hookIndex = 0;
    renderedClasses.length = 0;
    mini.registrations[0].component();
    assert.ok(!renderedClasses.includes('dshCc_findBar'), '编辑器里的 Esc 关掉查找条');
  }
  // --- 全屏头：上下文与出口 ------------------------------------------------
  // 全屏里看不到行内的工具条，所以「第几个命中 / 怎么换 / 怎么退出」都要在头上补齐，
  // 否则用户不知道自己在预览第几个元素、也不知道怎么退出。
  {
    const manyHost = await boot({
      dom: {
        nodes: [
          { tagName: 'DIV', className: 'card', children: [] },
          { tagName: 'DIV', className: 'card', children: [] },
          { tagName: 'DIV', className: 'card', children: [] },
        ],
      },
      fetchImpl: async (url) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 30, mtime: 1 }], active: 'custom.css', disabled: [] });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.card { color: red; }' });
        if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
        throw new Error('unexpected request: ' + url);
      },
    });
    const walk = (node, predicate, found = []) => {
      if (node === null || typeof node !== 'object') return found;
      if (predicate(node)) found.push(node);
      for (const child of node.children ?? []) walk(child, predicate, found);
      return found;
    };
    const nodesText = (root) => {
      const out = [];
      const visit = (node) => {
        if (node === null || typeof node !== 'object') return;
        for (const child of node.children ?? []) {
          if (typeof child === 'string') out.push(child);
          else visit(child);
        }
      };
      visit(root);
      return out;
    };
    const island = componentIsland((props) => manyHost.mod.__probe.PreviewBlock(props));
    const previewOf = (view) => {
      const element = findNode(view, manyHost.mod.__probe.PreviewBlock);
      return element === null ? null : island.render(element.props);
    };
    hookIndex = 0;
    const headRow = manyHost.registrations[0].component();
    findNode(headRow, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
    hookIndex = 0;
    const panel = manyHost.registrations[0].component();
    let preview = previewOf(panel);
    // 工具条上本来就有「第几个」的菜单：三个命中 → 三个选项。
    const matchMenus = walk(preview, node => typeof node.type === 'function' && node.props?.ariaLabel === '预览第几个命中元素');
    assert.strictEqual(matchMenus.length, 1, 'the toolbar offers a match menu — got: ' + matchMenus.length);
    assert.strictEqual(matchMenus[0].props.items.length, 3, 'with one entry per match');
    // 全屏：同一个组件再摆一次，头上补齐计数与出口。
    const fullButton = walk(preview, node => node.type === 'button' && node.props?.['aria-label'] === '全屏')[0];
    island.act(() => fullButton.props.onClick());
    preview = previewOf(panel);
    const dialog = walk(preview, node => node.type === 'dialog')[0];
    assert.ok(dialog !== undefined, 'the full screen renders a dialog');
    const dialogText = nodesText(dialog);
    assert.ok(dialogText.some(text => text.includes('3 个命中')),
      'the dialog head carries the hit count — got: ' + JSON.stringify(dialogText.filter(t => t.includes('命中'))));
    assert.ok(dialogText.some(text => text.includes('第 1 个')), 'and which element is being previewed');
    assert.ok(dialogText.some(text => text.includes('Esc 退出')), 'plus the way out (Esc)');
    const dialogMenus = walk(dialog, node => typeof node.type === 'function' && node.props?.ariaLabel === '预览第几个命中元素');
    assert.strictEqual(dialogMenus.length, 1, 'the dialog can switch matches too — got: ' + dialogMenus.length);
    // 换到第 2 个：索引前进（3 个命中时 0 → 1），头跟着改。
    island.act(() => dialogMenus[0].props.onPick('1'));
    preview = previewOf(panel);
    const movedText = nodesText(walk(preview, node => node.type === 'dialog')[0] ?? preview);
    assert.ok(movedText.some(text => text.includes('第 2 个')),
      'choosing a match moves the cursor — got: ' + JSON.stringify(movedText.filter(t => t.includes('第 '))));
    // 退出：× 收起 dialog。
    const closeButton = walk(preview, node => node.type === 'button' && node.props?.['aria-label'] === '退出全屏')[0];
    island.act(() => closeButton.props.onClick());
    preview = previewOf(panel);
    assert.strictEqual(walk(preview, node => node.type === 'dialog').length, 0, 'closing removes the dialog');
  }

  // --- 预览的样本本身是「插件自己的东西」，不能参与匹配 --------------------------
  // 用户写的 `[class*='_tableRow']` 曾经把预览里克隆出来的那几行也命中：样本一画出来，
  // 计数就跟着涨，看起来像「规则匹配了不存在的东西」。容器带上 data-dshcc-owned 之后，
  // queryOwned 会把它们（以及里面所有克隆）从任何匹配里剔掉。
  // 表行另有一条：游离的 <tr> 没有布局，样本要自己补 table > tbody 包装。
  {
    const boxLike = (className) => ({
      className,
      children: [],
      text: '',
      style: {},
      get textContent() { return this.text ?? ''; },
      set textContent(value) { this.text = String(value); this.children = []; },
      appendChild(child) { this.children.push(child); return child; },
    });
    const row = {
      tagName: 'TR',
      className: 'table-row',
      children: [],
      attributes: {},
      style: {},
      cloneNode() {
        return {
          tagName: 'TR',
          className: 'table-row',
          children: [],
          attributes: {},
          style: {},
          appendChild(child) { this.children.push(child); return child; },
          insertBefore(child) { this.children.unshift(child); return child; },
          removeAttribute() {},
        };
      },
      matches: (selector) => matchesSelector(row, selector),
    };
    const tableHost = await boot({
      dom: { nodes: [row] },
      fetchImpl: async (url) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 30, mtime: 1 }], active: 'custom.css', disabled: [] });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.table-row { color: red; }' });
        if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
        throw new Error('unexpected request: ' + url);
      },
    });
    hookIndex = 0;
    const tableTree = tableHost.registrations[0].component();
    findNode(tableTree, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
    hookIndex = 0;
    const markedPanel = tableHost.registrations[0].component();
    const island = componentIsland((props) => tableHost.mod.__probe.PreviewBlock(props));
    const preview = island.render(findNode(markedPanel, tableHost.mod.__probe.PreviewBlock).props);
    const containers = [];
    (function walk(node) {
      if (node === null || typeof node !== 'object') return;
      if (node.props?.['data-dshcc-owned'] !== undefined) containers.push(node);
      for (const child of node.children ?? []) walk(child);
    })(preview);
    assert.strictEqual(containers.length, 1, 'the modified sample container is in the tree — got: ' + containers.length);
    assert.strictEqual(String(containers[0].props['data-dshcc-owned']), '',
      'and it is marked as plugin chrome, so a selector cannot match the preview itself');
    // 画一遍：<tr> 的克隆要补 table / tbody 包装。
    const boxes = [boxLike('dshCc_previewAfter')];
    const model = tableHost.mod.__probe.previewModel({
      rule: { selector: '.table-row' },
      css: '.table-row { color: red; }',
      baselineCss: '.table-row { color: red; }',
      index: 0,
      exclusions: [],
    });
    tableHost.mod.__probe.paintModelInto({ querySelectorAll: () => boxes }, {
      model,
      rule: { selector: '.table-row' },
      css: '.table-row { color: red; }',
      compare: false,
      pseudos: [],
    });
    assert.ok(boxes[0].children.length >= 1, 'a table row was painted');
    assert.strictEqual(
      String(boxes[0].children[0].tagName ?? '').toLowerCase(),
      'table',
      'the row clone is wrapped in a table so it can lay out — got: ' + String(boxes[0].children[0].tagName),
    );
  }

  // --- 排除名单：根级元素不当样本、不被拾取 ------------------------------------
  // 默认名单是 `:root, html, body`：写一条作用在 body 上的规则等于给整个界面换皮肤，那是皮肤的事；
  // 预览把整页克隆进样本框也没有意义。这一节守住「默认存在、可改、命中时说明原因」。
  {
    const bodyLike = {
      tagName: 'BODY',
      className: '',
      children: [],
      parentElement: null,
      // 只有 `body` 这一条选择器命中它 —— 真实浏览器里由引擎判断，测试床里由这个函数回答。
      matches: selector => selector.trim() === 'body',
      cloneNode() { return { tagName: 'BODY', className: '', children: [], style: {}, appendChild() {}, removeAttribute() {} }; },
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 1280, height: 800 }),
    };
    const excludeHost = await boot({
      dom: { nodes: [bodyLike] },
      fetchImpl: async (url, init) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 30, mtime: 1 }], active: 'custom.css', disabled: [] });
        if (url.includes('/read?name=settings.json.css')) return jsonResponse({ ok: true, name: 'settings.json.css', css: '{}' });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: 'body { color: red; }' });
        if (url.includes('/write')) return jsonResponse({ ok: true, name: 'custom.css', rev: 2 });
        if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
        throw new Error('unexpected request: ' + url);
      },
    });
    hookIndex = 0;
    const excludeRow = excludeHost.registrations[0].component();
    findNode(excludeRow, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
    hookIndex = 0;
    const excludePanel = excludeHost.registrations[0].component();
    const island = componentIsland((props) => excludeHost.mod.__probe.PreviewBlock(props));
    const previewElement = findNode(excludePanel, excludeHost.mod.__probe.PreviewBlock);
    const preview = island.render(previewElement.props);
    const texts = [];
    (function walk(node) {
      if (node === null || typeof node !== 'object') return;
      for (const child of node.children ?? []) {
        if (typeof child === 'string') texts.push(child);
        else walk(child);
      }
    })(preview);
    assert.ok(texts.some(text => text.includes('排除名单')),
      'the block explains that the element is on the exclude list — got: ' + JSON.stringify(texts.slice(0, 12)));
    assert.ok(texts.some(text => text.includes(':root, html, body')),
      'and shows the list it is using — got: ' + JSON.stringify(texts.filter(text => text.includes('排除'))));

    // 样本必须是合成的那一个（不是整页克隆）。
    const boxLike = (className) => ({
      className,
      children: [],
      text: '',
      style: {},
      get textContent() { return this.text ?? ''; },
      set textContent(value) { this.text = String(value); this.children = []; },
      appendChild(child) { this.children.push(child); return child; },
    });
    const boxes = [boxLike('dshCc_previewAfter'), boxLike('dshCc_previewCurrent')];
    const excludedModel = excludeHost.mod.__probe.previewModel({
      rule: { selector: 'body' },
      css: 'body { color: red; }',
      baselineCss: 'body { color: red; }',
      index: 0,
      exclusions: excludeHost.mod.__probe.previewModel === undefined ? [] : [':root', 'html', 'body'],
    });
    assert.strictEqual(excludedModel.excluded, true, 'the model flags the excluded element');
    excludeHost.mod.__probe.paintModelInto({ querySelectorAll: () => boxes }, {
      model: excludedModel,
      rule: previewElement.props.rule,
      css: previewElement.props.css,
      compare: false,
      pseudos: [],
    });
    assert.ok(boxes[0].children.length >= 1, 'a sample was painted for the excluded element');
    assert.ok(
      String(boxes[0].children[0].className).includes('dshCc_sampleSynthetic'),
      'and it is the synthetic one — got: ' + String(boxes[0].children[0].className),
    );

    // 设置里的那一行：默认值就是这份名单，改完写回 settings.json.css。
    await settle();
    hookIndex = 0;
    renderedText.length = 0;
    const settingsSection = excludeHost.registrations[2].component({ subject: { kind: 'bundle', pkg: { name: 'dsh-custom-css' } } });
    // 这一节把正文包在 <SettingsPanel /> 里 —— 那是「函数类型」的子节点，假 React 不会自动渲染它，
    // 得手动展开一次（和壁纸面板的测试同一个做法），否则只能看到标题、徽标与描述。
    // 只展开那一个包着正文的组件（SettingsPanel），不要递归展开所有函数节点 —— 展开每个
    // Dropdown 之类的组件会把 hook 槽搅乱（它们各自用自己的 hook 序号）。
    const findPanelComponent = (node) => {
      if (node === null || typeof node !== 'object') return null;
      if (typeof node.type === 'function' && node.type.name === 'SettingsPanel') return node;
      for (const child of node.children ?? []) {
        const hit = findPanelComponent(child);
        if (hit !== null) return hit;
      }
      return null;
    };
    const panelElement = findPanelComponent(settingsSection);
    hookSlots.length = 0;
    hookIndex = 0;
    const settingsTree = panelElement === null ? settingsSection : panelElement.type(panelElement.props ?? {});
    const settingsText = renderedText.slice();
    const excludeInputs = [];
    (function collect(node) {
      if (node === null || typeof node !== 'object') return;
      if (node.type === 'input' && String(node.props?.className ?? '').includes('dshCc_excludeField')) excludeInputs.push(node);
      for (const child of node.children ?? []) collect(child);
    })(settingsTree);
    assert.strictEqual(excludeInputs.length, 1, 'the settings section offers one exclude field — text: ' + JSON.stringify(settingsText.slice(0, 20)));
    assert.strictEqual(excludeInputs[0].props.value, ':root, html, body', 'seeded with the default list — got: ' + JSON.stringify(excludeInputs[0].props.value));
    excludeInputs[0].props.onBlur({ target: { value: '.keep-me, [data-x]' } });
    await settle();
    const settingsWrites = excludeHost.calls.filter(call => String(call.url).includes('/write')
      && String(call.init?.body ?? '').includes('settings.json.css'));
    assert.ok(settingsWrites.length >= 1, 'changing the list writes the settings record — calls: '
      + JSON.stringify(excludeHost.calls.map(call => call.url)));
    assert.ok(
      String(settingsWrites[settingsWrites.length - 1].init.body).includes('.keep-me, [data-x]'),
      'with the new list in it',
    );
  }

  // --- 排除名单只看元素本身：祖先在名单里不等于后代也在 -------------------------
  // 回归用的就是这次真机上量到的现象：`closest(':root')` 对页面上每个节点都成立，于是**所有**
  // 规则都退化成「合成样本（不是页面上的元素）」。名单的语义是「别碰整页」。
  {
    const boxLike = (className) => ({
      className,
      children: [],
      textContent: '',
      appendChild(child) { this.children.push(child); return child; },
    });
    const bodyNode = {
      tagName: 'BODY',
      className: '',
      children: [],
      parentElement: null,
      matches: selector => selector.trim() === 'body',
      cloneNode() { return { className: 'body', children: [], style: {}, appendChild() {}, removeAttribute() {} }; },
    };
    const cardNode = {
      tagName: 'DIV',
      className: 'card',
      children: [],
      parentElement: bodyNode,
      matches: selector => selector.trim() === '.card',
      cloneNode() { return { className: 'card', children: [], style: {}, appendChild() {}, removeAttribute() {} }; },
    };
    bodyNode.children.push(cardNode);
    const nestedHost = await boot({
      dom: { nodes: [bodyNode, cardNode] },
      fetchImpl: async (url) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 30, mtime: 1 }], active: 'custom.css', disabled: [] });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.card { color: red; }' });
        if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
        throw new Error('unexpected request: ' + url);
      },
    });
    hookIndex = 0;
    const nestedRow = nestedHost.registrations[0].component();
    findNode(nestedRow, 'pre').props.onClick({ target: { getAttribute: () => '0' } });
    hookIndex = 0;
    const nestedPanel = nestedHost.registrations[0].component();
    const island = componentIsland((props) => nestedHost.mod.__probe.PreviewBlock(props));
    const nestedPreview = island.render(findNode(nestedPanel, nestedHost.mod.__probe.PreviewBlock).props);
    const nestedTexts = [];
    (function walk(node) {
      if (node === null || typeof node !== 'object') return;
      for (const child of node.children ?? []) {
        if (typeof child === 'string') nestedTexts.push(child);
        else walk(child);
      }
    })(nestedPreview);
    assert.ok(
      !nestedTexts.some(text => text.includes('排除名单')),
      'an element inside the page is NOT excluded just because its ancestor is — got: '
        + JSON.stringify(nestedTexts.filter(text => text.includes('排除'))),
    );
    const boxes = [boxLike('dshCc_previewAfter'), boxLike('dshCc_previewCurrent')];
    const nestedModel = nestedHost.mod.__probe.previewModel({
      rule: { selector: '.card' },
      css: '.card { color: red; }',
      baselineCss: '.card { color: red; }',
      index: 0,
      exclusions: [':root', 'html', 'body'],
    });
    assert.strictEqual(nestedModel.synthetic, false, 'the card itself is not on the list');
    nestedHost.mod.__probe.paintModelInto({ querySelectorAll: () => boxes }, {
      model: nestedModel,
      rule: { selector: '.card' },
      css: '.card { color: red; }',
      compare: false,
      pseudos: [],
    });
    assert.ok(boxes[0].children.length >= 1, 'the sample was painted for a normal element');
    assert.ok(
      !String(boxes[0].children[0].className).includes('dshCc_sampleSynthetic'),
      'and it is the real clone, not the synthetic sample — got: ' + String(boxes[0].children[0].className),
    );
  }

  // --- 效果预设：一排按钮，一次编辑 ------------------------------------------
  // 预设写的是**这一条规则**的一组声明，用的是材质令牌；它必须是**一次编辑**（一次 Ctrl+Z 撤回
  // 整批），而且检查不通过时要说原因，不是点了没反应。
  {
    const presetHost = await boot({
      dom: {
        nodes: [{ tagName: 'DIV', className: 'card', children: [] }],
        computed: {
          backgroundColor: 'rgba(0, 0, 0, 0)',
          getPropertyValue: name => (name === 'background-color' ? 'rgba(0, 0, 0, 0)' : ''),
        },
      },
      fetchImpl: async (url) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 40, mtime: 1 }], active: 'custom.css', disabled: [] });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.card { color: red; }' });
        if (url.includes('/write')) return jsonResponse({ ok: true, name: 'custom.css', rev: 2 });
        if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
        throw new Error('unexpected request: ' + url);
      },
    });
    hookIndex = 0;
    findNode(presetHost.registrations[0].component(), 'pre').props.onClick({ target: { getAttribute: () => '0' } });
    hookIndex = 0;
    renderedText.length = 0;
    renderedClasses.length = 0;
    const panelWithPresets = presetHost.registrations[0].component();
    assert.ok(renderedText.includes('效果预设'), 'the panel offers effect presets — got: ' + JSON.stringify(renderedText.slice(0, 12)));
    for (const label of ['亚克力', '毛玻璃', '云母', '细描边卡片']) {
      assert.ok(renderedText.includes(label), 'preset ' + label + ' is offered');
    }
    // 它们复用模板按钮那套类名：这正是「组件样式统一」要的效果 —— 不再为一排按钮发明新样式。
    const presetButtons = [];
    (function collect(node) {
      if (node === null || typeof node !== 'object') return;
      if (node.type === 'button' && String(node.props?.className ?? '') === 'dshCc_tpl') presetButtons.push(node);
      for (const child of node.children ?? []) collect(child);
    })(panelWithPresets);
    assert.strictEqual(presetButtons.length, 18, '4 presets + 14 templates share one button style — got ' + presetButtons.length);
    // 点「云母」：一次编辑写进 7 条声明，且引用材质令牌而不是写死数字。
    const micaButton = presetButtons.find(node => JSON.stringify(node.children ?? []).includes('云母'));
    assert.ok(micaButton !== undefined, 'the mica preset is clickable');
    micaButton.props.onClick();
    // 预设走的是编辑器的防抖保存（和打字同一条路），所以要把 400ms 的定时器推一下。
    await presetHost.runTimers();
    await settle();
    const presetWrite = presetHost.calls.filter(call => String(call.url).includes('/write'));
    assert.strictEqual(presetWrite.length, 1, 'one edit, one write — got ' + presetWrite.length);
    const written = JSON.parse(String(presetWrite[0].init.body)).css;
    for (const [property, value] of [
      ['background-color', 'var(--dsh-material-mica-bg)'],
      ['backdrop-filter', 'blur(var(--dsh-material-mica-blur)) saturate(var(--dsh-material-mica-saturate))'],
      ['border-width', '0.5px'],
      ['border-style', 'solid'],
      ['border-color', 'var(--dsw-alias-border-l1)'],
    ]) {
      assert.ok(
        written.includes(property + ': ' + value),
        'the mica preset writes ' + property + ' — got: ' + written.slice(0, 260),
      );
    }
    assert.ok(
      !/\n\s*border:/.test(written),
      'it never writes the `border` shorthand (that resets border-radius) — got: ' + written.slice(0, 200),
    );
    // 元素是透明底（假 DOM 没有计算样式）：应当写进去，但在下面留一行提醒。
    // 提醒是写完之后的渲染，所以要先重画一次再找它。
    hookIndex = 0;
    renderedText.length = 0;
    presetHost.registrations[0].component();
    assert.ok(
      renderedText.some(text => typeof text === 'string' && text.includes('已写入')),
      'a transparent target still gets the preset, with a note explaining the caveat — got: '
        + JSON.stringify(renderedText.slice(-6)),
    );
  }

  // --- 令牌页（只读清单）-----------------------------------------------------
  // 这张页面回答三件事：这条令牌叫什么、现在是什么、从哪来 —— 外加「被多少条规则用到」，
  // 因为那才是「我改这个会不会炸」的依据。这一节同时守住「跨域表读不到要计数」：
  // 静默跳过会让人以为那几张表里没有令牌。
  const sheetStyle = (values) => {
    const style = Object.keys(values);
    style.getPropertyValue = name => values[name] ?? '';
    return style;
  };
  const tokenHost = await boot({
    dom: {
      styleSheets: [
        {
          ownerNode: { dataset: { pluginCss: 'ext/theme.css' } },
          cssRules: [{
            selectorText: ':root',
            style: sheetStyle({ '--dsw-alias-bg-base': '#ffffff', '--dsw-alias-border-l2': 'var(--dsw-alias-bg-base)' }),
            cssText: ':root{--dsw-alias-bg-base:#ffffff;--dsw-alias-border-l2:var(--dsw-alias-bg-base)}',
          }],
        },
        // 跨域表：`cssRules` 直接抛，页面要把它算进「读不到」而不是当作没有令牌。
        { get cssRules() { throw new Error('SecurityError'); } },
      ],
    },
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.x{color:red}' });
      if (url.includes('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
      throw new Error('unexpected request: ' + url);
    },
  });
  hookIndex = 0;
  renderedText.length = 0;
  const tokenRow = tokenHost.registrations[0].component();
  buttonWith(tokenRow, '更多操作').props.onClick();
  hookIndex = 0;
  renderedText.length = 0;
  const tokenMenu = tokenHost.registrations[0].component();
  const tokensEntry = buttonWith(tokenMenu, '令牌');
  assert.ok(tokensEntry !== null, 'the actions menu offers 令牌 — menu: ' + JSON.stringify(renderedText));
  tokensEntry.props.onClick();
  await settle();
  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  const tokenPage = tokenHost.registrations[0].component();
  assert.ok(renderedText.includes('--dsw-alias-bg-base'), 'the page lists the token name');
  assert.ok(renderedText.includes('#ffffff'), 'with its value');
  assert.ok(renderedText.includes('ext/theme.css'), 'and where it comes from');
  assert.ok(
    renderedText.some(text => typeof text === 'string' && text.includes('2 条令牌')),
    'the header counts what it found — got: ' + JSON.stringify(renderedText.slice(0, 8)),
  );
  assert.ok(
    renderedText.some(text => typeof text === 'string' && text.includes('1 张表读不到')),
    'and says how many sheets could not be read',
  );
  assert.ok(
    renderedText.some(text => typeof text === 'string' && text.includes('1 条规则')),
    'and how many rules use a token (counted from the sheets text)',
  );
  assert.ok(renderedClasses.includes('dshCc_tokenRow'), 'rows carry their own class');
  // 搜索：按名字过滤，别的行应该消失。
  findNode(tokenPage, 'input').props.onChange({ target: { value: 'border-l2' } });
  hookIndex = 0;
  renderedText.length = 0;
  const tokenFiltered = tokenHost.registrations[0].component();
  assert.ok(
    renderedText.includes('--dsw-alias-border-l2') && !renderedText.includes('--dsw-alias-bg-base'),
    'the search field narrows the list — got: ' + JSON.stringify(renderedText.slice(0, 8)),
  );
  findNode(tokenFiltered, 'input').props.onChange({ target: { value: 'nothing-matches-this' } });
  hookIndex = 0;
  renderedText.length = 0;
  tokenHost.registrations[0].component();
  assert.ok(
    renderedText.some(text => typeof text === 'string' && text.includes('没有匹配')),
    'and an empty result says so instead of showing nothing — got: ' + JSON.stringify(renderedText),
  );

  // --- 接管：写 tokens.css，并且排在用户样式表之前 ---------------------------
  // 这一节守三件事：① 写入的是**一份正常的 CSS**（不是 JSON，也不是插件私有格式）；
  // ② 选择器是 `body, body[data-ds-dark-theme]`（只写 `body` 在深色下会输，踩过）；
  // ③ 注入位置在用户表**之前**，所以压得过往 DSH 与扩展，压不过用户自己。
  findNode(tokenPage, 'input').props.onChange({ target: { value: '' } });
  hookIndex = 0;
  renderedText.length = 0;
  const tokenList = tokenHost.registrations[0].component();
  const takeover = buttonWith(tokenList, '接管');
  assert.ok(takeover !== null, 'an unmodified token offers 接管 — got: ' + JSON.stringify(renderedText.slice(0, 10)));
  takeover.props.onClick();
  await settle();
  const tokenWrite = tokenHost.calls.filter(call => String(call.url).includes('/write') && String(call.init?.body ?? '').includes('tokens.css'));
  assert.ok(tokenWrite.length >= 1, 'the override is written to tokens.css — calls: ' + JSON.stringify(tokenHost.calls.map(c => c.url)));
  const writtenBody = JSON.parse(String(tokenWrite[tokenWrite.length - 1].init.body));
  assert.strictEqual(writtenBody.name, 'tokens.css', 'written under its own name');
  assert.ok(
    writtenBody.css.includes('body,\nbody[data-ds-dark-theme] {'),
    'the prelude is `body, body[data-ds-dark-theme]` — a bare `body` loses in dark mode',
  );
  assert.ok(
    writtenBody.css.includes('--dsw-alias-bg-base: #ffffff;'),
    'the override carries the value it started from — got: ' + String(writtenBody.css).slice(0, 200),
  );
  const tokenTag = tokenHost.styleTags.find(element => element.id === 'dsh-custom-css-token-style');
  assert.ok(tokenTag !== undefined, 'the overrides are injected as their own style tag');
  assert.ok(tokenTag.textContent.includes('--dsw-alias-bg-base'), 'with the override inside');
  const tagOrder = tokenHost.styleTags.map(element => element.id);
  assert.ok(
    tagOrder.indexOf('dsh-custom-css-token-style') < tagOrder.indexOf('dsh-custom-css-user-style'),
    'and it sits BEFORE the user sheet, so the user still wins — order: ' + JSON.stringify(tagOrder),
  );
  // 改值：输入框里回车 → 再写一次，值是新的。
  hookIndex = 0;
  renderedText.length = 0;
  const tokenEditing = tokenHost.registrations[0].component();
  // 这一页有两个 input：顶上那个搜索框、行里那个覆盖值输入框。第一个不一定是想要的那个。
  const tokenValueInputs = (node, found = []) => {
    if (node === null || typeof node !== 'object') return found;
    if (node.type === 'input') found.push(node);
    for (const child of node.children ?? []) tokenValueInputs(child, found);
    return found;
  };
  const tokenInput = tokenValueInputs(tokenEditing).find(node => String(node.props.className ?? '').includes('dshCc_tokenInput'));
  assert.ok(
    tokenInput !== undefined && tokenInput.props.defaultValue === '#ffffff',
    'the overridden row shows an input seeded with the value — '
      + JSON.stringify(tokenValueInputs(tokenEditing).map(node => ({ cls: node.props.className, value: node.props.defaultValue }))),
  );
  assert.ok(
    String(tokenInput.props.className ?? '').includes('dshUi_field'),
    'and that input is the shared field, not a bespoke control — class: ' + tokenInput.props.className,
  );
  tokenInput.props.onKeyDown({ key: 'Enter', target: { value: '#000000' } });
  await settle();
  const secondWrite = tokenHost.calls.filter(call => String(call.url).includes('/write') && String(call.init?.body ?? '').includes('tokens.css'));
  assert.ok(
    String(secondWrite[secondWrite.length - 1].init.body).includes('#000000'),
    'Enter writes the new value — got: ' + String(secondWrite[secondWrite.length - 1].init.body).slice(0, 200),
  );
  // 撤销：删文件、撤注入，别留一个空表。
  hookIndex = 0;
  renderedText.length = 0;
  const tokenReverting = tokenHost.registrations[0].component();
  const revert = buttonWith(tokenReverting, '撤销');
  assert.ok(revert !== null, 'an overridden token offers 撤销');
  revert.props.onClick();
  await settle();
  assert.ok(
    tokenHost.calls.some(call => String(call.url).includes('/delete') && String(call.init?.body ?? '').includes('tokens.css')),
    'removing the last override deletes the file instead of leaving an empty sheet',
  );
  // 空标签留着、内容清空：撤掉最后一条时「标签还在但什么都没写」，比依赖 remove() 摘干净更稳。
  assert.strictEqual(
    String(tokenHost.styleTags.find(element => element.id === 'dsh-custom-css-token-style')?.textContent ?? ''),
    '',
    'and the injected overrides are emptied with it',
  );

  // --- 选择器体检 (the audit page of the actions menu) ----------------------
  // 自定义 CSS 里大量选择器依赖 DSH 的构建哈希类名。换代改名之后规则不报错、也不消失，只是永远
  // 不再命中 ——「我明明写了却没生效」。这张页面把「没生效」变成一份可以逐条处理的清单，所以它要
  // 同时守住三件事：真的把命不中的规则列出来、**不把状态样式报成死规则**（否则第一次打开就是一屏
  // 红色）、点一下能把那条整条注释掉且原文还在。
  const AUDIT_SHEET = [
    '.live-row{color:red}',                    // 命得中（dom.nodes 里有一个）
    '.gone-shape{color:blue}',                 // 命不中 —— 该报
    '.tab:hover{color:green}',                 // 状态伪类 —— 不报
    '.tab.active{color:green}',                // 状态类 —— 不报
    '@media (min-width: 9999px){ .narrow-only{color:red} }', // 嵌套 —— 不报
    '.gone-with-comment{color:red;/* keep */}', // 命不中，块里还带一条注释
  ].join('\n');
  const auditWrites = [];
  let auditSheet = AUDIT_SHEET;
  const auditor = await boot({
    dom: { nodes: [{ tagName: 'DIV', className: 'live-row', children: [] }] },
    fetchImpl: async (url, init) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css', disabled: [] });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: auditSheet });
      if (url.endsWith('/write')) {
        const body = JSON.parse(init.body);
        auditWrites.push(body.css);
        auditSheet = body.css;
        return jsonResponse({ ok: true, name: 'custom.css', bytes: body.css.length });
      }
      if (url.includes('/history')) return jsonResponse({ ok: true, name: 'custom.css', entries: [] });
      throw new Error('unexpected request: ' + url);
    },
  });
  hookIndex = 0;
  renderedText.length = 0;
  let auditView = auditor.registrations[0].component();
  await auditor.runEffects();
  buttonWith(auditView, '更多操作').props.onClick();
  hookIndex = 0;
  renderedText.length = 0;
  auditView = auditor.registrations[0].component();
  const auditEntry = buttonWith(auditView, '问题检测');
  assert.ok(auditEntry !== null, 'the actions menu offers 问题检测 — menu: ' + JSON.stringify(renderedText));
  auditEntry.props.onClick();
  await settle();
  hookIndex = 0;
  renderedText.length = 0;
  renderedClasses.length = 0;
  auditView = auditor.registrations[0].component();
  assert.ok(renderedClasses.includes('dshCc_versionsHead'), 'the audit page has a header of its own');
  assert.ok(buttonWith(auditView, '返回') !== null, 'and a way back to the actions');
  assert.ok(
    renderedText.some(text => text.includes('共 2 条')),
    'it counts what is dead — status: ' + JSON.stringify(renderedText),
  );
  assert.ok(
    renderedText.some(text => text.includes('.gone-shape')) && renderedText.some(text => text.includes('.gone-with-comment')),
    'and lists both dead rules by selector — list: ' + JSON.stringify(renderedText),
  );
  // The exclusions are the whole reason this page is usable: a first run that reports every hover
  // style as dead teaches the user to ignore the list.
  for (const noisy of ['.tab:hover', '.tab.active', '.narrow-only', '.live-row']) {
    assert.ok(
      !renderedText.some(text => text === noisy),
      'it does not report ' + noisy + ' as dead — list: ' + JSON.stringify(renderedText),
    );
  }
  assert.ok(
    renderedText.some(text => text.startsWith('第 2 行')),
    'each entry says where it is in the sheet — list: ' + JSON.stringify(renderedText),
  );

  // One click comments that rule out, with the original text still readable inside the comment.
  buttonWith(auditView, '第 2 行').props.onClick();
  await settle();
  // The editor's writes are debounced (`WRITE_TICK`); a click alone only arms the timer.
  await auditor.runTimers();
  assert.strictEqual(
    auditWrites.length, 1,
    'the row edit is written once — writes: ' + JSON.stringify(auditWrites),
  );
  assert.ok(
    auditWrites[0].includes('/* .gone-shape{color:blue} */'),
    'the dead rule is commented out in place — wrote: ' + JSON.stringify(auditWrites[0]),
  );
  assert.ok(auditWrites[0].includes('.live-row{color:red}'), 'and nothing else moved');
  hookIndex = 0;
  renderedText.length = 0;
  auditView = auditor.registrations[0].component();
  assert.ok(
    renderedText.some(text => text.includes('共 1 条')),
    'the list shrinks by itself after the edit — list: ' + JSON.stringify(renderedText),
  );

  // A rule whose block already holds a comment must not be able to END the outer comment early:
  // a closing marker inside would leave the rest of the rule live, which is worse than not
  // commenting it at all — the sheet would silently change meaning. (`.gone-with-comment` is the
  // sixth line of AUDIT_SHEET; commenting the second line out adds no newlines, so it stays there.)
  buttonWith(auditView, '第 6 行').props.onClick();
  await settle();
  await auditor.runTimers();
  const lastCommentWrite = auditWrites[auditWrites.length - 1];
  assert.ok(
    lastCommentWrite.includes('/* .gone-with-comment{color:red;/* keep * /} */'),
    'the inner closing marker is defused so the outer comment cannot close early — wrote: ' + JSON.stringify(lastCommentWrite),
  );
  // Only the CLOSING marker needs defusing: CSS comments do not nest, so an inner opening marker is
  // just text inside the outer comment. Defusing `/*` as well would mangle the preserved source
  // without making anything safer.
  assert.ok(
    !lastCommentWrite.includes('*/ keep */') && !lastCommentWrite.includes('*/} */'),
    'and no closing marker survives inside the comment',
  );
  hookIndex = 0;
  renderedText.length = 0;
  auditView = auditor.registrations[0].component();
  assert.ok(
    renderedText.some(text => text.includes('命不中的规则没有')),
    'with nothing dead left the page says so — list: ' + JSON.stringify(renderedText),
  );
  // 这一遍的 computed 是公共桩（什么都读不到），所以「透明与定位」一节必须**不出现**：误报比漏报
  // 更伤 —— 每一个打开这一页的人都会先看到它。
  assert.ok(
    !renderedText.includes('透明与定位'),
    'a sheet whose samples read as plain is not reported — list: ' + JSON.stringify(renderedText),
  );

  // --- 问题检测页的第二节：透明与定位 ---------------------------------------
  // 这一节只有样本元素真的有问题时才存在，所以单独起一次 boot，把问题的来源（计算样式）注入进去：
  // opacity 0.6 的毛玻璃层，正是「玻璃开了但看不见」的那种写法。
  {
    const glassNode = { tagName: 'DIV', className: 'glass-hit', children: [] };
    const plainStyle = { backdropFilter: 'none', webkitBackdropFilter: 'none', opacity: '1', position: 'static', transform: 'none', filter: 'none', perspective: 'none', getPropertyValue: () => '' };
    const glassStyle = { ...plainStyle, backdropFilter: 'blur(8px)', webkitBackdropFilter: 'blur(8px)', opacity: '0.6' };
    const glassSheet = '.glass-hit{backdrop-filter:blur(8px);opacity:0.6;transition:all .2s}\n';
    const glassBoot = await boot({
      dom: {
        nodes: [glassNode],
        computed: (element) => (element === glassNode ? glassStyle : plainStyle),
      },
      fetchImpl: async (url) => {
        if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: '/tmp/custom-css', files: [{ name: 'custom.css', bytes: 44, mtime: 1 }], active: 'custom.css', disabled: [] });
        if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: glassSheet });
        if (url.includes('/history')) return jsonResponse({ ok: true, name: 'custom.css', entries: [] });
        if (url.endsWith('/about')) return jsonResponse({ ok: true, version: '9.9.9', dsh: null, dshCommit: null });
        throw new Error('unexpected request: ' + url);
      },
    });
    hookIndex = 0;
    renderedText.length = 0;
    let view = glassBoot.registrations[0].component();
    await glassBoot.runEffects();
    buttonWith(view, '更多操作').props.onClick();
    hookIndex = 0;
    renderedText.length = 0;
    view = glassBoot.registrations[0].component();
    buttonWith(view, '问题检测').props.onClick();
    await settle();
    hookIndex = 0;
    renderedText.length = 0;
    renderedClasses.length = 0;
    view = glassBoot.registrations[0].component();
    assert.ok(renderedClasses.includes('dshCc_auditSection'), 'the page grows a section header of its own');
    assert.ok(
      renderedText.includes('透明与定位'),
      'a sample with real findings gets its own section — list: ' + JSON.stringify(renderedText),
    );
    assert.ok(
      renderedText.some(text => text.includes('⚠ 1 处')),
      'the row carries a badge with how many problems it has — list: ' + JSON.stringify(renderedText),
    );
    assert.ok(
      !renderedText.some(text => text.includes('命不中的规则')),
      'and the selector section stays out when nothing is dead — list: ' + JSON.stringify(renderedText),
    );
    // 第二条判据（只看文本的 `transition: all`）落在同一节之外的另一节：两节同屏时各自有标题。
    assert.ok(
      renderedText.includes('动效与性能'),
      'a rule that is merely expensive gets its own section — list: ' + JSON.stringify(renderedText),
    );
    assert.ok(
      renderedText.some(text => text.includes('⚠ 1 处')),
      'with the same kind of badge — list: ' + JSON.stringify(renderedText),
    );
    // 点一行不是「注释掉」，是**跳过去**：菜单收起、编辑器接管（只读地跳，不改这一条）。
    buttonWith(view, '第 1 行').props.onClick();
    await settle();
    hookIndex = 0;
    renderedClasses.length = 0;
    glassBoot.registrations[0].component();
    assert.ok(
      !renderedClasses.includes('dshUi_menu'),
      'clicking a finding closes the menu, so the caret it moved is not hidden behind it — classes: ' + JSON.stringify(renderedClasses),
    );
  }

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

  // --- 22. custom wallpaper -------------------------------------------------
  //
  // The sheet this feature writes is the one place where a value the plugin did not invent —
  // a URL — is interpolated into CSS, so the escaping is asserted here rather than trusted.
  // A PNG's magic prefix, small enough that the whole data URL is readable in a failure.
  const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  assert.strictEqual(probe.wallpaperCss({ image: '' }), '', 'no picture means no sheet at all');
  assert.strictEqual(probe.wallpaperUrlAllowed('javascript:alert(1)'), false, 'a javascript URL is refused');
  assert.strictEqual(probe.wallpaperUrlAllowed('data:text/html;base64,PHNjcmlwdD4='), false, 'a non-image data URL is refused');
  assert.strictEqual(probe.wallpaperUrlAllowed('data:image/png;base64,AAAA'), true, 'an image data URL is accepted');
  assert.strictEqual(probe.wallpaperUrlAllowed('https://example.test/a.png'), true, 'an https URL is accepted');
  assert.strictEqual(probe.wallpaperUrlAllowed('file:///C:/pictures/a.png'), true, 'a file URL is accepted');
  assert.strictEqual(probe.wallpaperUrlAllowed('a".png</style><script>'), false, 'a value that could end the style element is refused');
  assert.strictEqual(
    probe.wallpaperCss({ image: 'x".png</style>', fit: 'cover' }), '',
    'and the sheet is empty rather than escaped — a value that cannot be carried legally is not carried',
  );
  const coverCss = probe.wallpaperCss({ image: PNG_DATA_URL, fit: 'cover', transparent: 20, brightness: 0 });
  assert.ok(
    coverCss.includes('background-image:url("' + PNG_DATA_URL + '")'),
    'the picture is written as a QUOTED url(), so nothing in it can end the declaration — got: ' + coverCss,
  );
  assert.ok(coverCss.includes('background-size:cover'), 'cover maps to the background-size keyword');
  assert.ok(!coverCss.includes('filter:'), 'brightness 0 writes no filter at all');
  const brightCss = probe.wallpaperCss({ image: PNG_DATA_URL, brightness: 25 });
  assert.ok(brightCss.includes('filter:brightness(1.25)'), 'a positive offset lightens: ' + brightCss);
  assert.ok(
    probe.wallpaperCss({ image: PNG_DATA_URL, brightness: -50 }).includes('filter:brightness(0.50)'),
    'and a negative one darkens',
  );
  // The interface keeps 100 − transparency per cent of its own colour, so the numbers in the
  // sheet have to move the other way from the slider the user drags.
  /** The interface's own share at one transparency setting, read back out of the sheet. */
  const baseAlpha = transparent => {
    const css = probe.wallpaperCss({ image: PNG_DATA_URL, transparent });
    const match = /--dsw-alias-bg-base:color-mix\(in srgb, light-dark\(#ffffff,#16181c\) (\d+)%/.exec(css);
    assert.ok(match !== null, 'the base surface has a percentage in it: ' + css);
    return Number(match[1]);
  };
  // The audience selectors have to outrank a skin's own. Measured in the dev instance: with a
  // bare `body::before`, the acrylic skin's `body::before` won the tie and the picture never
  // appeared, while the panel happily reported 已保存. That is a colourless difference — a
  // selector one step higher — so it is exactly the kind of thing a test has to hold.
  assert.ok(
    coverCss.includes('html body::before,html body[data-ds-dark-theme]::before{'),
    'the wallpaper layer outranks a bare body::before: ' + coverCss.split('\n').slice(0, 3).join(' | '),
  );
  assert.ok(
    coverCss.includes('opacity:1;'),
    'and pins its own opacity, so a skin that dims its own wallpaper layer cannot dim the picture',
  );
  assert.ok(
    /html body,html body\[data-ds-dark-theme\]\{/.test(coverCss),
    'the transparency tokens outrank a skin that sets the same tokens on `body`: ' + coverCss,
  );
  assert.ok(
    probe.wallpaperCss({ image: PNG_DATA_URL, transparent: 999 }).includes('background-size:cover'),
    'a setting out of range still produces a sheet',
  );
  assert.ok(
    baseAlpha(60) < baseAlpha(30) && baseAlpha(30) < baseAlpha(0),
    'the interface keeps less of its own colour the more the slider is raised — '
      + [0, 30, 60].map(value => value + '→' + baseAlpha(value) + '%').join(', '),
  );
  // The floor is the point: at 0 the interface must FULLY cover the picture. The old formula
  // multiplied a 14% base by the slider, so 0 left 14% of the colour and the picture showed
  // through — text sat on the photograph and could not be read. Reported from a real window.
  assert.strictEqual(baseAlpha(0), 100, 'at 0 the shell is opaque — the picture is fully covered');
  assert.ok(
    baseAlpha(26) >= 70,
    'and the default leaves the shell readable — 26 → ' + baseAlpha(26) + '%',
  );
  assert.ok(
    baseAlpha(60) > 0,
    'while the maximum keeps a floor of its own colour rather than going fully transparent — 60 → '
      + baseAlpha(60) + '%',
  );
  assert.strictEqual(baseAlpha(999), baseAlpha(60), 'and a value past the top is clamped to the top');
  assert.strictEqual(baseAlpha(-40), baseAlpha(0), 'a value past the bottom is clamped to the bottom');
  assert.ok(
    probe.wallpaperCss({ image: PNG_DATA_URL, fit: 'fill' }).includes('background-size:100% 100%'),
    'fill stretches to both axes',
  );
  assert.ok(
    probe.wallpaperCss({ image: PNG_DATA_URL, fit: 'tile' }).includes('background-repeat:repeat'),
    'tile repeats the picture',
  );
  assert.ok(
    probe.wallpaperCss({ image: PNG_DATA_URL, fit: 'nonsense' }).includes('background-size:cover'),
    'an unknown fit mode falls back to cover rather than into the stylesheet',
  );
  assert.strictEqual(
    probe.normalizeWallpaper({ image: 42, fit: 'x', transparent: 'nope', brightness: null }).image, '',
    'a record that is not a record normalises to nothing',
  );

  // The record is applied on its own, with no sheet route involved: an installed wallpaper must
  // survive the Host half being unreachable, and the browser's copy is what makes that true.
  const paper = await boot({
    fetchImpl: async () => { throw new Error('no route'); },
    stored: new Map([['dsh-custom-css:wallpaper', JSON.stringify({ image: 'https://example.test/a.png', fit: 'cover', transparent: 30, brightness: 0 })]]),
  });
  assert.strictEqual(paper.registrations.length, 3, 'a Host that answers nothing still registers every seat');
  const paperSheet = paper.styleTags.find(element => element.id === 'dsh-custom-css-wallpaper-style');
  assert.ok(paperSheet !== undefined, 'the wallpaper sheet is installed from the browser copy');
  assert.ok(
    paperSheet.textContent.includes('url("https://example.test/a.png")'),
    'the installed picture is in it — got: ' + (paperSheet === undefined ? '(no sheet)' : paperSheet.textContent),
  );
  assert.strictEqual(paper.userStyle(), undefined, 'no stylesheet was applied, so there is no user sheet to order against');

  // Uploading: the browser reads the file, the Host stores the bytes and answers with the URL,
  // and what the browser keeps is that URL — not the picture, and not a name it invented.
  const uploads = [];
  const uploader = await boot({
    fetchImpl: async (url, init) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: 'C:/css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css' });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.a{color:red}', rev: 1 });
      if (url.endsWith('/wallpaper-image')) {
        uploads.push(JSON.parse(init.body));
        return jsonResponse({ ok: true, name: 'wallpaper-abc.png', bytes: 120, reused: false, url: '/dsh-custom-css/wallpaper?name=wallpaper-abc.png' });
      }
      if (url.endsWith('/gallery')) return jsonResponse({ ok: true, dir: 'C:/css/.wallpapers', wallpapers: [] });
      throw new Error('unexpected request: ' + url);
    },
  });
  hookIndex = 0;
  /**
   * Every rendered node of one type, so a case can pick the input it means. `findNode` returns
   * the FIRST match by type, and this row has three inputs (the sheet importer, the row's own
   * file field, and the wallpaper's) — an assertion that grabbed "the first input" would be
   * measuring the wrong control while looking like it measured the right one. A nested component
   * is still a function among the props, exactly as React leaves it, so it is rendered on the way
   * down: that is what makes the panel's own controls reachable from the section that mounts it.
   */
  const allNodes = (node, type) => {
    // A nested component is an element whose `type` is the function, exactly as React stores it.
    // Rendering it here is what makes the panel's own controls reachable from the section that
    // mounts it — with the hook index reset first, so the panel starts from slot 0 rather than
    // reading the slots its parent already consumed.
    if (typeof node?.type === 'function') {
      hookIndex = 0;
      node = node.type(node.props ?? {});
    }
    if (node === null || typeof node !== 'object') return [];
    const found = node.type === type ? [node] : [];
    for (const child of node.children ?? []) found.push(...allNodes(child, type));
    return found;
  };
  const uploadPanel = uploader.registrations[1].component({ subject: { kind: 'bundle', pkg: { name: 'dsh-custom-css' } } });
  const fileInput = allNodes(uploadPanel, 'input').find(node => node.props.accept === 'image/*');
  assert.ok(fileInput !== undefined, 'the panel offers a file picker; inputs rendered: '
    + JSON.stringify(allNodes(uploadPanel, 'input').map(node => node.props.accept)));
  fileInput.props.onChange({
    target: { files: [{ name: 'a.png', type: 'image/png', size: 120 }] },
  });
  await settle();
  assert.strictEqual(uploads.length, 1, 'the picture is posted to the Host exactly once; requests so far: '
    + JSON.stringify(uploader.calls.map(entry => entry.url)));
  assert.ok(uploads[0].dataUrl.startsWith('data:image/png;base64,'), 'as a data URL the Host can decode: ' + String(uploads[0].dataUrl).slice(0, 40));
  assert.strictEqual(
    probe.wallpaperUrlAllowed('/dsh-custom-css/wallpaper?name=wallpaper-abc.png'), true,
    'a root-relative path is accepted — it is the shape the Host\'s own route answers with',
  );
  assert.strictEqual(
    probe.wallpaperUrlAllowed('//evil.test/a.png'), false,
    'but a protocol-relative one is not: that is somewhere else wearing the costume of a path',
  );
  const uploadSheet = uploader.styleTags.find(element => element.id === 'dsh-custom-css-wallpaper-style');
  assert.ok(
    uploadSheet !== undefined && uploadSheet.textContent.includes('/dsh-custom-css/wallpaper?name=wallpaper-abc.png'),
    'the sheet points at the URL the Host answered with — tags: '
      + JSON.stringify(uploader.styleTags.map(element => element.id)),
  );
  const userIndex = uploader.styleTags.indexOf(uploader.userStyle());
  assert.ok(
    userIndex >= 0 && uploader.styleTags.indexOf(uploadSheet) < userIndex,
    'and it sits BEFORE the user sheet, so the user\'s own rules win on a tie — order: '
      + JSON.stringify(uploader.styleTags.map(element => element.id || element.dataset.pluginCss)),
  );
  const storedWallpaper = JSON.parse(uploader.storage.get('dsh-custom-css:wallpaper'));
  assert.strictEqual(storedWallpaper.image, '/dsh-custom-css/wallpaper?name=wallpaper-abc.png', 'the browser keeps the URL, not the picture');
  assert.strictEqual(storedWallpaper.transparent, 26, 'with the settings it was installed under');
  await uploader.runTimers();
  await settle();
  assert.ok(
    uploader.calls.some(entry => entry.url.includes('/write') && JSON.parse(entry.init.body).name === 'wallpaper.json.css'),
    'the record is written to the Host under its own sheet name, so it survives this browser',
  );

  // 2. The section on this plugin's page in the plugin manager: rendered for its own page,
  //    declined on every other one. The plugin manager hands the page down as owner props, so
  //    the check is on the real subject rather than on a registration of ours.
  hookIndex = 0;
  const mine = uploader.registrations[1].component({ subject: { kind: 'bundle', pkg: { name: 'dsh-custom-css' } } });
  assert.ok(mine !== null && mine !== undefined, 'this plugin\'s own page shows the wallpaper section');
  // The seat's contract is that an entry draws its OWN section chrome, and the official section it
  // is modelled on has three parts: a 14px/500 title, a description line, and the facts list.
  // Asserted on the rendered tree, because "the section exists" is not "the section says anything".
  assert.strictEqual(mine.type, 'section', 'the contribution is a section element');
  assert.strictEqual(mine.props['data-dsh-wallpaper'], 'section', 'carrying this plugin\'s own marker');
  assert.strictEqual(mine.props['aria-label'], '自定义壁纸', 'and a name a landmark reader can announce');
  /**
   * Every string in a rendered subtree. The fake React keeps text in `children`, not in
   * `props.children`, so the copy a user reads is collected by walking that list — an assertion
   * written against `props.children` found empty strings and would have passed vacuously
   * against a section with no copy at all.
   */
  const sectionTextOf = (node) => {
    if (typeof node?.type === 'function') {
      hookIndex = 0;
      node = node.type(node.props ?? {});
    }
    if (typeof node === 'string') return node;
    if (node === null || typeof node !== 'object') return '';
    // `children` first (what the fake React stores), then `props.children` — a rendered button puts
    // its label in whichever the component it rendered through happened to set, and a walker that
    // only knew one of them reported "the section says nothing about it" for a labelled control.
    const kids = (node.children ?? []).length > 0 ? node.children : (node.props?.children ?? []);
    return [].concat(kids).map(sectionTextOf).join(' ');
  };
  const sectionText = sectionTextOf(mine);
  for (const expected of ['自定义壁纸', '本机图片', '.wallpapers', '32 MB', '皮肤']) {
    assert.ok(sectionText.includes(expected), 'the section chrome mentions ' + expected + ' — text: ' + sectionText);
  }
  assert.strictEqual(
    allNodes(mine, 'dl').length, 1,
    'and the facts are a definition list, the shape the shipped sections use',
  );
  assert.strictEqual(allNodes(mine, 'dt').length, 3, 'with one term per fact');

  // The URL field: the second way to set a picture, for a picture that is already somewhere. The
  // panel is mounted above (`mine`), so its own controls are in this tree — `allNodes` renders
  // nested components on the way down. The draft is component state, so the interaction is driven
  // through the SAME mounted tree rather than by re-rendering it: a fresh render would start from
  // an empty draft and test nothing.
  const wallPanel = allNodes(mine, 'input').find((node) => node.props?.type === 'text');
  assert.ok(wallPanel !== undefined, 'the panel offers a URL field');
  assert.strictEqual(wallPanel.props['aria-label'], '壁纸图片 URL', 'with a name a reader can announce');
  assert.ok(
    /https/.test(String(wallPanel.props.placeholder ?? '')),
    'and a placeholder that shows the shape of an address — got: ' + String(wallPanel.props.placeholder),
  );
  // Found by its label, which now really is in the tree: these buttons are plain DOM elements built
  // by the row's own `rowButton` helper, not elements handed to a component that re-arranges its
  // children on the way down. (That was the reason for the old props-based lookup.)
  const urlButtonOf = (tree) => allNodes(tree, 'button')
    .find((node) => (node.children ?? []).join('').includes('使用此 URL'));
  const firstUrlButton = urlButtonOf(mine);
  assert.ok(firstUrlButton !== undefined, 'with one commit button beside it');
  assert.strictEqual(
    firstUrlButton.props.disabled, true,
    'which is disabled while the draft is empty, so there is nothing to submit',
  );
  assert.strictEqual(
    firstUrlButton.props.className, 'dshUi_button',
    'and it is the settings row\'s own button, not a second kind of button — className: '
      + String(firstUrlButton.props.className),
  );
  const srcHasUrlLabel = source.includes("'使用此 URL'");
  assert.ok(
    srcHasUrlLabel,
    'and the button is labelled 使用此 URL',
  );

  // A refused address: the note explains, and the picture stays exactly as it was.
  wallPanel.props.onChange({ target: { value: 'javascript:alert(1)' } });
  hookIndex = 0;
  const refused = uploader.registrations[1].component({ subject: { kind: 'bundle', pkg: { name: 'dsh-custom-css' } } });
  const refusedField = allNodes(refused, 'input').find((node) => node.props?.type === 'text');
  refusedField.props.onChange({ target: { value: 'javascript:alert(1)' } });
  hookIndex = 0;
  const refusedReady = uploader.registrations[1].component({ subject: { kind: 'bundle', pkg: { name: 'dsh-custom-css' } } });
  urlButtonOf(refusedReady).props.onClick();
  hookIndex = 0;
  const afterRefusal = uploader.registrations[1].component({ subject: { kind: 'bundle', pkg: { name: 'dsh-custom-css' } } });
  assert.strictEqual(
    JSON.parse(uploader.storage.get('dsh-custom-css:wallpaper')).image,
    '/dsh-custom-css/wallpaper?name=wallpaper-abc.png',
    'a javascript: address never reaches the record',
  );
  assert.ok(
    sectionTextOf(afterRefusal).includes('不能用作壁纸'),
    'and the panel says why instead of doing nothing — text: ' + sectionTextOf(afterRefusal).slice(0, 200),
  );

  // An accepted address: the picture is the URL, and no upload was involved.
  hookIndex = 0;
  const accepted = uploader.registrations[1].component({ subject: { kind: 'bundle', pkg: { name: 'dsh-custom-css' } } });
  const acceptedField = allNodes(accepted, 'input').find((node) => node.props?.type === 'text');
  acceptedField.props.onChange({ target: { value: ' https://example.com/a.jpg ' } });
  hookIndex = 0;
  const ready = uploader.registrations[1].component({ subject: { kind: 'bundle', pkg: { name: 'dsh-custom-css' } } });
  const readyButton = urlButtonOf(ready);
  assert.strictEqual(readyButton.props.disabled, false, 'a draft enables it');
  readyButton.props.onClick();
  assert.strictEqual(
    JSON.parse(uploader.storage.get('dsh-custom-css:wallpaper')).image,
    'https://example.com/a.jpg',
    'and the address is installed with its surrounding whitespace trimmed',
  );

  hookIndex = 0;
  assert.strictEqual(
    uploader.registrations[1].component({ subject: { kind: 'bundle', pkg: { name: 'some-other-plugin' } } }), null,
    'another plugin\'s page does not',
  );
  hookIndex = 0;
  assert.strictEqual(uploader.registrations[1].component({}), null, 'and a page with no subject at all does not');
  hookIndex = 0;
  assert.strictEqual(
    uploader.registrations[1].component({ subject: { kind: 'item', id: 'dsh-custom-css' } }), null,
    'nor does an official plugin of the same name: this contribution is about the bundle',
  );

  // The wallpaper used to be mounted here as well; it is a LINK now. Asserted against the SOURCE
  // for the mount's absence (rendering the whole row would run the dropdown's effects), and
  // against the rendered node for the link, because "there is a labelled control" is a node fact.
  assert.ok(
    !source.includes('dshCc_wallpaperBlock') && !source.includes('dshCc_wallpaperHead'),
    'the settings row no longer references the wallpaper block it used to mount',
  );
  assert.ok(
    !source.includes('dshWp_lede'),
    'and the panel no longer carries the intro copy that moved into the section',
  );
  assert.strictEqual(
    source.split('WallpaperPanel').length - 1, 2,
    'the panel has exactly one mount (its definition plus one call site)',
  );

  const linkRow = (() => {
    // A clean mount, not just a clean index: the cases above mounted the wallpaper section, whose
    // panel now renders the settings row's `Dropdown` (a stateful component). The harness keeps
    // hook slots by position across mounts, so the row's first `useState` would read the value the
    // dropdown left at that index — measured: `openIndex` came back `undefined`, and the row then
    // asked for `rules[undefined]`. Clearing the slot table as well is what makes this the "fresh
    // component" every other mount in this file is.
    hookIndex = 0;
    hookSlots.length = 0;
    const view = uploader.registrations[0].component();
    const stack = [view];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === null || typeof node !== 'object') continue;
      if (node.type === 'div' && node.props.className === 'dshCc_wallpaperLinkRow') return node;
      for (const child of node.children ?? []) stack.push(child);
    }
    return null;
  })();
  assert.ok(linkRow !== null, 'the row offers a link to the wallpaper section');
  const linkButton = (linkRow.children ?? [])[0];
  assert.strictEqual(
    linkButton.props.className, 'dshCc_linkBtn',
    'the link is a link-styled control, not one of the row\'s 36px buttons',
  );
  assert.strictEqual(
    (linkButton.children ?? []).join(''), '自定义壁纸…',
    'and it says what it opens — got: ' + JSON.stringify(linkButton.children),
  );
  assert.strictEqual(
    (linkRow.children ?? []).slice(1).map(child => child.props.className).join(','), 'dshCc_linkNote',
    'beside it, one line saying where it goes',
  );
  assert.strictEqual(
    (linkRow.children ?? []).some(child => child?.type === 'input' || child?.props?.className === 'dshWp_root'),
    false,
    'and the row mounts NO wallpaper control: it is a link, not the panel',
  );

  // The link navigates through the official service, which is read at CLICK time: a required
  // dependency on `pluginNavigation` would take the whole plugin out of a composition whose
  // plugin manager does not provide one. The double counts the call on ITS OWN boot, so an
  // earlier boot's service cannot answer for this one.
  probe.openWallpaperSection();
  assert.deepStrictEqual(
    navigationCalls.slice(), ['dsh-custom-css'],
    'the link asks the plugin manager to open this plugin\'s page',
  );

  // …and the same plugin in a composition whose plugin manager is NOT installed. The point is that
  // it still LOADS: `pluginNavigation` is read through `ctx.get` instead of being declared in
  // `exports.inject`, and a required dependency would take both seats out of such a composition.
  const noManager = await boot({
    serviceMissing: true,
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) {
        return jsonResponse({ ok: true, dir: 'C:/css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css' });
      }
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.a{color:red}', rev: 1 });
      throw new Error('unexpected request: ' + url);
    },
  });
  assert.strictEqual(noManager.registrations.length, 3, 'a composition without a plugin manager still gets every seat');
  assert.deepStrictEqual(
    noManager.registrations.map(entry => entry.options.id).sort(),
    ['custom-css', 'custom-css-wallpaper', 'custom-css-wallpaper-settings'],
    'and all three are the seats this plugin registers',
  );

  // --- 23. plugin settings --------------------------------------------------
  //
  // The settings that ship without a Host route: they reach the page through the SAME injected
  // sheet the wallpaper uses, so what a test can hold on to is the sheet's text.
  // The probe runs inside the harness's VM context, so its objects have that realm's prototypes —
  // `deepStrictEqual` refuses them on identity. Compare the JSON, which is the same value a user
  // would read in the record file anyway.
  const settingsJson = (value) => JSON.stringify(value);
  /** The wallpaper half of a settings record — the editor half is asserted in its own cases. */
  const wallpaperHalf = (value) => {
    const record = JSON.parse(settingsJson(value));
    return JSON.stringify({
      rotate: record.rotate, scrim: record.scrim, blur: record.blur, clock: record.clock,
    });
  };
  assert.strictEqual(
    wallpaperHalf(probe.normalizeSettings(undefined)),
    settingsJson({ rotate: 'off', scrim: 0, blur: 0, clock: false }),
    'a missing record normalises to the defaults',
  );
  assert.strictEqual(
    wallpaperHalf(probe.normalizeSettings({ rotate: '5', scrim: 999, blur: -3, clock: 'yes' })),
    settingsJson({ rotate: 'off', scrim: 80, blur: 0, clock: false }),
    'and an out-of-range or unknown record is measured into the range rather than written through',
  );
  assert.strictEqual(
    wallpaperHalf(probe.normalizeSettings({ rotate: '300', scrim: 40, blur: 12, clock: true })),
    settingsJson({ rotate: '300', scrim: 40, blur: 12, clock: true }),
    'a valid record survives normalisation unchanged',
  );

  // The editor's preferences are whitelists too, and their defaults are the values the editor
  // shipped with — a record that predates them must not change how the editor behaves.
  const editorHalf = (value) => {
    const record = JSON.parse(settingsJson(value));
    return JSON.stringify({
      saveDelay: record.saveDelay, validate: record.validate,
      lineNumbers: record.lineNumbers, tabWidth: record.tabWidth,
    });
  };
  assert.strictEqual(
    editorHalf(probe.normalizeSettings(undefined)),
    settingsJson({ saveDelay: 400, validate: 'full', lineNumbers: true, tabWidth: 2 }),
    'a record without editor preferences gets the values the editor already had',
  );
  assert.strictEqual(
    editorHalf(probe.normalizeSettings({ saveDelay: 7, validate: 'loose', lineNumbers: 'yes', tabWidth: 3 })),
    settingsJson({ saveDelay: 400, validate: 'full', lineNumbers: true, tabWidth: 2 }),
    'and a hand-edited one cannot arm a delay, a strictness or a tab width nobody offered',
  );
  assert.strictEqual(
    editorHalf(probe.normalizeSettings({ saveDelay: 3000, validate: 'off', lineNumbers: false, tabWidth: 8 })),
    settingsJson({ saveDelay: 3000, validate: 'off', lineNumbers: false, tabWidth: 8 }),
    'while the offered values pass through',
  );
  assert.strictEqual(
    JSON.parse(settingsJson(probe.normalizeSettings({ lineNumbers: false }))).lineNumbers, false,
    'turning the gutter off survives: the default is "on", so only an explicit false may switch it',
  );

  // The editor preferences have to REACH the editor, not just survive normalisation. Each case
  // boots its own row and drives one edit through it, because the debounce and the strictness are
  // both read at the moment they are used.
  const slowSave = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: 'C:/css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css' });
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.a{color:red}', rev: 1 });
      if (url === '/dsh-custom-css/write') return jsonResponse({ ok: true, name: 'custom.css', rev: 2 });
      throw new Error('unexpected request: ' + url);
    },
  });
  slowSave.mod.__probe.commitSettings({ saveDelay: 3000, validate: 'full', lineNumbers: true, tabWidth: 2 });
  assert.strictEqual(
    slowSave.mod.__probe.settingsSnapshot().saveDelay, 3000,
    'the committed delay is in the store',
  );
  hookIndex = 0;
  renderedText.length = 0;
  const slowSaveRow = slowSave.registrations[0].component();
  await slowSave.runEffects();
  const typedArea = findNode(slowSaveRow, 'textarea');
  typedArea.props.onChange({
    target: { value: '.slow{color:blue}', selectionStart: 0 },
    nativeEvent: { inputType: 'insertText' },
  });
  assert.strictEqual(
    slowSave.debounces(3000).length, 1,
    'typing schedules ONE write at the delay the setting asks for',
  );
  assert.strictEqual(
    slowSave.debounces(WRITE_TICK).length, 0,
    'and not at the built-in one: the constant is only the default now',
  );

  // Strictness reaches the status line: with the checks off, a sheet with a broken declaration no
  // longer reports a line number — and a FAILED WRITE still reports, because that line is the
  // plugin's own state and not a linter's opinion.
  const lax = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: 'C:/css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css' });
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.a{color:red', rev: 1 });
      throw new Error('unexpected request: ' + url);
    },
  });
  lax.mod.__probe.commitSettings({ validate: 'off', saveDelay: 400, lineNumbers: true, tabWidth: 2 });
  hookIndex = 0;
  renderedText.length = 0;
  const laxRow = lax.registrations[0].component();
  await lax.runEffects();
  const laxText = JSON.stringify(renderedText);
  assert.ok(
    !/第 \d+ 行/.test(laxText),
    'with validation off, an unclosed block is not reported as a line problem — got: '
      + laxText.slice(0, 160),
  );

  // And the gutter is a class on the row, so the layout maths keeps the column it was measured
  // against: hidden, not unmounted.
  const noGutter = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: 'C:/css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css' });
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.a{color:red}', rev: 1 });
      throw new Error('unexpected request: ' + url);
    },
  });
  noGutter.mod.__probe.commitSettings({ lineNumbers: false, saveDelay: 400, validate: 'full', tabWidth: 2 });
  hookIndex = 0;
  renderedText.length = 0;
  const noGutterRow = noGutter.registrations[0].component();
  await noGutter.runEffects();
  // The gutter is hidden by a class on the row, not by removing it: the editor's colour layer and
  // its caret maths are positioned against that row, so the setting takes the numbers away and
  // leaves the box. What a test can hold is the class itself (the `display:none` rule is asserted
  // with the other stylesheet checks), and that the row still renders as one row.
  const rowClass = String(findNode(noGutterRow, 'div')?.props?.className ?? '');
  assert.ok(
    rowClass.includes('dshCc_noGutter'),
    'the row carries the no-gutter class — got class: ' + rowClass,
  );
  assert.strictEqual(
    rowClass.includes('dshCc_row'), true,
    'and it is still the same row element, so the editor\'s geometry is untouched',
  );
  assert.strictEqual(
    JSON.parse(settingsJson(noGutter.mod.__probe.settingsSnapshot())).lineNumbers, false,
    'the record the editor reads says the gutter is off',
  );
  assert.strictEqual(probe.rotateIntervalMs({ rotate: 'off' }), 0, 'rotation off is zero milliseconds');
  assert.strictEqual(probe.rotateIntervalMs({ rotate: '300' }), 300000, 'and five minutes is five minutes');
  // A hand-edited record is refused rather than obeyed: the choices are a whitelist, so a value
  // nobody offered — including one a user typed into the file themselves — reads as "off" instead
  // of arming a timer the interface has no control to switch off.
  assert.strictEqual(
    probe.rotateIntervalMs({ rotate: String(60 * 60 * 24 * 30) }), 0,
    'a value that is not one of the offered choices reads as off',
  );

  // The picture's own layer keeps ONE filter declaration. Two would replace each other, and the
  // measured symptom was a blur slider that moved while the picture stayed sharp.
  const composedFilter = probe.wallpaperCss(
    { image: PNG_DATA_URL, brightness: -55 },
    { blur: 12, scrim: 0, rotate: 'off', clock: false },
  );
  assert.ok(
    composedFilter.includes('filter:brightness(0.45) blur(12px)'),
    'brightness and blur compose into one filter — got: ' + composedFilter.split('\n').filter(l => l.startsWith('filter')).join('|'),
  );
  assert.strictEqual(
    composedFilter.split('filter:').length - 1, 1,
    'and there is exactly one filter declaration in the rule',
  );
  const scrimmed = probe.wallpaperCss(
    { image: PNG_DATA_URL },
    { blur: 0, scrim: 40, rotate: 'off', clock: false },
  );
  assert.ok(
    scrimmed.includes('background-image:linear-gradient(rgba(0,0,0,0.4),rgba(0,0,0,0.4)),url('),
    'the scrim is a gradient UNDER the picture, in the same background-image — got: '
      + scrimmed.split('\n').filter(l => l.includes('background-image')).join('|'),
  );
  assert.ok(
    !probe.wallpaperCss({ image: PNG_DATA_URL }, { scrim: 0, blur: 0, clock: false }).includes('linear-gradient(rgba'),
    'and no scrim means no gradient at all, not a transparent one',
  );

  // The clock: created only for a picture, ours by attribute, and never left behind.
  const clocked = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: 'C:/css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css' });
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.a{color:red}', rev: 1 });
      throw new Error('unexpected request: ' + url);
    },
  });
  probe.syncWallpaperClock({ clock: true, blur: 0, scrim: 0, rotate: 'off' });
  assert.strictEqual(
    clocked.document.body.children.some(child => child.id === 'dsh-custom-css-wallpaper-clock'), false,
    'a clock without a wallpaper is not created: it belongs to the picture',
  );
  probe.commitSettings({ clock: true, blur: 0, scrim: 0, rotate: 'off' });
  // A real picture through the real commit, so the store holds what the clock's own rule asks
  // about. `applyWallpaper` paints the sheet but deliberately does NOT touch the store — the
  // first version of this case used it and measured the clock being removed by its own rule.
  // The clock's off-switch, plus the failure mode worth guarding: a clock that stays behind after
  // it is switched off, or a second one created every time the settings are committed.
  //
  // ⚠ Everything here goes through the PLUGIN'S OWN document (`probe.appendStray` / `bodyList`).
  // Each `boot` builds its own VM and its own document object, so appending to a different boot's
  // body and then asking this one about "its" body measures two objects that never met — which is
  // exactly how the first version of this case reported a clock that was nowhere near it.
  probe.appendStray(probe.clockId());
  assert.strictEqual(
    probe.bodyList().includes('#' + probe.clockId()), true,
    'a clock-shaped node on the plugin\'s own body is found by id — body: ' + probe.bodyList(),
  );
  // The clock only exists ON a wallpaper, so the store needs a picture before "on" means anything:
  // without one the sync correctly removes the stray, which is what this case measured before it
  // committed a picture.
  probe.commitWallpaper({ image: PNG_DATA_URL }, { persist: false });
  probe.syncWallpaperClock({ clock: true, blur: 0, scrim: 0, rotate: 'off' });
  const afterOn = probe.bodyList();
  assert.strictEqual(
    afterOn.split(',').filter(entry => entry.includes('wallpaper-clock')).length, 1,
    'and syncing with the clock on reuses it instead of adding a second one — body: ' + afterOn,
  );
  probe.syncWallpaperClock({ clock: false, blur: 0, scrim: 0, rotate: 'off' });
  assert.strictEqual(
    probe.bodyList().includes('#' + probe.clockId()), false,
    'switching the clock off removes it rather than hiding it — body: ' + probe.bodyList(),
  );


  // --- 23d. window.dshCss: the authoring API --------------------------------
  //
  // The API is the console's way to reach what the plugin already does. What is assertable here
  // is the shape (a stable entry point with a version) and the parts that do not need a real
  // browser: transient sheets and the selector parser behind `deadSelectors`.
  const authoring = host.mod.__probe.authoringApi();
  assert.ok(authoring, 'window.dshCss is installed at load');
  assert.strictEqual(authoring.apiVersion, 1, 'with an API version');
  for (const path of ['sheets.list', 'sheets.read', 'sheets.write', 'sheets.activate', 'sheets.history',
    'css.apply', 'css.remove', 'css.list', 'css.selectorHits', 'css.computed', 'css.rulesFor',
    'css.deadSelectors', 'tokens.all', 'tokens.get', 'tokens.find', 'inspect', 'pick', 'on', 'off', 'help']) {
    const owner = path.split('.')[0];
    const name = path.split('.')[1];
    assert.strictEqual(typeof (name === undefined ? authoring[owner] : authoring[owner]?.[name]), 'function', path + ' exists');
  }
  // Transient sheets: apply → list → remove, and the tag really is in the head.
  const appliedId = authoring.css.apply('.probe-only{color:red}', { id: 'probe' });
  assert.strictEqual(appliedId, 'probe', 'apply returns the id it stored under');
  assert.deepStrictEqual(Array.from(authoring.css.list(), entry => entry.id), ['probe'], 'list reports it');
  assert.ok(
    host.styleTags.some(tag => tag.dataset.authoringId === 'probe' && String(tag.textContent).includes('.probe-only')),
    'and the style tag is in the document',
  );
  assert.strictEqual(authoring.css.remove('probe'), true, 'remove finds it');
  assert.deepStrictEqual(Array.from(authoring.css.list()), [], 'and it is gone');
  assert.strictEqual(authoring.css.remove('probe'), false, 'removing twice is a no-op');

  // deadSelectors: parses the stylesheet, skips at-rules and keyframes, and reports only the
  // selectors that match nothing.
  const dead = authoring.css.deadSelectors(
    '.definitely-missing{color:red}\n'
    + '.hover-missing:hover{color:green}\n'
    + '@media (min-width:1px){.also-missing{color:blue}}\n'
    + '@keyframes spin{from{opacity:0}to{opacity:1}}\n'
    + '.V1MMBW_tableWrap{box-shadow:none}',
  );
  // Only "never matches, on a resting page" counts: the hover rule is skipped (state-dependent),
  // the @media one too (a non-matching viewport says nothing about the rule), and keyframes are not
  // selectors at all. The real-looking stale class IS reported — that is the case that matters.
  assert.deepStrictEqual(Array.from(dead), ['.definitely-missing', '.V1MMBW_tableWrap'], 'got: ' + JSON.stringify(dead));

  // --- 23c. the account menu follows its trigger -----------------------------
  //
  // The menu is a portal on `body` with JS-positioned `left`/`top` (no CSS anchor
  // positioning), so CSS cannot learn the trigger's width — the plugin measures it. These
  // assertions cover the measuring function itself: what it copies, and when it refuses.
  const fakeTrigger = (expanded, width) => ({
    getAttribute: (name) => (name === 'aria-expanded' ? expanded : null),
    getBoundingClientRect: () => ({ width }),
  });
  const fitMenu = probe.fitMenuToTrigger;
  const openMenu = { style: {} };
  assert.strictEqual(
    fitMenu(openMenu, fakeTrigger('true', 252)),
    true,
    'an open menu takes the trigger width',
  );
  assert.strictEqual(openMenu.style.width, '252px', 'as a width');
  assert.strictEqual(openMenu.style.minWidth, '252px', 'and a min-width, so the content cannot shrink it');
  const closedMenu = { style: {} };
  assert.strictEqual(
    fitMenu(closedMenu, fakeTrigger('false', 252)),
    false,
    'a closed trigger is not copied — the menu belongs to nothing',
  );
  assert.strictEqual(closedMenu.style.width, undefined, 'and the menu is left alone');
  const zeroMenu = { style: {} };
  assert.strictEqual(fitMenu(zeroMenu, fakeTrigger('true', 0)), false, 'a zero-width trigger is ignored');
  assert.strictEqual(fitMenu(null, fakeTrigger('true', 252)), false, 'no menu, nothing to do');
  assert.strictEqual(
    fitMenu({ style: {} }, null),
    false,
    'no trigger, nothing to do',
  );

  // --- 23b. the UI kit: one button, one switch, four states ------------------
  //
  // The kit is the extension's only control implementation. What a test can hold is what the DOM
  // says: the class, the attribute that carries each state, and the fact that the panel's buttons
  // really go through it (the audit forbids the hand-written variant).
  const kitBoot = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: 'C:/css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css' });
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.a{color:red}', rev: 1 });
      throw new Error('unexpected request: ' + url);
    },
  });
  hookIndex = 0;
  hookSlots.length = 0;
  const kitSection = kitBoot.registrations[2].component({ subject: { kind: 'bundle', pkg: { name: 'dsh-custom-css' } } });
  const kitButtons = allNodes(kitSection, 'button');
  assert.ok(kitButtons.length > 0, 'the section renders buttons');
  // Every button in the panel is kit-built: either the button (`dshUi_button`), the switch, or
  // a choice trigger. What matters is that none of them is a hand-written shell.
  assert.strictEqual(
    kitButtons.every((node) => String(node.props.className).startsWith('dshUi_')),
    true,
    'every button comes from the kit — got: '
      + JSON.stringify(kitButtons.map((node) => String(node.props.className))),
  );
  assert.ok(
    kitButtons.filter((node) => String(node.props.className).startsWith('dshUi_button')).length >= 2,
    'including the plain buttons (export / reset)',
  );
  // The switch's state lives on `aria-checked`, not on a parallel class.
  const kitSwitches = kitButtons.filter((node) => String(node.props.role) === 'switch');
  assert.ok(kitSwitches.length >= 2, 'the section has its two switches');
  assert.deepStrictEqual(
    kitSwitches.map((node) => node.props['aria-checked']),
    [false, true, true],
    'with their state on aria-checked (clock off, line numbers on, console writes allowed)',
  );
  // The busy state is three things at once: disabled, aria-busy, and a spinner node.
  const busy = kitBoot.mod.__probe.ui.button({ busy: true }, '保存中');
  assert.strictEqual(busy.props.disabled, true, 'a busy button is disabled');
  assert.strictEqual(busy.props['aria-busy'], 'true', 'and says it is busy');
  assert.ok(
    busy.children.some((child) => child !== null && String(child.props?.className ?? '').includes('dshUi_spinner')),
    'and carries the spinner',
  );
  const idle = kitBoot.mod.__probe.ui.button({}, '保存');
  // React drops `disabled={false}` from the DOM, so the value here is false rather than absent.
  assert.strictEqual(idle.props.disabled, false, 'an idle button is not disabled');
  assert.strictEqual(idle.props['aria-busy'], undefined, 'and says nothing about busy');
  // The status line announces itself, and its state decides the paint.
  const liveStatus = kitBoot.mod.__probe.ui.status({ state: 'error', text: '失败了' });
  assert.strictEqual(liveStatus.props.role, 'status', 'the status line is a live region');
  assert.strictEqual(liveStatus.props['aria-live'], 'polite', 'politely announced');
  assert.ok(String(liveStatus.props.className).includes('dshUi_statusBad'), 'and painted as an error');
  // 提醒态不是错误：DSH 只有一个红，它留给「出错」与「重置」。
  const warnStatus = kitBoot.mod.__probe.ui.status({ state: 'warn', text: '正在演示悬停' });
  assert.ok(String(warnStatus.props.className).includes('dshUi_statusWarn'), 'a warn line is painted as a warning');
  assert.ok(!String(warnStatus.props.className).includes('dshUi_statusBad'), 'and not as an error');
  // 28px 档与图标档：两档高度都来自 DSH 的规格（36 / 28），第三个高度不该出现。
  const small = kitBoot.mod.__probe.ui.button({ size: 'sm' }, '小');
  assert.ok(String(small.props.className).includes('dshUi_buttonSm'), 'size: sm asks for the 28px button');
  assert.ok(!String(small.props.className).includes('dshUi_buttonIcon'), 'and is not an icon button');
  const icon = kitBoot.mod.__probe.ui.button({ size: 'sm', icon: true }, '×');
  assert.ok(String(icon.props.className).includes('dshUi_buttonIcon'), 'icon: true asks for the square variant');
  // 有按下语义的按钮把状态写在 aria-pressed 上；普通按钮不写（写 false 等于给读屏器加噪音）。
  const pressed = kitBoot.mod.__probe.ui.button({ pressed: true }, '对比');
  assert.strictEqual(pressed.props['aria-pressed'], 'true', 'a pressed button says so');
  const unpressed = kitBoot.mod.__probe.ui.button({ pressed: false }, '对比');
  assert.strictEqual(unpressed.props['aria-pressed'], 'false', 'and an unpressed one says that too');
  assert.strictEqual(kitBoot.mod.__probe.ui.button({}, '普通').props['aria-pressed'], undefined,
    'a button with no pressed state does not claim one');
  // 分段控件：一个组、若干段、同一时刻只有一段按下。
  const segments = kitBoot.mod.__probe.ui.segments({
    ariaLabel: '视图',
    value: 'single',
    choices: [['single', '单屏'], ['compare', '对比']],
    onChange: () => {},
  });
  assert.strictEqual(segments.props.role, 'group', 'the segments form one group');
  assert.strictEqual(segments.props['aria-label'], '视图', 'with a name');
  const segmentButtons = segments.children.filter(child => child !== null && child !== undefined);
  assert.strictEqual(segmentButtons.length, 2, 'one button per choice');
  assert.deepStrictEqual(segmentButtons.map(node => node.props['aria-pressed']), [true, false],
    'exactly the chosen one is pressed');
  let chosen = null;
  kitBoot.mod.__probe.ui.segments({
    ariaLabel: '视图',
    value: 'single',
    choices: [['single', '单屏'], ['compare', '对比']],
    onChange: (next) => { chosen = next; },
  }).children.filter(Boolean)[1].props.onClick();
  assert.strictEqual(chosen, 'compare', 'clicking a segment reports its value (not the event)');

  // --- 24. the data actions -------------------------------------------------
  //
  // The two buttons that touch everything at once. What a case can hold here is the SHAPE of the
  // calls they make: the export is a GET that ends in a download, and the reset is a POST that goes
  // through two clicks. A suite that drove the real reset would archive the fake Host's own fixture
  // files mid-run, so the assertion stops at "what was sent".
  const dataBoot = await boot({
    fetchImpl: async (url) => {
      if (url.endsWith('/list')) return jsonResponse({ ok: true, dir: 'C:/css', files: [{ name: 'custom.css', bytes: 20, mtime: 1 }], active: 'custom.css' });
      if (url.includes('/read')) return jsonResponse({ ok: true, name: 'custom.css', css: '.a{color:red}', rev: 1 });
      if (url.endsWith('/export')) {
        return jsonResponse({
          ok: true,
          kind: 'dsh-custom-css-backup',
          version: 1,
          sheets: { 'custom.css': { css: '.a{color:red}', history: [] } },
          records: {},
          wallpapers: [],
        });
      }
      if (url.endsWith('/archive-and-reset')) return jsonResponse({ ok: true, stamp: '1', backup: 'C:/css/.backup/1', moved: ['theme.css'], skipped: [] });
      throw new Error('unexpected request: ' + url);
    },
  });
  hookIndex = 0;
  renderedText.length = 0;
  const settingsSection = dataBoot.registrations[2].component({ subject: { kind: 'bundle', pkg: { name: 'dsh-custom-css' } } });
  assert.ok(settingsSection !== null, 'the settings section renders for its own page');

  // ⚠ The data group's own markup is asserted against the SOURCE, and the reason is a measured
  // harness limit rather than convenience: the panel reads `useSyncExternalStore`, so calling it a
  // second time reads the stores a SECOND time and the fake React's hook slots no longer line up.
  // Walking into the panel therefore measures the harness. What the source can prove is what the
  // two actions are wired to; what the routes do with those calls is the host suite's business.
  for (const needle of [
    "'dshUi_group'",
    '导出全部',
    '重置插件',
    '再按一次重置',
    "'/export'",
    "'/archive-and-reset'",
    'archive-and-reset',
  ]) {
    assert.ok(
      source.includes(needle),
      'the data group is wired to ' + needle,
    );
  }
  // And the reset arms before it acts: the two-click shape is in the handler, not in a comment.
  assert.ok(
    /if \(!confirmReset\) \{ setConfirmReset\(true\); return; \}/.test(source),
    'the reset handler arms on the first click and returns without calling the Host',
  );
  assert.ok(
    /localStorage\.removeItem\(WALLPAPER_KEY\)[\s\S]{0,120}localStorage\.removeItem\(SETTINGS_KEY\)/.test(source),
    'and it clears BOTH browser-local records, or the next page load would resurrect what it archived',
  );
  assert.strictEqual(
    dataBoot.calls.filter(call => call.url.endsWith('/archive-and-reset')).length, 0,
    'nothing was reset merely by rendering the section',
  );

  console.log('loader-smoke: OK — shape, slots, host apply, offline fallback, seeding, highlighting, completion, validation, rule panel, property dropdowns, sheet switch, shorthand parts, save state machine, editor undo, sheet outline, variable check, capped scroll containers, picker write handoff, rule reopen handoff, string-aware scanning, comments in a declaration head, opaque url()s and nested blocks, comments in every scanner, panel binding, click targets, completion guards, element picker, selector escaping, picker label gate, no orphan CSS, honest DOM stubs, caret reveal, token scope and kind, unmount flush verified, history versions verified, find and replace verified, format verified, external sync verified, wallpaper verified, wallpaper settings verified, seat watchdog verified, selector audit verified, i18n verified, no Chinese in the English UI');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
