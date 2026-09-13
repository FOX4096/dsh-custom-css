/**
 * Browser half of dsh-custom-css.
 *
 * DSH loads client plugins through its own module loader, so this file is a
 * `__ModuleLoader__.load` factory rather than a plain ES module — the same
 * shape every shipped `@deepseek-ai/dsh-client-ui-*` bundle uses.
 *
 * The row registers into the General settings section's item slot, which is
 * the additive seat for a single preference: ui-theme owns `appearance`
 * (order 10) and `font-size` (order 11) on it, so order 12 lands directly
 * beneath the Appearance block. The row draws its own internals and copy —
 * the section column only stacks rows — and every value it paints comes from
 * the DSH `--dsw-*` token set, so it follows the active palette and both
 * colour schemes without a per-theme branch.
 *
 * Stylesheets live on the Host (see `lib/index.js`): this half only lists,
 * reads, writes, and applies them over the plugin's own `/dsh-custom-css`
 * route. Applying happens from `apply()`, not from the row, because the row is
 * only mounted while the settings panel is open — a stylesheet that only
 * loaded with the panel would never reach a normal conversation page. Browser
 * storage is used solely as a fallback when the Host route is unreachable, and
 * as the migration source for a stylesheet authored by the previous version.
 */
window.__ModuleLoader__.load({
	id: "dsh-custom-css",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");

		const PLUGIN_ID = "dsh-custom-css";
		const ROW_CSS_TAG = PLUGIN_ID + "/CustomCssRow.module.css";
		const USER_STYLE_ID = PLUGIN_ID + "-user-style";
		const API = "/dsh-custom-css";
		const LEGACY_KEY = "dsh.custom-css";
		const DEFAULT_NAME = "custom.css";
		const WRITE_DELAY_MS = 400;
		/** Editor line height in px; must match `--dshCc-line` in ROW_CSS. */
		const LINE_HEIGHT = 19;
		/** Sentinel option value for the "new sheet" entry at the bottom. */
		const NEW_OPTION = "\u0000new";

		// The row's own stylesheet, injected the way DSH's client packages do it:
		// one marked <style> tag per file, so an unload or HMR pass can find and
		// replace exactly this tag. Metrics and tokens are the ones the shipped
		// General rows use — 14px/22px titles on --dsw-alias-label-primary,
		// 12px/18px descriptions on --dsw-alias-label-tertiary, a 0.5px
		// --dsw-alias-border-l2 separator with 16px vertical padding, and the
		// shared button chrome (8px radius, 5px/14px padding, focus ring on
		// --dsw-alias-brand-primary).
		const ROW_CSS = [
			'.dshCc_row{border-bottom:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;padding:16px 0;display:flex}',
			'.dshCc_head{align-items:center;justify-content:space-between;gap:12px;display:flex}',
			'.dshCc_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}',
			'.dshCc_actions{align-items:center;gap:8px;display:flex;flex:none}',
			// Picker chrome copied value-for-value from the shipped settings-row
			// selector — `oY77xG_selector`, `T1PP_q_selector` and `lats3W_selector`
			// are byte-identical across ui-permission-presets, ui-conversation and
			// ui-chat — and the menu surfaces from the shared dropdown
			// (`_root_1nxmc_1` / `_list_1nxmc_8` / `_item_1nxmc_92`).
			'.dshCc_picker{position:relative;display:inline-flex}',
			'.dshCc_trigger{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;',
			'color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:18px;align-items:center;',
			'gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex;max-width:220px}',
			'.dshCc_trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_trigger:disabled{cursor:default;opacity:.5}',
			'.dshCc_trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.dshCc_triggerLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dshCc_chevron{flex:none}',
			'.dshCc_menu{position:absolute;top:calc(100% + 4px);right:0;z-index:100;min-width:218px;max-width:360px;',
			'box-sizing:border-box;padding:4px;display:flex;flex-direction:column;gap:0;border:0;border-radius:20px;',
			'background:var(--dsw-specific-menu);box-shadow:var(--dsw-elevation-prominent);',
			'--dsw-elevation-stroke-color:var(--dsw-alias-border-l1)}',
			'.dshCc_menuItem{display:flex;align-items:center;gap:8px;width:100%;min-height:40px;padding:8px 10px;',
			'border:none;border-radius:10px;background:transparent;cursor:pointer;font:inherit;font-size:14px;',
			'line-height:22px;color:var(--dsw-alias-label-primary);text-align:left}',
			'.dshCc_menuItem:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_menuLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dshCc_menuCheck{flex:none;color:var(--dsw-alias-brand-primary)}',
			'.dshCc_btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:none;',
			'font:inherit;font-size:13px;line-height:1.5;padding:5px 14px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}',
			'.dshCc_btn:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary);',
			'background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_btn:disabled{opacity:.4;cursor:default}',
			'.dshCc_btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.dshCc_danger{color:var(--dsw-alias-state-error-primary)}',
			'.dshCc_danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary);',
			'border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent);',
			'background:var(--dsw-alias-interactive-bg-hover-danger)}',
			'.dshCc_newRow{align-items:center;gap:8px;display:flex}',
			'.dshCc_input{box-sizing:border-box;flex:1;min-width:0;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);',
			'border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}',
			'.dshCc_input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;border-color:transparent}',
			'.dshCc_desc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}',
			// Editor: a DevTools-like shell — a line-number gutter beside the text
			// area sharing one monospace metric, plus an anchored completion list.
			// A definite height, not merely a minimum. The textarea resolves
			// `height: 100%` against this box, and against an auto-height parent
			// that resolves to nothing — so the field grew with its content and a
			// long sheet was shown in full instead of scrolling inside it.
			'.dshCc_editorWrap{box-sizing:border-box;position:relative;display:flex;width:100%;height:140px;',
			'min-height:120px;overflow:hidden;resize:vertical;',
			'background:transparent;--dshCc-line:19px;',
			'--dshCc-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}',
			'.dshCc_editorWrap:focus-within{border-color:transparent;outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.dshCc_gutter{flex:none;box-sizing:border-box;padding:10px 6px 10px 10px;overflow:hidden;text-align:right;',
			'user-select:none;color:var(--dsw-alias-label-caption);font-size:12px;line-height:var(--dshCc-line);',
			'font-family:var(--dshCc-mono)}',
			// The gutter itself cannot scroll — `overflow: hidden` pins scrollTop at
			// 0 — so the numbers ride a translated layer, exactly like the colour
			// layer does.
			'.dshCc_gutterInner{will-change:transform}',
			'.dshCc_gutterLine{height:var(--dshCc-line)}',
			// Code column: a scroll-synced <pre> carries the colours while the
			// transparent textarea on top keeps the real caret, selection and IME
			// behaviour. The padding lives on this container rather than on the
			// textarea: a textarea's own padding does not travel with its content,
			// so the two layers would drift apart as soon as the sheet scrolls.
			'.dshCc_code{position:relative;flex:1;min-width:0;min-height:0;overflow:hidden;padding:10px 12px}',
			'.dshCc_highlight{position:absolute;top:10px;left:12px;right:12px;margin:0;pointer-events:none;',
			'white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;tab-size:2;',
			'font-weight:400;font-size:12px;line-height:var(--dshCc-line);font-family:var(--dshCc-mono);',
			'color:var(--dsw-alias-label-primary);will-change:transform;',
			// Sitting above the textarea: the layer is click-through except for the
			// rule selectors, which need the pointer to open the panel.
			'z-index:2}',
			'.dshCc_clickable{pointer-events:auto;cursor:pointer;border-radius:3px}',
			'.dshCc_clickable:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_editor{box-sizing:border-box;position:relative;z-index:1;display:block;width:100%;height:100%;min-height:0;',
			'padding:0;border:none;outline:none;background:transparent;overflow:auto;resize:none;',
			'color:transparent;caret-color:var(--dsw-alias-label-primary);',
			'font-weight:400;font-size:12px;line-height:var(--dshCc-line);font-family:var(--dshCc-mono);',
			'white-space:pre-wrap;overflow-wrap:break-word;tab-size:2;',
			// No scrollbar: a space-consuming bar would narrow the textarea relative
			// to the colour layer, so lines would wrap at different points and the
			// two layers would drift apart under a selection.
			'scrollbar-width:none}',
			'.dshCc_editor::-webkit-scrollbar{width:0;height:0}',
			'.dshCc_editor::placeholder{color:var(--dsw-alias-label-caption)}',
			// Semi-transparent, so the coloured glyphs stay readable through a
			// selection — the textarea's own text is transparent by design.
			'.dshCc_editor::selection{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, transparent)}',
			// Syntax colours: DSH's own shiki tokens, so the editor follows the
			// active light/dark palette exactly the way Markdown code blocks do.
			'.dshCc_tokSel{color:var(--shiki-token-keyword)}',
			'.dshCc_tokProp{color:var(--shiki-token-constant)}',
			'.dshCc_tokVal{color:var(--shiki-token-string)}',
			'.dshCc_tokPunc{color:var(--shiki-token-punctuation)}',
			'.dshCc_tokComment{color:var(--shiki-token-comment);font-style:italic}',
			'.dshCc_suggest{position:absolute;z-index:120;min-width:164px;max-width:280px;box-sizing:border-box;',
			'padding:2px;display:flex;flex-direction:column;border:0;border-radius:7px;',
			'background:var(--dsw-specific-menu);box-shadow:var(--dsw-elevation-prominent);',
			'--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);',
			'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}',
			'.dshCc_suggestItem{display:flex;align-items:center;gap:6px;width:100%;min-height:26px;padding:3px 7px;',
			'border:none;border-radius:5px;background:transparent;cursor:pointer;text-align:left;',
			'font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary)}',
			'.dshCc_suggestItem[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_suggestKind{margin-left:auto;flex:none;color:var(--dsw-alias-label-caption);font-size:11px}',
			// Editor column plus the rule panel that opens on a selector click.
			// One container for the whole editor: a header (file identity + switch), a
			// body (code beside the rule panel), and the status footer. `overflow:
			// hidden` lets the header and footer backgrounds meet the corner radius
			// without each of them carrying one.
			'.dshCc_shell{box-sizing:border-box;display:flex;flex-direction:column;width:100%;min-width:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
			// No max-height: the panel stretches to the editor's height, so dragging
			// the editor's resize handle moves both boxes together.
			'.dshCc_panel{flex:none;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:232px;',
			'min-height:0;overflow-y:auto;padding:10px;border:1px solid var(--dsw-alias-border-l2);',
			'border-radius:12px;background:var(--dsw-alias-bg-layer-1);scrollbar-width:thin}',
			'.dshCc_panelHead{align-items:center;display:flex;gap:6px}',
			'.dshCc_panelName{flex:1;min-width:0;box-sizing:border-box;height:26px;padding:0 8px;',
			'border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-module-platform);',
			'color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-family:var(--dshCc-mono)}',
			'.dshCc_panelName:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;border-color:transparent}',
			'.dshCc_panelClose{appearance:none;flex:none;width:22px;height:22px;padding:0;border:none;border-radius:6px;',
			'background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:14px;line-height:1;cursor:pointer}',
			'.dshCc_panelClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.dshCc_panelHint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
			'.dshCc_panelSection{margin:2px 0 0;padding-top:6px;border-top:0.5px solid var(--dsw-alias-border-l2);',
			'color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
			'.dshCc_prop{align-items:center;display:flex;gap:6px}',
			'.dshCc_propLabel{flex:none;width:66px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
			'color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}',
			'.dshCc_propValue{flex:1;min-width:0;box-sizing:border-box;height:24px;padding:0 6px;',
			'border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-module-platform);',
			'color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;cursor:pointer}',
			'.dshCc_propValue:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;border-color:transparent}',
			'.dshCc_propText{flex:1;min-width:0;box-sizing:border-box;height:24px;padding:0 6px;',
			'border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-module-platform);',
			'color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;font-family:var(--dshCc-mono)}',
			'.dshCc_propText:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;border-color:transparent}',
			// Same chrome as a property dropdown, and indented to the value column:
			// it sits in the same stack, so a dashed/transparent variant of its own
			// only ever read as a different control.
			'.dshCc_addProp{box-sizing:border-box;display:block;margin:2px 0 0 72px;height:24px;padding:0 6px;',
			'border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-module-platform);',
			'color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;cursor:pointer}',
			'.dshCc_addProp:hover{border-color:var(--dsw-alias-label-dimmed)}',
			'.dshCc_addProp:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.dshCc_empty{margin:0;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}',
			'.dshCc_tpl{display:flex;align-items:center;gap:6px;width:100%;min-height:26px;padding:4px 8px;',
			'border:1px solid transparent;border-radius:7px;background:var(--dsw-alias-bg-module-platform);',
			'color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;text-align:left}',
			'.dshCc_tpl:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_tpl:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.dshCc_tplHint{margin-left:auto;flex:none;color:var(--dsw-alias-label-caption);font-size:11px}',
			'.dshCc_foot{align-items:center;justify-content:space-between;gap:8px;display:flex;padding:6px 10px;border-top:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform)}',
			'.dshCc_status{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}',
			'.dshCc_error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}',
			// File bar above the editor: the sheet identity on the left, its switch on
			// the right — a row of its own so it can never fight the editor frame or the
			// focus ring, and so the two boxes keep their own radii.
			'.dshCc_fileBar{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;padding:7px 10px 7px 11px;border-bottom:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform)}',
			'.dshCc_fileIdentity{flex:1;display:flex;align-items:center;gap:7px;min-width:0}',
			'.dshCc_codeIcon{flex:none;color:var(--dsw-alias-label-tertiary)}',
			'.dshCc_fileName{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
			'.dshCc_languageBadge{flex:none;padding:0 5px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:4px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;letter-spacing:.04em}',
			'.dshCc_fileBarRight{flex:none;display:flex;align-items:center;gap:7px}',
			'.dshCc_statusDot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary)}',
			'.dshCc_statusDot[data-state=off]{background:var(--dsw-alias-label-tertiary);opacity:.5}',
			'.dshCc_switch{display:inline-flex;align-items:center;gap:7px;padding:2px 9px 2px 4px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}',
			'.dshCc_switch:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.dshCc_switch:disabled{opacity:.5;cursor:default}',
			'.dshCc_switchTrack{position:relative;flex:none;width:30px;height:16px;border-radius:999px;background:var(--dsw-alias-border-l2);transition:background 120ms ease}',
			'.dshCc_switchThumb{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform 120ms ease}',
			'.dshCc_switchOn{color:var(--dsw-alias-label-primary)}',
			'.dshCc_switchOn .dshCc_switchTrack{background:var(--dsw-alias-brand-primary)}',
			'.dshCc_switchOn .dshCc_switchThumb{transform:translateX(14px)}',
			'@media (prefers-reduced-motion: reduce){.dshCc_switchTrack,.dshCc_switchThumb{transition:none}}',
		].join('');

		if (
			typeof document !== 'undefined'
			&& document.querySelector('style[data-plugin-css=' + JSON.stringify(ROW_CSS_TAG) + ']') === null
		) {
			const styleTag = document.createElement('style');
			styleTag.dataset.plugin = PLUGIN_ID;
			styleTag.dataset.pluginCss = ROW_CSS_TAG;
			styleTag.textContent = ROW_CSS;
			document.head.appendChild(styleTag);
		}

		/**
		 * Apply the active stylesheet, or remove the tag when it is empty. The tag
		 * is appended to `head` so it outranks the shipped sheets at equal
		 * specificity; `!important` remains available for the rest.
		 * @param css - stylesheet text to install.
		 */
		function applyUserCss(css) {
			const existing = document.getElementById(USER_STYLE_ID);
			if (typeof css !== 'string' || css.trim() === '') {
				if (existing !== null) existing.remove();
				return;
			}
			const styleTag = existing === null ? document.createElement('style') : existing;
			if (existing === null) {
				styleTag.id = USER_STYLE_ID;
				styleTag.dataset.plugin = PLUGIN_ID;
				document.head.appendChild(styleTag);
			}
			styleTag.textContent = css;
		}

		/**
		 * Whether one sheet currently contributes styles.
		 * @param name - sheet name, or null.
		 * @param disabled - names switched off.
		 * @returns true when the sheet should be applied.
		 */
		function sheetEnabled(name, disabled) {
			return name === null || !disabled.includes(name);
		}

		/**
		 * Apply one sheet, honouring its switch: a sheet that is off keeps its
		 * text on disk but contributes nothing to the page.
		 * @param name - sheet name, or null.
		 * @param css - the sheet text.
		 * @param disabled - names switched off.
		 */
		function applySheet(name, css, disabled) {
			applyUserCss(sheetEnabled(name, disabled) ? css : '');
		}

		/** Browser-local copy of the switch set, for a Host half that predates it. */
		const DISABLED_KEY = PLUGIN_ID + ':disabled';

		/**
		 * Read the browser-local switch set.
		 * @returns disabled sheet names, or an empty array.
		 */
		function readLocalDisabled() {
			try {
				const raw = localStorage.getItem(DISABLED_KEY);
				const parsed = raw === null ? null : JSON.parse(raw);
				return Array.isArray(parsed) ? parsed.filter(name => typeof name === 'string') : [];
			}
			catch {
				return [];
			}
		}

		/**
		 * Store the switch set for this browser.
		 * @param disabled - names switched off.
		 */
		function writeLocalDisabled(disabled) {
			try {
				localStorage.setItem(DISABLED_KEY, JSON.stringify(disabled));
			}
			catch {
				// The switch still works for this page; only the copy is lost.
			}
		}

		/**
		 * Read the previous version's browser-local sheet, which also serves as
		 * the offline fallback store.
		 * @returns stored CSS text, or an empty string.
		 */
		function legacyCss() {
			try {
				const value = localStorage.getItem(LEGACY_KEY);
				return value === null ? '' : value;
			}
			catch {
				return '';
			}
		}

		/**
		 * Persist the fallback sheet (only used while the Host route is down).
		 * @param css - stylesheet text.
		 */
		function writeLegacyCss(css) {
			try {
				localStorage.setItem(LEGACY_KEY, css);
			}
			catch {
				// Nothing to do: the sheet still applies for this page.
			}
		}

		/**
		 * One request against the plugin's Host route.
		 * @param path - route suffix, e.g. `/list`.
		 * @param init - fetch init.
		 * @returns the decoded payload.
		 * @throws when the transport fails or the payload reports `ok: false`.
		 */
		async function api(path, init) {
			const response = await fetch(API + path, { credentials: 'same-origin', ...init });
			const payload = await response.json().catch(() => undefined);
			if (!response.ok || payload === undefined || payload.ok !== true) {
				throw new Error(payload?.error ?? ('http ' + response.status));
			}
			return payload;
		}

		/**
		 * POST one JSON body to the Host route.
		 * @param path - route suffix.
		 * @param body - JSON-serializable body.
		 * @returns the decoded payload.
		 */
		function post(path, body) {
			return api(path, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
		}

		/**
		 * Coerce an arbitrary file name into the Host's accepted shape.
		 * @param raw - a picked file name.
		 * @returns a single-segment `.css` name.
		 */
		function normalizeName(raw) {
			const base = String(raw ?? '').trim().replace(/\.[^.]*$/, '');
			const cleaned = base.replace(/[^\w.\u4e00-\u9fa5-]/g, '-').replace(/^[.-]+/, '').slice(0, 48);
			return (cleaned === '' ? 'imported' : cleaned) + '.css';
		}

		/**
		 * Pick a name that is not taken yet, so importing never silently
		 * overwrites an existing sheet.
		 * @param name - the preferred name.
		 * @param taken - existing names.
		 * @returns an unused `.css` name.
		 */
		function uniqueName(name, taken) {
			if (!taken.includes(name)) return name;
			const stem = name.replace(/\.css$/i, '');
			for (let index = 2; index < 100; index += 1) {
				const candidate = stem + '-' + index + '.css';
				if (!taken.includes(candidate)) return candidate;
			}
			return stem + '-' + Date.now() + '.css';
		}

		/**
		 * Shared row state. `apply()` loads it once so a stylesheet is active on
		 * every page, and the settings row subscribes to the same object instead
		 * of fetching a second copy.
		 */
		let rowState = {
			/** Host-side sheets. */
			files: [],
			/** Active sheet name, or null. */
			active: null,
			/** Sheets switched off: their text stays on disk, they style nothing. */
			disabled: [],
			/** Editor text. */
			css: '',
			/** `loading` | `files` | `unavailable`. */
			mode: 'loading',
			/** User-facing failure text for the row footer. */
			error: '',
		};
		const rowListeners = new Set();
		/**
		 * The accessors close over their state instead of reading `this`:
		 * `useSyncExternalStore` receives them as bare function references, so
		 * `this` is undefined inside them and a `this.state` read throws
		 * mid-render — which the settings shell swallows into a
		 * `data-slot-error` placeholder, i.e. a row that never appears.
		 */
		const store = {
			set(patch) {
				rowState = { ...rowState, ...patch };
				for (const listener of rowListeners) listener();
			},
			subscribe(listener) {
				rowListeners.add(listener);
				return () => {
					rowListeners.delete(listener);
				};
			},
			snapshot() {
				return rowState;
			},
		};

		/**
		 * Every CSS property this browser exposes, read out of `CSSStyleDeclaration`
		 * instead of shipped as a hand-written list. The accessor names on the
		 * prototype are exactly the properties the engine understands — including
		 * vendor and newly shipped ones — so the completion set tracks the browser
		 * rather than this file.
		 * @returns sorted kebab-case names, or an empty array without a DOM.
		 */
		function browserProperties() {
			if (typeof CSSStyleDeclaration === 'undefined') return [];
			const prototype = CSSStyleDeclaration.prototype;
			const names = [];
			for (const name in prototype) {
				if (typeof Object.getOwnPropertyDescriptor(prototype, name)?.get !== 'function') continue;
				names.push(name.replace(/([A-Z])/g, '-$1').toLowerCase());
			}
			return names.sort();
		}

		/** Resolved completion source; the engine's list wins over the fallback. */
		let propertyCache;

		/**
		 * Property names for the completion list.
		 * @returns the browser's list, falling back to the curated one.
		 */
		function properties() {
			if (propertyCache === undefined) {
				const found = browserProperties();
				propertyCache = found.length > 0 ? found : CSS_PROPERTIES;
			}
			return propertyCache;
		}

		/**
		 * Curated fallback used only when `CSSStyleDeclaration` is unavailable
		 * (a non-DOM caller such as the loader smoke test).
		 */
		const CSS_PROPERTIES = [
			'align-content', 'align-items', 'align-self', 'animation', 'aspect-ratio', 'backdrop-filter',
			'background', 'background-color', 'background-image', 'background-position', 'background-repeat',
			'background-size', 'border', 'border-bottom', 'border-color', 'border-left', 'border-radius',
			'border-right', 'border-style', 'border-top', 'border-width', 'bottom', 'box-shadow', 'box-sizing',
			'color', 'column-gap', 'content', 'cursor', 'display', 'filter', 'flex', 'flex-basis',
			'flex-direction', 'flex-grow', 'flex-shrink', 'flex-wrap', 'font', 'font-family', 'font-size',
			'font-style', 'font-weight', 'gap', 'grid', 'grid-template-columns', 'grid-template-rows',
			'height', 'inset', 'justify-content', 'justify-items', 'justify-self', 'left', 'letter-spacing',
			'line-height', 'margin', 'margin-bottom', 'margin-left', 'margin-right', 'margin-top',
			'max-height', 'max-width', 'min-height', 'min-width', 'object-fit', 'opacity', 'order',
			'outline', 'overflow', 'overflow-x', 'overflow-y', 'padding', 'padding-bottom', 'padding-left',
			'padding-right', 'padding-top', 'pointer-events', 'position', 'right', 'row-gap', 'text-align',
			'text-decoration', 'text-overflow', 'text-transform', 'top', 'transform', 'transition',
			'user-select', 'vertical-align', 'visibility', 'white-space', 'width', 'word-break', 'z-index',
		];

		/**
		 * Value completions for the properties where a closed set is genuinely
		 * useful. Properties taking arbitrary lengths or colours are absent on
		 * purpose: a wrong enumeration is worse than no enumeration.
		 */
		const CSS_VALUES = {
			'align-content': ['center', 'flex-end', 'flex-start', 'space-around', 'space-between', 'stretch'],
			'align-items': ['baseline', 'center', 'flex-end', 'flex-start', 'stretch'],
			'align-self': ['auto', 'baseline', 'center', 'flex-end', 'flex-start', 'stretch'],
			'border-style': ['dashed', 'dotted', 'double', 'none', 'solid'],
			'box-sizing': ['border-box', 'content-box'],
			'cursor': ['default', 'grab', 'help', 'move', 'not-allowed', 'pointer', 'text', 'wait'],
			'display': ['block', 'contents', 'flex', 'grid', 'inline', 'inline-block', 'inline-flex', 'none'],
			'flex-direction': ['column', 'column-reverse', 'row', 'row-reverse'],
			'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
			'font-style': ['italic', 'normal', 'oblique'],
			'font-weight': ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'bold', 'normal'],
			'justify-content': ['center', 'flex-end', 'flex-start', 'space-around', 'space-between', 'space-evenly'],
			'object-fit': ['contain', 'cover', 'fill', 'none', 'scale-down'],
			'overflow': ['auto', 'clip', 'hidden', 'scroll', 'visible'],
			'overflow-x': ['auto', 'clip', 'hidden', 'scroll', 'visible'],
			'overflow-y': ['auto', 'clip', 'hidden', 'scroll', 'visible'],
			'pointer-events': ['all', 'auto', 'none'],
			'position': ['absolute', 'fixed', 'relative', 'static', 'sticky'],
			'text-align': ['center', 'justify', 'left', 'right'],
			'text-decoration': ['line-through', 'none', 'underline'],
			'text-overflow': ['clip', 'ellipsis'],
			'text-transform': ['capitalize', 'lowercase', 'none', 'uppercase'],
			'user-select': ['all', 'auto', 'none', 'text'],
			'visibility': ['collapse', 'hidden', 'visible'],
			'white-space': ['normal', 'nowrap', 'pre', 'pre-wrap'],
			'word-break': ['break-all', 'break-word', 'keep-all', 'normal'],
		};

		/**
		 * Compute the completion state for one caret position.
		 *
		 * Inside a declaration (`prop: val`) the caret completes that property's
		 * enumerated values; anywhere else it completes property names. Both are a
		 * prefix filter over the word the caret sits on, so typing `disp` offers
		 * `display`.
		 * @param value - the whole editor text.
		 * @param caret - the caret offset within it.
		 * @returns `{ items, word, kind }`, or null when there is nothing to offer.
		 */
		function completionsFor(value, caret) {
			const before = value.slice(0, caret);
			const word = /[-a-zA-Z]*$/.exec(before)?.[0] ?? '';
			const line = before.slice(before.lastIndexOf('\n') + 1);
			// One line can hold several declarations; only the one the caret sits in
			// describes it. Straight after a `;` there is nothing to complete yet,
			// and offering the whole property list there is pure noise.
			const clauseStart = line.lastIndexOf(';') + 1;
			const clause = line.slice(clauseStart);
			if (clauseStart > 0 && clause.trim() === '') return null;
			const colon = clause.indexOf(':');
			if (colon < 0) {
				// Property names only make sense inside a rule block, so a selector
				// being typed does not spray a property list under the caret.
				if (!insideBlock(before)) return null;
				const items = properties().filter(item => item.startsWith(word) && item !== word).slice(0, 12);
				return items.length === 0 ? null : { items, word, kind: '属性' };
			}
			// The declaration's property is the LAST identifier before the colon —
			// a first-match scan would return the selector's tail instead.
			const matches = clause.slice(0, colon).match(/[-a-zA-Z]+/g);
			const property = matches === null ? undefined : matches[matches.length - 1].toLowerCase();
			const values = property === undefined ? undefined : CSS_VALUES[property];
			if (values === undefined) return null;
			// The enumeration is hand-kept, so let the engine have the final say:
			// anything it would reject never reaches the list.
			const items = values.filter(item => item.startsWith(word) && item !== word && supported(property, item));
			return items.length === 0 ? null : { items, word, kind: '值' };
		}

		/**
		 * Whether the text ends inside a rule block rather than in a selector.
		 * @param before - the sheet text up to the caret.
		 * @returns true when the open-brace count exceeds the close-brace count.
		 */
		function insideBlock(before) {
			return (before.match(/\{/g)?.length ?? 0) > (before.match(/\}/g)?.length ?? 0);
		}

		/**
		 * Whether the engine accepts one property/value pair.
		 * @param property - kebab-case property name.
		 * @param value - candidate value.
		 * @returns true when supported, or when the engine cannot be asked.
		 */
		function supported(property, value) {
			if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return true;
			return CSS.supports(property, value);
		}

		/**
		 * Escape one string for HTML text content.
		 * @param text - raw text.
		 * @returns the escaped text.
		 */
		function escapeHtml(text) {
			return text
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;');
		}

		/**
		 * Render one sheet as syntax-highlighted markup, the way the DevTools
		 * Styles pane colours declarations. A single forward scan tracks whether
		 * the text sits in a selector, a declaration body, or a value — all the
		 * structure colouring needs. Every piece is escaped first, so a stylesheet
		 * can never inject markup into the page.
		 * @param css - the sheet text.
		 * @returns escaped HTML with one span per token.
		 */
		function highlightCss(css, rules) {
			const parts = [];
			let buffer = '';
			let state = 'sel';
			const kindOf = () => (state === 'sel' ? 'Sel' : (state === 'val' ? 'Val' : 'Prop'));
			/**
			 * Emit the pending run. A run ending exactly at a rule's selector end is
			 * that rule's selector, so it also becomes the click target for the panel.
			 * @param at - offset the run ends at, before trailing whitespace.
			 */
			const flush = (at) => {
				if (buffer === '') return;
				const end = at - (buffer.length - buffer.trimEnd().length);
				const ruleIndex = rules.findIndex(rule => rule.selectorEnd === end);
				if (ruleIndex < 0) {
					parts.push('<span class="dshCc_tok' + kindOf() + '">' + escapeHtml(buffer) + '</span>');
				}
				else {
					parts.push('<span class="dshCc_tokSel dshCc_clickable" data-rule="' + ruleIndex + '">'
						+ escapeHtml(buffer) + '</span>');
				}
				buffer = '';
			};
			for (let index = 0; index < css.length; index += 1) {
				const ch = css[index];
				if (ch === '/' && css[index + 1] === '*') {
					flush(index);
					const end = css.indexOf('*/', index + 2);
					const stop = end < 0 ? css.length : end + 2;
					parts.push('<span class="dshCc_tokComment">' + escapeHtml(css.slice(index, stop)) + '</span>');
					index = stop - 1;
					continue;
				}
				if (ch === '{' || ch === '}' || ch === ':' || ch === ';') {
					flush(index);
					parts.push('<span class="dshCc_tokPunc">' + ch + '</span>');
					if (ch === '{') state = 'body';
					else if (ch === '}') state = 'sel';
					else if (ch === ':') state = 'val';
					else state = 'body';
					continue;
				}
				buffer += ch;
			}
			flush(css.length);
			// A trailing newline keeps the final line visible inside <pre>.
			return parts.join('') + '\n';
		}

		/**
		 * Check one sheet and describe what is wrong with it, mirroring how the
		 * DevTools Styles pane strikes through a declaration it refused: braces and
		 * comments must balance, every declaration must parse, and every value must
		 * be one the engine accepts.
		 *
		 * Descriptor blocks are judged by their own rules: `@property --x { syntax:
		 * '<color>' }` holds descriptors, not declarations, and CSS.supports()
		 * rejects all of them — asking it anyway reported a valid block as three
		 * broken declarations.
		 * @param css - the sheet text.
		 * @returns up to five `{ line, message }` issues; empty when clean.
		 */
		function validateCss(css) {
			const issues = [];
			let depth = 0;
			let line = 1;
			let startLine = 1;
			let buffer = '';
			// Each open block is either a declaration block or a descriptor block.
			// A stack is needed because an at-rule can sit inside @media. At-rules
			// whose contents the engine will judge on its own (or that carry
			// descriptors we cannot check here) are marked 'descriptor' and left
			// alone; @property gets the checks it actually has rules for.
			const blockKinds = [];
			const descriptorAtRules = /^@(font-face|font-palette-values|counter-style|page|viewport|font-feature-values)\b/i;
			/**
			 * Judge one @property descriptor.
			 * @param name - descriptor name.
			 * @param value - candidate value.
			 * @returns an issue message, or null when the value is fine.
			 */
			const propertyDescriptorIssue = (name, value) => {
				if (name === 'syntax') {
					return /^(['"])[^'"]*\1$/.test(value)
						? null
						: 'syntax 必须是带引号的字符串，例如 \'<color>\'';
				}
				if (name === 'inherits') {
					return value === 'true' || value === 'false' ? null : 'inherits 只能是 true 或 false';
				}
				// initial-value and friends depend on the syntax string, which
				// CSS.supports() cannot judge — leave them to the engine.
				return null;
			};
			const flush = (declaration) => {
				const text = buffer.trim();
				buffer = '';
				if (!declaration || text === '') return;
				const match = /^([-\w]+)\s*:\s*([\s\S]+?)\s*;?$/.exec(text);
				if (match === null) {
					issues.push({ line: startLine, message: '无法解析的声明：' + text.slice(0, 24) });
					return;
				}
				// `!important` is a flag, not part of the value: handing it to the
				// engine as one rejects every declaration that carries it.
				const value = match[2].replace(/!\s*important\s*$/i, '').trim();
				const kind = blockKinds[blockKinds.length - 1];
				if (kind === 'property') {
					const problem = propertyDescriptorIssue(match[1], value);
					if (problem !== null) issues.push({ line: startLine, message: problem });
					return;
				}
				if (kind === 'descriptor') return;
				if (!supported(match[1], value)) {
					issues.push({ line: startLine, message: match[1] + ' 的值无效：' + value.slice(0, 24) });
				}
			};
			for (let index = 0; index < css.length; index += 1) {
				const ch = css[index];
				if (ch === '\n') line += 1;
				if (ch === '/' && css[index + 1] === '*') {
					flush(depth > 0);
					const end = css.indexOf('*/', index + 2);
					if (end < 0) {
						issues.push({ line, message: '注释未闭合' });
						return issues.slice(0, 5);
					}
					line += css.slice(index, end + 2).split('\n').length - 1;
					index = end + 1;
					continue;
				}
				if (ch === '{') {
					// The prelude is still in the buffer; capture it before flushing,
					// because it decides how the block's contents are judged.
					const prelude = buffer.trim();
					flush(false);
					depth += 1;
					blockKinds.push(/^@property\b/i.test(prelude)
						? 'property'
						: (descriptorAtRules.test(prelude) ? 'descriptor' : 'rule'));
					startLine = line;
					continue;
				}
				if (ch === '}') {
					flush(depth > 0);
					depth -= 1;
					if (blockKinds.length > 0) blockKinds.pop();
					if (depth < 0) {
						issues.push({ line, message: '多余的 }' });
						depth = 0;
					}
					startLine = line;
					continue;
				}
				if (ch === ';' && depth > 0) {
					flush(true);
					startLine = line;
					continue;
				}
				if (buffer === '') startLine = line;
				buffer += ch;
			}
			flush(depth > 0);
			if (depth > 0) issues.push({ line, message: '缺少 ' + depth + ' 个 }' });
			return issues.slice(0, 5);
		}

		/**
		 * Locate every top-level style rule: its selector text, the offsets of the
		 * selector, and the offsets of the block interior. At-rules (`@media`, …)
		 * are skipped — they are not something the row can rename or fill in.
		 * @param css - the sheet text.
		 * @returns one record per rule, in source order.
		 */
		function parseRules(css) {
			const rules = [];
			let index = 0;
			let depth = 0;
			let sectionStart = 0;
			while (index < css.length) {
				const ch = css[index];
				if (ch === '/' && css[index + 1] === '*') {
					const end = css.indexOf('*/', index + 2);
					index = end < 0 ? css.length : end + 2;
					continue;
				}
				if (ch === '{') {
					const raw = css.slice(sectionStart, index);
					// A comment may sit in front of the selector; the offsets have to
					// point at the selector itself, or a rename would swallow it.
					const commentEnd = raw.lastIndexOf('*/');
					const content = commentEnd < 0 ? 0 : commentEnd + 2;
					const tail = raw.slice(content);
					const selector = tail.trim();
					if (depth === 0 && selector !== '' && !selector.startsWith('@')) {
						let scan = index + 1;
						let inner = 1;
						while (scan < css.length && inner > 0) {
							if (css[scan] === '{') inner += 1;
							else if (css[scan] === '}') inner -= 1;
							scan += 1;
						}
						rules.push({
							selector,
							selectorStart: sectionStart + content + (tail.length - tail.trimStart().length),
							selectorEnd: sectionStart + content + tail.trimEnd().length,
							bodyStart: index + 1,
							bodyEnd: Math.max(index + 1, scan - 1),
						});
					}
					depth += 1;
					index += 1;
					sectionStart = index;
					continue;
				}
				if (ch === '}') {
					depth = Math.max(0, depth - 1);
					index += 1;
					sectionStart = index;
					continue;
				}
				index += 1;
			}
			return rules;
		}

		/**
		 * Declaration sets the rule panel can drop into the selected block. These
		 * are starting points, not a design system: each one is a shape people
		 * reach for constantly, left deliberately plain so the sheet stays readable.
		 */
		const DECL_TEMPLATES = [
			{ id: 'container', label: '容器', hint: '纵向堆叠', css: 'display: flex;\nflex-direction: column;\ngap: 8px;' },
			{ id: 'row', label: '横向排列', hint: '一行排开', css: 'display: flex;\nalign-items: center;\ngap: 8px;' },
			{ id: 'center', label: '居中', hint: '水平 + 垂直', css: 'display: flex;\nalign-items: center;\njustify-content: center;' },
			{ id: 'grid', label: '网格', hint: '等宽两列', css: 'display: grid;\ngrid-template-columns: repeat(2, minmax(0, 1fr));\ngap: 8px;' },
			{ id: 'text', label: '文本', hint: '字号 / 行高', css: 'font-size: 14px;\nline-height: 22px;' },
			{ id: 'background', label: '背景', hint: '底色 + 圆角', css: 'background: transparent;\nborder-radius: 8px;' },
			{ id: 'border', label: '描边', hint: '细线 + 圆角', css: 'border: 1px solid currentColor;\nborder-radius: 8px;' },
			{ id: 'shadow', label: '阴影', hint: '轻微浮起', css: 'box-shadow: 0 2px 8px rgb(0 0 0 / 12%);' },
			{ id: 'size', label: '尺寸', hint: '宽高', css: 'width: 100%;\nheight: auto;' },
			{ id: 'spacing', label: '间距', hint: '内外边距', css: 'margin: 0;\npadding: 8px 12px;' },
			{ id: 'truncate', label: '截断', hint: '单行省略号', css: 'overflow: hidden;\ntext-overflow: ellipsis;\nwhite-space: nowrap;' },
			{ id: 'scroll', label: '滚动', hint: '纵向 + 限高', css: 'overflow-y: auto;\nmax-height: 240px;' },
			{ id: 'sticky', label: '吸顶', hint: '粘在顶部', css: 'position: sticky;\ntop: 0;\nz-index: 10;' },
			{ id: 'hide', label: '隐藏', hint: '不占布局', css: 'display: none;' },
		];

		/**
		 * The rule panel's property list, in Chinese first and CSS second. Only
		 * enum-shaped properties belong here — a length, colour or shadow needs a
		 * field, not a menu, and those stay in the sheet (or in a template).
		 */
		const PROPERTY_UI = [
			{ name: 'display', label: '显示', values: [['flex', '主轴方向'], ['grid', '网格'], ['block', '块级'], ['inline-block', '行内块'], ['inline', '行内'], ['none', '隐藏']] },
			{ name: 'flex-direction', label: '主轴方向', values: [['row', '水平排列'], ['column', '垂直排列'], ['row-reverse', '水平反向'], ['column-reverse', '垂直反向']] },
			{ name: 'flex-wrap', label: '换行方式', values: [['nowrap', '不换行'], ['wrap', '允许换行'], ['wrap-reverse', '反向换行']] },
			{ name: 'justify-content', label: '主轴对齐', values: [['flex-start', '靠起始边'], ['center', '居中'], ['flex-end', '靠结束边'], ['space-between', '两端对齐'], ['space-around', '环绕'], ['space-evenly', '均分']] },
			{ name: 'align-items', label: '交叉轴对齐', values: [['stretch', '拉伸'], ['flex-start', '靠起始边'], ['center', '居中'], ['flex-end', '靠结束边'], ['baseline', '基线']] },
			{ name: 'align-content', label: '多行对齐', values: [['stretch', '拉伸'], ['flex-start', '靠起始边'], ['center', '居中'], ['flex-end', '靠结束边'], ['space-between', '两端对齐'], ['space-around', '环绕']] },
			{ name: 'position', label: '定位', values: [['static', '常规'], ['relative', '相对'], ['absolute', '绝对'], ['fixed', '固定'], ['sticky', '吸顶']] },
			{ name: 'overflow', label: '溢出', values: [['visible', '可见'], ['hidden', '裁剪'], ['auto', '按需滚动'], ['scroll', '总是滚动']] },
			{ name: 'box-sizing', label: '盒模型', values: [['border-box', '含边框'], ['content-box', '不含边框']] },
			{ name: 'text-align', label: '文本对齐', values: [['left', '左'], ['center', '居中'], ['right', '右'], ['justify', '两端']] },
			{ name: 'white-space', label: '空白处理', values: [['normal', '正常'], ['nowrap', '不换行'], ['pre', '保留'], ['pre-wrap', '保留并换行']] },
			{ name: 'pointer-events', label: '鼠标事件', values: [['auto', '正常'], ['none', '穿透']] },
			{ name: 'cursor', label: '光标', values: [['default', '默认'], ['pointer', '手型'], ['text', '文本'], ['not-allowed', '禁止'], ['grab', '抓取']] },
			{ name: 'visibility', label: '可见性', values: [['visible', '可见'], ['hidden', '隐藏']] },
		];

		/**
		 * Read one rule's declarations into a property → value map.
		 * @param css - the sheet text.
		 * @param rule - a record from `parseRules`.
		 * @returns the values keyed by lower-cased property name.
		 */
		function readDeclarations(css, rule) {
			const found = new Map();
			const body = css.slice(rule.bodyStart, rule.bodyEnd).replace(/\/\*[\s\S]*?\*\//g, ' ');
			for (const piece of body.split(';')) {
				const match = /^\s*([-\w]+)\s*:\s*([\s\S]+?)\s*$/.exec(piece);
				if (match !== null) found.set(match[1].toLowerCase(), match[2]);
			}
			return found;
		}

		/**
		 * Restore declaration boundaries in a block interior.
		 *
		 * A missing `;` before a newline merges two declarations into one chunk, so
		 * every later write misses the existing entry and appends a duplicate. Sheets
		 * written by an earlier build (and any hand-written sheet) can carry that, so
		 * both the writer and the template inserter normalise first.
		 * @param body - raw block interior.
		 * @returns the interior with the boundary restored.
		 */
		function normaliseBlock(body) {
			return body.replace(/([^\s;{}])\s*\n(\s*[-\w]+\s*:)/g, '$1;\n$2');
		}

		/**
		 * Set, replace, or remove one declaration inside a rule.
		 * @param css - the sheet text.
		 * @param rule - the target rule.
		 * @param name - kebab-case property name.
		 * @param value - the new value; an empty string removes the declaration.
		 * @returns the updated sheet text.
		 */
		function writeDeclaration(css, rule, name, value) {
			const body = normaliseBlock(css.slice(rule.bodyStart, rule.bodyEnd));
			const lower = name.toLowerCase();
			// Walk the block declaration by declaration instead of rewriting it with a
			// regex: a sheet may separate declarations with newlines, may omit the last
			// semicolon, and may already carry duplicates. A pattern that assumes
			// `;`-delimited text silently appends a second copy instead of replacing.
			const chunks = [];
			let cursor = 0;
			while (cursor < body.length) {
				const semi = body.indexOf(';', cursor);
				const stop = semi < 0 ? body.length : semi;
				const chunk = body.slice(cursor, stop);
				const match = /^\s*([-\w]+)\s*:/.exec(chunk);
				chunks.push({
					start: cursor,
					chunk,
					terminator: semi < 0 ? '' : ';',
					target: match !== null && match[1].toLowerCase() === lower,
				});
				cursor = semi < 0 ? body.length : semi + 1;
			}

			const matching = chunks.filter(entry => entry.target);
			if (matching.length === 1 && value !== '') {
				// The common case: rewrite the value where it already sits.
				const only = matching[0];
				const head = /^(\s*[-\w]+\s*:\s*)/.exec(only.chunk)[1];
				return css.slice(0, rule.bodyStart + only.start) + head + value
					+ css.slice(rule.bodyStart + only.start + only.chunk.length);
			}

			// Otherwise edit for real: drop every copy, then append one when there is
			// a value. This also cleans up duplicates an older build left behind.
			const kept = chunks
				.filter(entry => !entry.target)
				.map(entry => entry.chunk + entry.terminator)
				.join('')
				.trim();
			// A trailing declaration without `;` would swallow whatever we append, so
			// close it first — that stray semicolon is what made the next write miss.
			const closed = kept === '' || kept.endsWith(';') ? kept : kept + ';';
			const added = value === ''
				? (kept === '' ? '' : '\n' + kept + '\n')
				: ((closed === '' ? '\n' : ('\n' + closed + '\n')) + '  ' + name + ': ' + value + ';\n');
			return css.slice(0, rule.bodyStart) + added + css.slice(rule.bodyEnd);
		}

		/**
		 * The shipped chevron glyph, transcribed from DSH's own pickers so the
		 * control matches the rows around it without depending on the icon module.
		 * @returns the 14px chevron.
		 */
		function ChevronDown() {
			return React.createElement(
				'svg',
				{ width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', className: 'dshCc_chevron' },
				React.createElement('path', {
					d: 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z',
					fill: 'currentColor',
				}),
			);
		}

		/**
		 * Tick rendered on the active menu entry.
		 * @returns the 14px check mark.
		 */
		function CheckMark() {
			return React.createElement(
				'svg',
				{ width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', className: 'dshCc_menuCheck' },
				React.createElement('path', {
					d: 'M3.4 7.4L5.9 9.9L10.6 4.6',
					stroke: 'currentColor',
					strokeWidth: 1.4,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
				}),
			);
		}

		/**
		 * The `#` sheet glyph shown in the file bar, drawn on the shipped 14px grid.
		 * @returns the icon element.
		 */
		function CssIcon() {
			return React.createElement(
				'svg',
				{ width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', className: 'dshCc_codeIcon', 'aria-hidden': true },
				React.createElement('path', {
					d: 'M6.4 1.9 5.9 5H3v1.4h2.7l-.5 3.2H2.8v1.4h2.1l-.5 3.1 1.4.2.5-3.3h2.9l-.5 3.1 1.4.2.5-3.3h2.6V9.6h-2.4l.5-3.2h2.4V5h-2.2l.5-3.1-1.4-.2-.5 3.3H7.4l.5-3.1-1.5-.2Zm.2 4.5h2.9l-.5 3.2H6.1l.5-3.2Z',
					fill: 'currentColor',
				}),
			);
		}
		/**
		 * Load the Host-side sheet list and activate a stylesheet, creating a
		 * default sheet (seeded from the previous version's browser storage) the
		 * first time the plugin runs. Any transport failure degrades to the
		 * browser-local sheet rather than leaving the page unstyled.
		 */
		async function bootstrap() {
			try {
				let listing = await api('/list');
				let files = listing.files;
				let active = listing.active;
				// The switch set lives on the Host; a Host half that predates the route
				// answers without the field, so the browser copy covers that gap.
				const disabled = Array.isArray(listing.disabled) ? listing.disabled : readLocalDisabled();

				if (files.length === 0) {
					const created = await post('/create', { name: DEFAULT_NAME, css: legacyCss() });
					active = created.name;
					listing = await api('/list');
					files = listing.files;
				}
				else if (active === null || !files.some(file => file.name === active)) {
					active = files[0].name;
					await post('/active', { name: active });
				}

				const sheet = await api('/read?name=' + encodeURIComponent(active));
				store.set({ files, active, css: sheet.css, disabled, mode: 'files', error: '' });
				applySheet(active, sheet.css, disabled);
			}
			catch (error) {
				const css = legacyCss();
				store.set({
					mode: 'unavailable',
					css,
					error: '宿主文件接口不可用，样式暂存在浏览器：' + (error?.message ?? error),
				});
				applyUserCss(css);
			}
		}

		/**
		 * The custom-CSS preference row: title, sheet picker, open-file and reset
		 * actions, an inline "new sheet" input, the editor, and a status footer.
		 * @returns the row element tree.
		 */
		function CustomCssRow() {
			const state = React.useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
			const [creating, setCreating] = React.useState(false);
			const [draftName, setDraftName] = React.useState('');
			const [saved, setSaved] = React.useState(true);
			const [pickerOpen, setPickerOpen] = React.useState(false);
			const [suggest, setSuggest] = React.useState(null);
			const [openSelector, setOpenSelector] = React.useState(null);
			const fileInput = React.useRef(null);
			const pickerRef = React.useRef(null);
			const editorRef = React.useRef(null);
			const gutterRef = React.useRef(null);
			const gutterInnerRef = React.useRef(null);
			const highlightRef = React.useRef(null);
			const pendingSave = React.useRef(null);
			const pendingCaret = React.useRef(null);
			const saveTimer = React.useRef(0);
			const fileMode = state.mode === 'files';
			const lineCount = state.css.split('\n').length;
			const activeEnabled = state.active === null ? true : !state.disabled.includes(state.active);

			/**
			 * Switch the active sheet on or off. Its text is untouched: only its
			 * contribution to the page changes. The Host is the source of truth, but an
			 * older Host half must not make the switch dead, so this browser keeps its
			 * own copy as well.
			 * @param next - the desired state.
			 */
			const setActiveEnabled = async (next) => {
				const name = state.active;
				if (name === null) return;
				const disabled = next
					? state.disabled.filter(entry => entry !== name)
					: [...new Set([...state.disabled, name])];
				store.set({ disabled, error: '' });
				applySheet(name, state.css, disabled);
				try {
					await post('/toggle', { name, enabled: next });
				}
				catch (error) {
					const message = String(error?.message ?? error);
					// `not-found` = the Host half predates this route (a dsh restart is
					// pending): an expected state, not a failure worth reporting.
					if (!message.includes('not-found')) {
						store.set({ error: '开关状态未能写入宿主：' + message });
					}
				}
				writeLocalDisabled(disabled);
			};

			// Dismiss the menu on an outside press, the way the shipped pickers do.
			React.useEffect(() => {
				if (!pickerOpen) return undefined;
				const onPointerDown = (event) => {
					if (pickerRef.current?.contains(event.target)) return;
					setPickerOpen(false);
				};
				document.addEventListener('mousedown', onPointerDown);
				return () => {
					document.removeEventListener('mousedown', onPointerDown);
				};
			}, [pickerOpen]);

			/**
			 * Flush the pending write-through immediately, to the sheet it was
			 * captured for. Every path that changes the active sheet goes through
			 * this, so a debounced save can never land under the next sheet's name.
			 */
			const flushSave = async () => {
				const pending = pendingSave.current;
				if (pending === null) return;
				pendingSave.current = null;
				clearTimeout(saveTimer.current);
				try {
					await post('/write', { name: pending.name, css: pending.css });
					store.set({ error: '' });
				}
				catch (error) {
					store.set({ error: '保存失败：' + (error?.message ?? error) });
				}
			};

			// Persist after a pause. The unmount path flushes rather than dropping the
			// pending write: closing the settings panel must not lose an edit.
			React.useEffect(() => () => {
				clearTimeout(saveTimer.current);
				void flushSave();
			}, []);

			const persist = (css) => {
				const current = store.snapshot();
				if (current.mode !== 'files' || current.active === null) {
					clearTimeout(saveTimer.current);
					writeLegacyCss(css);
					setSaved(true);
					return;
				}
				// The target sheet is captured together with the text: the debounce
				// can outlive a sheet switch, and the text belongs where it was typed.
				pendingSave.current = { name: current.active, css };
				clearTimeout(saveTimer.current);
				setSaved(false);
				saveTimer.current = setTimeout(() => {
					void flushSave().then(() => {
						setSaved(true);
					});
				}, WRITE_DELAY_MS);
			};

			const onEdit = (css) => {
				store.set({ css });
				applySheet(state.active, css, state.disabled);
				persist(css);
			};

			/**
			 * Refresh the completion list for the caret's new position, anchoring it
			 * to the line the caret sits on inside the editor shell.
			 * @param value - current editor text.
			 * @param caret - caret offset.
			 */
			const refreshSuggest = (value, caret) => {
				const found = completionsFor(value, caret);
				if (found === null) {
					setSuggest(null);
					return;
				}
				const lineIndex = value.slice(0, caret).split('\n').length - 1;
				const scrollTop = editorRef.current?.scrollTop ?? 0;
				// Anchor under the caret's line, but flip above it when the list would
				// fall out of the editor's clipped box, and start after the gutter —
				// whose width depends on how many digits the line count has.
				const height = found.items.length * 26 + 8;
				const viewHeight = editorRef.current?.clientHeight ?? 140;
				let top = (lineIndex + 1) * LINE_HEIGHT + 10 - scrollTop;
				if (top + height > viewHeight) top = Math.max(2, top - LINE_HEIGHT - height);
				const left = (gutterRef.current?.offsetWidth ?? 34) + 12;
				setSuggest({ ...found, index: 0, top, left });
			};

			/**
			 * Type into the sheet. Completions answer literal typing only: deleting,
			 * pasting, or moving the caret must not pop a menu under the cursor.
			 * @param event - the textarea change event.
			 */
			const onType = (event) => {
				const value = event.target.value;
				const previous = store.snapshot().css;
				onEdit(value);
				const inputType = event.nativeEvent?.inputType;
				const typed = inputType === undefined
					// No input type available (older engines, synthetic events): fall
					// back to "the text grew", which typing always does.
					? value.length > previous.length
					: (inputType === 'insertText' || inputType === 'insertCompositionText');
				if (!typed) {
					setSuggest(null);
					return;
				}
				refreshSuggest(value, event.target.selectionStart);
			};

			/** Replace the caret's word with one completion, keeping the caret after it. */
			const acceptSuggest = (item) => {
				const current = store.snapshot().css;
				const caret = editorRef.current?.selectionStart ?? current.length;
				const word = suggest?.word ?? '';
				const next = current.slice(0, caret - word.length) + item + current.slice(caret);
				pendingCaret.current = caret - word.length + item.length;
				onEdit(next);
				setSuggest(null);
			};

			/** Arrow / Enter / Tab / Escape handling while the list is open. */
			const onEditorKeyDown = (event) => {
				if (suggest === null) return;
				if (event.key === 'ArrowDown') {
					event.preventDefault();
					setSuggest({ ...suggest, index: (suggest.index + 1) % suggest.items.length });
					return;
				}
				if (event.key === 'ArrowUp') {
					event.preventDefault();
					setSuggest({ ...suggest, index: (suggest.index + suggest.items.length - 1) % suggest.items.length });
					return;
				}
				if (event.key === 'Enter' || event.key === 'Tab') {
					event.preventDefault();
					acceptSuggest(suggest.items[suggest.index]);
					return;
				}
				if (event.key === 'Escape') {
					event.preventDefault();
					setSuggest(null);
				}
			};

			// Restore the caret after a completion replaced the word under it.
			React.useEffect(() => {
				if (pendingCaret.current === null) return;
				const editor = editorRef.current;
				if (editor !== null) {
					editor.focus();
					editor.setSelectionRange(pendingCaret.current, pendingCaret.current);
				}
				pendingCaret.current = null;
			});

			/** Activate a sheet from the picker, or open the new-sheet input. */
			const onPick = async (value) => {
				if (value === NEW_OPTION) {
					setCreating(true);
					setDraftName('');
					return;
				}
				await flushSave();
				try {
					await post('/active', { name: value });
					const sheet = await api('/read?name=' + encodeURIComponent(value));
					store.set({ active: value, css: sheet.css, error: '' });
					applySheet(value, sheet.css, store.snapshot().disabled);
					setSaved(true);
				}
				catch (error) {
					store.set({ error: '切换失败：' + (error?.message ?? error) });
				}
			};

			/** Create the sheet named in the inline input and switch to it. */
			const onCreate = async () => {
				const name = normalizeName(draftName);
				await flushSave();
				try {
					await post('/create', { name });
				}
				catch (error) {
					const message = String(error?.message ?? error);
					store.set({ error: message === 'exists' ? ('已存在：' + name) : ('创建失败：' + message) });
					return;
				}
				try {
					const listing = await api('/list');
					store.set({ files: listing.files, active: name, css: '', error: '' });
					applySheet(name, '', store.snapshot().disabled);
					setSaved(true);
					setCreating(false);
					setDraftName('');
				}
				catch (error) {
					store.set({ error: '刷新失败：' + (error?.message ?? error) });
				}
			};

			/**
			 * Hand the active sheet to the OS default application — an editor,
			 * usually — so it can be edited in a real tool.
			 */
			const onOpen = async () => {
				const current = store.snapshot();
				if (current.active === null) return;
				// The editor may hold text the debounce has not written yet; the file
				// that opens should be what is on screen.
				await flushSave();
				try {
					await post('/open', { name: current.active });
					store.set({ error: '' });
				}
				catch (error) {
					// A 404 means this Host half predates the endpoint: the page was
					// reloaded but the DSH process itself was not restarted.
					const message = String(error?.message ?? error);
					store.set({
						error: message === 'not-found'
							? '宿主侧还没有这个接口，重启 dsh 后再试'
							: ('打开失败：' + message),
					});
				}
			};

			/**
			 * Save the active sheet to a file. Prefers the File System Access
			 * picker so the destination is explicit, and falls back to a plain
			 * download when the picker is missing or refused.
			 */
			const onExport = async () => {
				const current = store.snapshot();
				if (current.active === null) return;
				const blob = new Blob([current.css], { type: 'text/css' });
				if (typeof globalThis.showSaveFilePicker === 'function') {
					try {
						const handle = await globalThis.showSaveFilePicker({
							suggestedName: current.active,
							types: [{ description: 'CSS', accept: { 'text/css': ['.css'] } }],
						});
						const writable = await handle.createWritable();
						await writable.write(blob);
						await writable.close();
						store.set({ error: '' });
						return;
					}
					catch (error) {
						// A cancelled picker is a normal outcome, not a failure.
						if (error?.name === 'AbortError') return;
					}
				}
				const url = URL.createObjectURL(blob);
				const anchor = document.createElement('a');
				anchor.href = url;
				anchor.download = current.active;
				document.body.appendChild(anchor);
				anchor.click();
				anchor.remove();
				URL.revokeObjectURL(url);
				store.set({ error: '' });
			};

			/** Import a picked .css file as a new Host-side sheet. */			const onFilePicked = async (event) => {
				const file = event.target.files?.[0];
				event.target.value = '';
				if (file === undefined) return;
				await flushSave();
				try {
					const css = await file.text();
					const listing = await api('/list');
					const name = uniqueName(normalizeName(file.name), listing.files.map(entry => entry.name));
					await post('/import', { name, css });
					const after = await api('/list');
					store.set({ files: after.files, active: name, css, error: '' });
					applySheet(name, css, store.snapshot().disabled);
					setSaved(true);
				}
				catch (error) {
					store.set({ error: '打开失败：' + (error?.message ?? error) });
				}
			};

			// Parsed rules drive both the click targets in the colour layer and the
			// panel. The open panel is tracked by selector text rather than by index,
			// so an edit above it does not silently re-point it at another rule.
			const rules = parseRules(state.css);
			const openRule = openSelector === null
				? null
				: (rules.find(rule => rule.selector === openSelector) ?? null);
			const declarations = openRule === null ? null : readDeclarations(state.css, openRule);

			/** Set, or clear, one declaration on the open rule. */
			const setProperty = (name, value) => {
				if (openRule === null) return;
				onEdit(writeDeclaration(state.css, openRule, name, value));
			};

			/** Open the panel on one rule index. */
			const openRuleAt = (index) => {
				const rule = rules[index];
				if (rule === undefined) return;
				setOpenSelector(rule.selector);
			};

			/** Rename the open rule's selector in place. */
			const renameRule = (value) => {
				if (openRule === null) return;
				setOpenSelector(value);
				onEdit(state.css.slice(0, openRule.selectorStart) + value
					+ state.css.slice(openRule.selectorEnd));
			};

			/** Append one template's declarations inside the open rule's block. */
			const insertTemplate = (template) => {
				if (openRule === null) return;
				const block = template.css.split('\n').map(line => '  ' + line).join('\n');
				const kept = normaliseBlock(state.css.slice(openRule.bodyStart, openRule.bodyEnd)).trim();
				// A kept declaration without its closing `;` would swallow the first
				// template line, so close it before appending.
				const closed = kept === '' || kept.endsWith(';') ? kept : kept + ';';
				const body = (closed === '' ? '\n' : ('\n' + closed + '\n')) + block + '\n';
				onEdit(state.css.slice(0, openRule.bodyStart) + body + state.css.slice(openRule.bodyEnd));
			};

			// Validate on every render: the scan is a single linear pass and the
			// sheets involved are a few kilobytes at most.
			const issues = validateCss(state.css);
			const problem = state.error !== ''
				? state.error
				: (issues.length === 0
					? null
					: ('第 ' + issues[0].line + ' 行 ' + issues[0].message
						+ (issues.length > 1 ? ' 等 ' + issues.length + ' 处' : '')));

			const statusText = () => {
				if (state.mode === 'loading') return '正在读取…';
				const suffix = state.css.trim() === ''
					? '未设置'
					: (state.css.split('\n').length + ' 行 · ' + state.css.length + ' 字符');
				const off = activeEnabled ? '' : ' · 已关闭';
				if (!fileMode) return suffix + ' · 浏览器存储';
				return (saved ? '已保存 · ' : '保存中 · ') + suffix + off;
			};

			return React.createElement(
				'div',
				{ className: 'dshCc_row' },
				React.createElement(
					'div',
					{ className: 'dshCc_head' },
					React.createElement('div', { className: 'dshCc_title' }, '自定义 CSS'),
					React.createElement(
						'div',
						{ className: 'dshCc_actions' },
						fileMode
							? React.createElement(
								'div',
								{ className: 'dshCc_picker', ref: pickerRef },
								React.createElement(
									'button',
									{
										type: 'button',
										className: 'dshCc_trigger',
										'aria-haspopup': 'menu',
										'aria-expanded': pickerOpen,
										disabled: state.mode === 'loading',
										onClick: () => {
											setPickerOpen(!pickerOpen);
										},
									},
									React.createElement(
										'span',
										{ className: 'dshCc_triggerLabel' },
										state.active ?? '（无文件）',
									),
									React.createElement(ChevronDown, {}),
								),
								pickerOpen
									? React.createElement(
										'div',
										{ className: 'dshCc_menu', role: 'menu' },
										...state.files.map(file => React.createElement(
											'button',
											{
												key: file.name,
												type: 'button',
												role: 'menuitemradio',
												'aria-checked': file.name === state.active,
												className: 'dshCc_menuItem',
												onClick: () => {
													setPickerOpen(false);
													void onPick(file.name);
												},
											},
											React.createElement('span', { className: 'dshCc_menuLabel' }, file.name),
											file.name === state.active ? React.createElement(CheckMark, {}) : null,
										)),
										React.createElement(
											'button',
											{
												type: 'button',
												className: 'dshCc_menuItem',
												onClick: () => {
													setPickerOpen(false);
													void onPick(NEW_OPTION);
												},
											},
											React.createElement('span', { className: 'dshCc_menuLabel' }, '＋ 新建…'),
										),
									)
									: null,
							)
							: null,
						fileMode
							? React.createElement(
								'button',
								{
									type: 'button',
									className: 'dshCc_btn',
									disabled: state.active === null,
									title: '用系统默认程序打开当前文件',
									onClick: () => {
										void onOpen();
									},
								},
								'打开文件',
							)
							: null,
						fileMode
							? React.createElement(
								'button',
								{
									type: 'button',
									className: 'dshCc_btn',
									title: '从磁盘选取一个 .css 导入为新的样式表',
									onClick: () => {
										fileInput.current?.click();
									},
								},
								'导入',
							)
							: null,
						fileMode
							? React.createElement(
								'button',
								{
									type: 'button',
									className: 'dshCc_btn',
									disabled: state.active === null,
									title: '把当前样式表另存为文件',
									onClick: () => {
										void onExport();
									},
								},
								'导出',
							)
							: null,
						React.createElement(
							'button',
							{
								type: 'button',
								className: 'dshCc_btn dshCc_danger',
								disabled: state.css === '',
								title: '清空当前样式表的内容',
								onClick: () => {
									onEdit('');
								},
							},
							'重置',
						),
					),
				),
				creating
					? React.createElement(
						'div',
						{ className: 'dshCc_newRow' },
						React.createElement('input', {
							className: 'dshCc_input',
							'aria-label': '新建 CSS 文件名',
							placeholder: '新文件名，例如 dark-tweak.css',
							value: draftName,
							autoFocus: true,
							onChange: (event) => {
								setDraftName(event.target.value);
							},
							onKeyDown: (event) => {
								if (event.key === 'Enter') void onCreate();
								if (event.key === 'Escape') setCreating(false);
							},
						}),
						React.createElement(
							'button',
							{ type: 'button', className: 'dshCc_btn', onClick: () => { void onCreate(); } },
							'创建',
						),
						React.createElement(
							'button',
							{ type: 'button', className: 'dshCc_btn', onClick: () => { setCreating(false); } },
							'取消',
						),
					)
					: null,
				React.createElement(
					'p',
					{ className: 'dshCc_desc' },
					fileMode
						? '样式表保存在宿主目录 ~/.dsh/custom-css/；「打开文件」用系统默认程序编辑它，导入 / 导出用于与其它文件互通。'
						: '追加到界面上的样式表；需要压过已有样式时可用 !important。',
				),
				React.createElement(
					'div',
					{ className: 'dshCc_shell' },
					React.createElement(
						'div',
						{ className: 'dshCc_fileBar' },
						React.createElement(
							'div',
							{ className: 'dshCc_fileIdentity' },
							React.createElement(CssIcon, {}),
							React.createElement(
								'span',
								{ className: 'dshCc_fileName', title: state.active ?? '' },
								state.active ?? '（无文件）',
							),
							React.createElement('span', { className: 'dshCc_languageBadge' }, 'CSS'),
						),
						React.createElement(
							'div',
							{ className: 'dshCc_fileBarRight' },
							React.createElement('span', {
								className: 'dshCc_statusDot',
								'data-state': activeEnabled ? 'on' : 'off',
								'aria-hidden': true,
							}),
							React.createElement(
								'button',
								{
									type: 'button',
									role: 'switch',
									'aria-checked': activeEnabled,
									'aria-label': '启用这张样式表',
									className: 'dshCc_switch' + (activeEnabled ? ' dshCc_switchOn' : ''),
									disabled: state.active === null,
									title: activeEnabled
										? '点一下临时关闭这张样式表（文件内容不动）'
										: '点一下重新启用这张样式表',
									onClick: () => {
										void setActiveEnabled(!activeEnabled);
									},
								},
								React.createElement(
									'span',
									{ className: 'dshCc_switchTrack', 'aria-hidden': true },
									React.createElement('span', { className: 'dshCc_switchThumb' }),
								),
								React.createElement('span', { className: 'dshCc_switchLabel' }, activeEnabled ? '已启用' : '已关闭'),
							),
						),
					),
					React.createElement(
						'div',
						{ className: 'dshCc_main' },
						React.createElement(
							'div',
							{ className: 'dshCc_editorWrap' },
						React.createElement(
							'div',
							{ className: 'dshCc_gutter', ref: gutterRef, 'aria-hidden': true },
							React.createElement(
								'div',
								{ className: 'dshCc_gutterInner', ref: gutterInnerRef },
								...Array.from({ length: lineCount }, (_, index) => React.createElement(
									'div',
									{ key: index, className: 'dshCc_gutterLine' },
									String(index + 1),
								)),
							),
						),
						React.createElement(
							'div',
							{ className: 'dshCc_code' },
							React.createElement('pre', {
								ref: highlightRef,
								className: 'dshCc_highlight',
								'aria-hidden': true,
								// Already escaped token by token inside highlightCss; the
								// sheet text never reaches the DOM as markup.
								dangerouslySetInnerHTML: { __html: highlightCss(state.css, rules) },
								// Rule selectors carry pointer-events, so their click lands
								// here instead of on the textarea underneath.
								onClick: (event) => {
									const attribute = event.target.getAttribute?.('data-rule');
									if (attribute === null || attribute === undefined) return;
									openRuleAt(Number(attribute));
								},
							}),
							React.createElement('textarea', {
								ref: editorRef,
								className: 'dshCc_editor',
								'aria-label': '自定义 CSS',
								spellCheck: false,
								placeholder: '例如：\n.dsh-chat-bubble { border-radius: 12px; }',
								value: state.css,
								onChange: onType,
								onKeyDown: onEditorKeyDown,
								onScroll: (event) => {
									const target = event.target;
									if (gutterInnerRef.current !== null) {
										gutterInnerRef.current.style.transform = 'translateY(' + (-target.scrollTop) + 'px)';
									}
									if (highlightRef.current !== null) {
										highlightRef.current.style.transform = 'translate('
											+ (-target.scrollLeft) + 'px,' + (-target.scrollTop) + 'px)';
									}
									// The completion list is anchored to a line box, so it is
									// stale the moment the text moves underneath it.
									setSuggest(null);
								},
								onBlur: () => {
									setSuggest(null);
								},
							}),
						),
						suggest === null ? null : React.createElement(
							'div',
							{ className: 'dshCc_suggest', style: { top: suggest.top + 'px', left: suggest.left + 'px' } },
							...suggest.items.map((item, index) => React.createElement(
								'button',
								{
									key: item,
									type: 'button',
									className: 'dshCc_suggestItem',
									'data-active': index === suggest.index,
									onMouseDown: (event) => {
										event.preventDefault();
										acceptSuggest(item);
									},
								},
								item,
								React.createElement('span', { className: 'dshCc_suggestKind' }, suggest.kind),
							)),
						),
					),
					openRule === null ? null : React.createElement(
						'div',
						{ className: 'dshCc_panel' },
						React.createElement(
							'div',
							{ className: 'dshCc_panelHead' },
							React.createElement('input', {
								className: 'dshCc_panelName',
								'aria-label': '选择器',
								spellCheck: false,
								value: openSelector ?? '',
								onChange: (event) => {
									renameRule(event.target.value);
								},
							}),
							React.createElement(
								'button',
								{
									type: 'button',
									className: 'dshCc_panelClose',
									'aria-label': '关闭规则面板',
									onClick: () => {
										setOpenSelector(null);
									},
								},
								'×',
							),
						),
						// Only what the rule actually declares: an unset property gets no
						// row at all, so the panel reads as a summary of the sheet rather
						// than a form full of blanks.
						...(declarations === null || declarations.size === 0
							? [React.createElement('p', { key: 'empty', className: 'dshCc_empty' }, '这条规则还没有声明')]
							: Array.from(declarations).map(([declared, current]) => {
								const entry = PROPERTY_UI.find(item => item.name === declared);
								if (entry === undefined) {
									// Not an enum-shaped property (gap, margin-top, …): it still
									// belongs in the panel, as a value field rather than a menu.
									return React.createElement(
										'label',
										{ key: declared, className: 'dshCc_prop' },
										React.createElement('span', { className: 'dshCc_propLabel' }, declared),
										React.createElement('input', {
											className: 'dshCc_propText',
											'aria-label': declared,
											spellCheck: false,
											value: current,
											onChange: (event) => {
												setProperty(declared, event.target.value);
											},
										}),
									);
								}
								const known = entry.values.some(pair => pair[0] === current);
								return React.createElement(
									'label',
									{ key: declared, className: 'dshCc_prop' },
									React.createElement('span', { className: 'dshCc_propLabel' }, entry.label),
									React.createElement(
										'select',
										{
											className: 'dshCc_propValue',
											'aria-label': entry.label,
											value: current,
											onChange: (event) => {
												setProperty(entry.name, event.target.value);
											},
										},
										// A value typed by hand (or laid down by a template) stays
										// visible instead of being dropped by the menu.
										known ? null : React.createElement('option', { value: current }, current),
										...entry.values.map(pair => React.createElement(
											'option',
											{ key: pair[0], value: pair[0] },
											pair[1],
										)),
										React.createElement('option', { value: '' }, '（删除此项）'),
									),
								);
							})),
						React.createElement(
							'select',
							{
								className: 'dshCc_addProp',
								'aria-label': '添加属性',
								value: '',
								onChange: (event) => {
									const entry = PROPERTY_UI.find(item => item.name === event.target.value);
									if (entry !== undefined) setProperty(entry.name, entry.values[0][0]);
								},
							},
							React.createElement('option', { value: '' }, '＋ 添加属性…'),
							...PROPERTY_UI
								.filter(entry => !(declarations?.has(entry.name) ?? false))
								.map(entry => React.createElement(
									'option',
									{ key: entry.name, value: entry.name },
									entry.label + '（' + entry.name + '）',
								)),
						),
						React.createElement('p', { className: 'dshCc_panelSection' }, '插入模板'),
						...DECL_TEMPLATES.map(template => React.createElement(
							'button',
							{
								key: template.id,
								type: 'button',
								className: 'dshCc_tpl',
								onClick: () => {
									insertTemplate(template);
								},
							},
							template.label,
							React.createElement('span', { className: 'dshCc_tplHint' }, template.hint),
						)),
					),
				),
				React.createElement(
					'div',
					{ className: 'dshCc_foot' },
					React.createElement(
						'span',
						{ className: problem === null ? 'dshCc_status' : 'dshCc_error' },
						problem === null ? statusText() : (statusText() + ' · ' + problem),
					),
					fileMode ? React.createElement(
						'span',
						{ className: 'dshCc_status' },
						state.active === null ? '' : state.active,
					) : null,
				),
				),
				React.createElement('input', {
					ref: fileInput,
					type: 'file',
					accept: '.css,text/css',
					style: { display: 'none' },
					onChange: (event) => {
						void onFilePicked(event);
					},
				}),
			);
		}

		/**
		 * Client plugin body: activate the stored stylesheet for every page, then
		 * register the preference row. `slots.inject` waits for the General
		 * section's item seat, so load order against ui-settings-general does not
		 * matter.
		 * @param ctx - browser cordis context carrying the slot registry.
		 */
		function apply(ctx) {
			void bootstrap();
			ctx.slots.inject('settings.general.item', () => ctx.slots.register({
				name: 'settings.general.item',
				id: 'custom-css',
				order: 12,
				registrant: PLUGIN_ID,
			}, CustomCssRow));
		}

		/** Browser services this plugin needs before its body runs. */
		const inject = ['slots'];

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
