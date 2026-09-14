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
			'.dshCc_btn{appearance:none;box-sizing:border-box;display:inline-flex;align-items:center;height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:none;',
			'font:inherit;font-size:14px;line-height:22px;padding:0 14px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}',
			'.dshCc_btn:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary);',
			'background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_btn:disabled{opacity:.4;cursor:default}',
			'.dshCc_btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.dshCc_danger{color:var(--dsw-alias-state-error-primary)}',
			'.dshCc_danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary);',
			'border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent);',
			'background:var(--dsw-alias-interactive-bg-hover-danger)}',
			'.dshCc_newRow{align-items:center;gap:8px;display:flex}',
			'.dshCc_input{box-sizing:border-box;flex:1;min-width:0;height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);',
			'border-radius:18px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px}',
			'.dshCc_input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;border-color:transparent}',
			'.dshCc_desc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}',
			// Editor: a DevTools-like shell — a line-number gutter beside the text
			// area sharing one monospace metric, plus an anchored completion list.
			// A definite height, not merely a minimum. The textarea resolves
			// `height: 100%` against this box, and against an auto-height parent
			// that resolves to nothing — so the field grew with its content and a
			// long sheet was shown in full instead of scrolling inside it.
			'.dshCc_editorWrap{box-sizing:border-box;position:relative;display:flex;width:100%;min-width:0;height:140px;',
			'min-height:140px;overflow:hidden;resize:vertical;',
			'border-radius:8px;background:var(--dsw-alias-bg-module-platform);--dshCc-line:19px;',
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
			'.dshCc_shell{box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1fr);width:100%;min-width:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
			// Body: the code field on top, the rule panel beneath it.
			'.dshCc_main{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;width:100%;min-width:0;padding:8px}',
			// The panel sits under the code rather than beside it, and caps its own
			// height: a rule with many declarations then scrolls inside the container
			// instead of stretching the whole row.
			'.dshCc_panel{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;width:100%;min-width:0;',
			'min-height:0;max-height:260px;overflow-y:auto;overflow-x:hidden;padding:10px;border:1px solid var(--dsw-alias-border-l2);',
			'border-radius:10px;background:var(--dsw-alias-bg-layer-1);scrollbar-width:thin}',
			// Grids: declarations flow across the width, templates sit as compact chips.
			// The panel is a capped, scrolling column: without this its own children shrink
			// to fit (the selector field measured 26px instead of 36), because a flex item
			// defaults to flex-shrink:1. Rows keep their height; the panel scrolls.
			'.dshCc_panel>*{flex:none}',
			'.dshCc_propGrid{box-sizing:border-box;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px 12px;width:100%;min-width:0}',
			// Grid and flex items both default to min-width:auto, and a <select> reports
			// its widest option as max-content — so every level has to allow shrinking,
			// or one long option label pushes the whole cell out of the panel.
			'.dshCc_propGrid>*{min-width:0}',
			// Panel dropdowns are own-element menus (a native <select> popup cannot be
			// styled): trigger matches the field chrome, menu matches the sheet picker —
			// same radius, same layer, same shadow.
			'.dshCc_selectWrap{position:relative;display:inline-flex;width:100%;min-width:0}',
			// Full width, label left and chevron right: it reads as the panel's toolbar
			// control rather than a field floating in the corner.
			'.dshCc_addPropWrap{width:100%;max-width:none}',
			'.dshCc_addPropWrap .dshCc_select{background:var(--dsw-alias-interactive-bg-hover);border-color:transparent}',
			'.dshCc_addPropWrap .dshCc_select:hover{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}',
			'.dshCc_select{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:36px;padding:0 14px;',
			'border:1px solid var(--dsw-alias-border-l2);border-radius:18px;background:var(--dsw-alias-bg-module-platform);',
			'color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;font-family:var(--dshCc-mono);text-align:left;cursor:pointer}',
			'.dshCc_select:hover{border-color:var(--dsw-alias-label-dimmed)}',
			'.dshCc_select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.dshCc_selectValue{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:14px}',
			'.dshCc_select{justify-content:space-between}',
			'.dshCc_selectMenu{z-index:60;box-sizing:border-box;display:flex;flex-direction:column;gap:1px;overflow-y:auto;',
			'padding:4px;border-radius:20px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-elevation-prominent);scrollbar-width:thin}',
			'.dshCc_selectItem{display:flex;align-items:center;gap:8px;min-height:36px;padding:4px 12px;border:none;border-radius:10px;',
			'background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer}',
			'.dshCc_selectItem:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_selectItem[aria-selected=true]{color:var(--dsw-alias-brand-primary)}',
			'.dshCc_selectGroup{padding:4px 8px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
			// Explicit box for the shorthand rows too, and room for their fields: a
			// four-part shorthand takes the whole grid width instead of a 240px cell.
			'.dshCc_propWide{grid-column:1 / -1}',
			'.dshCc_partRow{display:flex;align-items:center;gap:10px;min-width:0;flex:1 1 auto}',
			'.dshCc_partCell{display:flex;align-items:center;gap:6px;min-width:0;flex:1 1 0}',
			// A chip rather than plain text: component names then read as labels instead of
			// as another value in the row. Renders on the tag surface DSH itself ships.
			'.dshCc_partName{flex:none;padding:1px 7px;border-radius:6px;background:var(--dsw-alias-markdown-tag);',
			'color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;white-space:nowrap}',
			'.dshCc_partRow .dshCc_propText{flex:1 1 0;min-width:0}',
			'.dshCc_tplGrid{box-sizing:border-box;display:grid;grid-template-columns:repeat(auto-fill,minmax(124px,1fr));gap:8px;width:100%;min-width:0}',
			// One field for the selector, with the close control *inside* it: the field then
			// spans the panel the way every other control does, and the × reads as part of
			// the field rather than as a separate button beside it.
			'.dshCc_panelField{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:100%;min-width:0;height:36px;padding:0 5px 0 14px;',
			'border:1px solid var(--dsw-alias-border-l2);border-radius:18px;background:var(--dsw-alias-bg-module-platform)}',
			'.dshCc_panelField:focus-within{border-color:transparent;outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.dshCc_panelName{flex:1;min-width:0;height:100%;padding:0;border:none;outline:none;background:transparent;',
			'color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;font-family:var(--dshCc-mono)}',
			'.dshCc_panelClose{appearance:none;flex:none;display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;',
			'border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:15px;line-height:1;cursor:pointer}',
			'.dshCc_panelClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.dshCc_panelHint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
			'.dshCc_panelSection{margin:2px 0 0;padding-top:6px;border-top:0.5px solid var(--dsw-alias-border-l2);',
			'color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
			'.dshCc_prop{align-items:center;display:flex;gap:8px;min-width:0}',
			'.dshCc_propLabel{flex:none;width:76px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
			'color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}',
			'.dshCc_propText{flex:1;min-width:0;max-width:100%;box-sizing:border-box;height:36px;padding:0 14px;',
			'border:1px solid var(--dsw-alias-border-l2);border-radius:18px;background:var(--dsw-alias-bg-module-platform);',
			'color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;font-family:var(--dshCc-mono)}',
			'.dshCc_propText:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;border-color:transparent}',
			// Same chrome as a property dropdown, and indented to the value column:
			// it sits in the same stack, so a dashed/transparent variant of its own
			// only ever read as a different control.
			'.dshCc_empty{margin:0;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;min-width:0}',
			'.dshCc_tpl{display:flex;align-items:center;gap:8px;width:100%;min-width:0;min-height:36px;padding:5px 14px;',
			'border:1px solid transparent;border-radius:18px;background:var(--dsw-alias-bg-module-platform);',
			'color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;text-align:left;overflow:hidden}',
			'.dshCc_tpl:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_tpl:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.dshCc_tplHint{margin-left:auto;flex:none;color:var(--dsw-alias-label-caption);font-size:11px}',
			'.dshCc_foot{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-width:0;padding:6px 10px;border-top:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform)}',
			'.dshCc_status{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}',
			'.dshCc_error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}',
			// File bar above the editor: the sheet identity on the left, its switch on
			// the right — a row of its own so it can never fight the editor frame or the
			// focus ring, and so the two boxes keep their own radii.
			'.dshCc_fileBar{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-width:0;padding:7px 10px 7px 11px;border-bottom:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform)}',
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
			'.dshCc_pickBtn[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
			// The session dims the surface it sits in and lets clicks through to the page
			// behind it — the highlight box and the hint bar are appended to the body, so
			// they stay visible while everything else steps aside.
			'[data-dshCc-picking="true"]{pointer-events:none;opacity:0.3}',
			'.dshCc_pickBox{position:fixed;z-index:2147483000;pointer-events:none;box-sizing:border-box;border:1px solid var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);border-radius:4px}',
			'.dshCc_pickBox::after{content:attr(data-label);position:absolute;left:0;top:-22px;white-space:nowrap;padding:1px 6px;border-radius:4px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-inverse, #fff);font-size:11px;line-height:18px}',
			// The toolbar is interactive on purpose: it is the visible way out of picking
			// mode, and the level buttons are the keyboard shortcuts in clickable form.
			'.dshCc_pickBar{position:fixed;z-index:2147483001;left:50%;bottom:24px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;max-width:92vw;box-sizing:border-box;padding:6px 8px 6px 14px;border-radius:18px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:13px}',
			'.dshCc_pickBarInfo{min-width:0;max-width:46vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
			'.dshCc_pickBarBtn{appearance:none;flex:none;height:28px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;line-height:1}',
			'.dshCc_pickBarBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_menuHint{flex:none;margin-left:auto;color:var(--dsw-alias-label-caption);font-size:11px}',
			'.dshCc_menuItemDanger{color:var(--dsw-alias-state-error-primary)}',
			'.dshCc_menuItem:disabled{cursor:default;opacity:.45}',
			'.dshCc_menuItem:disabled:hover{background:transparent}',
			'.dshCc_picked{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;width:100%;min-width:0;padding:8px 10px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}',
			'.dshCc_pickedHead{align-items:center;display:flex;justify-content:space-between;gap:8px;width:100%;min-width:0}',
			'.dshCc_pickedTitle{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dshCc_pickedList{display:flex;flex-direction:column;gap:4px;width:100%;min-width:0}',
			'.dshCc_candidate{align-items:center;appearance:none;display:flex;gap:8px;width:100%;min-width:0;padding:6px 8px;border:0.5px solid transparent;border-radius:6px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;text-align:left}',
			'.dshCc_candidate[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary)}',
			'.dshCc_candidateSel{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;font-size:12px}',
			'.dshCc_candidateKind,.dshCc_candidateMatches{flex:none;color:var(--dsw-alias-label-caption);font-size:11px}',
			'.dshCc_pickedNote{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
			'.dshCc_pickedTokens{display:flex;flex-wrap:wrap;gap:6px;width:100%;min-width:0}',
			'.dshCc_tokenChip{appearance:none;padding:3px 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-markdown-tag);color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px}',
			'.dshCc_tokenChip[aria-pressed="false"]{opacity:0.45;text-decoration:line-through}',
			'.dshCc_pickedActions{display:flex;gap:8px;width:100%;min-width:0}',
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
			// In an unterminated string or comment there is nothing to complete: the
			// caret is not at a property or value boundary at all.
			if (inOpenLiteral(before)) return null;
			const word = /[-a-zA-Z]*$/.exec(before)?.[0] ?? '';
			const line = before.slice(before.lastIndexOf('\n') + 1);
			// One line can hold several declarations; only the one the caret sits in
			// describes it. Straight after a `;` there is nothing to complete yet,
			// and offering the whole property list there is pure noise.
			const clauseStart = clauseStartAt(line);
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
		 * Walk a sheet fragment, skipping everything that is not structure.
		 *
		 * Strings, comments and `url()` tokens are opaque in CSS — their braces and
		 * semicolons are text, not punctuation. Every scanner in this file goes
		 * through this one walk, so the completion path cannot disagree with the
		 * parser about where a block or a declaration begins.
		 * @param text - the fragment to walk.
		 * @param visit - called with `(char, index)` for each structural character.
		 * @returns the brace depth left open, and whether the walk ended inside an
		 *   unterminated string or comment.
		 */
		function walkStructure(text, visit) {
			let depth = 0;
			let open = false;
			let index = 0;
			while (index < text.length) {
				const ch = text[index];
				if (ch === '"' || ch === "'") {
					const string = scanString(text, index);
					if (!string.closed) open = true;
					index = string.stop;
					continue;
				}
				if (ch === '/' && text[index + 1] === '*') {
					const comment = scanComment(text, index);
					if (!comment.closed) open = true;
					index = comment.stop;
					continue;
				}
				if (isUrlStart(text, index)) {
					index = skipUrl(text, index);
					continue;
				}
				if (ch === '{') depth += 1;
				else if (ch === '}') depth = Math.max(0, depth - 1);
				visit(ch, index);
				index += 1;
			}
			return { depth, open };
		}

		/**
		 * Whether the text ends inside a rule block rather than in a selector.
		 *
		 * Counting the bare characters was wrong for the same reason it was wrong
		 * everywhere else: `content: "}"` closed the block on paper, so typing
		 * `color: ` after it offered no completions at all. That is the standard way
		 * to clear a float, not an exotic edge case.
		 * @param before - the sheet text up to the caret.
		 * @returns true when a block is open at the caret.
		 */
		function insideBlock(before) {
			return walkStructure(before, () => {}).depth > 0;
		}

		/**
		 * Offset where the declaration the caret sits in begins.
		 * @param text - the line up to the caret.
		 * @returns the offset just past the last top-level `;`, or 0.
		 */
		function clauseStartAt(text) {
			let start = 0;
			walkStructure(text, (ch, index) => {
				if (ch === ';') start = index + 1;
			});
			return start;
		}

		/**
		 * Whether the text ends inside an unterminated string or comment.
		 * @param text - the sheet text up to the caret.
		 * @returns true when the caret sits in an open string or comment.
		 */
		function inOpenLiteral(text) {
			return walkStructure(text, () => {}).open;
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
		 * A generated class name: CSS Modules' `_card_1fywu_26`. The capture is the
		 * stable half — the name the author wrote, without the rotating hash.
		 */
		const MODULE_CLASS = /^(_[a-z0-9]+)_[a-z0-9]{4,}_\d+$/i;
		/** A hand-written class name: at least one hyphen, no generated hash. */
		const SEMANTIC_CLASS = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

		/**
		 * Read one attribute from a real element or a plain test double.
		 * @param node - element or double.
		 * @param name - attribute name.
		 * @returns the attribute value, or undefined.
		 */
		function attrOf(node, name) {
			if (typeof node?.getAttribute === 'function') return node.getAttribute(name) ?? undefined;
			return node?.attributes?.[name];
		}

		/**
		 * Every attribute name on a real element or a plain test double.
		 * @param node - element or double.
		 * @returns the attribute names.
		 */
		function attributeNames(node) {
			if (node?.attributes === undefined || node.attributes === null) return [];
			if (typeof node.getAttribute === 'function' && typeof node.attributes[Symbol.iterator] === 'function') {
				return [...node.attributes].map(entry => entry.name);
			}
			return Object.keys(node.attributes);
		}

		/**
		 * One CSS string literal.
		 * @param value - the raw value.
		 * @returns the quoted, escaped literal.
		 */
		function cssString(value) {
			return '"' + String(value).replace(/["\\]/g, '\\$&') + '"';
		}

		/**
		 * One selector segment: the tag, plus `:nth-child()` only when the tag alone
		 * would be ambiguous among its siblings.
		 * @param node - element or double.
		 * @returns the segment.
		 */
		function selectorSegment(node) {
			const tag = String(node?.tagName ?? '').toLowerCase() || '*';
			const siblings = [...(node?.parentElement?.children ?? [])];
			if (siblings.length === 0) return tag;
			const sameTag = siblings.filter(child => String(child?.tagName ?? '').toLowerCase() === tag);
			if (sameTag.length <= 1) return tag;
			return tag + ':nth-child(' + (siblings.indexOf(node) + 1) + ')';
		}

		/**
		 * Escape one identifier for a selector.
		 * @param value - the raw identifier.
		 * @returns the escaped identifier.
		 */
		function cssIdent(value) {
			return String(value).replace(/[^\w-]/g, character => '\\' + character);
		}

		/**
		 * How many elements a selector matches, with an unusable selector counted as one
		 * (unknown is never treated as "unique").
		 * @param probe - `selector → count`.
		 * @param selector - the selector to test.
		 * @returns the match count.
		 */
		function probeMatches(probe, selector) {
			if (probe === undefined) return 1;
			try {
				return probe(selector);
			}
			catch {
				return 1;
			}
		}

		/**
		 * Candidate selectors for one picked element, best first.
		 *
		 * The order is what actually survives a DSH upgrade: hooks the app itself sets
		 * and queries, then the accessibility layer, then hand-written plugin classes,
		 * then a hash-tolerant match for generated classes, and only then a structural
		 * path — which always works and always breaks eventually.
		 *
		 * A candidate that matches several elements is demoted, not hidden (styling a
		 * whole family of elements at once is a legitimate thing to want), but the
		 * demotion is deliberately small: a readable selector that also hits two
		 * neighbours still beats a structural path, which is guaranteed to break on the
		 * next release. What it must not do is win the default — uniqueness decides
		 * that first, and the evidence hierarchy only breaks ties.
		 * @param node - the picked element (a real Element, or a plain double).
		 * @param probe - `selector → match count`, used to prefer a unique candidate.
		 * @returns up to three `{ selector, kind, note, matches }`, best first.
		 */
		function selectorCandidates(node, probe) {
			const candidates = [];
			const tag = String(node?.tagName ?? '').toLowerCase();
			const classes = String(node?.className ?? '').split(/\s+/).filter(Boolean);
			// Two for a collision: enough to lose to a unique candidate of a weaker
			// kind, not enough to lose to the structural fallback at rank 5.
			const add = (selector, kind, note, rank) => {
				if (selector === '' || candidates.some(entry => entry.selector === selector)) return;
				const matches = probeMatches(probe, selector);
				candidates.push({ selector, kind, note, matches, rank: rank + (matches === 1 ? 0 : 2) });
			};

			// 1. Hooks the app itself sets — and queries, which is the strongest
			//    promise a selector can get in this interface.
			for (const name of attributeNames(node)) {
				if (!/^data-(?!dshCc|dshcc|react)/.test(name)) continue;
				const value = attrOf(node, name);
				const usable = typeof value === 'string' && value !== '' && value.length <= 40;
				add(usable ? '[' + name + '=' + cssString(value) + ']' : '[' + name + ']',
					'属性钩子', 'DSH 自己也在用这类钩子，跨版本最稳', 0);
			}

			// 2. The accessibility layer: stable, readable, but a label can repeat.
			const label = attrOf(node, 'aria-label');
			if (typeof label === 'string' && label !== '') {
				add(tag + '[aria-label=' + cssString(label) + ']',
					'无障碍名', '语义层不会随便改；界面里若有同名元素会一起命中', 1);
			}

			// 3. Hand-written classes — how plugins like the music player name things.
			const semantic = classes.find(name => SEMANTIC_CLASS.test(name) && !MODULE_CLASS.test(name));
			if (semantic !== undefined) {
				add(tag + '.' + semantic, '语义类名', '插件作者手写的类名，通常跟着插件一起演进', 2);
			}

			// 4. A generated class, matched without its rotating hash.
			const generated = classes.find(name => MODULE_CLASS.test(name));
			if (generated !== undefined) {
				add(tag + '[class*=' + cssString(MODULE_CLASS.exec(generated)[1] + '_') + ']',
					'哈希容错', 'CSS Modules 的哈希随构建变化，这种写法不接哈希', 3);
			}

			// 5. Structure: always available, never stable.
			const parts = [];
			let current = node;
			let anchor = '';
			for (let depth = 0; depth < 6 && current !== null && current !== undefined; depth += 1) {
				const id = attrOf(current, 'id');
				if (depth > 0 && typeof id === 'string' && id !== '') {
					anchor = '#' + cssIdent(id) + ' > ';
					break;
				}
				parts.unshift(selectorSegment(current));
				current = current.parentElement ?? null;
			}
			let path = parts.join(' > ');
			for (let cut = 1; cut < parts.length; cut += 1) {
				const shorter = parts.slice(cut).join(' > ');
				if (probeMatches(probe, shorter) === 1) {
					path = shorter;
					break;
				}
			}
			add(anchor + path, '结构路径', '兜底方案：属性与类名都没有时用它，界面改版会失效', 5);

			candidates.sort((left, right) => left.rank - right.rank);
			return candidates.slice(0, 3);
		}

		/**
		 * The surface a pick session has to move out of the way.
		 *
		 * The row lives inside the settings surface, which covers exactly what the user
		 * wants to click. The outermost dialog is the right thing to dim; if there is no
		 * dialog, the outermost ancestor that covers the viewport is.
		 * @param node - an element inside the surface (our own row).
		 * @param root - the document root, where the walk stops.
		 * @param viewport - `{ width, height }` of the window.
		 * @returns the element to move aside, or null when nothing covers the page.
		 */
		function surfaceToMoveAside(node, root, viewport) {
			let best = null;
			let current = node ?? null;
			while (current !== null && current !== undefined && current !== root) {
				if (typeof current.getAttribute === 'function' && current.getAttribute('aria-modal') === 'true') return current;
				const box = typeof current.getBoundingClientRect === 'function'
					? current.getBoundingClientRect()
					: { width: 0, height: 0 };
				const covers = viewport.width > 0 && viewport.height > 0
					&& box.width >= viewport.width * 0.8
					&& box.height >= viewport.height * 0.6;
				if (covers) best = current;
				current = current.parentElement ?? null;
			}
			return best;
		}

		/**
		 * One element-pick session.
		 *
		 * Everything outside the plugin's own tree goes through \`host\`, so the state
		 * machine — hover reports an element, click resolves it, Escape cancels, and
		 * stopping detaches exactly what was attached — is testable without a DOM.
		 * @param host - listener registry, \`elementAt(x, y)\`, box drawing and callbacks.
		 * @returns \`{ stop }\`, which ends the session and detaches its listeners.
		 */
		function startPickSession(host) {
			let stopped = false;
			let selected = null;
			const stop = () => {
				if (stopped) return;
				stopped = true;
				host.unlisten('pointermove', onMove, false);
				host.unlisten('click', onClick, true);
				host.unlisten('keydown', onKey, true);
				host.hideBox();
			};
			const show = (node) => {
				if (node === undefined || node === null) return;
				selected = node;
				host.showBox(node);
			};
			const step = (direction) => {
				if (stopped || selected === null) return;
				show(host.relative(selected, direction));
			};
			const confirm = () => {
				if (stopped || selected === null) return;
				const node = selected;
				stop();
				host.onPick(node);
			};
			const isChrome = (target) => host.isChrome !== undefined && host.isChrome(target) === true;
			const onMove = (event) => {
				// Over the toolbar the pointer is not choosing: the level the user walked
				// to with the keyboard has to survive until they move back out.
				if (isChrome(event.target)) return;
				show(host.elementAt(event.clientX, event.clientY));
			};
			const onClick = (event) => {
				// A click on the toolbar is the toolbar's business, never a pick.
				if (isChrome(event.target)) return;
				event.preventDefault();
				event.stopPropagation();
				// A real click is always preceded by a pointermove, but a synthetic or
				// touch-generated one is not: fall back to the element under the pointer
				// rather than doing nothing, and keep the keyboard's selection otherwise.
				if (selected === null) show(host.elementAt(event.clientX, event.clientY));
				confirm();
			};
			const onKey = (event) => {
				const key = String(event.key ?? '');
				const moves = {
					ArrowUp: 'parent', w: 'parent', W: 'parent',
					ArrowDown: 'child', s: 'child', S: 'child',
					ArrowLeft: 'previous', a: 'previous', A: 'previous',
					ArrowRight: 'next', d: 'next', D: 'next',
				};
				if (moves[key] !== undefined) {
					event.preventDefault();
					step(moves[key]);
					return;
				}
				if (key === 'Enter') {
					event.preventDefault();
					confirm();
					return;
				}
				if (key === 'Escape') {
					event.preventDefault();
					stop();
					host.onCancel();
				}
			};
			host.listen('pointermove', onMove, false);
			host.listen('click', onClick, true);
			host.listen('keydown', onKey, true);
			return { stop, step, confirm };
		}

		/**
		 * The node one step away in the tree, for the level keys.
		 *
		 * AdGuard's picker works this way: the pointer chooses roughly, the keyboard
		 * walks up, down and sideways until the highlight is on the element that
		 * actually owns the styling. Walking stops at the body: above it there is
		 * nothing a sheet should target.
		 * @param node - the current selection.
		 * @param direction - \`parent\` | \`child\` | \`previous\` | \`next\`.
		 * @returns the neighbour, or null at the edge of the tree.
		 */
		function relativeNode(node, direction) {
			if (node === null || node === undefined) return null;
			const parent = node.parentElement ?? null;
			const body = (entry) => String(entry?.tagName ?? '').toLowerCase() === 'body';
			if (direction === 'parent') return parent === null || body(parent) ? null : parent;
			if (direction === 'child') return (node.children ?? [])[0] ?? null;
			if (parent === null) return null;
			const siblings = [...(parent.children ?? [])];
			const index = siblings.indexOf(node);
			if (index < 0) return null;
			return siblings[index + (direction === 'previous' ? -1 : 1)] ?? null;
		}

		/**
		 * Short human description of an element: its tag, its most telling attribute,
		 * and its nearest ancestors — the readout that says where the highlight is.
		 * @param node - the element.
		 * @param depth - how many ancestors to keep.
		 * @returns e.g. \`section > div.dsh-music-qq-head\`.
		 */
		function describeNode(node, depth = 2) {
			const label = (entry) => {
				const tag = String(entry?.tagName ?? '').toLowerCase() || '?';
				const classes = String(entry?.className ?? '').split(/\s+/).filter(Boolean);
				const semantic = classes.find(name => (SEMANTIC_CLASS.test(name) || MODULE_CLASS.test(name))
					&& !name.startsWith('dshCc') && !name.startsWith('_dshCc'));
				if (semantic !== undefined) return tag + '.' + semantic;
				const aria = attrOf(entry, 'aria-label');
				if (typeof aria === 'string' && aria !== '') return tag + '[' + aria + ']';
				const id = attrOf(entry, 'id');
				return typeof id === 'string' && id !== '' ? tag + '#' + id : tag;
			};
			const parts = [label(node)];
			let current = node?.parentElement ?? null;
			for (let step = 0; step < depth && current !== null && current !== undefined; step += 1) {
				if (String(current.tagName ?? '').toLowerCase() === 'body') break;
				parts.unshift(label(current));
				current = current.parentElement ?? null;
			}
			return parts.join(' > ');
		}

		/**
		 * The value → token-name map of the app's own stylesheets.
		 *
		 * Built from the CSSOM rather than a hand-kept list, so new design tokens and
		 * changed values are picked up on their own — which is what lets the picker
		 * suggest `var(--dsw-…)` instead of the literal colour it resolved to.
		 * @param sheets - the document's style sheets (injected for tests).
		 * @returns a map from a computed value to the token names carrying it.
		 */
		function collectTokens(sheets) {
			const found = new Map();
			const add = (name, value) => {
				if (!name.startsWith('--') || value === undefined || String(value).trim() === '') return;
				const key = String(value).trim();
				if (!found.has(key)) found.set(key, []);
				const names = found.get(key);
				if (!names.includes(name)) names.push(name);
			};
			const walk = (rules) => {
				for (const rule of rules ?? []) {
					if (rule?.style) {
						for (const name of rule.style) add(name, rule.style.getPropertyValue(name));
					}
					// @media / @supports / @layer keep their own rule list.
					if (rule?.cssRules) walk(rule.cssRules);
				}
			};
			for (const sheet of sheets ?? []) {
				try {
					walk(sheet?.cssRules);
				}
				catch {
					// A cross-origin sheet is unreadable; skipping it is the only option.
				}
			}
			return found;
		}

		/**
		 * Token suggestions for one picked element.
		 * @param style - the element's computed style.
		 * @param tokens - the value → names map.
		 * @returns up to four `{ property, value, token }`, in declaration order.
		 */
		function tokenSuggestions(style, tokens) {
			const wanted = [
				['background-color', /(^|-)bg/],
				['color', /label|text|(^|-)fg/],
				['border-color', /border/],
				['border-radius', /corner|radius/],
			];
			const found = [];
			for (const [property, preference] of wanted) {
				const resolved = String(style?.getPropertyValue?.(property) ?? '').trim();
				const names = tokens?.get(resolved);
				if (names === undefined || names.length === 0) continue;
				found.push({ property, value: resolved, token: names.find(name => preference.test(name)) ?? names[0] });
			}
			return found;
		}

		/**
		 * Append a rule for a selector, and report where the caret belongs.
		 * @param css - the sheet text.
		 * @param selector - the selector to add.
		 * @returns the new sheet text and the caret offset inside the new block.
		 */
		function appendRule(css, selector, declarations = []) {
			const lines = declarations.map(line => '  ' + line + '\n').join('');
			const body = selector.trim() + ' {\n' + (lines === '' ? '  \n' : lines) + '}';
			const gap = css === '' ? '' : (css.endsWith('\n') ? '\n' : '\n\n');
			const next = css + gap + body;
			return { css: next, caret: next.lastIndexOf('{') + 2 };
		}

		/**
		 * Index of the rule with this selector, ignoring whitespace differences.
		 * @param rules - records from parseRules.
		 * @param selector - the candidate selector.
		 * @returns the index, or -1.
		 */
		function findRuleIndex(rules, selector) {
			const wanted = selector.replace(/\s+/g, ' ').trim();
			return rules.findIndex(rule => rule.selector.replace(/\s+/g, ' ').trim() === wanted);
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
			 * Emit the pending run. A run that sits inside a rule's selector is part of
			 * that rule's click target for the panel.
			 *
			 * The selector is tokenised on its punctuation, so a pseudo-class splits it
			 * into '.a', ':' and 'hover': matching only the run that ends exactly at the
			 * selector end made 'hover' clickable and left the rule name itself inert.
			 * @param at - offset the run ends at, before trailing whitespace.
			 */
			const flush = (at) => {
				if (buffer === '') return;
				const runStart = at - buffer.length;
				const start = runStart + (buffer.length - buffer.trimStart().length);
				const end = at - (buffer.length - buffer.trimEnd().length);
				const ruleIndex = end > start
					? rules.findIndex(rule => start >= rule.selectorStart && end <= rule.selectorEnd)
					: -1;
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
				// A string belongs to the run it sits in: its `:`/`;`/braces are not
				// punctuation, so the colouring does not drift for the rest of the line.
				if (ch === '"' || ch === "'") {
					const stop = skipString(css, index);
					buffer += css.slice(index, stop);
					index = stop - 1;
					continue;
				}
				if (ch === '/' && css[index + 1] === '*') {
					flush(index);
					const stop = scanComment(css, index).stop;
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
				// Strings are opaque here too: a `}` or `;` inside one is text, not
				// structure — counting it reported a valid sheet as unbalanced.
				if (ch === '"' || ch === "'") {
					const stop = skipString(css, index);
					line += css.slice(index, stop).split('\n').length - 1;
					buffer += css.slice(index, stop);
					index = stop - 1;
					continue;
				}
				if (isUrlStart(css, index)) {
					// Same opacity as the declaration splitter: an unquoted data URI
					// carries a semicolon, and splitting there reported a legal
					// background-image as an unparsable declaration.
					const stop = skipUrl(css, index);
					line += css.slice(index, stop).split('\n').length - 1;
					buffer += css.slice(index, stop);
					index = stop - 1;
					continue;
				}
				if (ch === '/' && css[index + 1] === '*') {
					const comment = scanComment(css, index);
					if (!comment.closed) {
						flush(depth > 0);
						issues.push({ line, message: '注释未闭合' });
						return issues.slice(0, 5);
					}
					// A comment is whitespace between tokens, not a statement boundary:
					// blank it into the buffer (same length, newlines kept) so a legal
					// comment between a property name and its colon is not reported as
					// two unparsable pieces.
					const text = css.slice(index, comment.stop);
					buffer += text.replace(/[^\n]/g, ' ');
					line += text.split('\n').length - 1;
					index = comment.stop - 1;
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
				if (ch === ';') {
					// A top-level semicolon ends a statement of its own
					// (@import "x";), so the next prelude starts fresh. Keeping it in the
					// buffer glued the at-rule name onto the following block and judged a
					// legal @font-face as a style rule, rejecting its descriptors.
					flush(false);
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
				// A string is opaque: `content: "}"` must not close the block, or every rule
				// after it gets offsets that point at the wrong text.
				if (ch === '"' || ch === "'") {
					index = skipString(css, index);
					continue;
				}
				if (ch === '/' && css[index + 1] === '*') {
					index = scanComment(css, index).stop;
					continue;
				}
				if (ch === ';' && depth === 0) {
					// An @import statement ends with a semicolon: without this the next
					// rule's "selector" still carried the at-rule, started with @, and
					// was dropped — leaving it unclickable in the editor.
					index += 1;
					sectionStart = index;
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
							const innerCh = css[scan];
							// Same opacity as the outer loop: `content: "}"` must not end the
							// body, or the rule after it is swallowed and a write from the
							// panel lands inside the string.
							if (innerCh === '"' || innerCh === "'") {
								scan = skipString(css, scan);
								continue;
							}
							if (innerCh === '/' && css[scan + 1] === '*') {
								scan = scanComment(css, scan).stop;
								continue;
							}
							if (innerCh === '{') inner += 1;
							else if (innerCh === '}') inner -= 1;
							scan += 1;
						}
						rules.push({
							selector,
							selectorStart: sectionStart + content + (tail.length - tail.trimStart().length),
							selectorEnd: sectionStart + content + tail.trimEnd().length,
							bodyStart: index + 1,
							// An unterminated block (a rule being typed, or a broken sheet)
							// ends at the end of the text: stopping at the last character
							// would hide it from the panel and make a write drop it.
							bodyEnd: inner === 0 ? Math.max(index + 1, scan - 1) : css.length,
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
		 * The rule panel's property dictionary, Chinese first and CSS second.
		 *
		 * Two shapes live here:
		 *   - `values`: the closed set the engine accepts (display, position, …),
		 *     rendered as a dropdown whose option labels are Chinese.
		 *   - `seed` without `values`: a length, colour, shadow or function the panel
		 *     cannot enumerate (gap, margin-top, font-size …), rendered as a free text
		 *     field seeded with a usable starting value; `hint` becomes its placeholder.
		 * `group` only orders the "add property" menu.
		 */
		const PROPERTY_UI = [
			{ group: '布局', name: 'display', label: '显示', values: [['flex', '弹性布局'], ['grid', '网格'], ['block', '块级'], ['inline-block', '行内块'], ['inline', '行内'], ['none', '隐藏']] },
			{ group: '布局', name: 'position', label: '定位', values: [['static', '常规'], ['relative', '相对'], ['absolute', '绝对'], ['fixed', '固定'], ['sticky', '吸顶']] },
			{ group: '布局', name: 'top', label: '上偏移', seed: '0', hint: '0 / 12px / auto' },
			{ group: '布局', name: 'right', label: '右偏移', seed: '0', hint: '0 / 12px / auto' },
			{ group: '布局', name: 'bottom', label: '下偏移', seed: '0', hint: '0 / 12px / auto' },
			{ group: '布局', name: 'left', label: '左偏移', seed: '0', hint: '0 / 12px / auto' },
			{ group: '布局', name: 'inset', label: '四边偏移', join: ' ', collapse: true, parts: [{ label: '上', hint: '0 / 12px / auto', seed: '0' }, { label: '右', hint: '0 / 12px / auto', seed: '0' }, { label: '下', hint: '0 / 12px / auto', seed: '0' }, { label: '左', hint: '0 / 12px / auto', seed: '0' }] },
			{ group: '布局', name: 'z-index', label: '层级', seed: '10', hint: '10 / -1' },
			{ group: '布局', name: 'float', label: '浮动', values: [['none', '不浮动'], ['left', '左浮'], ['right', '右浮']] },
			{ group: '布局', name: 'clear', label: '清除浮动', values: [['none', '不清除'], ['left', '清左'], ['right', '清右'], ['both', '两侧']] },
			{ group: '布局', name: 'overflow', label: '溢出', values: [['visible', '可见'], ['hidden', '裁剪'], ['auto', '按需滚动'], ['scroll', '总是滚动']] },
			{ group: '布局', name: 'overflow-x', label: '横向溢出', values: [['visible', '可见'], ['hidden', '裁剪'], ['auto', '按需滚动'], ['scroll', '总是滚动']] },
			{ group: '布局', name: 'overflow-y', label: '纵向溢出', values: [['visible', '可见'], ['hidden', '裁剪'], ['auto', '按需滚动'], ['scroll', '总是滚动']] },
			{ group: '布局', name: 'box-sizing', label: '盒模型', values: [['border-box', '含边框'], ['content-box', '不含边框']] },
			{ group: '尺寸', name: 'aspect-ratio', label: '宽高比', join: ' / ', parts: [{ label: '宽', hint: '16', seed: '16' }, { label: '高', hint: '9', seed: '9' }] },
			{ group: '布局', name: 'clip-path', label: '裁剪形状', seed: 'inset(0 0 0 0)', hint: 'circle(50%)' },
			{ group: '布局', name: 'contain', label: '包含优化', values: [['none', '无'], ['layout', '布局'], ['paint', '绘制'], ['size', '尺寸'], ['strict', '全部'], ['content', '内容']] },
			{ group: '布局', name: 'isolation', label: '层叠隔离', values: [['auto', '自动'], ['isolate', '独立']] },
			{ group: '弹性与对齐', name: 'flex-direction', label: '主轴方向', values: [['row', '水平排列'], ['column', '垂直排列'], ['row-reverse', '水平反向'], ['column-reverse', '垂直反向']] },
			{ group: '弹性与对齐', name: 'flex-wrap', label: '换行方式', values: [['nowrap', '不换行'], ['wrap', '允许换行'], ['wrap-reverse', '反向换行']] },
			{ group: '弹性与对齐', name: 'justify-content', label: '主轴对齐', values: [['flex-start', '靠起始边'], ['center', '居中'], ['flex-end', '靠结束边'], ['space-between', '两端对齐'], ['space-around', '环绕'], ['space-evenly', '均分']] },
			{ group: '弹性与对齐', name: 'align-items', label: '交叉轴对齐', values: [['stretch', '拉伸'], ['flex-start', '靠起始边'], ['center', '居中'], ['flex-end', '靠结束边'], ['baseline', '基线']] },
			{ group: '弹性与对齐', name: 'align-content', label: '多行对齐', values: [['stretch', '拉伸'], ['flex-start', '靠起始边'], ['center', '居中'], ['flex-end', '靠结束边'], ['space-between', '两端对齐'], ['space-around', '环绕']] },
			{ group: '弹性与对齐', name: 'align-self', label: '自身对齐', values: [['auto', '跟随父级'], ['stretch', '拉伸'], ['flex-start', '靠起始边'], ['center', '居中'], ['flex-end', '靠结束边'], ['baseline', '基线']] },
			{ group: '弹性与对齐', name: 'place-items', label: '网格对齐', values: [['center', '居中'], ['stretch', '拉伸'], ['start', '靠起始边'], ['end', '靠结束边']] },
			{ group: '弹性与对齐', name: 'justify-items', label: '网格水平对齐', values: [['stretch', '拉伸'], ['start', '靠起始边'], ['center', '居中'], ['end', '靠结束边']] },
			{ group: '弹性与对齐', name: 'gap', label: '间距', join: ' ', collapse: true, parts: [{ label: '行间距', hint: '8px', seed: '8px' }, { label: '列间距', hint: '8px', seed: '8px' }] },
			{ group: '弹性与对齐', name: 'row-gap', label: '行间距', seed: '8px', hint: '8px' },
			{ group: '弹性与对齐', name: 'column-gap', label: '列间距', seed: '8px', hint: '8px' },
			{ group: '弹性与对齐', name: 'flex', label: '弹性简写', join: ' ', parts: [{ label: '放大', hint: '1 / 0', seed: '1' }, { label: '收缩', hint: '1 / 0', seed: '1' }, { label: '基准尺寸', hint: 'auto / 0 / 240px', seed: 'auto' }] },
			{ group: '弹性与对齐', name: 'flex-grow', label: '放大比例', seed: '1', hint: '1 / 0' },
			{ group: '弹性与对齐', name: 'flex-shrink', label: '收缩比例', seed: '0', hint: '1 / 0' },
			{ group: '弹性与对齐', name: 'flex-basis', label: '基准尺寸', seed: 'auto', hint: 'auto / 0 / 240px' },
			{ group: '弹性与对齐', name: 'order', label: '排列次序', seed: '0', hint: '-1 / 0 / 2' },
			{ group: '网格', name: 'grid-template-columns', label: '网格列', seed: 'repeat(2, minmax(0, 1fr))', hint: '1fr 1fr' },
			{ group: '网格', name: 'grid-template-rows', label: '网格行', seed: 'auto', hint: 'auto / 1fr' },
			{ group: '网格', name: 'grid-auto-flow', label: '自动流向', values: [['row', '按行'], ['column', '按列'], ['row dense', '按行密集'], ['column dense', '按列密集']] },
			{ group: '网格', name: 'grid-column', label: '列跨度', seed: '1 / -1', hint: '1 / -1' },
			{ group: '网格', name: 'grid-row', label: '行跨度', seed: 'auto', hint: 'auto / 1 / 3' },
			{ group: '尺寸', name: 'width', label: '宽度', seed: '100%', hint: '100% / 240px / auto' },
			{ group: '尺寸', name: 'height', label: '高度', seed: 'auto', hint: 'auto / 40px' },
			{ group: '尺寸', name: 'min-width', label: '最小宽度', seed: '0', hint: '0 / 120px' },
			{ group: '尺寸', name: 'max-width', label: '最大宽度', seed: '100%', hint: '100% / 480px' },
			{ group: '尺寸', name: 'min-height', label: '最小高度', seed: '0', hint: '0 / 32px' },
			{ group: '尺寸', name: 'max-height', label: '最大高度', seed: '240px', hint: '240px / none' },
			{ group: '间距', name: 'margin', label: '外边距', join: ' ', collapse: true, parts: [{ label: '上', hint: '0 / 8px / auto', seed: '0' }, { label: '右', hint: '0 / 8px / auto', seed: '0' }, { label: '下', hint: '0 / 8px / auto', seed: '0' }, { label: '左', hint: '0 / 8px / auto', seed: '0' }] },
			{ group: '间距', name: 'margin-top', label: '上外边距', seed: '0', hint: '0 / 8px / auto' },
			{ group: '间距', name: 'margin-right', label: '右外边距', seed: '0', hint: '0 / 8px / auto' },
			{ group: '间距', name: 'margin-bottom', label: '下外边距', seed: '0', hint: '0 / 8px / auto' },
			{ group: '间距', name: 'margin-left', label: '左外边距', seed: '0', hint: '0 / 8px / auto' },
			{ group: '间距', name: 'padding', label: '内边距', join: ' ', collapse: true, parts: [{ label: '上', hint: '8px', seed: '8px' }, { label: '右', hint: '8px', seed: '8px' }, { label: '下', hint: '8px', seed: '8px' }, { label: '左', hint: '8px', seed: '8px' }] },
			{ group: '间距', name: 'padding-top', label: '上内边距', seed: '8px', hint: '8px' },
			{ group: '间距', name: 'padding-right', label: '右内边距', seed: '8px', hint: '8px' },
			{ group: '间距', name: 'padding-bottom', label: '下内边距', seed: '8px', hint: '8px' },
			{ group: '间距', name: 'padding-left', label: '左内边距', seed: '8px', hint: '8px' },
			{ group: '文本', name: 'color', label: '文字颜色', seed: 'currentColor', hint: '#333 / currentColor' },
			{ group: '文本', name: 'font', label: '字体简写', seed: '14px/22px inherit', hint: '14px/22px inherit' },
			{ group: '文本', name: 'font-family', label: '字体', seed: 'inherit', hint: 'inherit / ui-monospace' },
			{ group: '文本', name: 'font-size', label: '字号', seed: '14px', hint: '14px / 0.875rem' },
			{ group: '文本', name: 'font-weight', label: '字重', values: [['400', '常规'], ['500', '中等'], ['600', '半粗'], ['700', '粗'], ['normal', '常规（关键字）'], ['bold', '粗体（关键字）']] },
			{ group: '文本', name: 'font-style', label: '字体样式', values: [['normal', '正常'], ['italic', '斜体']] },
			{ group: '文本', name: 'font-variant-numeric', label: '数字字形', values: [['normal', '默认'], ['tabular-nums', '等宽数字']] },
			{ group: '文本', name: 'line-height', label: '行高', seed: '22px', hint: '22px / 1.5' },
			{ group: '文本', name: 'letter-spacing', label: '字距', seed: '0.02em', hint: '0.02em / -0.01em' },
			{ group: '文本', name: 'text-align', label: '文本对齐', values: [['left', '左'], ['center', '居中'], ['right', '右'], ['justify', '两端']] },
			{ group: '文本', name: 'text-decoration', label: '文本装饰', values: [['none', '无'], ['underline', '下划线'], ['line-through', '删除线']] },
			{ group: '文本', name: 'text-transform', label: '大小写', values: [['none', '原样'], ['uppercase', '全大写'], ['lowercase', '全小写'], ['capitalize', '首字母大写']] },
			{ group: '文本', name: 'text-overflow', label: '溢出省略', values: [['clip', '裁剪'], ['ellipsis', '省略号']] },
			{ group: '文本', name: 'text-shadow', label: '文字阴影', seed: '0 1px 2px rgb(0 0 0 / 20%)', hint: '0 1px 2px rgb(0 0 0 / 20%)' },
			{ group: '文本', name: 'text-indent', label: '首行缩进', seed: '0', hint: '0 / 2em' },
			{ group: '文本', name: 'white-space', label: '空白处理', values: [['normal', '正常'], ['nowrap', '不换行'], ['pre', '保留'], ['pre-wrap', '保留并换行']] },
			{ group: '文本', name: 'word-break', label: '断词方式', values: [['normal', '正常'], ['break-all', '任意断词'], ['keep-all', '不断词']] },
			{ group: '文本', name: 'overflow-wrap', label: '长词换行', values: [['normal', '正常'], ['anywhere', '任意位置'], ['break-word', '长词断行']] },
			{ group: '文本', name: 'vertical-align', label: '垂直对齐', values: [['baseline', '基线'], ['middle', '居中'], ['top', '顶端'], ['bottom', '底端']] },
			{ group: '背景', name: 'background', label: '背景简写', seed: 'transparent', hint: 'transparent / #fff' },
			{ group: '背景', name: 'background-color', label: '背景色', seed: 'transparent', hint: 'transparent / #f5f6f7' },
			{ group: '背景', name: 'background-image', label: '背景图', seed: 'none', hint: 'none / url(...)' },
			{ group: '背景', name: 'background-size', label: '背景尺寸', values: [['auto', '原始尺寸'], ['cover', '覆盖'], ['contain', '完整显示']] },
			{ group: '背景', name: 'background-position', label: '背景位置', values: [['center', '居中'], ['top', '顶部'], ['bottom', '底部'], ['left', '左侧'], ['right', '右侧']] },
			{ group: '背景', name: 'background-repeat', label: '背景重复', values: [['no-repeat', '不重复'], ['repeat', '重复'], ['repeat-x', '横向重复'], ['repeat-y', '纵向重复']] },
			{ group: '背景', name: 'background-clip', label: '背景裁剪', values: [['border-box', '含边框'], ['padding-box', '含内边距'], ['content-box', '仅内容'], ['text', '按文字']] },
			{ group: '背景', name: 'backdrop-filter', label: '背景模糊', seed: 'blur(8px)', hint: 'blur(8px)' },
			{ group: '背景', name: 'mix-blend-mode', label: '混合模式', values: [['normal', '正常'], ['multiply', '正片叠底'], ['screen', '滤色'], ['overlay', '叠加'], ['soft-light', '柔光']] },
			{ group: '描边与圆角', name: 'border', label: '边框简写', seed: '1px solid currentColor', hint: '1px solid currentColor' },
			{ group: '描边与圆角', name: 'border-width', label: '边框宽度', seed: '1px', hint: '1px / 0.5px' },
			{ group: '描边与圆角', name: 'border-style', label: '边框样式', values: [['solid', '实线'], ['dashed', '虚线'], ['dotted', '点线'], ['none', '无']] },
			{ group: '描边与圆角', name: 'border-color', label: '边框颜色', seed: 'currentColor', hint: 'currentColor / #0000001a' },
			{ group: '描边与圆角', name: 'border-radius', label: '圆角', join: ' ', collapse: true, parts: [{ label: '左上', hint: '8px / 999px', seed: '8px' }, { label: '右上', hint: '8px', seed: '8px' }, { label: '右下', hint: '8px', seed: '8px' }, { label: '左下', hint: '8px', seed: '8px' }] },
			{ group: '描边与圆角', name: 'border-top-left-radius', label: '左上圆角', seed: '8px', hint: '8px' },
			{ group: '描边与圆角', name: 'border-top-right-radius', label: '右上圆角', seed: '8px', hint: '8px' },
			{ group: '描边与圆角', name: 'border-bottom-left-radius', label: '左下圆角', seed: '8px', hint: '8px' },
			{ group: '描边与圆角', name: 'border-bottom-right-radius', label: '右下圆角', seed: '8px', hint: '8px' },
			{ group: '描边与圆角', name: 'outline', label: '轮廓', seed: '2px solid', hint: '2px solid var(--dsw-alias-brand-primary)' },
			{ group: '描边与圆角', name: 'outline-offset', label: '轮廓偏移', seed: '2px', hint: '2px' },
			{ group: '效果与动效', name: 'box-shadow', label: '阴影', seed: '0 2px 8px rgb(0 0 0 / 12%)', hint: '0 2px 8px rgb(0 0 0 / 12%)' },
			{ group: '效果与动效', name: 'opacity', label: '不透明度', seed: '0.6', hint: '0.6 / 1' },
			{ group: '效果与动效', name: 'filter', label: '滤镜', seed: 'blur(2px)', hint: 'blur(2px) / none' },
			{ group: '效果与动效', name: 'transform', label: '变换', seed: 'translateY(-2px)', hint: 'translateY(-2px) / scale(1.02)' },
			{ group: '效果与动效', name: 'transform-origin', label: '变换原点', values: [['center', '居中'], ['top', '顶部'], ['bottom', '底部'], ['left', '左侧'], ['right', '右侧'], ['top left', '左上'], ['bottom right', '右下']] },
			{ group: '效果与动效', name: 'transition', label: '过渡', seed: 'all 160ms ease', hint: 'all 160ms ease' },
			{ group: '效果与动效', name: 'animation', label: '动画', seed: 'none', hint: 'none / spin 18s linear infinite' },
			{ group: '效果与动效', name: 'will-change', label: '提前优化', seed: 'transform', hint: 'transform / opacity' },
			{ group: '效果与动效', name: 'scroll-behavior', label: '滚动行为', values: [['auto', '立即'], ['smooth', '平滑']] },
			{ group: '效果与动效', name: 'scrollbar-width', label: '滚动条宽度', values: [['auto', '默认'], ['thin', '细'], ['none', '隐藏']] },
			{ group: '交互', name: 'pointer-events', label: '鼠标事件', values: [['auto', '正常'], ['none', '穿透']] },
			{ group: '交互', name: 'cursor', label: '光标', values: [['default', '默认'], ['pointer', '手型'], ['text', '文本'], ['not-allowed', '禁止'], ['grab', '抓取'], ['zoom-in', '放大']] },
			{ group: '交互', name: 'visibility', label: '可见性', values: [['visible', '可见'], ['hidden', '隐藏']] },
			{ group: '交互', name: 'user-select', label: '文本选择', values: [['auto', '自动'], ['none', '不可选'], ['text', '可选'], ['all', '全选']] },
			{ group: '交互', name: 'caret-color', label: '光标颜色', seed: 'currentColor', hint: 'currentColor / #333' },
			{ group: '交互', name: 'accent-color', label: '主题色', seed: 'auto', hint: 'auto / #4d6bfe' },
			{ group: '交互', name: 'object-fit', label: '替换内容适配', values: [['fill', '拉伸'], ['contain', '完整显示'], ['cover', '覆盖'], ['none', '原始'], ['scale-down', '缩小']] },
			{ group: '交互', name: 'content', label: '生成内容', seed: '""', hint: '"" / "→"' },
		];

		/** Menu group order, derived from the dictionary so the two cannot drift. */
		const PROPERTY_GROUPS = [...new Set(PROPERTY_UI.map(entry => entry.group))];

		/**
		 * The value a freshly added property starts from: its first enum option, or
		 * the seed of a free property.
		 * @param entry - a dictionary entry.
		 * @returns the starting value.
		 */
		function initialValue(entry) {
			// A shorthand seeds from its parts, so adding `flex` writes a usable value.
			if (entry.parts !== undefined) return joinParts(entry.parts.map(part => part.seed ?? ''), entry);
			return entry.values?.[0]?.[0] ?? entry.seed ?? '';
		}

		/**
		 * Split a declaration into one token per part of a shorthand.
		 *
		 * The 1/2/3-token forms of a four-sided shorthand expand the way CSS defines
		 * them (`a` → all four, `a b` → a b a b, `a b c` → a b c b), so the fields start
		 * from what the sheet actually means.
		 * @param value - the declaration value.
		 * @param entry - a dictionary entry carrying `parts`.
		 * @returns one string per part.
		 */
		function splitParts(value, entry) {
			const raw = value.trim();
			const tokens = raw === ''
				? []
				: raw.split(entry.join === ' / ' ? '/' : /\s+/).map(token => token.trim()).filter(token => token !== '');
			if (entry.collapse === true && entry.parts.length === 4) {
				if (tokens.length === 1) return [tokens[0], tokens[0], tokens[0], tokens[0]];
				if (tokens.length === 2) return [tokens[0], tokens[1], tokens[0], tokens[1]];
				if (tokens.length === 3) return [tokens[0], tokens[1], tokens[2], tokens[1]];
			}
			if (entry.collapse === true && entry.parts.length === 2 && tokens.length === 1) {
				return [tokens[0], tokens[0]];
			}
			return entry.parts.map((part, index) => tokens[index] ?? '');
		}

		/**
		 * Rebuild a shorthand value from its fields.
		 *
		 * Collapsible shorthands are written back in their shortest equivalent form
		 * (`8px 8px 8px 8px` → `8px`), so editing one corner does not silently rewrite
		 * the rest of the sheet into a verbose shape.
		 * @param values - one string per part.
		 * @param entry - a dictionary entry carrying `parts`.
		 * @returns the declaration value.
		 */
		function joinParts(values, entry) {
			const separator = entry.join === ' / ' ? ' / ' : ' ';
			const tokens = values.map(value => value.trim());
			if (entry.collapse === true) {
				if (tokens.every(token => token === '')) return '';
				if (entry.parts.length === 4) {
					const [top, right, bottom, left] = tokens;
					if (top === right && right === bottom && bottom === left) return top;
					if (top === bottom && right === left) return top + ' ' + right;
					if (right === left) return [top, right, bottom].join(' ');
					return tokens.join(' ');
				}
				const [first, second] = tokens;
				if (first === '' || second === '' || first === second) return first === '' ? second : first;
				return first + ' ' + second;
			}
			// A trailing empty part drops off; a gap in the middle keeps that part's seed,
			// because writing `flex: 1 100%` would mean grow=1, shrink=100%.
			let last = -1;
			tokens.forEach((token, index) => {
				if (token !== '') last = index;
			});
			return tokens
				.slice(0, last + 1)
				  .map((token, index) => (token === '' ? (entry.parts[index].seed ?? '') : token))
				  .join(separator);
		}

		/**
		 * Read one rule's declarations into a property → value map.
		 * @param css - the sheet text.
		 * @param rule - a record from `parseRules`.
		 * @returns the values keyed by lower-cased property name.
		 */
		function readDeclarations(css, rule) {
			const found = new Map();
			// Normalise first: a block whose declarations lost their `;` is otherwise one
			// giant piece that matches nothing, and the panel claims the rule is empty
			// even though the writer would have normalised it on the next edit. The split
			// is shared with the writer, so a `;` inside a string cannot truncate a value.
			const body = normaliseBlock(css.slice(rule.bodyStart, rule.bodyEnd));
			for (const entry of splitDeclarations(body)) {
				// The name is matched on the blanked copy (a comment in front of it
				// would hide it), but the VALUE is read from the original chunk: a
				// comment after the colon is part of the file, and showing the blanked
				// text both hid it and made the writer's head pattern drop it.
				const blanked = blankComments(entry.chunk);
				const match = /^\s*([-\w]+)\s*:/.exec(blanked);
				if (match === null) continue;
				found.set(match[1].toLowerCase(), entry.chunk.slice(blanked.indexOf(':', match[1].length) + 1).trim());
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
			return mapStructure(body, gap => gap.replace(/([^\s;{}])\s*\n(\s*[-\w]+\s*:)/g, '$1;\n$2'));
		}

		/**
		 * Scan one CSS string literal.
		 *
		 * Strings are opaque in CSS: they may contain `{`, `}`, `;`, `:` and even
		 * `/*`. This is the only place that knows whether the closing quote was
		 * actually found — a caller inferring it from the last character gets a
		 * trailing escaped quote (a quoted run ending in backslash-quote) wrong,
		 * because that quote is escaped and the string is still open.
		 * @param text - the text to scan.
		 * @param start - index of the opening quote.
		 * @returns the index after the closing quote (or the end of the text), and
		 *   whether the closing quote was found.
		 */
		function scanString(text, start) {
			const quote = text[start];
			let index = start + 1;
			while (index < text.length) {
				if (text[index] === '\\') {
					index += 2;
					continue;
				}
				if (text[index] === quote) return { stop: index + 1, closed: true };
				index += 1;
			}
			return { stop: text.length, closed: false };
		}

		/**
		 * Index just past a CSS string literal.
		 * @param text - the text to scan.
		 * @param start - index of the opening quote.
		 * @returns the index after the closing quote, or the end of the text.
		 */
		function skipString(text, start) {
			return scanString(text, start).stop;
		}

		/**
		 * Scan one comment.
		 *
		 * The comment's own closing marker is the other thing every scanner used to
		 * re-derive by hand; asking here keeps "is it closed?" in one place.
		 * @param text - the text to scan.
		 * @param start - index of the opening slash-star.
		 * @returns the index after the closing marker (or the end of the text), and
		 *   whether the closing marker was found.
		 */
		function scanComment(text, start) {
			const end = text.indexOf('*/', start + 2);
			return end < 0 ? { stop: text.length, closed: false } : { stop: end + 2, closed: true };
		}

		/**
		 * Whether a url( token starts at this index, ignoring case and any
		 * identifier character in front of it.
		 * @param text - the text to inspect.
		 * @param index - candidate offset.
		 * @returns true when the offset opens a url token.
		 */
		function isUrlStart(text, index) {
			if (text.slice(index, index + 4).toLowerCase() !== 'url(') return false;
			const before = index === 0 ? '' : text[index - 1];
			return before === '' || !/[-\w]/.test(before);
		}

		/**
		 * Index just past a url(...) token, quoted or not.
		 *
		 * An unquoted url may legally contain a semicolon — every base64 data URI
		 * does — and a scanner that splits declarations on the bare character cuts
		 * the value in half and then welds the tail onto the next declaration.
		 * @param text - the text to scan.
		 * @param start - index of the u in url(.
		 * @returns the index after the closing paren, or the end of the text.
		 */
		function skipUrl(text, start) {
			const open = text.indexOf('(', start + 3);
			if (open < 0) return start + 3;
			let index = open + 1;
			while (index < text.length) {
				const ch = text[index];
				if (ch === '"' || ch === "'") {
					index = skipString(text, index);
					continue;
				}
				if (ch === ')') return index + 1;
				index += 1;
			}
			return text.length;
		}

		/**
		 * Index just past a nested block, braces included.
		 *
		 * CSS nesting puts a whole rule inside another rule's body, and its interior
		 * semicolons are not the outer rule's declaration separators.
		 * @param text - the text to scan.
		 * @param start - index of the opening brace.
		 * @returns the index after the matching closing brace, or the end of the text.
		 */
		function skipBlock(text, start) {
			let depth = 0;
			let index = start;
			while (index < text.length) {
				const ch = text[index];
				if (ch === '"' || ch === "'") {
					index = skipString(text, index);
					continue;
				}
				if (ch === '/' && text[index + 1] === '*') {
					index = scanComment(text, index).stop;
					continue;
				}
				if (ch === '{') depth += 1;
				else if (ch === '}') {
					depth -= 1;
					if (depth === 0) return index + 1;
				}
				index += 1;
			}
			return text.length;
		}

		/**
		 * Apply a transform to the parts of a fragment that are not strings,
		 * comments, `url()` tokens or nested blocks.
		 *
		 * A regex over the whole body cannot tell a comment from the code it reads
		 * like: a Chinese or English comment whose second line starts with a property
		 * name looked exactly like a missing-semicolon boundary, so normalising one
		 * declaration edited the comment's text instead.
		 * @param text - the fragment to process.
		 * @param transform - applied to each structural gap in turn.
		 * @returns the fragment with every gap transformed.
		 */
		function mapStructure(text, transform) {
			let out = '';
			let cursor = 0;
			let index = 0;
			while (index < text.length) {
				const ch = text[index];
				let stop = -1;
				if (ch === '"' || ch === "'") stop = skipString(text, index);
				else if (ch === '/' && text[index + 1] === '*') {
					stop = scanComment(text, index).stop;
				}
				else if (isUrlStart(text, index)) stop = skipUrl(text, index);
				else if (ch === '{') stop = skipBlock(text, index);
				if (stop < 0) {
					index += 1;
					continue;
				}
				out += transform(text.slice(cursor, index)) + text.slice(index, stop);
				cursor = stop;
				index = stop;
			}
			return out + transform(text.slice(cursor));
		}

		/**
		 * The real comments in a fragment — not text that merely looks like one
		 * because it sits inside a string.
		 * @param text - the fragment to scan.
		 * @returns the comments in source order.
		 */
		function commentsIn(text) {
			const found = [];
			let index = 0;
			while (index < text.length) {
				const ch = text[index];
				if (ch === '"' || ch === "'") {
					index = skipString(text, index);
					continue;
				}
				if (ch === '/' && text[index + 1] === '*') {
					const stop = scanComment(text, index).stop;
					found.push(text.slice(index, stop));
					index = stop;
					continue;
				}
				index += 1;
			}
			return found;
		}

		/**
		 * Replace comments with spaces, leaving every offset intact.
		 *
		 * Used before matching a declaration: a chunk may be led by a comment, and the
		 * property regex would otherwise meet `/` instead of a name. Same length in,
		 * same length out, so the caller can still slice the original text by offset.
		 * @param text - block interior or a single chunk.
		 * @returns the same text with comment bodies blanked.
		 */
		function blankComments(text) {
			let out = '';
			let index = 0;
			while (index < text.length) {
				const ch = text[index];
				if (ch === '"' || ch === "'") {
					const stop = skipString(text, index);
					out += text.slice(index, stop);
					index = stop;
					continue;
				}
				if (ch === '/' && text[index + 1] === '*') {
					const stop = scanComment(text, index).stop;
					out += ' '.repeat(stop - index);
					index = stop;
					continue;
				}
				out += ch;
				index += 1;
			}
			return out;
		}

		/**
		 * Split a block interior into declaration chunks.
		 *
		 * `;` separates declarations — except when it sits inside a string or a comment.
		 * Both the reader and the writer go through this so they cannot disagree about
		 * where one declaration ends.
		 * @param body - block interior.
		 * @returns chunks with offsets, text and terminator, in source order.
		 */
		function splitDeclarations(body) {
			const chunks = [];
			let cursor = 0;
			let index = 0;
			while (index < body.length) {
				const ch = body[index];
				if (ch === '"' || ch === "'") {
					index = skipString(body, index);
					continue;
				}
				if (ch === '/' && body[index + 1] === '*') {
					index = scanComment(body, index).stop;
					continue;
				}
				if (isUrlStart(body, index)) {
					index = skipUrl(body, index);
					continue;
				}
				if (ch === '{') {
					// A nested rule keeps its own semicolons: close the chunk that leads
					// up to it, then hand the whole block back as one opaque piece. Both
					// halves are text the writer reassembles verbatim, and neither looks
					// like a declaration, so the panel never offers to edit inside them.
					const stop = skipBlock(body, index);
					chunks.push({ start: cursor, end: index, chunk: body.slice(cursor, index), terminator: '' });
					chunks.push({ start: index, end: stop, chunk: body.slice(index, stop), terminator: '' });
					index = stop;
					cursor = stop;
					continue;
				}
				if (ch === ';') {
					chunks.push({ start: cursor, end: index, chunk: body.slice(cursor, index), terminator: ';' });
					index += 1;
					cursor = index;
					continue;
				}
				index += 1;
			}
			if (cursor < body.length) {
				chunks.push({ start: cursor, end: body.length, chunk: body.slice(cursor), terminator: '' });
			}
			return chunks;
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
			// Everything below works on the NORMALISED body and writes that body back. The
			// fast path used to slice the original sheet with offsets measured on the
			// normalised copy, so one inserted `;` earlier in the block shifted the cut and
			// ate whatever followed — up to and including the closing brace.
			const body = normaliseBlock(css.slice(rule.bodyStart, rule.bodyEnd));
			const lower = name.toLowerCase();
			// One shared splitter (string- and comment-aware) plus blanked copies for
			// matching: a chunk led by a comment starts with `/`, and the property regex
			// would otherwise miss it — appending a second copy instead of replacing.
			const chunks = splitDeclarations(body);
			for (const entry of chunks) {
				const match = /^\s*([-\w]+)\s*:/.exec(blankComments(entry.chunk));
				entry.target = match !== null && match[1].toLowerCase() === lower;
			}

			const matching = chunks.filter(entry => entry.target);
			const only = matching.length === 1 ? matching[0] : null;
			// The common case: rewrite the value where it already sits, keeping the head
			// — including any comment that shares the chunk. Comments are whitespace
			// between tokens, so one may also sit between the name and its colon: the
			// pattern allows them on both sides, and a chunk that still does not match
			// falls through to the rewrite below rather than dereferencing null.
			const head = only === null || value === ''
				? null
				: /^(\s*(?:\/\*[\s\S]*?\*\/\s*)*[-\w]+\s*(?:\/\*[\s\S]*?\*\/\s*)*:\s*)/.exec(only.chunk);
			if (head !== null) {
				const nextBody = body.slice(0, only.start) + head[1] + value + body.slice(only.end);
				return css.slice(0, rule.bodyStart) + nextBody + css.slice(rule.bodyEnd);
			}

			// Otherwise edit for real: drop every copy — keeping any comment that shared
			// its chunk — then append one when there is a value. This also cleans up
			// duplicates an older build left behind.
			const keptParts = [];
			for (const entry of chunks) {
				if (!entry.target) {
					keptParts.push(entry.chunk + entry.terminator);
					continue;
				}
				const comments = commentsIn(entry.chunk);
				if (comments.length > 0) keptParts.push(comments.join('\n') + '\n');
			}
			const kept = keptParts.join('').trim();
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
		/**
		 * A dropdown for the rule panel.
		 *
		 * The native `<select>` popup cannot be styled — it renders square with the OS
		 * palette — so the panel uses the same own-element menu as the sheet picker
		 * (rounded, layered, DSH tokens). The menu is positioned `fixed` from the
		 * trigger's rect: the panel's own scrolling and the container's `overflow:
		 * hidden` cannot clip it, and it flips above the trigger when the viewport has
		 * no room below.
		 * @param props - items, current label, aria label, wrapper class and pick callback.
		 * @returns the trigger plus, while open, the menu.
		 */
		function Dropdown(props) {
			const [open, setOpen] = React.useState(false);
			const triggerRef = React.useRef(null);
			const menuRef = React.useRef(null);

			React.useEffect(() => {
				if (!open) return undefined;
				// The effect is inert without a DOM (contract tests drive the props instead).
				if (typeof document.addEventListener !== 'function') return undefined;
				const onPointerDown = (event) => {
					if (triggerRef.current?.contains(event.target)) return;
					if (menuRef.current?.contains(event.target)) return;
					setOpen(false);
				};
				document.addEventListener('mousedown', onPointerDown);
				return () => {
					document.removeEventListener('mousedown', onPointerDown);
				};
			}, [open]);

			const rect = open ? triggerRef.current?.getBoundingClientRect() : undefined;
			const viewport = typeof window === 'undefined' ? 0 : window.innerHeight;
			const flipUp = rect !== undefined && viewport > 0
				&& viewport - rect.bottom < 240 && rect.top > 240;
			const menuStyle = rect === undefined
				? undefined
				: {
					position: 'fixed',
					left: Math.round(rect.left) + 'px',
					minWidth: Math.round(rect.width) + 'px',
					maxHeight: '260px',
					...(flipUp
						? { bottom: Math.round(viewport - rect.top + 4) + 'px' }
						  : { top: Math.round(rect.bottom + 4) + 'px' }),
				};

			const rows = [];
			let lastGroup = null;
			for (const item of props.items) {
				if (item.group !== undefined && item.group !== lastGroup) {
					lastGroup = item.group;
					rows.push(React.createElement(
						'div',
						{ key: 'group-' + item.group, className: 'dshCc_selectGroup' },
						item.group,
					));
				}
				rows.push(React.createElement(
					'button',
					{
						key: item.value === '' ? 'empty' : item.value,
						type: 'button',
						role: 'option',
						className: 'dshCc_selectItem',
						'aria-selected': item.selected === true,
						onClick: () => {
							setOpen(false);
							props.onPick(item.value);
						},
					},
					React.createElement('span', { className: 'dshCc_selectLabel' }, item.label),
					item.selected === true ? React.createElement(CheckMark, {}) : null,
				));
			}

			return React.createElement(
				'span',
				{ className: 'dshCc_selectWrap' + (props.wrapperClassName === undefined ? '' : ' ' + props.wrapperClassName) },
				React.createElement(
					'button',
					{
						type: 'button',
						ref: triggerRef,
						className: 'dshCc_select' + (open ? ' dshCc_selectOpen' : ''),
						'aria-haspopup': 'listbox',
						'aria-expanded': open,
						'aria-label': props.ariaLabel,
						onClick: () => {
							setOpen(!open);
						},
					},
					React.createElement('span', { className: 'dshCc_selectValue' }, props.display),
					React.createElement(ChevronDown, {}),
				),
				open ? React.createElement('div', {
					className: 'dshCc_selectMenu',
					role: 'listbox',
					ref: menuRef,
					style: menuStyle,
				}, ...rows) : null,
			);
		}
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
			/**
			 * Index of the rule the panel is open on, or null.
			 *
			 * By index, not by selector text: two rules may legally share a selector,
			 * and looking the open one up by text bound the panel — and every write it
			 * made — to the FIRST of them, so editing the second one edited the first.
			 */
			const [openIndex, setOpenIndex] = React.useState(null);
			/** Raw text of the selector field while it is being edited. */
			const [selectorDraft, setSelectorDraft] = React.useState(null);
			/** Whether the actions menu is open. */
			const [actionsOpen, setActionsOpen] = React.useState(false);
			/** Whether the element picker is armed (the settings surface steps aside). */
			const [picking, setPicking] = React.useState(false);
			/** Candidates for the element just picked, best first. */
			const [picked, setPicked] = React.useState(null);
			/** Token declarations offered for the picked element. */
			const [pickedTokens, setPickedTokens] = React.useState([]);
			/** Which candidate is selected, and which token chips are switched off. */
			const [pickedChoice, setPickedChoice] = React.useState(0);
			const [pickedOff, setPickedOff] = React.useState([]);
			const rowRef = React.useRef(null);
			/** Selector appended by the picker, to be opened once the sheet has it. */
			const pendingOpen = React.useRef(null);

			// A draft belongs to the rule it was typed in: moving the panel to another
			// rule must not show that rule the previous one's half-typed selector.
			React.useEffect(() => {
				setSelectorDraft(null);
			}, [openIndex]);

			/**
			 * Arm the element picker.
			 *
			 * The settings surface covers the very thing the user wants to click, so it
			 * is dimmed and made click-through for the session; the highlight box and the
			 * hint bar live outside it, on the document, or they would be dimmed too.
			 */
			React.useEffect(() => {
				if (!picking) return undefined;
				const surface = surfaceToMoveAside(rowRef.current, document.documentElement, {
					width: window.innerWidth,
					height: window.innerHeight,
				});
				if (surface !== null) surface.setAttribute('data-dshCc-picking', 'true');
				const box = document.createElement('div');
				box.className = 'dshCc_pickBox';
				// The toolbar is appended to the document, outside the dimmed surface, and
				// is clickable — otherwise the only way out of picking mode is a key
				// nobody was told about, and the interface looks dead.
				const bar = document.createElement('div');
				bar.className = 'dshCc_pickBar';
				const readout = document.createElement('span');
				readout.className = 'dshCc_pickBarInfo';
				readout.textContent = '把指针移到要改的元素上 · ↑↓ 换层级 · ←→ 换同级 · Enter 确认 · Esc 取消';
				const barButton = (label, onClick) => {
					const button = document.createElement('button');
					button.type = 'button';
					button.className = 'dshCc_pickBarBtn';
					button.textContent = label;
					button.addEventListener('click', onClick);
					return button;
				};
				let session = null;
				bar.appendChild(readout);
				bar.appendChild(barButton('上一级', () => session?.step('parent')));
				bar.appendChild(barButton('下一级', () => session?.step('child')));
				bar.appendChild(barButton('上一个', () => session?.step('previous')));
				bar.appendChild(barButton('下一个', () => session?.step('next')));
				bar.appendChild(barButton('取消', () => {
					session?.stop();
					setPicking(false);
				}));
				document.body.appendChild(box);
				document.body.appendChild(bar);
				const started = startPickSession({
					listen: (type, handler, capture) => {
						document.addEventListener(type, handler, capture === true);
					},
					unlisten: (type, handler, capture) => {
						document.removeEventListener(type, handler, capture === true);
					},
					elementAt: (x, y) => document.elementFromPoint(x, y),
					relative: (node, direction) => relativeNode(node, direction),
					isChrome: (target) => target === bar
						|| (typeof target?.closest === 'function' && target.closest('.dshCc_pickBar') !== null),
					showBox: (node) => {
						const rect = node.getBoundingClientRect();
						box.style.top = rect.top + 'px';
						box.style.left = rect.left + 'px';
						box.style.width = rect.width + 'px';
						box.style.height = rect.height + 'px';
						box.dataset.label = Math.round(rect.width) + '×' + Math.round(rect.height);
						readout.textContent = describeNode(node) + ' · ' + Math.round(rect.width) + '×' + Math.round(rect.height);
					},
					hideBox: () => {
						box.style.width = '0';
						box.style.height = '0';
					},
					onPick: (node) => {
						const probe = (selector) => document.querySelectorAll(selector).length;
						setPicked({ candidates: selectorCandidates(node, probe), tag: String(node.tagName ?? '').toLowerCase() });
						setPickedTokens(tokenSuggestions(
							window.getComputedStyle(node),
							collectTokens(document.styleSheets),
						));
						setPickedChoice(0);
						setPickedOff([]);
						setPicking(false);
					},
					onCancel: () => {
						setPicking(false);
					},
				});
				session = started;
				return () => {
					started.stop();
					box.remove();
					bar.remove();
					if (surface !== null) surface.removeAttribute('data-dshCc-picking');
				};
			}, [picking]);

			// An appended rule is opened once the sheet actually contains it: the write
			// goes through the debounced store, so the index cannot be known here.
			React.useEffect(() => {
				if (pendingOpen.current === null) return;
				const index = findRuleIndex(parseRules(store.snapshot().css), pendingOpen.current);
				if (index < 0) return;
				pendingOpen.current = null;
				setOpenIndex(index);
			}, [state.css]);
			const fileInput = React.useRef(null);
			const pickerRef = React.useRef(null);
			const actionsRef = React.useRef(null);
			const editorRef = React.useRef(null);
			const gutterRef = React.useRef(null);
			const gutterInnerRef = React.useRef(null);
			const highlightRef = React.useRef(null);
			const pendingSave = React.useRef(null);
			const pendingCaret = React.useRef(null);
			const saveTimer = React.useRef(0);
			/** Bumped on every edit; a finishing write only reports for its own epoch. */
			const saveEpoch = React.useRef(0);
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

			// Dismiss a menu on an outside press, the way the shipped pickers do.
			React.useEffect(() => {
				if (!pickerOpen && !actionsOpen) return undefined;
				const onPointerDown = (event) => {
					if (pickerRef.current?.contains(event.target) !== true) setPickerOpen(false);
					if (actionsRef.current?.contains(event.target) !== true) setActionsOpen(false);
				};
				document.addEventListener('mousedown', onPointerDown);
				return () => {
					document.removeEventListener('mousedown', onPointerDown);
				};
			}, [pickerOpen, actionsOpen]);

			/**
			 * Flush the pending write-through immediately, to the sheet it was
			 * captured for. Every path that changes the active sheet goes through
			 * this, so a debounced save can never land under the next sheet's name.
			 */
			const flushSave = async () => {
				const pending = pendingSave.current;
				if (pending === null) return true;
				pendingSave.current = null;
				clearTimeout(saveTimer.current);
				try {
					await post('/write', { name: pending.name, css: pending.css });
					store.set({ error: '' });
					return true;
				}
				catch (error) {
					store.set({ error: '保存失败：' + (error?.message ?? error) });
					return false;
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
				saveEpoch.current += 1;
				const epoch = saveEpoch.current;
				saveTimer.current = setTimeout(() => {
					void flushSave().then((ok) => {
						// Two ways the indicator could lie: a write landing after a newer
						// edit (epoch), and a write that failed outright (ok) — which used
						// to print "已保存" right next to its own error notice.
						if (ok && epoch === saveEpoch.current) setSaved(true);
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
				// The list can outlive the caret that opened it: clicking inside the
				// textarea neither blurs nor re-runs completion. Re-read the word under
				// the caret now — splicing the remembered one at a moved caret deleted
				// characters and dropped the completion in the wrong place.
				const found = completionsFor(current, caret);
				if (found === null || found.word !== word) {
					setSuggest(null);
					return;
				}
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
				const flushed = await flushSave();
				try {
					await post('/active', { name: value });
					const sheet = await api('/read?name=' + encodeURIComponent(value));
					// A failed flush raised its own notice: switching sheets must not wipe
					// it, or the edit that never landed becomes invisible.
					store.set({ active: value, css: sheet.css, ...(flushed ? { error: '' } : {}) });
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
				const flushed = await flushSave();
				try {
					await post('/open', { name: current.active });
					if (flushed) store.set({ error: '' });
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

			/** Import a picked .css file as a new Host-side sheet. */
			const onFilePicked = async (event) => {
				const file = event.target.files?.[0];
				event.target.value = '';
				if (file === undefined) return;
				const flushed = await flushSave();
				try {
					const css = await file.text();
					const listing = await api('/list');
					const name = uniqueName(normalizeName(file.name), listing.files.map(entry => entry.name));
					await post('/import', { name, css });
					const after = await api('/list');
					store.set({ files: after.files, active: name, css, ...(flushed ? { error: '' } : {}) });
					applySheet(name, css, store.snapshot().disabled);
					setSaved(true);
				}
				catch (error) {
					store.set({ error: '打开失败：' + (error?.message ?? error) });
				}
			};

			// Parsed rules drive both the click targets in the colour layer and the
			// panel.
			const rules = parseRules(state.css);
			const openRule = openIndex === null || openIndex >= rules.length ? null : rules[openIndex];
			const declarations = openRule === null ? null : readDeclarations(state.css, openRule);

			/**
			 * Put the picked selector into the sheet: open the rule that already has it,
			 * or append one seeded with the token declarations that are still switched on.
			 * @param selector - the chosen candidate.
			 */
			const usePicked = (selector) => {
				const existing = findRuleIndex(rules, selector);
				setPicked(null);
				if (existing >= 0) {
					setOpenIndex(existing);
					pendingCaret.current = rules[existing].bodyStart;
					return;
				}
				const declarations = pickedTokens
					.filter(entry => !pickedOff.includes(entry.token))
					.map(entry => entry.property + ': var(' + entry.token + ');');
				const next = appendRule(state.css, selector, declarations);
				onEdit(next.css);
				pendingCaret.current = next.caret;
				pendingOpen.current = selector;
			};

			/** Set, or clear, one declaration on the open rule. */
			const setProperty = (name, value) => {
				if (openRule === null) return;
				onEdit(writeDeclaration(state.css, openRule, name, value));
			};

			/** Open the panel on one rule index. */
			const openRuleAt = (index) => {
				if (rules[index] === undefined) return;
				setOpenIndex(index);
			};

			/**
			 * Rename the open rule's selector in place.
			 *
			 * An empty selector makes the rule unparseable, and the panel is found by
			 * selector — so writing one would make the panel (and its own input) vanish
			 * with no way back. The draft is kept in local state instead: clearing the
			 * field shows empty, the sheet keeps its last valid selector, and the field
			 * falls back to the committed value on blur.
			 * @param value - the raw input text.
			 */
			const renameRule = (value) => {
				if (openRule === null) return;
				setSelectorDraft(value);
				if (value.trim() === '') return;
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
				{ className: 'dshCc_row', ref: rowRef },
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
						React.createElement(
							'button',
							{
								type: 'button',
								className: 'dshCc_btn dshCc_pickBtn',
								disabled: !fileMode,
								'aria-pressed': picking,
								title: '在界面上点选一个元素，自动生成稳定的选择器（并给出对应的 DSH 令牌）',
								onClick: () => {
									setPicked(null);
									setPicking(!picking);
								},
							},
							picking ? '取消拾取' : '拾取元素',
						),
						React.createElement(
							'div',
							{ className: 'dshCc_picker', ref: actionsRef },
							React.createElement(
								'button',
								{
									type: 'button',
									className: 'dshCc_trigger',
									'aria-haspopup': 'menu',
									'aria-expanded': actionsOpen,
									disabled: !fileMode,
									onClick: () => {
										setActionsOpen(!actionsOpen);
									},
								},
								React.createElement('span', { className: 'dshCc_triggerLabel' }, '更多操作'),
								React.createElement(ChevronDown, {}),
							),
							actionsOpen
								? React.createElement(
									'div',
									{ className: 'dshCc_menu', role: 'menu' },
									...[
										{
											label: '打开文件',
											hint: '用系统默认程序编辑它',
											disabled: state.active === null,
											run: () => { void onOpen(); },
										},
										{
											label: '导入',
											hint: '从磁盘选一个 .css 作为新表',
											disabled: false,
											run: () => { fileInput.current?.click(); },
										},
										{
											label: '导出',
											hint: '把当前表另存为文件',
											disabled: state.active === null,
											run: () => { void onExport(); },
										},
										{
											label: '重置',
											hint: '清空当前样式表的内容',
											disabled: state.css === '',
											danger: true,
											run: () => { onEdit(''); },
										},
									].map(item => React.createElement(
										'button',
										{
											key: item.label,
											type: 'button',
											role: 'menuitem',
											className: item.danger === true ? 'dshCc_menuItem dshCc_menuItemDanger' : 'dshCc_menuItem',
											disabled: item.disabled,
											title: item.hint,
											onClick: () => {
												setActionsOpen(false);
												item.run();
											},
										},
										React.createElement('span', { className: 'dshCc_menuLabel' }, item.label),
										React.createElement('span', { className: 'dshCc_menuHint' }, item.hint),
									)),
								)
								: null,
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
						picked === null ? null : React.createElement(
							'div',
							{ className: 'dshCc_picked' },
							React.createElement(
								'div',
								{ className: 'dshCc_pickedHead' },
								React.createElement('span', { className: 'dshCc_pickedTitle' }, '已选中 ' + picked.tag),
								React.createElement(
									'button',
									{
										type: 'button',
										className: 'dshCc_panelClose',
										'aria-label': '取消这次拾取',
										onClick: () => {
											setPicked(null);
										},
									},
									'×',
								),
							),
							React.createElement(
								'div',
								{ className: 'dshCc_pickedList' },
								...picked.candidates.map((candidate, index) => React.createElement(
									'button',
									{
										key: candidate.selector,
										type: 'button',
										className: 'dshCc_candidate',
										'aria-pressed': index === pickedChoice,
										onClick: () => {
											setPickedChoice(index);
										},
									},
									React.createElement('code', { className: 'dshCc_candidateSel' }, candidate.selector),
									React.createElement('span', { className: 'dshCc_candidateKind' }, candidate.kind),
									React.createElement(
										'span',
										{ className: 'dshCc_candidateMatches' },
										candidate.matches === 1 ? '仅此一个' : candidate.matches + ' 个命中',
									),
								)),
							),
							React.createElement(
								'div',
								{ className: 'dshCc_pickedNote' },
								picked.candidates[pickedChoice]?.note ?? '',
							),
							pickedTokens.length === 0 ? null : React.createElement(
								'div',
								{ className: 'dshCc_pickedTokens' },
								...pickedTokens.map(entry => React.createElement(
									'button',
									{
										key: entry.token,
										type: 'button',
										className: 'dshCc_tokenChip',
										'aria-pressed': !pickedOff.includes(entry.token),
										title: entry.property + ' 当前解析为 ' + entry.value,
										onClick: () => {
											setPickedOff(pickedOff.includes(entry.token)
												? pickedOff.filter(name => name !== entry.token)
												: [...pickedOff, entry.token]);
										},
									},
									entry.property + ': var(' + entry.token + ')',
								)),
							),
							React.createElement(
								'div',
								{ className: 'dshCc_pickedActions' },
								React.createElement(
									'button',
									{
										type: 'button',
										className: 'dshCc_btn dshCc_primary',
										onClick: () => {
											usePicked(picked.candidates[pickedChoice].selector);
										},
									},
									'插入规则',
								),
								React.createElement(
									'button',
									{
										type: 'button',
										className: 'dshCc_btn',
										onClick: () => {
											setPicked(null);
										},
									},
									'取消',
								),
							),
						),
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
							{ className: 'dshCc_panelField' },
							React.createElement('input', {
								className: 'dshCc_panelName',
								'aria-label': '选择器',
								spellCheck: false,
								value: selectorDraft === null ? (openRule?.selector ?? '') : selectorDraft,
								onChange: (event) => {
									renameRule(event.target.value);
								},
								// Committing a partial edit (or blurring) drops the draft, so the field can
								// never stay stuck on the empty text that was withheld from the sheet.
								onBlur: () => {
									setSelectorDraft(null);
								},
							}),
							React.createElement(
								'button',
								{
									type: 'button',
									className: 'dshCc_panelClose',
									'aria-label': '关闭规则面板',
									onClick: () => {
										setOpenIndex(null);
									},
								},
								'×',
							),
						),
						// Only what the rule actually declares: an unset property gets no
						// row at all, so the panel reads as a summary of the sheet rather
						// than a form full of blanks.
						React.createElement(
							'div',
							{ className: 'dshCc_propGrid' },
						...(declarations === null || declarations.size === 0
							? [React.createElement('p', { key: 'empty', className: 'dshCc_empty' }, '这条规则还没有声明')]
							: Array.from(declarations).map(([declared, current]) => {
								const entry = PROPERTY_UI.find(item => item.name === declared);
								const label = entry === undefined ? declared : entry.label;
								if (entry === undefined || entry.values === undefined) {
									const parts = entry?.parts;
									// A shorthand gets one field per component. The slash form of
									// `border-radius` (`8px / 12px`) addresses two axes at once, which one
									// field per corner cannot express — that form keeps the free field.
									const slashForm = parts !== undefined && entry.join !== ' / ' && current.includes('/');
									if (parts !== undefined && !slashForm) {
										const tokens = splitParts(current, entry);
										return React.createElement(
											'label',
											{ key: declared, className: 'dshCc_prop dshCc_propWide' },
											React.createElement('span', { className: 'dshCc_propLabel', title: declared }, label),
											React.createElement(
												'div',
												{ className: 'dshCc_partRow' },
												...parts.map((part, index) => React.createElement(
													'span',
													{ key: part.label, className: 'dshCc_partCell' },
													React.createElement('span', { className: 'dshCc_partName' }, part.label),
													React.createElement('input', {
														className: 'dshCc_propText',
														'aria-label': label + ' · ' + part.label,
														title: label + ' · ' + part.label,
														// The field name is the label above it; the placeholder stays a value hint.
														placeholder: part.hint,
														spellCheck: false,
														value: tokens[index] ?? '',
														onChange: (event) => {
															const next = tokens.slice();
															next[index] = event.target.value;
															setProperty(declared, joinParts(next, entry));
														},
													}),
												)),
											),
										);
									}
									// A length, colour, shadow or function: the panel can name it but
									// cannot enumerate it, so it gets a free field — its dictionary hint
									// doubles as the placeholder — instead of a menu.
									return React.createElement(
										'label',
										{ key: declared, className: 'dshCc_prop' },
										React.createElement('span', { className: 'dshCc_propLabel', title: declared }, label),
										React.createElement('input', {
											className: 'dshCc_propText',
											'aria-label': label,
											placeholder: entry?.hint ?? '',
											spellCheck: false,
											value: current,
											onChange: (event) => {
												setProperty(declared, event.target.value);
											},
										}),
									);
								}
								const known = entry.values.find(pair => pair[0] === current);
								return React.createElement(
									'label',
									{ key: declared, className: 'dshCc_prop' },
									React.createElement('span', { className: 'dshCc_propLabel', title: declared }, entry.label),
									React.createElement(Dropdown, {
										items: [
											// A value typed by hand (or laid down by a template) stays visible
											// instead of being dropped by the menu.
											...(known === undefined ? [{ value: current, label: current, selected: true }] : []),
											...entry.values.map(pair => ({
												value: pair[0],
												label: pair[1],
												selected: pair[0] === current,
											})),
											{ value: '', label: '（删除此项）', selected: false },
										],
										display: known === undefined ? current : known[1],
										ariaLabel: entry.label,
										onPick: (picked) => {
											setProperty(entry.name, picked);
										},
									}),
								);
							})),
						),
						// The add-property control sits below the declarations: it is the
						// natural place to reach for once the summary above it has been read.
						React.createElement(Dropdown, {
							items: [
								{ value: '', label: '＋ 添加属性…', selected: true },
								...PROPERTY_GROUPS.flatMap(group => PROPERTY_UI
									.filter(entry => entry.group === group
										&& !(declarations?.has(entry.name) ?? false))
									.map(entry => ({
										value: entry.name,
										label: entry.label + '（' + entry.name + '）',
										group,
									}))),
							],
							display: '＋ 添加属性…',
							ariaLabel: '添加属性',
							wrapperClassName: 'dshCc_addPropWrap',
							onPick: (picked) => {
								const entry = PROPERTY_UI.find(item => item.name === picked);
								if (entry !== undefined) setProperty(entry.name, initialValue(entry));
							},
						}),
						React.createElement('p', { className: 'dshCc_panelSection' }, '插入模板'),
						React.createElement(
							'div',
							{ className: 'dshCc_tplGrid' },
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
