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
		const WALLPAPER_CSS_TAG = PLUGIN_ID + "/Wallpaper.module.css";
		const USER_STYLE_ID = PLUGIN_ID + "-user-style";
		/** The injected wallpaper sheet, kept apart from the user's own so neither can edit the other. */
		const WALLPAPER_STYLE_ID = PLUGIN_ID + "-wallpaper-style";
		/** Where this browser keeps the wallpaper it last applied; applied before any request. */
		const WALLPAPER_KEY = PLUGIN_ID + ":wallpaper";
		/** The corner clock's element id; the wallpaper sheet styles it. */
		const CLOCK_ELEMENT_ID = PLUGIN_ID + '-wallpaper-clock';
		const API = "/dsh-custom-css";
		const LEGACY_KEY = "dsh.custom-css";
		const DEFAULT_NAME = "custom.css";
		const WRITE_DELAY_MS = 400;
		/** Where the wallpaper record lives on the Host: a sheet of its own, so it survives a profile. */
		const WALLPAPER_SHEET = 'wallpaper.json.css';
		/** Where this plugin's own settings live: its own sheet, so the wallpaper record stays one thing. */
		const SETTINGS_SHEET = 'settings.json.css';
		/** Where this browser keeps the settings it last applied. */
		const SETTINGS_KEY = PLUGIN_ID + ':settings';

		/** Default wallpaper settings, and the values every stored record is measured against. */
		const WALLPAPER_DEFAULTS = { url: "", fit: "cover", transparent: 26, brightness: 0 };
		/** The fit modes the panel offers; anything else in a stored record is thrown away. */
		const WALLPAPER_FITS = ["cover", "contain", "fill", "tile"];
		/**
		 * How many stored wallpapers the panel offers at once.
		 *
		 * The Host serves up to 120; the strip is small and the newest are the ones anyone wants
		 * back, so showing more would only be a longer scroll.
		 */
		const WALLPAPER_GALLERY_MAX = 12;
		/**
		 * This plugin's own settings — the ones that are not about the stylesheet editor at all.
		 *
		 * Kept apart from the wallpaper record on purpose: a wallpaper is a thing with a picture
		 * and a look, and these are preferences about how the plugin behaves. Mixing them would
		 * make every one of them part of the wallpaper's own record, which is the file a user
		 * reads when they want to know what picture is installed.
		 */
		/**
		 * 默认排除名单：**根级元素**。
		 *
		 * 它们不该成为预览样本（克隆一个 <html> 没有意义，而且会把整页样式带进预览框），也不该被
		 * 拾取器选中（写一条作用在 body 上的规则，等于给整个界面换皮肤 —— 那是「皮肤」的事，
		 * 不是「一条规则」的事）。名单可改，见「壁纸设置」里的「排除名单」。
		 */
		const DEFAULT_EXCLUDE = ':root, html, body';

		/** 名单上限：每条都要对每个候选元素求值一次，长名单是给自己找卡顿。 */
		const EXCLUDE_MAX = 12;
		const SETTINGS_DEFAULTS = {
			/** How many stored pictures to cycle through when the wallpaper rotates. */
			rotate: 'off',
			/** An overlay between the picture and the interface; 0 is none. */
			scrim: 0,
			/** Blur applied to the picture itself; 0 is none. */
			blur: 0,
			/** Whether a dim clock sits in the corner the interface leaves free. */
			clock: false,
			/** Editor: how long typing settles before the sheet is written, in ms. */
			saveDelay: 400,
			/** Editor: `full` runs the document-level checks too, `syntax` only parses, `off` neither. */
			validate: 'full',
			/** 开发者：控制台里的 window.dshCss 能否写盘（查询类接口永远可用）。 */
			devApi: true,
			/** Editor: whether the line-number gutter is drawn. */
			lineNumbers: true,
			/** Editor: spaces one Tab press inserts. */
			tabWidth: 2,
			/** 预览与拾取都不碰的元素（选择器列表，逗号分隔）。 */
			exclude: DEFAULT_EXCLUDE,
		};
		/** Autosave delays the panel offers, in ms. */
		const SAVE_DELAY_CHOICES = [
			[200, 'set.delayFast'],
			[400, 'set.delayDefault'],
			[1000, 'set.delaySlow'],
			[3000, 'set.delayVerySlow'],
		];
		/** What the validation pass is allowed to do. */
		const VALIDATE_CHOICES = [
			['full', 'set.validateFull'],
			['syntax', 'set.validateSyntax'],
			['off', 'set.validateOff'],
		];
		/** Tab widths, in spaces. */
		const TAB_WIDTH_CHOICES = [[2, 'set.tab2'], [4, 'set.tab4'], [8, 'set.tab8']];
		/** Rotation intervals, as a value the panel can hand to `Number()`. */
		const ROTATE_CHOICES = [
			['off', 'set.rotateOff'],
			['300', 'set.rotate5'],
			['1800', 'set.rotate30'],
			['3600', 'set.rotateHourly'],
			['86400', 'set.rotateDaily'],
		];
		/** What one rotation step may not exceed, in ms — a guard against a hand-edited record. */
		const ROTATE_MAX_MS = 7 * 24 * 60 * 60 * 1000;
		/** Editor line height in px; must match `--dshCc-line` in ROW_CSS. */
		const LINE_HEIGHT = 19;
		/** Sentinel option value for the "new sheet" entry at the bottom. */
		const NEW_OPTION = "\u0000new";
		/**
		 * Marks an element as this plugin's own chrome rather than page content.
		 *
		 * Anything the plugin paints on top of the interface — the picker's boxes and panel,
		 * the rule-highlight boxes — carries this, and every place that asks the page "how many
		 * elements match this selector" filters those out.
		 *
		 * Measured before it existed: with `[class]` typed into the selector field, the page
		 * answered 336 matches with the highlight off and **653** with it on. The 317 extra were
		 * the plugin's own highlight boxes, which are `div`s with a class. So the count was
		 * self-referential, and so was every other count in this row: the outline's per-rule
		 * "n hits" column and the picker's own candidate ranking read the same way.
		 *
		 * Worse than a wrong number: the boxes are siblings of the app's root, so they shift
		 * `body > div:nth-child(N)` — which is the structural-path candidate this plugin's
		 * element picker generates. An overlay that changes the selectors you get from picking
		 * is an overlay that breaks its own feature.
		 */
		const OWNED_ATTR = 'data-dshcc-owned';

		// The row's own stylesheet, injected the way DSH's client packages do it:
		// one marked <style> tag per file, so an unload or HMR pass can find and
		// replace exactly this tag. Metrics and tokens are the ones the shipped
		// General rows use — 14px/22px titles on --dsw-alias-label-primary,
		// 12px/18px descriptions on --dsw-alias-label-tertiary, a 0.5px
		// --dsw-alias-border-l2 separator with 16px vertical padding, and the
		// shared control chrome below.
		//
		// IDIOMS, NOT MERGED SELECTORS.
		//
		// A duplication pass over the generated sheet found the same values written
		// out in many rules: the focus ring in 9 of them, `36px` + radius + fill +
		// stroke in 6, `min-width:0` in 35. Split across rules, that is not a size
		// problem — it is a *change* problem: the radius sweep had to find `18px` in
		// four different rules by hand.
		//
		// What is extracted here is the VALUE, never the selector list. Two rules that
		// share a declaration still stay two rules, so specificity and source order are
		// exactly what they were; a merged selector would quietly move both of those.
		// The generated text is byte-identical except for the tokens swapped in below.
		const CONTROL_36 = 'height:36px;padding:0 14px;border-radius:var(--dsw-radius-md);'
			+ 'background:var(--dsw-alias-bg-module-platform);font:inherit;font:var(--dsw-font-s-14);';
		const CONTROL_28 = 'height:28px;padding:0 10px;border-radius:var(--dsw-radius-sm);';
		const ELLIPSIS = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		const HINT_TEXT = 'margin-left:auto;flex:none;color:var(--dsw-alias-label-caption);font-size:11px';
/* dsh-shared:anchor */

		/* <<< dsh-shared:base-css v1.0.0 >>> */
		const SHARED_BASE_CSS = "/* ════════════════════════════════════════════════════════════════════════════\n   dsh-shared · 样式公共层（v1）\n\n   这一份源码会被 `shared/sync.mjs` 原样写进各扩展的浏览器半，作为**一张独立的样式表**\n   注入（`<style data-plugin-css=\"…/shared-base.css\">`），顺序在用户自己的样式表**之前** ——\n   于是用户表里的规则天然赢过它，不需要 `!important`。\n\n   它只放「多个扩展共用、且与具体扩展无关」的东西：\n\n   · 本地设计令牌（`--dsl-g-*`）：各扩展的卡片 / 描边 / 圆角都读这几个，换成一份定义，\n     一处调整就能全线生效；\n   · 两个原语（`:where()` 包着，特异性 0）：细描边卡片、单行省略 —— 任何扩展都可以用，\n     也可以用一行选择器覆盖掉。\n   · 三个原语都**不碰** DSH 自己的 `--dsw-*` 令牌：那些归宿主，扩展覆盖它们会连带打断\n     深色主题（实测过一次：把 `--dsw-alias-label-primary` 钉死成深色，深色主题下正文就\n     变成黑底黑字）。\n\n   这里的每一条都必须能在「没有用户样式表」时独立存在。\n   ════════════════════════════════════════════════════════════════════════════ */\n\n:root {\n  /* 表面：细描边 + 卡片阴影 + 圆角。三个值在扩展里反复出现，所以只定义一次。 */\n  --dsl-g-border-surface: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 12%, transparent);\n  --dsl-g-shadow-card: 0 1px 3px #0000001a, 0 8px 24px #0000000f;\n  --dsl-g-radius-surface: 12px;\n  /* 间距与字号步进：面板内边距、卡片标题、说明文字各取一档。 */\n  --dsl-g-gap-tight: 8px;\n  --dsl-g-gap: 12px;\n  --dsl-g-font-title: 13px;\n  --dsl-g-font-note: 12px;\n}\n\n/* 原语一：细描边卡片。`:where()` 让特异性为 0 —— 任何扩展自己的类名都能直接覆盖。 */\n:where(.dsl-card, .dsl-surface) {\n  background: var(--dsw-alias-bg-module-platform, #ffffff);\n  border: 1px solid var(--dsl-g-border-surface);\n  border-radius: var(--dsl-g-radius-surface);\n  box-shadow: var(--dsl-g-shadow-card);\n}\n\n/* 原语二：单行省略。宽度不够时截断而不是换行，行高不会被撑开。 */\n:where(.dsl-ellipsis) {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* 原语三：面板里的小号说明文字。 */\n:where(.dsl-note) {\n  color: var(--dsw-alias-label-tertiary, #6b7280);\n  font-size: var(--dsl-g-font-note);\n  line-height: 18px;\n}";
		/* <<< dsh-shared:end >>> */

		/** 公共层：控件与行布局（`dshUi_*`）。两个界面共用，先于编辑器自己的样式注入。 */
		/* ═══ 文案与语言 ═══════════════════════════════════════════════════════════
		 * 两份词典交给 DSH 的 locale 服务（`ctx.locale.register(ns, tag, dict)`），随后
		 * `ctx.locale.bind(ns)` 拿到的 `t` 交给下面那个变量。语言切换时组件靠 store 前进一步
		 * 重渲染，`t` 在调用时才读当前语言，所以不需要重新挂载。
		 *
		 * 三条约定（都是踩过才定下来的）：
		 *   · **没有 locale 服务的组合（以及测试床）行为不变**：`t` 退回只查 zh 表。
		 *   · **未登记的键显示中文原文，不显示 key** —— 翻译是增量的，漏一条不该让界面出现
		 *     `status.saved` 这种东西。
		 *   · **中文表就是原始文案**：所以默认语言下输出与加国际化之前逐字一致。
		 * ═════════════════════════════════════════════════════════════════════════ */
		const LOCALE_NS = 'custom-css';

		const STRINGS = {
			zh: {
				'row.title': '自定义 CSS',
				'row.noFile': '（无文件）',
				'row.newSheet': '＋ 新建…',
				'row.pick': '拾取元素',
				'row.pickCancel': '取消拾取',
				'row.find': '查找',
				'row.findClose': '关闭查找',
				'row.more': '更多操作',
				'row.create': '创建',
				'row.cancel': '取消',
				'row.enabled': '已启用',
				'row.disabled': '已关闭',
				'row.outline': '大纲',
				'row.outlineAria': '这张样式表的规则大纲',
				'diag.stackedGlass': '这层毛玻璃的祖先里还有一层 backdrop-filter：模糊会被采样两次，又贵又浑',
				'diag.opacityKillsGlass': '这一层有不透明度（自身或祖先 < 1）：它会隔离 backdrop root，backdrop-filter 等于没开',
				'diag.fixedTrapped': 'position: fixed 的祖先链上有 transform / filter / perspective：它会退化成「相对那个祖先定位」，可能被裁掉',

				'row.wallpaperLink': '自定义壁纸…',
				'row.linkNote': '在插件详情页里设置',
				'row.conflictReload': '重新载入',
				'row.conflictOverwrite': '覆盖它',
				'row.conflict': '磁盘上的 {name} 已被改动，这次写入已拦下：',
				'row.newPlaceholder': '新文件名，例如 dark-tweak.css',
				'row.newAria': '新建 CSS 文件名',
				'row.placeholder': '例如：\n.dsh-chat-bubble { border-radius: 12px; }',
				'row.descFile': '样式表保存在宿主目录 ~/.dsh/custom-css/；「打开文件」用系统默认程序编辑它，导入 / 导出用于与其它文件互通。',
				'row.descBrowser': '追加到界面上的样式表；需要压过已有样式时可用 !important。',
				'row.pickTitle': '在界面上悬停选取一个元素，自动生成稳定的选择器（并给出对应的 DSH 令牌）',
				'row.findTitle': '在样式表里查找 / 替换（Ctrl+F）',
				'row.moreTitle': '打开文件 / 导入 / 导出 / 重置 / 历史版本',
				'row.enableTitle': '启用这张样式表',
				'row.busyTitle': '正在写入样式表，稍候',
				'row.disableTitle': '点一下临时关闭这张样式表（文件内容不动）',
				'row.reenableTitle': '点一下重新启用这张样式表',
				'status.loading': '正在读取…',
				'status.unset': '未设置',
				'status.size': '{lines} 行 · {chars} 字符',
				'status.off': ' · 已关闭',
				'status.browser': ' · 浏览器存储',
				'status.saved': '已保存 · ',
				'status.saving': '保存中 · ',
				'menu.open': '打开文件',
				'menu.openHint': '用系统默认程序编辑它',
				'menu.import': '导入',
				'menu.importHint': '从磁盘选一个 .css 作为新表',
				'menu.export': '导出',
				'menu.exportHint': '把当前表另存为文件',
				'menu.format': '格式化',
				'menu.formatHint': '缩进、每条规则一行',
				'menu.audit': '选择器体检',
				'menu.tokens': '令牌',
				'menu.tokensHint': '列出 DSH 与其它扩展定义的令牌',
				'tokens.count': '{count} 条令牌',
				'tokens.unreadable': ' · {count} 张表读不到',
				'tokens.search': '搜索：名字、值或来源',
				'tokens.empty': '这一页没有读到任何令牌定义。',
				'tokens.noMatch': '没有匹配「{query}」的令牌。',
				'tokens.uses': ' · {count} 条规则',
				'tokens.conditional': ' · 条件内',
				'tokens.conditionalShort': '条件内 · ',
				'tokens.conditionalHint': '这条定义在 @media / @supports 里，只在条件成立时生效',
				'tokens.material': '材质参数（插件默认）',
				'tokens.all': '全部令牌',
				'tokens.inline': '内联样式表',
				'tokens.takeover': '接管',
				'tokens.takeoverTitle': '往 tokens.css 写一条覆盖（来源：{source}）',
				'tokens.release': '撤销',
				'tokens.releaseTitle': '删掉这条覆盖，回到来源的值',
				'tokens.overrideAria': '为 {name} 写覆盖值',
				'tokens.valueHint': '回车保存 · Esc 取消。令牌有深浅两套值（light-dark(a, b)）时改整串',
				'menu.auditHint': '列出当前命不中的规则（换代后常见）',
				'menu.versions': '历史版本',
				'menu.versionsHint': '回到之前的某一版',
				'menu.rename': '重命名',
				'menu.renameHint': '给这张表换个名字（历史版本一起跟着走）',
				'menu.folder': '打开目录',
				'menu.folderHint': '在系统文件管理器里打开样式表目录',
				'menu.delete': '删除',
				'menu.deleteAgain': '再按一次删除',
				'menu.deleteHint': '把这张表从目录里删掉',
				'menu.deleteConfirmHint': '不可撤销（历史里会留一份）',
				'menu.reset': '重置',
				'menu.resetHint': '清空当前样式表的内容',
				'page.back': '返回',
				'page.backToActions': '回到操作列表',
				'rename.backTitle': '返回操作菜单',
				'rename.heading': '← 重命名',
				'rename.desc': '只能改名字，内容与历史版本一起跟着走；已存在的名字不会被覆盖。',
				'rename.fieldAria': '新的样式表文件名',
				'rename.submit': '重命名',
				'versions.reading': '正在读取…',
				'versions.empty': '还没有历史版本：这张表还没有被覆盖保存过。',
				'versions.restoreTitle': '把 {at} 的版本恢复到编辑器（当前内容会先存为一个版本）',
				'versions.restored': '已恢复到 {at}',
				'versions.restoreFailed': '恢复失败：{message}',
				'audit.empty': '这张表还是空的，没有可体检的规则。',
				'audit.clean': '扫了一遍：这张表里的规则当前都命得中。',
				'audit.found': '扫了一遍：{count} 条规则当前命不中。状态相关的（:hover、.active 这类）不报 —— 它们本来就要等交互才命中。点一行，就把那条整条注释掉（保留原文）。',
				'audit.line': '第 {line} 行',
				'audit.rowTitle': '把这一条整条注释掉：{selector}',
				'audit.commentAll': '全部注释掉',
				'audit.commentAllHint': '{count} 条 · 一次 Ctrl+Z 可撤回',
				'audit.commentAllTitle': '把上面列出的 {count} 条全部注释掉（一次编辑，Ctrl+Z 可整体撤回）',
				'audit.more': '还有 {count} 条没列出来（先处理上面这些，列表会自动缩短）。',
				'find.none': '无命中',
				'find.case': '区分大小写',
				'find.prev': '上一个（Shift+Enter）',
				'find.prevAria': '上一个命中',
				'find.next': '下一个（Enter）',
				'find.nextAria': '下一个命中',
				'find.replaceOneTitle': '替换这一个（Ctrl+Z 可以撤回）',
				'find.replaceOne': '替换这一个',
				'find.replace': '替换',
				'find.replaceAllTitle': '替换全部命中（一次撤销就能全部撤回）',
				'find.replaceAll': '全部替换',
				'find.closeTitle': '关闭查找（Esc）',
				'find.close': '关闭查找',
				'panel.selector': '选择器',
				'panel.notSelector': '这段文字不是选择器（{text}），页面上无法定位',
				'panel.pseudo': '伪元素没有自己的元素可以框选 —— 试试去掉 ::before / ::after',
				'panel.noMatch': '页面上没有元素匹配这个选择器',
				'panel.offHint': '点一下取消强调',
				'panel.onHint': '在页面上框出这 {count} 个匹配的元素',
				'panel.labelInvalid': '不是选择器',
				'panel.labelPseudo': '伪元素',
				'panel.labelNone': '无命中',
				'panel.labelCount': '{count} 个命中',
				'panel.close': '关闭规则面板',
				'panel.empty': '这条规则还没有声明',
				'panel.removeOption': '（删除此项）',
				'panel.addProp': '＋ 添加属性…',
				'panel.addPropAria': '添加属性',
				'panel.templates': '插入模板',
				'panel.presets': '效果预设',
				'preview.full': '全屏',
				'preview.fullTitle': '打开全屏视图：左右并排 + 同一个规则面板（Esc 退出）',
				'preview.compare': '对比',
				'preview.compareTitle': '左边显示打开这条规则时的样子，右边是现在的样子',
				'preview.list': '列表',
				'preview.listTitle': '展开卡片导航：一张卡对应一个命中的元素，点哪张就看哪个',
				'preview.current': '当前',
				'preview.modified': '修改后',
				'preview.same': '还没改动：改一个值，左右就会分开。',
				'preview.stateHover': '悬停',
				'preview.stateFocus': '聚焦',
				'preview.statePlaceholder': '占位符',
				'preview.chipsTitle': '在真页面上强制这个状态，再读它的计算样式',
				'preview.pseudoTitle': '把伪元素合成进样本（content 是文本时才能合成）',
				'preview.demoing': '演示中：页面真的被改成这个状态',
				'preview.synthetic': '合成样本（不是页面上的元素）',
				'preview.fullAria': '规则全屏视图',
				'preview.fullClose': '退出全屏',
				'preview.meta': '{count} 个命中 · 第 {index} 个',
				'preview.prev': '上一个命中元素',
				'preview.next': '下一个命中元素',
				'preview.esc': 'Esc 退出',
				'preview.note': '样本冻结了元素此刻的计算样式：这条规则的声明是真的，改完之后的重排与悬停态不在其中。',
				'preset.hintTitle': '把「{preset}」的一组声明写进这条规则（一次 Ctrl+Z 可撤回）',
				'preset.noTarget': '这条规则当前一个元素都没命中，预设不知道往哪写。',
				'preset.ownChrome': '这条规则命中的是插件自己的界面（预览/令牌那一套），预设不改它。',
				'preset.needsFill': '这块自己是透明的，玻璃不会显形 —— 预设写的是底色 + 模糊',
				'preset.tooSmall': '元素只有 {width}×{height}，纹理/玻璃太小看不清',
				'preset.warn': '已写入「{preset}」，但请注意：{why}',
				'panel.hitCount': ' · 命中 {count}',
				'panel.invalid': ' · 选择器无效',
				'panel.zeroHits': ' · 无命中',
				'error.toggle': '开关状态未能写入宿主：{message}',
				'error.read': '读取失败：{message}',
				'error.switch': '切换失败：{message}',
				'error.exists': '已存在：{name}',
				'error.create': '创建失败：{message}',
				'error.refresh': '刷新失败：{message}',
				'error.rename': '重命名失败：{message}',
				'error.lastSheet': '这是最后一张样式表，删掉界面就没有样式表可用了。',
				'error.delete': '删除失败：{message}',
				'error.openFolder': '打开目录失败：{message}',
				'error.noRoute': '宿主侧还没有这个接口，重启 dsh 后再试',
				'error.open': '打开失败：{message}',
				'error.save': '保存失败：{message}',
				'error.history': '读取历史失败：{message}',
				'warn.seatTitle': '[dsh-custom-css] 3 秒内没有拿到设置槽位 settings.general.item —— 「设置 → 通用」里很可能看不到「自定义 CSS」这一行。',
				'warn.seatWhy': '原因通常是 DSH 换代改了槽位名，不是配置写错。',
				'warn.seatWhere': '已知问题与处置：https://github.com/FOX4096/dsh-custom-css/blob/main/docs/known-issues.md',
				'warn.versions': '版本：{parts}',
				'wp.previewAlt': '当前壁纸预览',
				'wp.none': '未选择',
				'wp.previewNote': '预览里压着的这层，就是「界面浓度」：它决定界面自己那层底色还留多少。',
				'wp.image': '图片',
				'wp.changeImage': '更换图片',
				'wp.chooseImage': '选择图片…',
				'wp.remove': '移除',
				'wp.url': '图片 URL',
				'wp.orUrl': '或 URL',
				'wp.urlPlaceholder': 'https://… 或 file:///…',
				'wp.urlAria': '壁纸图片 URL',
				'wp.useUrl': '使用此 URL',
				'wp.fill': '填充',
				'wp.fillAria': '壁纸填充方式',
				'wp.opacity': '界面浓度',
				'wp.opacityAria': '界面底色浓度（0 = 完全遮住壁纸，越大壁纸越明显）',
				'wp.brightness': '明暗',
				'wp.brightnessAria': '壁纸明暗',
				'wp.used': '用过的',
				'wp.useWallpaper': '使用壁纸 {name}',
				'wp.folder': '文件夹',
				'wp.folderTitle': '壁纸图片与记录都在这里',
				'wp.reload': '重新读取',
				'wp.empty': '还没有壁纸：选一张本机图片，或者在上面贴一个 URL。',
				'wp.skinNote': '当前样式表（皮肤）自己也设了界面底色，那一档比这里的「界面浓度」优先；壁纸本身不受影响。想让它听这里的，就把皮肤里那几个 --dsw-alias-bg-* 的值删掉。',
				'wp.title': '自定义壁纸',
				'wp.badge': '宿主文件',
				'wp.desc': '给界面换一张本机图片当背景。图片是宿主磁盘上的真文件，本页与下次打开都会自动用上；「界面浓度」越大，壁纸透出来越多；0 时界面完全遮住壁纸（文字最清楚）。',
				'wp.fact.images': '图片与记录',
				'wp.fact.limit': '上限',
				'wp.fact.skin': '与皮肤的关系',
				'wp.fact.limitValue': '单张 32 MB（按解码后的字节算）',
				'wp.fact.skinValue': '壁纸层优先；界面底色那一档，皮肤设了就以皮肤为准',
				'set.title': '壁纸设置',
				'set.badge': '本机生效',
				'set.desc': '轮换、遮罩、模糊、角落时间 —— 这四项都在插件自己这一侧生效，改完立刻作用到界面上。',
				'set.rotate': '轮换',
				'set.rotateAria': '壁纸轮换间隔',
				'set.scrim': '遮罩',
				'set.scrimAria': '壁纸遮罩浓度',
				'set.blur': '模糊',
				'set.blurAria': '壁纸模糊半径',
				'set.clock': '角落时间',
				'set.clockAria': '在壁纸上显示时间',
				'set.saveDelay': '保存延迟',
				'set.saveDelayAria': '样式表保存延迟',
				'set.validate': '校验',
				'set.validateAria': '格式校验严格度',
				'set.lineNumbers': '行号',
				'set.lineNumbersAria': '显示编辑器行号',
				'set.tabWidth': 'Tab 宽度',
				'set.tabWidthAria': 'Tab 宽度（空格数）',
				'set.devApi': '控制台写盘',
				'set.devApiAria': '允许从控制台写样式表',
				'set.shown': '显示',
				'set.hidden': '不显示',
				'set.hide': '隐藏',
				'set.allowed': '允许',
				'set.readonly': '只读',
				'set.hint.wallpaper': '这些设置存在宿主磁盘上的 settings.json.css（内容恰好是 JSON），换浏览器也还在；「遮罩」压的是壁纸本身，与上面壁纸那一节的「界面浓度」是两件事。',
				'set.group.editor': '编辑器',
				'set.exclude': '排除名单',
				'set.excludeAria': '预览与拾取都不碰的选择器',
				'set.excludeHint': '逗号分隔的选择器；**只匹配元素自己**（不看祖先）。默认 :root, html, body —— 用来排除「整页」：写一条作用在 body 上的规则等于给整个界面换皮肤，而把整页克隆进预览框没有意义。',
				'set.group.exclude': '预览与拾取',
				'preview.excluded': '这个元素在排除名单里（{list}），所以预览用的是合成样本。要改名单：「插件详情页 → 壁纸设置 → 排除名单」。',
				'pick.excluded': '这个元素在排除名单里（{list}），拾取器不为它生成规则。',
								'set.hint.editor': '编辑器这几项只影响「设置 → 通用」里那一个编辑器本身：保存延迟是打字停下来多久才写盘，校验严格度决定状态行报不报格式问题，行号与 Tab 宽度改的是它的外观与缩进。',
				'set.group.dev': '开发者',
				'set.hint.dev': '控制台里的 window.dshCss 能读写样式表。关掉后它只剩查询与临时表（css.apply），写盘会被拒绝 —— 查询类接口不受影响。',
				'set.group.data': '数据',
				'set.backup': '备份',
				'set.exportAll': '导出全部',
				'set.hint.backup': '样式表 + 历史版本 + 壁纸，一个 JSON 文件',
				'set.reset': '重置',
				'set.resetAgain': '再按一次重置',
				'set.resetPlugin': '重置插件',
				'set.resetTitleConfirm': '所有样式表、历史与壁纸都会挪进 .backup/<时间戳>/，不是删除',
				'set.resetTitle': '恢复成刚装上的样子（原文件归档保存，可自行取回）',
				'set.rotateHint': '（库里至少要有两张图才会轮换）',
				'set.group.about': '关于',
				'set.term.version': '版本',
				'set.term.dir': '目录',
				'set.term.host': '宿主',
				'set.term.links': '链接',
				'set.link.repo': '仓库',
				'set.link.docs': '文档',
				'data.exported': '已导出 {sheets} 张样式表、{wallpapers} 张壁纸。',
				'data.exportFailed': '导出失败：{message}',
				'data.archived': '已归档 {moved} 项到 {backup}{skipped}，页面即将刷新。',
				'data.archivedSkipped': '；有 {count} 项被占用没能移动（重启 dsh 后再试）',
				'data.resetFailed': '重置失败：{message}',
				'error.hostFiles': '宿主文件接口不可用，样式暂存在浏览器：{message}',
				'find.search': '查找',
				'find.replacement': '替换为',
				'wp.unnamed': '未命名',
				'wp.notImage': '这不是图片文件（{name}）',
				'wp.tooBig': '图片超过 32 MB，先压缩一下再选',
				'wp.readFailed': '读取失败',
				'wp.imageReadFailed': '读取图片失败：{message}',
				'wp.badImage': '宿主不接受这张图（格式或体积）',
				'wp.uploadFailed': '上传失败：{message}',
				'pick.title': '元素拾取器',
				'pick.hint': '点击一个元素开始（悬停只预览，不会改变已选）',
				'pick.cancel': '取消',
				'pick.up': '上一级',
				'pick.down': '下一级',
				'pick.insert': '插入规则',
				'pick.keys': '快捷键',
				'pick.keyUp': '↑ 上一个层级（父元素）',
				'pick.keyDown': '↓ 下一个层级（第一个子元素）',
				'pick.keyEnter': 'Enter 确认当前高亮',
				'pick.keyEsc': 'Esc 取消',
				'pick.depthTitle': '层级深度：拖动在祖先链上移动，0 表示指针下的元素',
				'pick.depth': '层级深度',
				'pick.unknownHits': '命中数未知',
				'pick.onlyOne': '仅此一个',
				'pick.hits': '{count} 个命中',
				'pick.chipTitle': '{property} 当前解析为 {value}',
				'pick.kind.attr': '属性钩子',
				'pick.kind.attrHint': 'DSH 自己也在用这类钩子，跨版本最稳',
				'pick.kind.aria': '无障碍名',
				'pick.kind.ariaHint': '语义层不会随便改；界面里若有同名元素会一起命中',
				'pick.kind.semantic': '语义类名',
				'pick.kind.semanticHint': '插件作者手写的类名，通常跟着插件一起演进',
				'pick.kind.hash': '哈希容错',
				'pick.kind.hashHint': 'CSS Modules 的哈希随构建变化，这种写法不接哈希',
				'pick.kind.path': '结构路径',
				'pick.kind.pathHint': '兜底方案：属性与类名都没有时用它，界面改版会失效',
				'comp.property': '属性',
				'comp.value': '值',
				'validate.syntax': "syntax 必须是带引号的字符串，例如 '<color>'",
				'validate.inherits': 'inherits 只能是 true 或 false',
				'validate.unparsable': '无法解析的声明：{text}',
				'validate.badValue': '{property} 的值无效：{value}',
				'validate.commentOpen': '注释未闭合',
				'validate.strayBrace': '多余的 }',
				'validate.missingBrace': '缺少 {count} 个 }',
				'validate.varUnreadable': '变量 {name} 在这条规则命中的元素上读不到',
				'status.problem': '第 {line} 行 {message}',
				'status.problemMore': ' 等 {count} 处',
				'prop.badValue': '这个值 {value} 不是合法的 {property} 值',
				'warn.pluginVersion': '插件 {version}',
				'wp.saving': '正在保存…',
				'wp.saved': '已保存',
				'wp.urlRejected': '这个地址不能用作壁纸：只接受 http(s)、file://、data:image/… 或站内路径（以单个 / 开头）。',
				'wp.fillCover': '铺满 · 裁掉多余',
				'wp.fillContain': '完整 · 留边',
				'wp.fillStretch': '拉伸 · 填满',
				'wp.fillTile': '平铺 · 多份',
				'set.delayFast': '几乎立刻（200ms）',
				'set.delayDefault': '默认（400ms）',
				'set.delaySlow': '慢一点（1s）',
				'set.delayVerySlow': '很慢（3s）',
				'set.validateFull': '语法 + 变量体检',
				'set.validateSyntax': '只查语法',
				'set.validateOff': '关闭校验',
				'set.tab2': '2 空格',
				'set.tab4': '4 空格',
				'set.tab8': '8 空格',
				'set.rotateOff': '不轮换',
				'set.rotate5': '每 5 分钟',
				'set.rotate30': '每 30 分钟',
				'set.rotateHourly': '每小时',
				'set.rotateDaily': '每天',
			},
			en: {
				'row.title': 'Custom CSS',
				'row.noFile': '(no file)',
				'row.newSheet': '＋ New…',
				'row.pick': 'Pick element',
				'row.pickCancel': 'Stop picking',
				'row.find': 'Find',
				'row.findClose': 'Close find',
				'row.more': 'More actions',
				'row.create': 'Create',
				'row.cancel': 'Cancel',
				'row.enabled': 'Enabled',
				'row.disabled': 'Off',
				'row.outline': 'Outline',
				'row.outlineAria': 'Rule outline of this sheet',
				'diag.stackedGlass': 'An ancestor already has a backdrop-filter: the blur is sampled twice — costly and muddy',
				'diag.opacityKillsGlass': 'This layer has opacity below 1 (its own or an ancestor): that isolates the backdrop root, so backdrop-filter does nothing',
				'diag.fixedTrapped': 'A position: fixed element under a transformed ancestor is positioned relative to it — it can be clipped away',

				'row.wallpaperLink': 'Custom wallpaper…',
				'row.linkNote': 'Set on the plugin detail page',
				'row.conflictReload': 'Reload from disk',
				'row.conflictOverwrite': 'Overwrite it',
				'row.conflict': '{name} changed on disk, so this write was stopped:',
				'row.newPlaceholder': 'New file name, e.g. dark-tweak.css',
				'row.newAria': 'New CSS file name',
				'row.placeholder': 'For example:\n.dsh-chat-bubble { border-radius: 12px; }',
				'row.descFile': 'Sheets live in ~/.dsh/custom-css/. "Open file" edits one in your default app; import / export move sheets between installs.',
				'row.descBrowser': 'A stylesheet appended to the interface. Use !important when it has to win over existing rules.',
				'row.pickTitle': 'Hover an element to get a stable selector for it (and the DSH tokens it uses)',
				'row.findTitle': 'Find / replace in the sheet (Ctrl+F)',
				'row.moreTitle': 'Open file / import / export / reset / versions',
				'row.enableTitle': 'Turn this sheet on',
				'row.busyTitle': 'Writing the sheet, one moment',
				'row.disableTitle': 'Switch this sheet off without touching the file',
				'row.reenableTitle': 'Switch this sheet back on',
				'status.loading': 'Reading…',
				'status.unset': 'empty',
				'status.size': '{lines} lines · {chars} chars',
				'status.off': ' · off',
				'status.browser': ' · browser storage',
				'status.saved': 'Saved · ',
				'status.saving': 'Saving · ',
				'menu.open': 'Open file',
				'menu.openHint': 'Edit it in your default app',
				'menu.import': 'Import',
				'menu.importHint': 'Load a .css from disk as a new sheet',
				'menu.export': 'Export',
				'menu.exportHint': 'Save this sheet to a file',
				'menu.format': 'Format',
				'menu.formatHint': 'Indent, one rule per line',
				'menu.audit': 'Check selectors',
				'menu.tokens': 'Tokens',
				'menu.tokensHint': 'List the tokens DSH and other extensions define',
				'tokens.count': '{count} token(s)',
				'tokens.unreadable': ' · {count} sheet(s) unreadable',
				'tokens.search': 'Search name, value or source',
				'tokens.empty': 'No token definitions were readable on this page.',
				'tokens.noMatch': 'No token matches "{query}".',
				'tokens.uses': ' · {count} rule(s)',
				'tokens.conditional': ' · conditional',
				'tokens.conditionalShort': 'conditional · ',
				'tokens.conditionalHint': 'This definition sits inside @media / @supports, so it only applies while the condition holds',
				'tokens.material': 'Material parameters (plugin defaults)',
				'tokens.all': 'All tokens',
				'tokens.inline': 'inline sheet',
				'tokens.takeover': 'Override',
				'tokens.takeoverTitle': 'Write one override into tokens.css (source: {source})',
				'tokens.release': 'Revert',
				'tokens.releaseTitle': 'Drop this override and go back to the source value',
				'tokens.overrideAria': 'Override value for {name}',
				'tokens.valueHint': 'Enter saves · Esc cancels. When a token has a light/dark pair (light-dark(a, b)), edit the whole expression',
				'menu.auditHint': 'List rules matching nothing right now',
				'menu.versions': 'Versions',
				'menu.versionsHint': 'Go back to an earlier version',
				'menu.rename': 'Rename',
				'menu.renameHint': 'Rename this sheet (its versions follow)',
				'menu.folder': 'Open folder',
				'menu.folderHint': 'Show the sheet folder in your file manager',
				'menu.delete': 'Delete',
				'menu.deleteAgain': 'Press again to delete',
				'menu.deleteHint': 'Remove this sheet from the folder',
				'menu.deleteConfirmHint': 'Cannot be undone (a version is kept)',
				'menu.reset': 'Reset',
				'menu.resetHint': 'Empty this sheet',
				'page.back': 'Back',
				'page.backToActions': 'Back to the actions',
				'rename.backTitle': 'Back to the actions',
				'rename.heading': '← Rename',
				'rename.desc': 'Only the name changes; content and versions follow. An existing name is never overwritten.',
				'rename.fieldAria': 'New sheet file name',
				'rename.submit': 'Rename',
				'versions.reading': 'Reading…',
				'versions.empty': 'No versions yet: this sheet has not been overwritten.',
				'versions.restoreTitle': 'Restore the {at} version into the editor (the current text is saved as a version first)',
				'versions.restored': 'Restored {at}',
				'versions.restoreFailed': 'Restore failed: {message}',
				'audit.empty': 'This sheet is empty, so there is nothing to check.',
				'audit.clean': 'Checked: every rule in this sheet matches something right now.',
				'audit.found': 'Checked: {count} rule(s) match nothing right now. State-dependent ones (:hover, .active and friends) are not listed — they only match while interacting. Click a row to comment that whole rule out (the text is kept).',
				'audit.line': 'Line {line}',
				'audit.rowTitle': 'Comment this whole rule out: {selector}',
				'audit.commentAll': 'Comment them all out',
				'audit.commentAllHint': '{count} rule(s) · one Ctrl+Z undoes it',
				'audit.commentAllTitle': 'Comment out all {count} listed above (one edit, Ctrl+Z reverses it)',
				'audit.more': '{count} more not listed (handle the ones above first; the list shrinks by itself).',
				'find.none': 'no match',
				'find.case': 'Match case',
				'find.prev': 'Previous (Shift+Enter)',
				'find.prevAria': 'Previous match',
				'find.next': 'Next (Enter)',
				'find.nextAria': 'Next match',
				'find.replaceOneTitle': 'Replace this one (Ctrl+Z undoes it)',
				'find.replaceOne': 'Replace this match',
				'find.replace': 'Replace',
				'find.replaceAllTitle': 'Replace every match (one undo reverses all of them)',
				'find.replaceAll': 'Replace all',
				'find.closeTitle': 'Close find (Esc)',
				'find.close': 'Close find',
				'panel.selector': 'Selector',
				'panel.notSelector': 'This text is not a selector ({text}), so nothing can be located on the page',
				'panel.pseudo': 'A pseudo-element has no box of its own — try removing ::before / ::after',
				'panel.noMatch': 'No element on the page matches this selector',
				'panel.offHint': 'Click to stop highlighting',
				'panel.onHint': 'Outline the {count} matching element(s) on the page',
				'panel.labelInvalid': 'not a selector',
				'panel.labelPseudo': 'pseudo-element',
				'panel.labelNone': 'no match',
				'panel.labelCount': '{count} match(es)',
				'panel.close': 'Close the rule panel',
				'panel.empty': 'This rule has no declarations yet',
				'panel.removeOption': '(remove this declaration)',
				'panel.addProp': '＋ Add property…',
				'panel.addPropAria': 'Add a property',
				'panel.templates': 'Insert a template',
				'panel.presets': 'Effect presets',
				'preview.full': 'Full screen',
				'preview.fullTitle': 'Open the full-screen view: side by side + the same rule panel (Esc leaves)',
				'preview.compare': 'Compare',
				'preview.compareTitle': 'Left shows the sheet as it was when you opened this rule; right is the sheet now',
				'preview.list': 'List',
				'preview.listTitle': 'Show card navigation: one card per match, click one to preview it',
				'preview.current': 'Current',
				'preview.modified': 'Modified',
				'preview.same': 'Nothing changed yet — edit a value and the two sides separate.',
				'preview.stateHover': 'Hover',
				'preview.stateFocus': 'Focus',
				'preview.statePlaceholder': 'Placeholder',
				'preview.chipsTitle': 'Force this state on the real page, then read its computed style',
				'preview.pseudoTitle': 'Synthesise the pseudo-element into the sample (only when its content is text)',
				'preview.demoing': 'Demoing: the page really is in this state right now',
				'preview.synthetic': 'Synthetic sample (not an element on the page)',
				'preview.fullAria': 'Full-screen rule view',
				'preview.fullClose': 'Leave full screen',
				'preview.meta': '{count} matches · #{index}',
				'preview.prev': 'Previous matched element',
				'preview.next': 'Next matched element',
				'preview.esc': 'Esc to close',
				'preview.note': 'The samples freeze the element’s computed style as it is right now: the declarations are real, but reflow after the change and hover states are not shown.',
				'preset.hintTitle': 'Write the "{preset}" declarations into this rule (one Ctrl+Z undoes it)',
				'preset.noTarget': 'This rule matches nothing right now, so there is nowhere to write the preset.',
				'preset.ownChrome': 'This rule matches the plugin’s own chrome (preview / tokens), so a preset will not touch it.',
				'preset.needsFill': 'This element has no fill of its own, so the glass shows nothing — the preset writes a fill and a blur',
				'preset.tooSmall': 'The element is only {width}×{height}, too small for a texture or glass to read',
				'preset.warn': 'Wrote "{preset}", but note: {why}',
				'panel.hitCount': ' · {count} match(es)',
				'panel.invalid': ' · invalid selector',
				'panel.zeroHits': ' · no match',
				'error.toggle': 'Could not store the switch state: {message}',
				'error.read': 'Read failed: {message}',
				'error.switch': 'Switch failed: {message}',
				'error.exists': 'Already exists: {name}',
				'error.create': 'Create failed: {message}',
				'error.refresh': 'Refresh failed: {message}',
				'error.rename': 'Rename failed: {message}',
				'error.lastSheet': 'This is the last sheet; deleting it would leave the interface unstyled.',
				'error.delete': 'Delete failed: {message}',
				'error.openFolder': 'Could not open the folder: {message}',
				'error.noRoute': 'The Host half does not have this route yet — restart dsh and try again',
				'error.open': 'Could not open the file: {message}',
				'error.save': 'Save failed: {message}',
				'error.history': 'Could not read versions: {message}',
				'warn.seatTitle': '[dsh-custom-css] The settings seat settings.general.item did not arrive within 3 seconds — the "Custom CSS" row is probably missing from Settings → General.',
				'warn.seatWhy': 'That usually means a DSH release renamed the slot; it is not a configuration mistake.',
				'warn.seatWhere': 'Known issues and what to do: https://github.com/FOX4096/dsh-custom-css/blob/main/docs/known-issues.md',
				'warn.versions': 'Versions: {parts}',
				'wp.previewAlt': 'Current wallpaper preview',
				'wp.none': 'Nothing selected',
				'wp.previewNote': 'The layer over the preview is what "Interface opacity" controls: how much of the interface’s own background survives.',
				'wp.image': 'Image',
				'wp.changeImage': 'Change image',
				'wp.chooseImage': 'Choose an image…',
				'wp.remove': 'Remove',
				'wp.url': 'Image URL',
				'wp.orUrl': 'or a URL',
				'wp.urlPlaceholder': 'https://… or file:///…',
				'wp.urlAria': 'Wallpaper image URL',
				'wp.useUrl': 'Use this URL',
				'wp.fill': 'Fill',
				'wp.fillAria': 'How the wallpaper fills the screen',
				'wp.opacity': 'Interface opacity',
				'wp.opacityAria': 'Interface background opacity (0 hides the wallpaper completely; higher lets more of it through)',
				'wp.brightness': 'Brightness',
				'wp.brightnessAria': 'Wallpaper brightness',
				'wp.used': 'Used before',
				'wp.useWallpaper': 'Use the wallpaper {name}',
				'wp.folder': 'Folder',
				'wp.folderTitle': 'Wallpaper images and its record live here',
				'wp.reload': 'Reload',
				'wp.empty': 'No wallpaper yet: pick an image from this machine, or paste a URL above.',
				'wp.skinNote': 'The current sheet (skin) sets an interface background of its own, and that one wins over "Interface opacity" here; the picture itself is unaffected. To let this panel win, delete the --dsw-alias-bg-* values from the skin.',
				'wp.title': 'Custom wallpaper',
				'wp.badge': 'Host file',
				'wp.desc': 'Puts a picture from this machine behind the interface. The image is a real file on the Host disk, used on this page and the next one automatically; higher "Interface opacity" lets more of it through, and 0 hides it completely (most readable text).',
				'wp.fact.images': 'Images and record',
				'wp.fact.limit': 'Limit',
				'wp.fact.skin': 'Versus the skin',
				'wp.fact.limitValue': '32 MB per image (decoded bytes)',
				'wp.fact.skinValue': 'The wallpaper layer wins; for the interface background, a skin that sets it wins',
				'set.title': 'Wallpaper settings',
				'set.badge': 'Applies in this browser',
				'set.desc': 'Rotation, scrim, blur and the corner clock — all four act on the plugin’s own layer, so a change shows up immediately.',
				'set.rotate': 'Rotation',
				'set.rotateAria': 'Wallpaper rotation interval',
				'set.scrim': 'Scrim',
				'set.scrimAria': 'Wallpaper scrim strength',
				'set.blur': 'Blur',
				'set.blurAria': 'Wallpaper blur radius',
				'set.clock': 'Corner clock',
				'set.clockAria': 'Show the time on the wallpaper',
				'set.saveDelay': 'Save delay',
				'set.saveDelayAria': 'Sheet save delay',
				'set.validate': 'Validation',
				'set.validateAria': 'How strictly the sheet is validated',
				'set.lineNumbers': 'Line numbers',
				'set.lineNumbersAria': 'Show editor line numbers',
				'set.tabWidth': 'Tab width',
				'set.tabWidthAria': 'Tab width (spaces)',
				'set.devApi': 'Console writes',
				'set.devApiAria': 'Allow writing sheets from the console',
				'set.shown': 'Shown',
				'set.hidden': 'Hidden',
				'set.hide': 'Hide',
				'set.allowed': 'Allowed',
				'set.readonly': 'Read-only',
				'set.hint.wallpaper': 'These live in settings.json.css on the Host disk (its content happens to be JSON), so they survive a browser change; the scrim dims the picture itself, which is a different thing from "Interface opacity" in the wallpaper section above.',
				'set.group.editor': 'Editor',
				'set.exclude': 'Exclude list',
				'set.excludeAria': 'Selectors the preview and picker leave alone',
				'set.excludeHint': 'Comma-separated selectors, matched against the element itself only (ancestors are not considered). Default :root, html, body — this excludes the page as a whole: a rule on body means restyling the entire interface, and cloning the whole page into the preview box is meaningless.',
				'set.group.exclude': 'Preview and picking',
				'preview.excluded': 'This element is on the exclude list ({list}), so the preview uses a synthetic sample. Change it in Plugins → this plugin → Wallpaper settings → Exclude list.',
				'pick.excluded': 'This element is on the exclude list ({list}), so the picker will not build a rule for it.',
								'set.hint.editor': 'These only affect the one editor in Settings → General: the save delay is how long typing has to pause before the write, the strictness decides whether the status line reports format problems, and line numbers / tab width change how it looks and indents.',
				'set.group.dev': 'Developer',
				'set.hint.dev': 'window.dshCss in the console can read and write sheets. Turned off, it keeps only queries and the temporary sheet (css.apply) — writes are refused, queries are not affected.',
				'set.group.data': 'Data',
				'set.backup': 'Backup',
				'set.exportAll': 'Export everything',
				'set.hint.backup': 'Sheets + versions + wallpapers in one JSON file',
				'set.reset': 'Reset',
				'set.resetAgain': 'Press again to reset',
				'set.resetPlugin': 'Reset the plugin',
				'set.resetTitleConfirm': 'Every sheet, version and wallpaper moves into .backup/<timestamp>/ — nothing is deleted',
				'set.resetTitle': 'Back to a fresh install (the original files are archived, you can take them back)',
				'set.rotateHint': '(rotation needs at least two images in the library)',
				'set.group.about': 'About',
				'set.term.version': 'Version',
				'set.term.dir': 'Folder',
				'set.term.host': 'Host',
				'set.term.links': 'Links',
				'set.link.repo': 'Repository',
				'set.link.docs': 'Docs',
				'data.exported': 'Exported {sheets} sheet(s) and {wallpapers} wallpaper(s).',
				'data.exportFailed': 'Export failed: {message}',
				'data.archived': 'Archived {moved} item(s) into {backup}{skipped}; the page is about to reload.',
				'data.archivedSkipped': '; {count} were in use and could not be moved (try again after restarting dsh)',
				'data.resetFailed': 'Reset failed: {message}',
				'error.hostFiles': 'The Host file API is unavailable, so sheets are kept in the browser only: {message}',
				'find.search': 'Find',
				'find.replacement': 'Replace with',
				'wp.unnamed': 'unnamed',
				'wp.notImage': 'That is not an image file ({name})',
				'wp.tooBig': 'The image is over 32 MB — compress it first',
				'wp.readFailed': 'Could not read it',
				'wp.imageReadFailed': 'Could not read the image: {message}',
				'wp.badImage': 'The Host refused this image (format or size)',
				'wp.uploadFailed': 'Upload failed: {message}',
				'pick.title': 'Element picker',
				'pick.hint': 'Click an element to start (hovering only previews, it does not change the choice)',
				'pick.cancel': 'Cancel',
				'pick.up': 'One level up',
				'pick.down': 'One level down',
				'pick.insert': 'Insert rule',
				'pick.keys': 'Shortcuts',
				'pick.keyUp': '↑ one level up (parent)',
				'pick.keyDown': '↓ one level down (first child)',
				'pick.keyEnter': 'Enter accepts the highlighted one',
				'pick.keyEsc': 'Esc cancels',
				'pick.depthTitle': 'Depth: drag along the ancestor chain, 0 is the element under the pointer',
				'pick.depth': 'Depth',
				'pick.unknownHits': 'match count unknown',
				'pick.onlyOne': 'the only one',
				'pick.hits': '{count} match(es)',
				'pick.chipTitle': '{property} currently resolves to {value}',
				'pick.kind.attr': 'attribute hook',
				'pick.kind.attrHint': 'DSH uses these too, so they survive most releases',
				'pick.kind.aria': 'accessible name',
				'pick.kind.ariaHint': 'the semantic layer rarely changes; a same-named element matches too',
				'pick.kind.semantic': 'semantic class',
				'pick.kind.semanticHint': 'hand-written by the plugin author, usually evolves with it',
				'pick.kind.hash': 'hash-tolerant',
				'pick.kind.hashHint': 'CSS Modules hashes change per build; this form ignores the hash',
				'pick.kind.path': 'structural path',
				'pick.kind.pathHint': 'the fallback when neither attributes nor classes exist; breaks when the layout changes',
				'comp.property': 'property',
				'comp.value': 'value',
				'validate.syntax': "syntax must be a quoted string, e.g. '<color>'",
				'validate.inherits': 'inherits can only be true or false',
				'validate.unparsable': 'Cannot parse this declaration: {text}',
				'validate.badValue': "Invalid value for {property}: {value}",
				'validate.commentOpen': 'Unclosed comment',
				'validate.strayBrace': 'Stray }',
				'validate.missingBrace': 'Missing {count} closing brace(s)',
				'validate.varUnreadable': 'Variable {name} cannot be read on the elements this rule matches',
				'status.problem': 'Line {line}: {message}',
				'status.problemMore': ' (and {count} more)',
				'prop.badValue': '{value} is not a valid {property} value',
				'warn.pluginVersion': 'plugin {version}',
				'wp.saving': 'Saving…',
				'wp.saved': 'Saved',
				'wp.urlRejected': 'That address cannot be used as a wallpaper: only http(s), file://, data:image/… or a site path starting with a single / are accepted.',
				'wp.fillCover': 'Cover · crop the overflow',
				'wp.fillContain': 'Contain · letterbox',
				'wp.fillStretch': 'Stretch · fill',
				'wp.fillTile': 'Tile · repeat',
				'set.delayFast': 'Almost at once (200ms)',
				'set.delayDefault': 'Default (400ms)',
				'set.delaySlow': 'Slower (1s)',
				'set.delayVerySlow': 'Very slow (3s)',
				'set.validateFull': 'Syntax + variable check',
				'set.validateSyntax': 'Syntax only',
				'set.validateOff': 'No validation',
				'set.tab2': '2 spaces',
				'set.tab4': '4 spaces',
				'set.tab8': '8 spaces',
				'set.rotateOff': 'No rotation',
				'set.rotate5': 'Every 5 minutes',
				'set.rotate30': 'Every 30 minutes',
				'set.rotateHourly': 'Every hour',
				'set.rotateDaily': 'Every day',
			},
		};

		/** 预览块里那两块样本的容器类名（effect 按类名找它们，避免给面板加 hook）。 */
		const PREVIEW_AFTER_CLASS = 'dshCc_previewAfter';
		const PREVIEW_CURRENT_CLASS = 'dshCc_previewCurrent';

		/** 打开某条规则那一刻的样式表文本；预览块拿它当「当前」。 */
		let previewBaselineCss = null;

		/** 上一次画预览时的签名：同一份输入不要每次渲染都重画。 */
		let previewSignature = '';

		/** 刚打开一条规则：下一次 effect 滚一次，把预览块露出来。 */
		let previewScrollPending = false;

		/** 强制态那份临时表的 id（只在预览期间存在）。 */
		const PREVIEW_FORCE_STYLE_ID = PLUGIN_ID + '-preview-force';

		/**
		 * 三个**能强制**的状态：选择器片段 → 类名。
		 *
		 * 为什么走「改写选择器 + 加类」而不是别的：浏览器不让你读「悬停时」的计算样式，
		 * 只有 DevTools 的 CDP forcePseudoState 能，页面里没这个权限。所以把 :hover 改写成
		 * .dshCcStateHover、把这个类临时加到目标元素上 —— 于是**真页面**进入了那个状态，
		 * 我们再读它的计算样式（与 docs/preview.md 的状态芯片一节一致）。
		 * 正则都按字面量每次重建：带 g 标志的 RegExp 复用会带着上次的 lastIndex。
		 */
		const PREVIEW_STATES = [
			{ id: 'hover', labelKey: 'preview.stateHover', cls: 'dshCcStateHover', pattern: ':hover' },
			{ id: 'focus', labelKey: 'preview.stateFocus', cls: 'dshCcStateFocus', pattern: ':focus' },
			{ id: 'placeholder', labelKey: 'preview.statePlaceholder', cls: 'dshCcStatePlaceholder', pattern: ':placeholder-shown' },
		];

		/** 当前被强制的那一份：表 + 类 + 元素，用来原样撤掉。 */
		let previewForced = null;

		/**
		 * 给一个节点加一个类。
		 *
		 * 两个实现是有意的：真 DOM 有 classList，而测试床的假节点只有一个 className 字符串 ——
		 * 只写 classList 会让这条路径在测试里静默不生效（看起来像「功能没做」）。
		 * @param node - the element.
		 * @param cls - the class to add.
		 */
		function addStateClass(node, cls) {
			if (node === null || node === undefined) return;
			if (typeof node.classList?.add === 'function') {
				node.classList.add(cls);
				return;
			}
			const current = String(node.className ?? '');
			if (current.split(/\s+/).includes(cls)) return;
			node.className = (current + ' ' + cls).trim();
		}

		/**
		 * 摘掉一个类（addStateClass 的反向操作）。
		 * @param node - the element.
		 * @param cls - the class to remove.
		 */
		function removeStateClass(node, cls) {
			if (node === null || node === undefined) return;
			if (typeof node.classList?.remove === 'function') {
				node.classList.remove(cls);
				return;
			}
			node.className = String(node.className ?? '')
				.split(/\s+/)
				.filter(name => name !== '' && name !== cls)
				.join(' ');
		}

		/**
		 * 撤掉所有强制态：删表、摘类。
		 *
		 * 调用点分散（芯片关掉、换规则、切对比 / 全屏、面板关闭、行卸载、换表），所以集中在这里 ——
		 * 少一处就会在页面上留下一个没主的类，那正是「预览把人坑了」的样子。
		 */
		function clearPreviewForcing() {
			if (previewForced === null) return;
			const { tag, classes, node } = previewForced;
			previewForced = null;
			for (const cls of classes) removeStateClass(node, cls);
			if (tag !== null) tag.remove?.();
			else document.getElementById?.(PREVIEW_FORCE_STYLE_ID)?.remove?.();
			previewSignature = '';
		}

		/**
		 * 把一个元素**此刻的计算样式**冻成一段内联样式。
		 *
		 * 为什么是「全部属性」而不是挑几条：样本要在我们的行里重放，而它继承不到原来祖先的
		 * 字体、宽度、颜色 —— 只抄几条就得猜漏了哪条。全抄 340 来条的代价是一次
		 * `getComputedStyle` 读 + 一段十几 KB 的字符串，换的是「看起来和真的一样」。
		 * @param node - the element to freeze.
		 * @returns a cssText string ('' when there is no computed style to read).
		 */
		function frozenStyleText(node, pseudo) {
			const reader = typeof getComputedStyle === 'function'
				? getComputedStyle
				: (typeof window !== 'undefined' ? window.getComputedStyle : undefined);
			if (typeof reader !== 'function') return '';
			// 伪元素也走这条路：reader(node, '::before') 拿到的就是它自己的计算样式。
			const computed = pseudo === undefined ? reader(node) : reader(node, pseudo);
			if (computed === undefined || computed === null) return '';
			const parts = [];
			for (let index = 0; index < (computed.length ?? 0); index += 1) {
				const name = computed[index];
				if (typeof name !== 'string') continue;
				const value = computed.getPropertyValue(name);
				if (value === '' || value === undefined) continue;
				parts.push(name + ':' + value);
			}
			return parts.join(';');
		}

		/**
		 * 预览用来找「宿主元素」的选择器：把状态伪类去掉。
		 *
		 * `button:hover` 在静止页面上一个都匹配不到，而预览要看的就是「悬停之后」—— 所以找元素时
		 * 用 `button`，再由强制态把它送回 `:hover` 的样子。去掉之后若什么都不剩（规则只写了
		 * `:hover`），退回通配符，至少能拿到一个元素。
		 * @param selector - the rule's selector.
		 * @returns the selector to resolve for the preview.
		 */
		function previewTargetSelector(selector) {
			const stripped = String(selector ?? '')
				.replace(/:(hover|focus|focus-visible|focus-within|active|placeholder-shown)\b/g, '')
				.trim();
			return stripped === '' ? '*' : stripped;
		}

		/**
		 * 在**真页面**上强制几个状态：改写成状态类、注入一张临时表、把类加到目标元素上。
		 *
		 * 为什么必须动真页面：浏览器不让你读「悬停时」的计算样式（只有 DevTools 的 CDP
		 * forcePseudoState 能）。强制之后 frozenStyleText 读到的就是那个状态下的真值，
		 * 样本再把它冻成内联 —— 于是预览里看到的是真的悬停效果，不是猜的。
		 *
		 * 代价写在 docs/preview.md 里：**预览期间页面真的变了**（只变这一条规则），
		 * 所以芯片只在单屏模式出现，关掉 / 换规则 / 关面板时必须原样撤掉。
		 * @param rule - the open rule (selector + body offsets).
		 * @param css - the sheet text the rule belongs to.
		 * @param states - the PREVIEW_STATES entries to force.
		 * @param node - the element to force them on.
		 * @returns the forced record (also kept in previewForced), or null.
		 */
		function forcePreviewStates(rule, css, states, node) {
			clearPreviewForcing();
			if (rule === null || rule === undefined || states.length === 0) return null;
			if (typeof document === 'undefined') return null;
			const body = String(css.slice(rule.bodyStart, rule.bodyEnd)).trim();
			if (body === '') return null;
			// 选择器按状态逐条改写：:hover 换成 .dshCcStateHover。字面量正则、每次新建。
			const rules = states.map((state) => {
				const selector = String(rule.selector ?? '').replace(new RegExp(state.pattern + '\\b', 'g'), '.' + state.cls);
				return selector + ' {' + body + '}';
			});
			const tag = document.createElement('style');
			tag.id = PREVIEW_FORCE_STYLE_ID;
			tag.dataset.plugin = PLUGIN_ID;
			tag.textContent = rules.join('\n');
			// 追加到 head 末尾：与别的规则平局时它要赢（那正是「强制」的意思）。
			document.head.appendChild(tag);
			// 类只加在「正在看的那一个元素」上；没有命中时表照样注入 —— 那是改写的载体。
			if (node !== undefined && node !== null) {
				for (const state of states) addStateClass(node, state.cls);
			}
			previewForced = { tag, classes: states.map(state => state.cls), node: node ?? null };
			previewSignature = '';
			return previewForced;
		}

		/**
		 * 一个伪元素能不能用真元素合成出来。
		 *
		 * 伪元素不是节点，克隆带不走它；能做的是读它的计算样式、造一个 span 把样式抄上去，再把
		 * content 当文本放进去。content 是 url(...) 这类不是文本时合成出来会误导 —— 返回 null。
		 * @param node - the host element.
		 * @param pseudo - '::before' or '::after'.
		 * @returns a span carrying the pseudo's style, or null when it cannot be told.
		 */
		function syntheticPseudo(node, pseudo) {
			if (typeof document === 'undefined') return null;
			const reader = typeof getComputedStyle === 'function'
				? getComputedStyle
				: (typeof window !== 'undefined' ? window.getComputedStyle : undefined);
			if (typeof reader !== 'function') return null;
			let computed;
			try { computed = reader(node, pseudo); }
			catch { return null; }
			if (computed === undefined || computed === null) return null;
			const content = String(computed.getPropertyValue?.('content') ?? '').trim();
			if (content === '' || content === 'none' || content === 'normal') return null;
			if (/^url\(/i.test(content)) return null;
			const text = content.replace(/^['"]/, '').replace(/['"]$/, '');
			const span = document.createElement('span');
			span.className = 'dshCc_samplePseudo';
			const styleText = frozenStyleText(node, pseudo);
			if (styleText !== '') span.style.cssText = styleText;
			span.textContent = text;
			return span;
		}

		/**
		 * 命中 0 个时的合成样本：用这条规则自己的声明拼一个方框。
		 *
		 * 必须**明确标注**「这不是页面上的元素」：否则用户会去页面上找那个其实不存在的东西。
		 * 宽高取规则里的值，没有就给 240×120（够看清圆角、描边、玻璃这类效果）。
		 * @param rule - the open rule.
		 * @param css - the sheet text.
		 * @returns a div, or null when a sample cannot be built.
		 */
		function syntheticSample(rule, css) {
			if (typeof document === 'undefined') return null;
			const declarations = readDeclarations(css, rule);
			const parts = [];
			if (declarations !== null) {
				for (const [name, value] of declarations) parts.push(name + ':' + value);
			}
			const sized = declarations !== null
				&& (declarations.has('width') || declarations.has('min-width'))
				&& (declarations.has('height') || declarations.has('min-height'));
			if (!sized) parts.push('width:240px', 'height:120px');
			parts.push('display:flex', 'align-items:center', 'justify-content:center', 'font-size:12px');
			const node = document.createElement('div');
			node.className = 'dshCc_sample dshCc_sampleSynthetic';
			node.style.cssText = parts.join(';');
			node.textContent = t('preview.synthetic');
			return node;
		}

		/**
		 * 把当前规则的效果画进预览块的样本里（内联面板与全屏视图共用一次遍历）。
		 *
		 * 机制（见 docs/preview.md）：
		 *   1. 「修改后」= 现在这份样式表下读到的计算样式（强制了状态就是被强制之后的值）；
		 *   2. 「当前」= 把样式表临时换回**打开这条规则那一刻**的文本、读一次、再换回来；
		 *   3. 样本都是同一个元素的克隆，样式写成内联 —— 左右只差你打开之后的改动；
		 *   4. 命中 0 个时用合成样本，并标注它不是页面上的元素。
		 * @param root - the container to look in (panel or the whole row).
		 * @param rule - the open rule.
		 * @param currentCss - the sheet as it is now.
		 * @param compare - whether the left box should be painted.
		 * @param index - which match to preview (card navigation).
		 * @param pseudos - '::before' / '::after' to synthesise into the samples.
		 */
		function paintPreview(root, rule, currentCss, compare, index, pseudos, excluded) {
			if (root === null || root === undefined || rule === null || rule === undefined) return;
			const selector = String(rule.selector ?? '');
			const wanted = (pseudos ?? []).slice();
			const boxes = root.querySelectorAll?.('.' + PREVIEW_AFTER_CLASS + ', .' + PREVIEW_CURRENT_CLASS);
			const list = boxes === undefined || boxes === null ? [] : [...boxes];
			// 每次重画前先清空：样本是克隆节点，留着旧的会让两份叠在一起。
			for (const box of list) box.textContent = '';
			const targets = resolveSelector(previewTargetSelector(selector)).nodes ?? [];
			// 排除名单里的元素（默认 :root / html / body）不当样本：克隆整页没有意义，
			// 而且会把页面自己的样式带进预览框。改成合成样本，并在面板里说明原因。
			if (excluded === true || targets.length === 0) {
				const sample = syntheticSample(rule, currentCss);
				if (sample === null) return;
				for (const box of list) box.appendChild?.(sample.cloneNode?.(true) ?? sample);
				previewSignature = [selector, currentCss.length, compare, index, excluded === true ? 'excluded' : 'synthetic'].join('\u0000');
				return;
			}
			// 命中多个时，卡片导航决定看哪一个；越界就退回第一个（删掉几行代码之后索引会失效）。
			const target = targets[index] ?? targets[0];
			const afterStyle = frozenStyleText(target);
			let beforeStyle = null;
			if (compare && previewBaselineCss !== null && previewBaselineCss !== currentCss) {
				applyUserCss(previewBaselineCss);
				beforeStyle = frozenStyleText(target);
				applyUserCss(currentCss);
			}
			for (const box of list) {
				const isCurrent = String(box.className ?? '').includes(PREVIEW_CURRENT_CLASS);
				if (isCurrent && beforeStyle === null) continue;
				const clone = target.cloneNode?.(true);
				if (clone === undefined || clone === null) continue;
				clone.removeAttribute?.('id');
				clone.style.cssText = isCurrent ? beforeStyle : afterStyle;
				// A cloned <tr> / <td> outside a table has no layout: the parser synthesises the
				// wrappers on the page, so the sample has to do the same or the row renders as nothing.
				const tag = String(target.tagName ?? '').toUpperCase();
				let host = clone;
				if (tag === 'TR' || tag === 'TD' || tag === 'TH') {
					const table = document.createElement('table');
					const tbody = document.createElement('tbody');
					table.appendChild(tbody);
					if (tag === 'TR') tbody.appendChild(clone);
					else {
						const row = document.createElement('tr');
						row.appendChild(clone);
						tbody.appendChild(row);
					}
					host = table;
				}
				for (const pseudo of wanted) {
					const made = syntheticPseudo(target, pseudo);
					if (made === null) continue;
					if (pseudo === '::before' && typeof clone.insertBefore === 'function') {
						clone.insertBefore(made, clone.firstChild ?? null);
					}
					else clone.appendChild?.(made);
				}
				box.appendChild?.(host);
			}
			previewSignature = [selector, currentCss.length, compare, index, wanted.join(',')].join('\u0000');
		}

		/**
		 * 当前语言的标签（zh / en / 语言包自报的 tag）。内容词典按它选表。
		 */
		let activeLocaleTag = 'zh';

		/**
		 * 内容字符串的英文对照表：**按中文原文索引**。
		 *
		 * 为什么与上面那份 key 词典分开：属性字典与声明模板是「内容」—— 一张 112 条的、中文优先的
		 * CSS 教学表（`display` → `显示` → `弹性布局`）。给它每条编一个 key 只会让表更难读，而它
		 * 需要的是「同一张表的两种语言」。所以界面文案走 `t(key)`（注册进 DSH，将来加语言包也吃得到），
		 * 内容走 `content(中文原文)`：英文时查这张表，查不到就显示中文原文。
		 *
		 * 代价写清楚：**这张表只服务英文**。将来有人加日语包时，界面会跟着变，而属性字典仍是中文
		 * （或他补一份 content 表）—— 这是有意的取舍：不假装支持一个没人翻过的语言。
		 */
		const CONTENT_EN = {
			"上": "Top",
			"上偏移": "Top offset",
			"上内边距": "Padding top",
			"上外边距": "Margin top",
			"下": "Bottom",
			"下偏移": "Bottom offset",
			"下内边距": "Padding bottom",
			"下划线": "Underline",
			"下外边距": "Margin bottom",
			"不可选": "Not selectable",
			"不含边框": "Content box",
			"不换行": "No wrap",
			"不断词": "Keep words",
			"不浮动": "No float",
			"不清除": "No clear",
			"不透明度": "Opacity",
			"不重复": "No repeat",
			"两侧": "Both sides",
			"两端": "Justify",
			"两端对齐": "Space between",
			"中等": "Medium",
			"主轴对齐": "Main axis alignment",
			"主轴方向": "Main axis direction",
			"主题色": "Accent color",
			"交互": "Interaction",
			"交叉轴对齐": "Cross axis alignment",
			"仅内容": "Content box only",
			"任意位置": "Anywhere",
			"任意断词": "Break anywhere",
			"保留": "Preserve",
			"保留并换行": "Preserve and wrap",
			"允许换行": "Wrap",
			"光标": "Cursor",
			"光标颜色": "Caret color",
			"全大写": "Uppercase",
			"全小写": "Lowercase",
			"全选": "Select all",
			"全部": "All",
			"内容": "Content",
			"内边距": "Padding",
			"列跨度": "Column span",
			"列间距": "Column gap",
			"删除线": "Line through",
			"动画": "Animation",
			"包含优化": "Containment",
			"半粗": "Semi-bold",
			"原始": "Original",
			"原始尺寸": "Original size",
			"原样": "As is",
			"反向换行": "Reverse wrap",
			"变换": "Transform",
			"变换原点": "Transform origin",
			"叠加": "Overlay",
			"可见": "Visible",
			"可见性": "Visibility",
			"可选": "Selectable",
			"右": "Right",
			"右上": "Top right",
			"右上圆角": "Radius top right",
			"右下": "Bottom right",
			"右下圆角": "Radius bottom right",
			"右侧": "Right side",
			"右偏移": "Right offset",
			"右内边距": "Padding right",
			"右外边距": "Margin right",
			"右浮": "Float right",
			"含内边距": "Padding box",
			"含边框": "Border box",
			"吸顶": "Sticky",
			"四边偏移": "Inset",
			"固定": "Fixed",
			"圆角": "Border radius",
			"均分": "Space evenly",
			"块级": "Block",
			"垂直反向": "Column reverse",
			"垂直对齐": "Vertical align",
			"垂直排列": "Column",
			"基准尺寸": "Flex basis",
			"基线": "Baseline",
			"外边距": "Margin",
			"多行对齐": "Multi-line alignment",
			"大小写": "Text transform",
			"字体": "Font family",
			"字体样式": "Font style",
			"字体简写": "Font shorthand",
			"字号": "Font size",
			"字距": "Letter spacing",
			"字重": "Font weight",
			"完整显示": "Contain",
			"定位": "Position",
			"实线": "Solid",
			"容器": "Container",
			"亚克力": "Acrylic",
			"透但清楚": "Sheer but legible",
			"毛玻璃": "Frosted",
			"糊得明显": "Visibly blurred",
			"云母": "Mica",
			"几乎不糊，只换质感": "Barely blurred, just a different texture",
			"细描边卡片": "Hairline card",
			"最小的一种": "The smallest one",
			"横向排列": "Row layout",
			"截断": "Truncate",
			"滚动": "Scroll",
			"一行排开": "One row",
			"水平 + 垂直": "Both axes",
			"等宽两列": "Two equal columns",
			"字号 / 行高": "Font size / line height",
			"底色 + 圆角": "Fill + radius",
			"细线 + 圆角": "Hairline + radius",
			"轻微浮起": "Slight lift",
			"宽高": "Width and height",
			"内外边距": "Margin and padding",
			"单行省略号": "One-line ellipsis",
			"纵向 + 限高": "Scroll with a cap",
			"粘在顶部": "Stick to the top",
			"不占布局": "Out of flow",
			"宽": "Width",
			"宽度": "Width",
			"宽高比": "Aspect ratio",
			"尺寸": "Size",
			"层叠隔离": "Isolation",
			"层级": "Z-index",
			"居中": "Center",
			"左": "Left",
			"左上": "Top left",
			"左上圆角": "Radius top left",
			"左下": "Bottom left",
			"左下圆角": "Radius bottom left",
			"左侧": "Left side",
			"左偏移": "Left offset",
			"左内边距": "Padding left",
			"左外边距": "Margin left",
			"左浮": "Float left",
			"布局": "Layout",
			"常规": "Static",
			"常规（关键字）": "Normal",
			"平滑": "Smooth",
			"底端": "Bottom",
			"底部": "Bottom",
			"弹性与对齐": "Flex and alignment",
			"弹性布局": "Flex",
			"弹性简写": "Flex shorthand",
			"总是滚动": "Always scroll",
			"手型": "Pointer",
			"抓取": "Grab",
			"拉伸": "Stretch",
			"按列": "By column",
			"按列密集": "Column dense",
			"按文字": "Text",
			"按行": "By row",
			"按行密集": "Row dense",
			"按需滚动": "Scroll as needed",
			"换行方式": "Wrapping",
			"排列次序": "Order",
			"描边与圆角": "Border and radius",
			"描边": "Border",
			"提前优化": "Will change",
			"收缩": "Shrink",
			"收缩比例": "Flex shrink",
			"放大": "Grow",
			"放大比例": "Flex grow",
			"效果与动效": "Effects and motion",
			"数字字形": "Numeric glyphs",
			"文字阴影": "Text shadow",
			"文字颜色": "Text color",
			"文本": "Text",
			"文本对齐": "Text align",
			"文本装饰": "Text decoration",
			"文本选择": "User select",
			"斜体": "Italic",
			"断词方式": "Word break",
			"无": "None",
			"显示": "Display",
			"替换内容适配": "Object fit",
			"最大宽度": "Max width",
			"最大高度": "Max height",
			"最小宽度": "Min width",
			"最小高度": "Min height",
			"柔光": "Soft light",
			"横向溢出": "Overflow X",
			"横向重复": "Repeat X",
			"正常": "Normal",
			"正片叠底": "Multiply",
			"水平反向": "Row reverse",
			"水平排列": "Row",
			"浮动": "Float",
			"混合模式": "Blend mode",
			"清右": "Clear right",
			"清左": "Clear left",
			"清除浮动": "Clear",
			"溢出": "Overflow",
			"溢出省略": "Text overflow",
			"滚动条宽度": "Scrollbar width",
			"滚动行为": "Scroll behavior",
			"滤色": "Screen",
			"滤镜": "Filter",
			"点线": "Dotted",
			"独立": "Isolate",
			"环绕": "Space around",
			"生成内容": "Content",
			"盒模型": "Box sizing",
			"相对": "Relative",
			"省略号": "Ellipsis",
			"禁止": "Not allowed",
			"空白处理": "White space",
			"穿透": "Through",
			"立即": "Immediate",
			"等宽数字": "Tabular nums",
			"粗": "Bold",
			"粗体（关键字）": "Bold (keyword)",
			"纵向堆叠": "Column stack",
			"纵向溢出": "Overflow Y",
			"纵向重复": "Repeat Y",
			"细": "Thin",
			"绘制": "Paint",
			"绝对": "Absolute",
			"缩小": "Scale down",
			"网格": "Grid",
			"网格列": "Grid columns",
			"网格对齐": "Place items",
			"网格水平对齐": "Justify items",
			"网格行": "Grid rows",
			"背景": "Background",
			"背景位置": "Background position",
			"背景图": "Background image",
			"背景尺寸": "Background size",
			"背景模糊": "Backdrop filter",
			"背景简写": "Background shorthand",
			"背景色": "Background color",
			"背景裁剪": "Background clip",
			"背景重复": "Background repeat",
			"自动": "Auto",
			"自动流向": "Grid auto flow",
			"自身对齐": "Align self",
			"虚线": "Dashed",
			"行内": "Inline",
			"行内块": "Inline block",
			"行跨度": "Row span",
			"行间距": "Row gap",
			"行高": "Line height",
			"裁剪": "Clip",
			"裁剪形状": "Clip path",
			"覆盖": "Cover",
			"跟随父级": "Follow parent",
			"轮廓": "Outline",
			"轮廓偏移": "Outline offset",
			"边框宽度": "Border width",
			"边框样式": "Border style",
			"边框简写": "Border shorthand",
			"边框颜色": "Border color",
			"过渡": "Transition",
			"重复": "Repeat",
			"长词换行": "Long word wrapping",
			"长词断行": "Break long words",
			"间距": "Gap",
			"阴影": "Shadow",
			"隐藏": "Hidden",
			"靠结束边": "End",
			"靠起始边": "Start",
			"顶端": "Top",
			"顶部": "Top",
			"首字母大写": "Capitalize",
			"首行缩进": "Text indent",
			"高": "Height",
			"高度": "Height",
			"默认": "Default",
			"鼠标事件": "Pointer events",
		};

		/**
		 * 翻译一条**内容**（属性名、值名、模板名、分组名）。
		 *
		 * 只在英文下查表；查不到就原样返回中文 —— 与界面那套「未登记的键显示原文」同一个原则：
		 * 漏一条不该让界面出现空字符串或 key。
		 * @param text - the Chinese source text.
		 * @returns the English text in English, else the argument.
		 */
		function content(text) {
			if (activeLocaleTag !== 'en') return text;
			return CONTENT_EN[text] ?? text;
		}

		/**
		 * `{name}` 占位替换。缺变量时保留原样的占位符 —— 一个没填的 `{count}` 比空字符串更容易发现。
		 * @param text - template.
		 * @param vars - values keyed by placeholder name.
		 * @returns the filled text.
		 */
		function interpolate(text, vars) {
			if (vars === undefined || vars === null) return text;
			return String(text).replace(/\{(\w+)\}/g, (whole, name) => (
				Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
			));
		}

		/**
		 * 当前翻译函数。默认只查 zh 表：没有 locale 服务的组合行为与加国际化之前完全一致。
		 * `apply` 拿到 locale 服务后会把它换成 `locale.bind(LOCALE_NS)`。
		 */
		let translate = (key, vars) => interpolate(STRINGS.zh[key] ?? key, vars);

		/**
		 * 翻译一条文案。
		 * @param key - key in {@link STRINGS}, e.g. `menu.audit`.
		 * @param vars - `{name}` 占位符的值。
		 * @returns the current locale's text.
		 */
		function t(key, vars) {
			return translate(key, vars);
		}

		const BASE_CSS_TAG = PLUGIN_ID + '/Base.module.css';
		const BASE_CSS = [
			'.dshUi_menu{position:absolute;top:calc(100% + 4px);right:0;z-index:100;min-width:100%;width:max-content;max-width:360px;box-sizing:border-box;padding:4px;display:flex;flex-direction:column;gap:0;border:0;border-radius:var(--dsw-radius-lg);background:var(--dsw-menu-surface-fill);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);max-height:min(60vh,320px);overflow-y:auto;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1)}',
			'.dshUi_menuItem{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;border:none;border-radius:var(--dsw-radius-md);background:transparent;cursor:pointer;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);text-align:left}',
			'.dshUi_menuItem:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshUi_menuLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dshUi_button{appearance:none;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font:var(--dsw-font-s-14);cursor:pointer;white-space:nowrap}',
			'.dshUi_button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshUi_button:disabled{cursor:not-allowed;opacity:.4}',
			'.dshUi_button:focus-visible{outline-style:solid;outline-offset:1px}',
			'.dshUi_button[aria-busy="true"]{opacity:.6}',
			'.dshUi_spinner{flex:none;box-sizing:border-box;width:12px;height:12px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;animation:dshUiSpin 700ms linear infinite}',
			'@keyframes dshUiSpin{to{transform:rotate(360deg)}}',
			'.dshUi_buttonDanger{color:var(--dsw-alias-state-error-primary)}',
			'.dshUi_buttonDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}',
			'@media (prefers-reduced-motion:reduce){.dshUi_spinner{animation:none;border-right-color:currentColor;opacity:.6}}',
			'.dshUi_field,.dshCc_panelField,.dshCc_propText{box-sizing:border-box;height:34px;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13)}',
			'.dshUi_field:focus-visible,.dshCc_panelField:focus-within,.dshCc_propText:focus-visible{border-color:var(--dsw-alias-state-business-primary)}',
			'.dshUi_field:disabled,.dshCc_panelField:disabled,.dshCc_propText:disabled{color:var(--dsw-alias-label-tertiary)}',
			'.dshUi_field[aria-invalid="true"],.dshCc_propText[aria-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}',
			'.dshUi_fieldFail{display:flex;flex-direction:column;gap:4px;flex:1 1 240px;min-width:0}',
			'.dshUi_fieldMessage{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);line-height:16px}',
			'.dshUi_fieldMessageBad{color:var(--dsw-alias-state-error-primary)}',
			'.dshUi_field{flex:1;min-width:0}',
			'.dshUi_choiceWrap{position:relative;display:inline-flex;width:100%;min-width:0}',
			'.dshUi_choice{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-width:0;height:36px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font:var(--dsw-font-s-14);font-family:var(--ds-font-family-code);text-align:left;cursor:pointer}',
			'.dshUi_choice:hover{border-color:var(--dsw-alias-label-dimmed)}',
			'.dshUi_choice:focus-visible{outline-style:solid;outline-offset:1px}',
			'.dshUi_choice:disabled{opacity:.4;cursor:not-allowed}',
			'.dshUi_choice:disabled:hover{border-color:var(--dsw-alias-border-l2)}',
			'.dshUi_choiceValue{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:14px}',
			'.dshUi_choice{justify-content:space-between}',
			'.dshUi_choiceMenu{z-index:60;box-sizing:border-box;display:flex;flex-direction:column;gap:0;overflow-y:auto;padding:4px;border-radius:var(--dsw-radius-lg);background:var(--dsw-menu-surface-fill);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);max-height:260px;inset:auto;margin:0;border:0}',
			'.dshUi_choiceMenu::-webkit-scrollbar-track, .dshUi_menu::-webkit-scrollbar-track,.dshCc_pickPanel::-webkit-scrollbar-track, .dshCc_panel::-webkit-scrollbar-track{margin:6px}',
			'.dshUi_choiceItem{display:flex;align-items:center;gap:8px;min-height:34px;padding:6px 8px;border:none;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);text-align:left;cursor:pointer}',
			'.dshUi_choiceItem:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshUi_choiceItem:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}',
			'.dshUi_menuItem:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);outline:none}',
			'.dshUi_choiceItem[aria-selected=true]{color:var(--dsw-alias-brand-primary)}',
			'.dshUi_choiceGroup{position:sticky;top:0;z-index:1;padding:4px 7px 2px;color:var(--dsw-alias-label-tertiary);font-weight:500;font-size:11px;line-height:16px}',
			'.dshUi_choiceGroup[data-stuck]{background:var(--dsw-alias-menu-group-header-fill)}',
			'.dshUi_badge{flex:none;padding:1px 8px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:999px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px;font-weight:500;letter-spacing:.04em}',
			'.dshUi_switch{display:inline-flex;align-items:center;gap:7px;padding:2px 9px 2px 4px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);cursor:pointer}',
			'.dshUi_switch:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshUi_switch:focus-visible{outline-style:solid;outline-offset:2px}',
			'.dshUi_switch:disabled{opacity:.5;cursor:default}',
			'.dshUi_switchTrack{position:relative;flex:none;width:36px;height:20px;border-radius:999px;background:var(--dsw-alias-border-l3);transition:background 120ms ease}',
			'.dshUi_switchThumb{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-switch-thumb);transition:transform 120ms ease}',
			'.dshUi_switch[aria-checked="true"]{color:var(--dsw-alias-label-primary)}',
			'.dshUi_switch[aria-checked="true"] .dshUi_switchTrack{background:var(--dsw-alias-brand-primary)}',
			'.dshUi_switch[aria-checked="true"] .dshUi_switchThumb{background:var(--dsw-alias-label-primary-foreground);transform:translateX(16px)}',
			'@media (max-width:520px){.dshUi_switchLabel{display:none}}',
			'@media (prefers-reduced-motion: reduce){.dshUi_switchTrack,.dshUi_switchThumb{transition:none}}',
			'.dshUi_menuHint{flex:none;margin-left:auto;color:var(--dsw-alias-label-caption);font-size:11px}',
			'.dshUi_menuItem:disabled{cursor:default;opacity:.45}',
			'.dshUi_menuItem:disabled:hover{background:transparent}'
		].join('');

		const ROW_CSS = [
			'.dshCc_row{border-bottom:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:8px;padding:16px 0;display:flex}',
			'.dshCc_head{align-items:center;justify-content:space-between;gap:12px;display:flex;flex-wrap:wrap}',
			'.dshCc_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}',
			'.dshCc_actions{align-items:center;gap:8px;display:flex;flex-wrap:wrap;min-width:0}',
			'.dshCc_picker{position:relative;display:inline-flex}',
			'.dshCc_trigger{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:var(--dsw-radius-md);align-items:center;gap:12px;padding:0 14px;font:var(--dsw-font-s-14);display:inline-flex;max-width:220px}',
			'.dshCc_trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_trigger:disabled{cursor:default;opacity:.5}',
			'.dshCc_trigger:focus-visible{outline-style:solid;outline-offset:1px}',
			'.dshCc_triggerLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dshCc_chevron{flex:none}',
			'.dshCc_menuCheck{flex:none;color:var(--dsw-alias-label-primary)}',
			'.dshCc_newRow{align-items:center;gap:8px;display:flex}',
			'.dshCc_wallpaperLinkRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}',
			'.dshCc_linkBtn{appearance:none;background:none;border:none;padding:0;margin:0;cursor:pointer;font:inherit;font:var(--dsw-font-xs-13);color:var(--dsw-alias-state-business-primary);text-align:left;border-radius:var(--dsw-radius-xs)}',
			'.dshCc_linkBtn:hover{text-decoration:underline}',
			'.dshCc_linkBtn:focus-visible{outline-style:solid;outline-offset:2px}',
			'.dshCc_linkNote{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}',
			'.dshCc_panelField{display:flex;align-items:center;gap:6px;width:100%;min-width:0;padding-right:5px}',
			// 令牌页：一条令牌两行 —— 名字 + 用量 / 值 + 来源。列表限高自己滚，否则 500 条会把
			// 整行撑到看不见编辑器。
			'.dshCc_excludeField{flex:1 1 auto;min-width:0}',
			// 与查找栏的字段同规格（28px / 透明底 / 12px 字），横向占满。
			'.dshCc_tokenSearch{box-sizing:border-box;flex:none;width:100%;height:28px;margin:8px 0 4px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);outline:none}',
			'.dshCc_tokenSearch:focus-visible{outline-style:solid;outline-offset:1px}',
			// 覆盖值输入框同理：两行一条的紧凑行里，36px 的默认字段太厚。
			'.dshCc_tokenInput{box-sizing:border-box;flex:1 1 auto;min-width:0;height:24px;padding:0 6px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxxs-11);font-family:var(--ds-font-family-code);outline:none}',
			'.dshCc_tokenInput:focus-visible{outline-style:solid;outline-offset:1px}',
			'.dshCc_tokenSection{margin:8px 0 4px;color:var(--dsw-alias-label-caption);font:var(--dsw-font-xxxs-11)}',
			'.dshCc_tokenList{box-sizing:border-box;flex:none;display:flex;flex-direction:column;min-width:0;max-height:260px;overflow-y:auto;border:0.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm)}',
			'.dshCc_tokenRow{display:flex;flex-direction:column;gap:2px;min-width:0;padding:6px 8px;border-top:0.5px solid var(--dsw-alias-border-l1)}',
			'.dshCc_tokenRow:first-child{border-top:0}',
			'.dshCc_tokenTop{display:flex;gap:8px;align-items:baseline;min-width:0}',
			'.dshCc_tokenName{flex:1;min-width:0;font:var(--dsw-font-xxxs-11);font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dshCc_tokenMeta{flex:none;color:var(--dsw-alias-label-caption);font:var(--dsw-font-xxxs-11);white-space:nowrap}',
			'.dshCc_tokenSub{display:flex;gap:8px;min-width:0}',
			'.dshCc_tokenValue{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dshCc_tokenSource{flex:0 1 auto;max-width:55%;min-width:0;color:var(--dsw-alias-label-caption);font:var(--dsw-font-xxxs-11);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dshCc_propText{flex:1;min-width:0;max-width:100%;font-family:var(--ds-font-family-code)}',
			'.dshCc_desc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}',
			'.dshCc_editorWrap{box-sizing:border-box;position:relative;display:flex;flex-direction:column;width:100%;min-width:0;height:140px;min-height:140px;overflow:hidden;resize:vertical;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);--dshCc-line:19px}',
			'.dshCc_editorWrap:focus-within{border-color:transparent;outline-style:solid;outline-offset:1px}',
			'.dshCc_editorRow{display:flex;flex:1;min-height:0;min-width:0}',
			'.dshCc_findBar{box-sizing:border-box;display:flex;flex:none;align-items:center;gap:6px;padding:6px 8px;border-bottom:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}',
			'.dshCc_findField{box-sizing:border-box;flex:1;min-width:0;height:28px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font:var(--dsw-font-xxs-12);outline:none}',
			'.dshCc_findField:focus{border-color:var(--dsw-alias-brand-primary)}',
			'.dshCc_findCount{flex:none;min-width:52px;text-align:right;color:var(--dsw-alias-label-caption);font-size:12px;font-variant-numeric:tabular-nums}',
			'.dshCc_findCountBad{flex:none;min-width:52px;text-align:right;color:var(--dsw-alias-state-error-primary);font-size:12px}',
			'.dshCc_findBtn{appearance:none;flex:none;height:28px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;line-height:1}',
			'.dshCc_findBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_findBtn:disabled{opacity:.4;cursor:not-allowed}',
			'.dshCc_findBtn[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active);border-color:transparent;color:var(--dsw-alias-brand-primary);font-weight:600}',
			'.dshCc_findBtn[aria-pressed="true"]:hover{background:var(--dsw-alias-interactive-bg-active)}',
			'.dshCc_findIcon{padding:0 6px}',
			'.dshCc_findIcon .dshCc_chevron{transform:rotate(90deg)}',
			'.dshCc_findNext .dshCc_chevron{transform:rotate(-90deg)}',
			'@media (max-width:640px){.dshCc_findCount,.dshCc_findCountBad{display:none}}',
			'@media (max-width:540px){.dshCc_findLabel{display:none}.dshCc_findWide{padding:0 6px}}',
			'.dshCc_findIconOnly{display:none}',
			'@media (max-width:540px){.dshCc_findIconOnly{display:inline}}',
			'.dshCc_hit{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);border-radius:var(--dsw-radius-xs)}',
			'.dshCc_hitActive{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 34%, transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent)}',
			'.dshCc_gutter{flex:none;box-sizing:border-box;padding:10px 6px 10px 10px;overflow:hidden;text-align:right;user-select:none;color:var(--dsw-alias-label-caption);font-size:12px;line-height:var(--dshCc-line);font-family:var(--ds-font-family-code)}',
			'.dshCc_gutterInner{will-change:transform}',
			'.dshCc_noGutter .dshCc_gutter{display:none}',
			'.dshCc_gutterLine{height:var(--dshCc-line)}',
			'.dshCc_code{position:relative;flex:1;min-width:0;min-height:0;overflow:hidden;padding:10px 12px}',
			'.dshCc_highlight{position:absolute;top:10px;left:12px;right:12px;margin:0;pointer-events:none;white-space:pre;overflow-wrap:normal;word-break:normal;tab-size:2;font-weight:400;font-size:12px;line-height:var(--dshCc-line);font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-primary);will-change:transform;z-index:2}',
			'.dshCc_clickable{pointer-events:auto;cursor:pointer;border-radius:var(--dsw-radius-xs)}',
			'.dshCc_clickable:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_editor{box-sizing:border-box;position:relative;z-index:1;display:block;width:100%;height:100%;min-height:0;padding:0;border:none;outline:none;background:transparent;overflow:auto;resize:none;color:transparent;caret-color:var(--dsw-alias-label-primary);font-weight:400;font-size:12px;line-height:var(--dshCc-line);font-family:var(--ds-font-family-code);white-space:pre;overflow-wrap:normal;tab-size:2;scrollbar-width:none}',
			'.dshCc_editor::-webkit-scrollbar{width:0;height:0}',
			'.dshCc_editor::placeholder{color:var(--dsw-alias-label-caption)}',
			'.dshCc_editor::selection{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, transparent)}',
			'.dshCc_tokSel{color:var(--shiki-token-keyword)}',
			'.dshCc_tokProp{color:var(--shiki-token-constant)}',
			'.dshCc_tokVal{color:var(--shiki-token-string)}',
			'.dshCc_tokPunc{color:var(--shiki-token-punctuation)}',
			'.dshCc_tokComment{color:var(--shiki-token-comment);font-style:italic}',
			'.dshCc_suggest{position:absolute;z-index:120;min-width:164px;max-width:280px;box-sizing:border-box;padding:4px;display:flex;flex-direction:column;border:0;border-radius:var(--dsw-radius-lg);background:var(--dsw-menu-surface-fill);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-prominent);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);font-family:var(--ds-font-family-code)}',
			'.dshCc_suggestItem{display:flex;align-items:center;gap:6px;width:100%;min-height:26px;padding:3px 7px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;cursor:pointer;text-align:left;font:inherit;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-primary)}',
			'.dshCc_suggestItem[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_suggestKind{margin-left:auto;flex:none;color:var(--dsw-alias-label-caption);font-size:11px}',
			'.dshCc_shell{box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1fr);width:100%;min-width:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1)}',
			'.dshCc_main{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;width:100%;min-width:0;padding:8px}',
			'.dshCc_panel{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;width:100%;min-width:0;min-height:0;max-height:340px;overflow-y:auto;overflow-x:hidden;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}',
			'.dshCc_panel>*{flex:none}',
			// 预览块：头部一行（规则文本 + 三个按钮）、视口（一块或两块）、底部一行口径说明。
			// 窄行下两块上下堆叠 —— 与 docs/preview.md 的结论一致。
			'.dshCc_preview{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;width:100%;min-width:0;padding:10px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform)}',
			'.dshCc_previewHead{display:flex;align-items:center;gap:8px;min-width:0}',
			'.dshCc_previewRule{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxxs-11);font-family:var(--ds-font-family-code)}',
			'.dshCc_previewTools{display:flex;flex:none;align-items:center;gap:4px}',
			'.dshCc_sampleCards{display:flex;flex-wrap:wrap;gap:4px;min-width:0;max-height:64px;overflow-y:auto}',
			'.dshCc_previewStage{display:flex;flex-wrap:wrap;gap:8px;min-width:0}',
			'.dshCc_previewBox{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;flex:1 1 160px;min-width:0;max-height:260px;overflow:auto;padding:8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1)}',
			'.dshCc_previewLabel{align-self:flex-start;padding:0 6px;border-radius:var(--dsw-radius-xs);color:var(--dsw-alias-label-caption);font:var(--dsw-font-xxxs-11)}',
			// 增删点缀色是**底色**（alpha 0.08），文字仍用 label 色：直接当文字色在真机上量到等于隐身。
			'.dshCc_previewBoxCurrent .dshCc_previewLabel{background:var(--dsw-alias-code-diff-deleted);color:var(--dsw-alias-label-secondary)}',
			'.dshCc_previewBoxModified .dshCc_previewLabel{background:var(--dsw-alias-code-diff-added);color:var(--dsw-alias-label-secondary)}',
			'.dshCc_previewAfter,.dshCc_previewCurrent{box-sizing:border-box;min-width:0;max-height:260px;max-width:100%;overflow:auto}',
			'.dshCc_previewNote{margin:0;color:var(--dsw-alias-label-caption);font:var(--dsw-font-xxs-12)}',
			// 状态芯片那一行、演示中标记、合成样本与伪元素样本、全屏 dialog。
			'.dshCc_stateChips{display:flex;flex-wrap:wrap;gap:4px;min-width:0}',
			'.dshCc_previewDemo{color:var(--dsw-alias-state-warn-primary);font:var(--dsw-font-xxs-12)}',
			'.dshCc_sampleSynthetic{display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-1)}',
			'.dshCc_samplePseudo{display:inline-block}',
			'.dshCc_full{box-sizing:border-box;position:fixed;inset:0;margin:auto;display:flex;flex-direction:column;gap:16px;width:min(1280px,96vw);height:min(94vh,960px);padding:20px;border:0.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-settings-card-fill);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent)}',
			'.dshCc_full::backdrop{background:color-mix(in srgb,var(--dsw-alias-bg-overlay) 55%,transparent);-webkit-backdrop-filter:blur(18px) saturate(1.15);backdrop-filter:blur(18px) saturate(1.15)}',
			// 关掉透明效果的系统设置：宁可实一点，也不要一块「什么都没发生」的玻璃。
			'@media (prefers-reduced-transparency:reduce){.dshCc_full::backdrop{-webkit-backdrop-filter:none;backdrop-filter:none;background:var(--dsw-alias-bg-overlay)}}',
			'.dshCc_full[open]{animation:dshCc_fullIn .2s ease-out}',
			'@keyframes dshCc_fullIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}',
			'@media (prefers-reduced-motion:reduce){.dshCc_full[open]{animation:none}}',
			'.dshCc_fullHead{display:flex;align-items:center;gap:8px;min-width:0}',
			'.dshCc_fullMeta{flex:none;color:var(--dsw-alias-label-caption);font:var(--dsw-font-xxxs-11);white-space:nowrap}',
			'.dshCc_fullKeys{display:flex;flex:none;align-items:center;gap:4px}',
			'.dshCc_fullNav{appearance:none;flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:15px;line-height:1;cursor:pointer}',
			'.dshCc_fullNav:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.dshCc_fullEsc{flex:none;color:var(--dsw-alias-label-caption);font:var(--dsw-font-xxxs-11);white-space:nowrap}',
			'.dshCc_fullStage{flex:1 1 auto;flex-wrap:nowrap;min-height:260px}',
			'.dshCc_fullStage .dshCc_previewBox{flex:1 1 0;max-height:none}',
			'.dshCc_fullStage .dshCc_previewAfter,.dshCc_fullStage .dshCc_previewCurrent{flex:1 1 auto;max-height:none}',
			'.dshCc_fullStage .dshCc_previewBox>:last-child{margin:auto}',
			'.dshCc_fullBody{flex:0 1 auto;min-height:0;max-height:42%;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-top:8px;border-top:0.5px solid var(--dsw-alias-border-l2)}',


			'.dshCc_propGrid{box-sizing:border-box;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px 12px;width:100%;min-width:0}',
			'.dshCc_propGrid>*{min-width:0}',
			'.dshCc_addPropWrap{width:100%;max-width:none}',
			'.dshCc_addPropWrap .dshUi_choice{background:var(--dsw-alias-interactive-bg-hover);border-color:transparent}',
			'.dshCc_addPropWrap .dshUi_choice:hover{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}',
			'.dshCc_outline{flex:none;width:auto;max-width:160px}',
			'.dshCc_outline .dshUi_choice{height:28px;padding:0 10px;gap:6px;font:var(--dsw-font-xxs-12)}',
			'.dshCc_outline .dshUi_choiceLabel{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
			'.dshCc_propWide{grid-column:1 / -1}',
			'.dshCc_partRow{display:flex;align-items:center;gap:10px;min-width:0;flex:1 1 auto}',
			'.dshCc_partCell{display:flex;align-items:center;gap:6px;min-width:0;flex:1 1 0}',
			'.dshCc_partName{flex:none;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-markdown-tag);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;font-weight:500;white-space:nowrap}',
			'.dshCc_partRow .dshCc_propText{flex:1 1 0;min-width:0}',
			'.dshCc_tplGrid{box-sizing:border-box;display:grid;grid-template-columns:repeat(auto-fill,minmax(124px,1fr));gap:8px;width:100%;min-width:0}',
			'.dshCc_panelName{flex:1;min-width:0;height:100%;padding:0;border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);font-family:var(--ds-font-family-code)}',
			'.dshCc_panelClose{appearance:none;flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:15px;line-height:1;cursor:pointer}',
			'.dshCc_panelClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.dshCc_hlToggle{appearance:none;flex:none;display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:17px;cursor:pointer;white-space:nowrap}',
			'.dshCc_hlToggle:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.dshCc_hlToggle[aria-pressed="true"]{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-label-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent)}',
			'.dshCc_hlToggle:disabled{opacity:.55;cursor:default}',
			// 预览块里的按下态是「选中」而不是「实况高亮」：中性底色，与强调显示那枚胶囊的警告色区分开。
			'.dshCc_previewTools .dshCc_hlToggle[aria-pressed="true"],.dshCc_stateChips .dshCc_hlToggle[aria-pressed="true"],.dshCc_sampleCards .dshCc_hlToggle[aria-pressed="true"]{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}',
			'.dshCc_panelSection{margin:2px 0 0;padding-top:6px;border-top:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
			'.dshCc_prop{align-items:center;display:flex;gap:8px;min-width:0}',
			'.dshCc_propLabel{flex:none;width:76px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13)}',
			'.dshCc_empty{margin:0;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;min-width:0}',
			'.dshCc_tpl{display:flex;align-items:center;gap:8px;width:100%;min-width:0;min-height:36px;padding:5px 14px;border:1px solid transparent;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font:var(--dsw-font-xxs-12);cursor:pointer;text-align:left;overflow:hidden}',
			'.dshCc_tpl:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_tpl:focus-visible{outline-style:solid;outline-offset:1px}',
			'.dshCc_tplHint{margin-left:auto;flex:none;color:var(--dsw-alias-label-caption);font-size:11px}',
			'.dshCc_foot{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-width:0;padding:6px 10px;border-top:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform)}',
			'.dshCc_status{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);font-variant-numeric:tabular-nums}',
			'.dshCc_error{color:var(--dsw-alias-state-error-primary);font:var(--dsw-font-xxs-12)}',
			'.dshCc_conflict{display:flex;align-items:center;gap:8px;min-width:0;color:var(--dsw-alias-state-error-primary);font:var(--dsw-font-xxs-12)}',
			'.dshCc_conflictBtn{appearance:none;flex:none;height:28px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;line-height:1}',
			'.dshCc_conflictBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_fileBar{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-width:0;padding:7px 10px 7px 11px;border-bottom:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform)}',
			'.dshCc_fileIdentity{flex:1;display:flex;align-items:center;gap:7px;min-width:0}',
			'.dshCc_codeIcon{flex:none;color:var(--dsw-alias-label-tertiary)}',
			'.dshCc_fileName{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13)}',
			'.dshCc_fileBarRight{flex:none;display:flex;align-items:center;gap:7px}',
			'.dshCc_statusDot{position:relative;flex:none;width:10px;height:10px;border-radius:50%}',
			'.dshCc_statusDot::after{content:"";position:absolute;inset:20%;border-radius:50%;background:currentColor}',
			'.dshCc_statusDot[data-state=on]{color:var(--dsw-alias-state-success-primary)}',
			'.dshCc_statusDot[data-state=off]{color:var(--dsw-alias-state-idle-primary)}',
			'.dshCc_statusDot[data-state=ongoing]{color:var(--dsw-alias-state-warn-primary);animation:dshCc-status-pulse 1.5s ease-in-out infinite}',
			'@keyframes dshCc-status-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
			'@media (prefers-reduced-motion: reduce){.dshCc_statusDot[data-state=ongoing]{animation:none;opacity:.75}}',
			'.dshCc_pickBtn[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-brand-primary)}',
			'.dshCc_pickBtn[aria-pressed="true"]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
			'.dshCc_pickPanel{position:fixed;z-index:2147483002;left:50%;bottom:20px;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;width:min(520px,92vw);max-height:56vh;overflow-y:auto;box-sizing:border-box;padding:10px 12px;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:13px}',
			'.dshCc_pickPanelHead{align-items:center;display:flex;gap:8px;justify-content:space-between}',
			'.dshCc_pickPanelInfo{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
			'.dshCc_pickPanelList{display:flex;flex-direction:column;gap:4px}',
			'.dshCc_pickPanelTokens{display:flex;flex-wrap:wrap;gap:6px}',
			'.dshCc_pickPanelFoot{align-items:center;display:flex;gap:8px;position:relative}',
			'.dshCc_pickInsert{appearance:none;margin-left:auto;height:28px;padding:0 10px;border:none;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);cursor:pointer;font:inherit;font-size:12px}',
			'.dshCc_pickBox{position:fixed;z-index:2147483000;pointer-events:none;box-sizing:border-box;border:1px solid var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);border-radius:var(--dsw-radius-xs)}',
			'.dshCc_pickLocked{border-width:2px;background:color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent)}',
			'.dshCc_pickBox[data-label]::after{content:attr(data-label);position:absolute;left:0;top:-22px;white-space:nowrap;padding:1px 6px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font-size:11px;line-height:18px}',
			'.dshCc_hlBox{position:fixed;z-index:2147483000;pointer-events:none;box-sizing:border-box;border:1px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);border-radius:var(--dsw-radius-xs)}',
			'.dshCc_hlBox[data-sole="true"]{border-width:2px;background:transparent}',
			'.dshCc_pickBarBtn{appearance:none;flex:none;height:28px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;line-height:1}',
			'.dshCc_pickBarBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_menuItemDanger{color:var(--dsw-alias-state-error-primary)}',
			'.dshCc_menuItemDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}',
			'.dshCc_versionsHead{display:flex;align-items:center;gap:6px;min-width:0;padding:2px 4px 4px}',
			'.dshCc_versionsBack{appearance:none;flex:none;display:inline-flex;align-items:center;gap:3px;height:24px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer}',
			'.dshCc_versionsBack:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.dshCc_versionsBack .dshCc_chevron{transform:rotate(90deg)}',
			'.dshCc_versionsFor{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-caption);font-size:11px;text-align:right}',
			'.dshCc_versionsNote{padding:6px 10px 2px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12)}',
			'.dshCc_versionsNoteBad{color:var(--dsw-alias-state-error-primary)}',
			'.dshCc_versionsItem{font-variant-numeric:tabular-nums}',
			'.dshCc_versionsEmpty{padding:10px;color:var(--dsw-alias-label-caption);font:var(--dsw-font-xxs-12)}',
			'.dshCc_menuBtn{gap:8px;padding-right:10px}',
			'.dshCc_pickHelpTrigger{flex:none;padding:0 8px;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:help;font-size:12px;line-height:28px}',
			'.dshCc_pickHelpTrigger:hover{color:var(--dsw-alias-label-primary)}',
			'.dshCc_pickHelp{position:absolute;left:14px;bottom:calc(100% + 8px);display:none;flex-direction:column;gap:2px;padding:8px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-specific-menu);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);white-space:nowrap}',
			'.dshCc_pickHelp[data-open="true"]{display:flex}',
			'.dshCc_pickSlider{flex:none;width:120px;height:28px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
			'.dshCc_candidate{align-items:center;appearance:none;display:flex;gap:8px;width:100%;min-width:0;padding:6px 8px;border:0.5px solid transparent;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;text-align:left}',
			'.dshCc_candidate[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary)}',
			'.dshCc_candidateSel{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code);font-size:12px}',
			'.dshCc_candidateKind,.dshCc_candidateMatches{flex:none;color:var(--dsw-alias-label-caption);font-size:11px}',
			'.dshCc_tokenChip{appearance:none;padding:3px 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-tag);color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px}',
			'.dshCc_tokenChip[aria-pressed="false"]{opacity:0.45;text-decoration:line-through}',
			'@media (max-width:900px){',
			'.dshCc_fullStage{flex-wrap:wrap}',
			'.dshCc_fullStage .dshCc_previewBox{flex:1 1 100%;max-height:none}',
			'.dshCc_full{padding:14px;gap:12px}',
			'.dshCc_fullEsc{display:none}',
			'}',
		].join('');

		// 公共层先装：先令牌（--dsl-g-*），再控件；都在编辑器自己的表之前。
		installSharedBaseCss();

		// 公共层在前，编辑器在后：两张表都命中同一个元素时，更具体的那张（编辑器/面板）赢。
		if (
			typeof document !== 'undefined'
			&& document.querySelector('style[data-plugin-css=' + JSON.stringify(BASE_CSS_TAG) + ']') === null
		) {
			const styleTag = document.createElement('style');
			styleTag.dataset.plugin = PLUGIN_ID;
			styleTag.dataset.pluginCss = BASE_CSS_TAG;
			styleTag.textContent = BASE_CSS;
			document.head.appendChild(styleTag);
		}

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

		/* ═══ 修：聊天里的图片压住后面的内容（归因见 docs/known-issues.md）═════════
		 * 症状：消息里的 markdown 图片会盖住下一块内容（256px 图标压住下面的 callout）。
		 *
		 * 归因（3080 真机，逐张样式表二分 + 逐条规则定位）：
		 *   · 关掉全部扩展样式表 → 图片外层 <p> 高 256px，布局正常（DSH 自己是对的）
		 *   · 只开 dsh-smooth-stream 0.7.0 的 TypewriterAssistantNodeView.module.css → <p> 19px
		 *   · 再只删掉它里面那条规则 → 回到 256px；放回去 → 又 19px
		 *
		 * 那条规则是：
		 *   @supports (text-box-trim: trim-both) {
		 *     .root :is(p, h1, h2, h3, h4, h5, h6, blockquote) {
		 *       text-box-trim: trim-both; text-box-edge: text;
		 *     }
		 *   }
		 * text-box-trim 按文字边裁掉首末行的半行距；当段落里只有一个很高的 inline-block
		 * 图片时，裁剪按文字行高（19px）算，而图仍画 256px —— 图就溢出到盒子外面。
		 * 不是「inline-block 不贡献高度」（我最初的误判），也不是 min-height:0。
		 *
		 * 上游已修：main 的 1f199b7 与 0.8.0-rc.1（npm tag next）给选择器加了
		 * :not(:has(img, video, canvas, iframe, object, embed, code))；但 latest 仍是 0.7.0，
		 * 所以装 latest 的人依旧会看到。那条修复实测有效（19px -> 256px）。
		 *
		 * 本插件这条规则：让包图片的按钮成为块级元素，那个 <p> 的高度就只能由图片决定 ——
		 * 上游哪个版本、哪个扩展布局出岔子，图都不会再盖住下文。
		 *
		 * 选择器用模块名前缀（_imageButton_）而不是完整类名：哈希后缀每次构建都会变，
		 * 这段来自 CSS module 文件名，跨版本稳定；DSH 改名则静默失效（退回原状），不误伤别的元素。
		 * width:fit-content 不能省：只写 display:block 会让按钮撑满整行、点整行都开大图。
		 *
		 * 单独一个 <style data-plugin-css="dsh-custom-css/host-fix.css">：这是对显示的一次性
		 * 补丁，不属于本插件 UI，便于识别与移除；上游 0.8 正式版铺开后可以整块删掉。
		 * ═══════════════════════════════════════════════════════════════════════ */
		const HOST_FIX_CSS_TAG = PLUGIN_ID + '/host-fix.css';
		const HOST_FIX_CSS = [
			'[class*="_imageButton_"]{display:block;width:fit-content;max-width:100%}',
		].join('');

		/**
		 * 上游（dsh-smooth-stream）是否已经修好「图片外层 <p> 被压成行高」。
		 *
		 * 修好的版本里那条规则带 `:not(:has(img, …))`（排除含图片的段落）。检测选择器文本而不是
		 * 版本号：插件版本没有可读的接口，而规则本身就是「修没修」的直接证据。
		 * @returns true 表示本插件不必再注入补丁。
		 */
		function upstreamFixesImageButtons() {
			const fixed = selector => typeof selector === 'string' && selector.includes(':not(:has(img');
			const walk = (rules) => {
				for (const rule of rules) {
					if (typeof rule.selectorText === 'string' && fixed(rule.selectorText)) return true;
					if (rule.cssRules !== undefined && rule.cssRules.length > 0 && walk([...rule.cssRules])) return true;
				}
				return false;
			};
			for (const sheet of document.styleSheets) {
				try {
					if (walk([...sheet.cssRules])) return true;
				}
				catch { /* 跨域样式表读不到：跳过 */ }
			}
			return false;
		}

		/**
		 * 注入宿主的图片排版补丁 —— **只在补丁仍然需要时**。
		 *
		 * 这段代码的寿命应该短：上游 0.8.0-rc.1 起已经修了（见 docs/known-issues.md），所以
		 * 装了新版就该自动闭嘴，而不是让「display:block」永久变成这个插件的一部分。上游的样式表
		 * 可能比本插件晚注入，所以延迟再复查两次，出现就撤掉自己。
		 */
		function installHostFix() {
			if (typeof document === 'undefined') return;
			if (document.querySelector('style[data-plugin-css=' + JSON.stringify(HOST_FIX_CSS_TAG) + ']') !== null) return;
			if (upstreamFixesImageButtons()) return;
			const styleTag = document.createElement('style');
			styleTag.dataset.plugin = PLUGIN_ID;
			styleTag.dataset.pluginCss = HOST_FIX_CSS_TAG;
			styleTag.textContent = HOST_FIX_CSS;
			document.head.appendChild(styleTag);
			const retire = () => {
				if (!upstreamFixesImageButtons()) return;
				document.querySelector('style[data-plugin-css=' + JSON.stringify(HOST_FIX_CSS_TAG) + ']')?.remove();
			};
			setTimeout(retire, 1500);
			setTimeout(retire, 4000);
		}

		installHostFix();

		/* ═══ 弹出菜单跟随触发器宽度 ════════════════════════════════════════════
		 * 侧栏左下「更多」（账号菜单）的按钮宽度随侧栏走，而它的下拉菜单是挂到 `body` 的
		 * portal：inline 只给 `left` / `top`，没有 CSS 锚点定位（`position-anchor` 是
		 * `normal`、锚点元素没有 `anchor-name`），所以 CSS 量不到按钮宽度 —— 只能写死一个
		 * 像素值，侧栏一拖宽就对不上。
		 *
		 * 这里用一段观察器补上：菜单出现时，量一下那个展开中的触发器，把菜单的宽度设成
		 * 同一个值；窗口尺寸变化时如果菜单还开着，再量一次。只认「设置区里的菜单触发器」，
		 * 不碰别的弹出层。
		 *
		 * 为什么不做成纯 CSS：`anchor-size(width)` 需要 `position-anchor` + `anchor-name`
		 * 成对出现，而菜单的定位是 JS 算的 left/top（不参与锚点定位），我们没有权限去改
		 * 那份 JS。JS 补这 10 行比给宿主打补丁稳。
		 * ═══════════════════════════════════════════════════════════════════════ */
		const MENU_TRIGGER_SELECTOR = '[class*="_settingsArea"] [aria-haspopup="menu"]';

		/**
		 * Widen a `body`-level menu to the width of the trigger that opened it.
		 * @param menu - the menu element (any element with `role="menu"`).
		 * @param trigger - the trigger to copy from; defaults to the settings-area one. Passed in by
		 * the test, which has no real DOM to query.
		 * @returns true when a width was applied.
		 */
		function fitMenuToTrigger(menu, trigger = document.querySelector(MENU_TRIGGER_SELECTOR)) {
			if (menu === null || typeof menu !== 'object' || menu.style === undefined) return false;
			if (trigger === null || typeof trigger !== 'object') return false;
			if (trigger.getAttribute('aria-expanded') !== 'true') return false;
			const width = Math.round(trigger.getBoundingClientRect().width);
			if (!(width > 0)) return false;
			menu.style.width = width + 'px';
			menu.style.minWidth = width + 'px';
			return true;
		}

		/**
		 * Install the menu-width follower once. Safe to call repeatedly: it keys off a data
		 * attribute on `document.body`, and degrades to nothing where MutationObserver is missing.
		 */
		function installMenuWidthFollower() {
			if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
			if (document.body === null || document.body.dataset.dshMenuFollower === 'on') return;
			document.body.dataset.dshMenuFollower = 'on';

			const fitOpenMenus = () => {
				for (const menu of document.querySelectorAll('[role="menu"]')) fitMenuToTrigger(menu);
			};

			new MutationObserver((records) => {
				for (const record of records) {
					for (const node of record.addedNodes) {
						if (node.nodeType !== 1) continue;
						if (node.matches?.('[role="menu"]')) {
							// The menu is positioned in the same frame it is inserted; measure on the
							// next one so its own `left`/`top` are already applied.
							requestAnimationFrame(() => fitMenuToTrigger(node));
						}
					}
				}
			}).observe(document.body, { childList: true, subtree: true });

			// The sidebar is resizable: if a menu is open while the width changes, follow again.
			window.addEventListener('resize', fitOpenMenus, { passive: true });
		}




		/**
		 * 装 CSS 公共层（`shared/base.css`，由 shared/sync.mjs 同步成这一段的 `SHARED_BASE_CSS`）。
		 *
		 * 它是**扩展自己的**样式基座：本地设计令牌 + 三个零特异性原语，服务本机那套自定义样式
		 * （音乐播放器 / 费用条 / genui 的覆盖都读同一批令牌）。先于用户样式表注入，所以用户
		 * 规则天然赢过它，不需要 `!important`。
		 */
		function installSharedBaseCss() {
			if (typeof document === 'undefined') return;
			const tag = PLUGIN_ID + '/shared-base.css';
			if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tag) + ']') !== null) return;
			const styleTag = document.createElement('style');
			styleTag.dataset.plugin = PLUGIN_ID;
			styleTag.dataset.pluginCss = tag;
			styleTag.textContent = SHARED_BASE_CSS;
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

		/** 材质令牌那份样式表的 id：默认值必须**先于**用户表存在，否则预设引用的 var() 解析成空。 */
		const MATERIAL_STYLE_ID = PLUGIN_ID + '-material-style';

		/**
		 * 三套材质的默认参数：云母 / 亚克力 / 毛玻璃。
		 *
		 * 为什么由插件自己定义：预设只写 `var(--dsh-material-mica-bg)` 这类引用，而 `var()` 没有
		 * 回退值时，令牌缺失会让**整条声明被丢弃**（不报错）—— 等用户先填就等于预设点了没反应。
		 * 所以默认值随插件发布，令牌页把它们标成「插件默认」，接管之后覆盖它们。
		 *
		 * 底色用 `light-dark()`：深色下压黑、浅色下压白，一套值两种主题都对。
		 */
		const MATERIAL_TOKENS = [
			['--dsh-material-acrylic-bg', 'light-dark(color-mix(in srgb, #ffffff 72%, transparent), color-mix(in srgb, #1c1c1e 72%, transparent))'],
			['--dsh-material-acrylic-blur', '24px'],
			['--dsh-material-acrylic-saturate', '150%'],
			['--dsh-material-acrylic-border', 'var(--dsw-alias-border-l2)'],
			['--dsh-material-frost-bg', 'light-dark(color-mix(in srgb, #ffffff 58%, transparent), color-mix(in srgb, #1c1c1e 58%, transparent))'],
			['--dsh-material-frost-blur', '36px'],
			['--dsh-material-frost-saturate', '120%'],
			['--dsh-material-mica-bg', 'light-dark(color-mix(in srgb, #ffffff 86%, transparent), color-mix(in srgb, #1c1c1e 86%, transparent))'],
			['--dsh-material-mica-blur', '18px'],
			['--dsh-material-mica-saturate', '115%'],
			['--dsh-material-mica-grain', '0.035'],
		];

		/**
		 * 注入材质令牌的默认值。
		 *
		 * 选择器与令牌覆盖那份相同（`body, body[data-ds-dark-theme]`），理由也一样：DSH 的令牌定义
		 * 在 `body` 上，深色那套在 `body[data-ds-dark-theme]`（(0,1,1)）。只写 `body` 在深色下会输。
		 */
		function applyMaterialTokens() {
			if (typeof document === 'undefined') return;
			let tag = document.getElementById(MATERIAL_STYLE_ID);
			if (tag === null) {
				tag = document.createElement('style');
				tag.id = MATERIAL_STYLE_ID;
				tag.dataset.plugin = PLUGIN_ID;
				tag.dataset.pluginCss = PLUGIN_ID + '/material-tokens.css';
				document.head.appendChild(tag);
			}
			tag.textContent = [
				'/* dsh-custom-css · 材质令牌默认值（在「更多操作 → 令牌」里接管后覆盖） */',
				'body,',
				'body[data-ds-dark-theme] {',
				...MATERIAL_TOKENS.map(([name, value]) => '  ' + name + ': ' + value + ';'),
				'}',
				'',
			].join('\n');
		}

		/**
		 * 默认排除名单：**根级元素**。
		 *
		 * 它们不该成为预览样本（克隆一个 <html> 没有意义，而且会把整页样式带进预览框），也不该被
		 * 拾取器选中（写一条作用在 body 上的规则，等于给整个界面换皮肤 —— 那是「皮肤」的事，
		 * 不是「一条规则」的事）。名单可改，见「壁纸设置」里的「排除名单」。
		 */


		/**
		 * 把设置里的文本读成选择器数组。
		 *
		 * 逗号或换行分隔，去空、去重、限长。坏选择器留到**用时**再处理：matches() 会抛错，
		 * 而一份「偶尔让拾取器崩掉」的名单比没有名单更糟 —— 求值那一步逐条 try。
		 * @param text - the raw setting.
		 * @returns an array of selector strings.
		 */
		function parseExclude(text) {
			const found = [];
			for (const part of String(text ?? "").split(/[,\n]+/)) {
				const selector = part.trim();
				if (selector === "" || found.includes(selector)) continue;
				found.push(selector);
				if (found.length >= EXCLUDE_MAX) break;
			}
			return found;
		}

		/**
		 * 三个会「真的坏掉」的透明/定位问题，按元素逐个判。
		 *
		 * 判定只用预览块已经在做的事（解析命中 → 读计算样式），所以它不引入第二套 DOM 逻辑；
		 * `styleOf` 可以注入，纯函数就能被单测驱动。
		 * @param node - 预览中的那个元素。
		 * @param styleOf - 读计算样式，默认 window.getComputedStyle。
		 * @returns 诊断数组 `{ id, detail }`，id 用于 i18n。
		 */
		function diagnoseElement(node, styleOf = (target) => window.getComputedStyle(target)) {
			const findings = [];
			if (node === null || node === undefined) return findings;
			const read = (element) => {
				try { return styleOf(element); }
				catch { return null; }
			};
			const own = read(node);
			if (own === null) return findings;
			const backdrop = String(own.backdropFilter ?? own.webkitBackdropFilter ?? 'none');
			// 1) opacity 杀掉 backdrop-filter：不透明度会建立隔离的 backdrop root，玻璃等于没开。
			if (backdrop !== 'none' && backdrop !== '') {
				let opacity = Number(own.opacity ?? '1');
				if (!(opacity > 0)) opacity = 1;
				let walked = node.parentElement ?? null;
				let inherited = false;
				while (walked !== null && walked !== undefined) {
					const style = read(walked);
					if (style === null) break;
					const value = Number(style.opacity ?? '1');
					if (Number.isFinite(value) && value > 0 && value < 1) { inherited = true; break; }
					walked = walked.parentElement ?? null;
				}
				if (opacity < 1 || inherited) findings.push({ id: 'opacityKillsGlass' });
				// 2) 毛玻璃多层叠加：祖先里还有一层 backdrop-filter。
				let cursor = node.parentElement ?? null;
				while (cursor !== null && cursor !== undefined) {
					const style = read(cursor);
					if (style === null) break;
					const other = String(style.backdropFilter ?? style.webkitBackdropFilter ?? 'none');
					if (other !== 'none' && other !== '') { findings.push({ id: 'stackedGlass' }); break; }
					cursor = cursor.parentElement ?? null;
				}
			}
			// 3) position:fixed 被带 transform 的祖先捕获（上一轮「菜单点不了」的根因）。
			if (String(own.position ?? '') === 'fixed') {
				let cursor = node.parentElement ?? null;
				while (cursor !== null && cursor !== undefined) {
					const style = read(cursor);
					if (style === null) break;
					const transform = String(style.transform ?? 'none');
					const filter = String(style.filter ?? 'none');
					const perspective = String(style.perspective ?? 'none');
					if ((transform !== 'none' && transform !== '') || (filter !== 'none' && filter !== '') || (perspective !== 'none' && perspective !== '')) {
						findings.push({ id: 'fixedTrapped' });
						break;
					}
					cursor = cursor.parentElement ?? null;
				}
			}
			return findings;
		}

		/**
		 * 这个元素**本身**在不在排除名单里。
		 *
		 * 只看元素自己，**不看祖先**：名单的用途是「别碰整页」（`:root` / `html` / `body` 这些），
		 * 而用 `closest()` 去判祖先会让 `:root` 命中**页面上所有元素**（每个节点都有 html 当祖先），
		 * 结果是每条规则都退化成合成样本 —— 这是真机上量出来的，不是假设。
		 * @param node - the element to test.
		 * @param selectors - the parsed exclude list.
		 * @returns true when the element itself is excluded.
		 */
		function isExcludedNode(node, selectors) {
			if (node === null || node === undefined || selectors.length === 0) return false;
			for (const selector of selectors) {
				try {
					if (typeof node.matches === 'function' && node.matches(selector)) return true;
				}
				catch { /* 坏选择器：跳过这一条 */ }
			}
			return false;
		}
		/** 令牌覆盖写在哪个文件里（与 custom.css 并列，跟着备份/历史一起走）。 */
		const TOKENS_SHEET = 'tokens.css';

		/** 令牌覆盖那份 style 标签的 id：它必须排在用户样式表**之前**。 */
		const TOKENS_STYLE_ID = PLUGIN_ID + '-token-style';

		/** 覆盖表：令牌名 → 值。只装用户改过的，不抄来源。 */
		const tokenOverrides = new Map();

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

		/* ═══ 自定义壁纸 ═══════════════════════════════════════════════════════
		 * A wallpaper is a picture behind the interface, and the interface is opaque by
		 * default: DSH paints its shell with `--dsw-alias-bg-base`, so a picture placed
		 * behind it is simply not visible. The sheet this section generates therefore does
		 * two things at once — it paints the picture, and it lets the shell through by
		 * rewriting the background tokens to their own colour at the chosen strength.
		 *
		 * It is written into a <style> of its own, ahead of the user's sheet, so:
		 *   - the two cannot overwrite each other (the user's sheet is a separate element),
		 *   - the user's sheet wins on a tie, which is where an override belongs,
		 *   - and the wallpaper travels on its own to every page, whether or not the
		 *     settings row or the plugin page is on screen.
		 *
		 * The tokens are redefined at `body, body[data-ds-dark-theme]` — the pair the shipped
		 * acrylic skin uses — because DSH defines its dark values on the more specific
		 * `body[data-ds-dark-theme]`. A bare `body` block wins in light mode and silently
		 * loses in dark mode, which is the failure this pair exists to prevent.
		 * ═══════════════════════════════════════════════════════════════════════ */

		/**
		 * The wallpaper state, kept at module scope rather than in the panel.
		 *
		 * The panel is mounted from ONE seat (this plugin's page in the plugin manager, which the
		 * user can leave and come back to), but the panel is not the only writer: `apply()` loads
		 * the record on every page, and the store is what lets the load, the upload and the panel
		 * agree about what is installed. Keeping it here is also what keeps a remount from
		 * displaying a stale picture while the fresh read is in flight.
		 *
		 * `image` is the picture's URL *or* its data URL: a picture uploaded through the host
		 * arrives as a route URL, and a small one can still live entirely in this record. The
		 * two differ only in what has to be reachable at page load.
		 */
		let wallpaperState = {
			/** Picture URL or data URL; empty means no wallpaper. */
			image: '',
			/** `cover` | `contain` | `fill` | `tile`. */
			fit: WALLPAPER_DEFAULTS.fit,
			/** How much of the interface's own base colour is kept, in per cent. */
			transparent: WALLPAPER_DEFAULTS.transparent,
			/** `filter: brightness()` applied to the picture, in per cent offset. */
			brightness: WALLPAPER_DEFAULTS.brightness,
			/** `idle` | `saving` | `saved` | `error`, for the panel's own status line. */
			status: 'idle',
			/** Why the last upload or save failed, in the panel's words. */
			error: '',
			/** Stored wallpapers the Host offered back, newest first. */
			gallery: [],
			/**
			 * Bumped by every write to the store.
			 *
			 * A reply that arrives after the picture has been changed again must not report for
			 * the picture it was made for — the same epoch guard the editor's save uses, and here
			 * it is what keeps "已保存" from appearing under a brand-new upload that is still
			 * being written.
			 */
			epoch: 0,
		};
		const wallpaperListeners = new Set();
		const wallpaperStore = {
			set(patch) {
				wallpaperState = { ...wallpaperState, ...patch };
				for (const listener of wallpaperListeners) listener();
			},
			subscribe(listener) {
				wallpaperListeners.add(listener);
				return () => {
					wallpaperListeners.delete(listener);
				};
			},
			snapshot() {
				return wallpaperState;
			},
		};

		/**
		 * Measure one wallpaper record into the shape the store and the sheet expect.
		 *
		 * Everything here is a value a user cannot type: the record comes from the Host or from
		 * this browser's storage, both of which survive versions of this plugin. A fit mode the
		 * current build does not know about becomes the default rather than an invalid CSS
		 * keyword, and a number becomes a number in range rather than a string that would land
		 * in the stylesheet verbatim.
		 * @param raw - a stored record, or anything else.
		 * @returns a complete, in-range record.
		 */
		function normalizeWallpaper(raw) {
			const source = raw !== null && typeof raw === 'object' ? raw : {};
			const number = (value, fallback, low, high) => {
				const parsed = typeof value === 'number' ? value : Number(value);
				if (!Number.isFinite(parsed)) return fallback;
				return Math.min(high, Math.max(low, Math.round(parsed)));
			};
			return {
				image: typeof source.image === 'string' ? source.image : '',
				fit: WALLPAPER_FITS.includes(source.fit) ? source.fit : WALLPAPER_DEFAULTS.fit,
				transparent: number(source.transparent, WALLPAPER_DEFAULTS.transparent, 0, 60),
				brightness: number(source.brightness, WALLPAPER_DEFAULTS.brightness, -60, 60),
			};
		}

		/**
		 * Whether an `image` value is something a stylesheet may carry.
		 *
		 * The value is interpolated into a `url()` — quoted, so the only way out of it is a
		 * control character or a sequence that ends the style element. Both are refused. An
		 * `http(s)`, `file:` or `data:` URL is accepted, and so is a relative path starting with
		 * a single slash: that is the shape the Host's own route answers with, and refusing it
		 * would refuse the only URL this plugin ever generates. `javascript:` is refused, as is a
		 * `data:` URL that is not an image, and a protocol-relative `//host/path` — which is a
		 * URL to somewhere else wearing the costume of a path.
		 * @param image - the candidate value.
		 * @returns true when it may be written into a stylesheet.
		 */
		function wallpaperUrlAllowed(image) {
			if (typeof image !== 'string' || image === '') return true;
			if (image.length > 8 * 1024 * 1024) return false;
			// eslint-disable-next-line no-control-regex -- refusing control characters is the point
			if (/[\u0000-\u001f\u007f]/.test(image)) return false;
			if (/<\/style/i.test(image)) return false;
			if (/^data:/i.test(image)) return /^data:image\//i.test(image);
			if (/^\/\//.test(image)) return false;
			if (/^\/[^/]/.test(image)) return true;
			return /^(https?|file):/i.test(image);
		}

		/**
		 * 界面底色在某档「界面浓度」下保留多少（%）。
		 *
		 * 两处共用：真正注入的样式表，和面板里那块预览。**必须共用** —— 分开算过一次，结果
		 * 预览与真实界面差 8 个百分点（预览用 100 − 浓度，真实那层还叠了自身地板值）。
		 * @param floor - 这层在最大透明时仍保留的自身颜色（14/30/42/34）。
		 * @param transparent - 0–60，0 = 完全遮住壁纸。
		 * @returns 0–100。
		 */
		function interfaceOpacity(floor, transparent) {
			const amount = Math.max(0, Math.min(60, Number(transparent) || 0));
			return Math.round(floor + (100 - floor) * (1 - amount / 100));
		}

		/**
		 * The stylesheet text for one wallpaper.
		 *
		 * Split out as a pure function on purpose: this is the part a test can hold on to, and
		 * every number in it comes from a setting whose effect a user can see immediately. The
		 * empty string it returns for a rejected or absent picture is what "no wallpaper" means
		 * — `applyWallpaper` then removes the sheet entirely rather than leaving a dead one.
		 *
		 * The interface is lightened by turning each background token into itself at a reduced
		 * percentage: `color-mix(in srgb, <its own colour> <strength>, transparent)`. Written
		 * with the literal colours DSH uses rather than with `var(--dsw-…)`, because a custom
		 * property that refers to itself is a cycle, and one that refers to the token it is
		 * redefining would resolve to nothing.
		 * @param raw - a wallpaper record (measured here, so a partial record is fine).
		 * @param rawSettings - this plugin's settings; read for the parts that paint (scrim, clock).
		 * @returns CSS text, or an empty string when there is nothing to paint.
		 */
		function wallpaperCss(raw, rawSettings) {
			const settings = normalizeWallpaper(raw);
			const prefs = normalizeSettings(rawSettings);
			if (settings.image === '' || !wallpaperUrlAllowed(settings.image)) return '';
			// JSON string syntax is also valid CSS string syntax, so a URL carrying a quote or a
			// backslash cannot end the string early.
			const url = JSON.stringify(settings.image);
			// `tile` is `auto`, and `auto` for an SVG or a large photograph means "its own size",
			// which is what a tiled wallpaper wants. The other three are the `background-size`
			// keywords of the same name apart from `fill`, which is `100% 100%`.
			const size = settings.fit === 'fill' ? '100% 100%' : settings.fit === 'tile' ? 'auto' : settings.fit;
			const repeat = settings.fit === 'tile' ? 'repeat' : 'no-repeat';
			// 界面底色在「0」时必须是不透明的：这是这个控件的下限语义（0 = 完全遮住壁纸），
			// 也是文字可读性的下限。原来的写法是 percent × (100−transparent)/100 —— 于是 0 的
			// 时候底色只剩 14%（壁纸整张透出来，正文直接糊在照片上），而滑块的文案又写着
			// 「越小壁纸越明显」，方向与行为正好相反。
			//
			// 现在：0 → 100%（完全遮住），60 → 该令牌自己的地板值（14/30/42/34%），中间线性。
			// percent 于是表示「最大透明时这层还留多少」，而不是「0 时留多少」。
			const alpha = percent => Math.max(0, Math.min(100, interfaceOpacity(percent, settings.transparent)));
			const factor = 1 + settings.brightness / 100;
			// ONE `filter` declaration, not two: a second `filter` in the same rule replaces the
			// first instead of adding to it, so brightness and blur have to be composed here.
			// Measured: with two declarations the picture kept `brightness(0.45)` and lost the
			// blur entirely — the slider moved and nothing blurred.
			const filters = [];
			if (settings.brightness !== 0) filters.push('brightness(' + factor.toFixed(2) + ')');
			if (prefs.blur > 0) filters.push('blur(' + prefs.blur + 'px)');
			const filter = filters.length === 0 ? '' : 'filter:' + filters.join(' ') + ';';
			// The scrim is a second, independent overlay BETWEEN the picture and the interface.
			// It is not "make the interface more opaque": that control (`transparent`) changes what
			// the shell keeps of its own colour, while this darkens the picture itself — which is
			// what a user with a bright photograph actually wants.
			const scrim = prefs.scrim === 0 ? '' : String(prefs.scrim / 100);
			return [
				'/* dsh-custom-css · 自定义壁纸 */',
				// The audience selectors are written as a PAIR that is one step more specific than
				// the skin's, and that is not decoration. Measured: with a bare `body::before`
				// here and the acrylic skin (its own `body::before`) loaded as the user's sheet,
				// the skin won the tie and the picture was never painted — the gradient stayed on
				// screen while the panel said "已保存". `html body::before` outranks `body::before`,
				// and the dark-theme leg outranks the skin's `body[data-ds-dark-theme]::before`
				// the same way.
				//
				// The layer's own geometry carries `!important` on top of that, and the reason is
				// the feature rather than the tie: a skin that paints a wallpaper of its OWN is
				// exactly the case this panel exists to replace, and a wallpaper that loses to a
				// gradient is indistinguishable from a broken one. `!important` is otherwise
				// avoided in this plugin — a user's own sheet can still override every one of
				// these with an `!important` of their own, which is the escape hatch that keeps
				// this from being an unoverridable rule.
				'html body::before,html body[data-ds-dark-theme]::before{',
				'content:"";',
				'position:fixed;',
				'inset:0;',
				'z-index:-1;',
				'pointer-events:none;',
				scrim === '' ? 'background-image:url(' + url + ') !important;'
					: 'background-image:linear-gradient(rgba(0,0,0,' + (prefs.scrim / 100) + '),rgba(0,0,0,' + (prefs.scrim / 100) + ')),url(' + url + ') !important;',
				'background-size:' + size + ' !important;',
				'background-position:center center !important;',
				'background-repeat:' + repeat + ' !important;',
				'background-attachment:fixed !important;',
				// The whole picture, whatever opacity a skin put on its own wallpaper layer: this
				// sheet's opacity control is `transparent`, not this.
				'opacity:1;',
				filter,
				'}',
				// The shell's own surfaces: each token keeps its hue, so a light theme stays light
				// and a dark one stays dark while the picture shows through. Same one-step-higher
				// specificity, for the same measured reason — the acrylic skin sets these same
				// tokens on `body, body[data-ds-dark-theme]`, and a tie there means the panel's
				// 「界面浓度」 slider moves a number without moving the interface.
				'html body,html body[data-ds-dark-theme]{',
				'--dsw-alias-bg-base:color-mix(in srgb, light-dark(#ffffff,#16181c) ' + alpha(14) + '%,transparent);',
				'--dsw-alias-bg-layer-1:color-mix(in srgb, light-dark(#ffffff,#1c1f24) ' + alpha(30) + '%,transparent);',
				'--dsw-alias-bg-layer-2:color-mix(in srgb, light-dark(#ffffff,#262a31) ' + alpha(42) + '%,transparent);',
				'--dsw-alias-bg-module-platform:color-mix(in srgb, light-dark(#f5f6f7,#1a1d21) ' + alpha(34) + '%,transparent);',
				'}',
			].filter(line => line !== '').join('\n') + '\n';
		}

		/**
		 * Publish a wallpaper as a stylesheet on the page.
		 *
		 * Inserted immediately BEFORE the user's sheet, which gives the picture its own element
		 * — a re-render of the user's sheet cannot take it with it — and leaves the user's rules
		 * later in the cascade, where an override belongs. That the sheet is a text block and not
		 * an element is also why no `.dshWp_*` class appears here: content painted behind the
		 * app is not part of the app's DOM, and the picker's own "how many elements match" count
		 * must not be able to see it.
		 * @param raw - a wallpaper record; an empty picture removes the sheet.
		 */
		function applyWallpaper(raw, rawSettings) {
			const existing = document.getElementById(WALLPAPER_STYLE_ID);
			if (existing !== null) existing.remove();
			const css = wallpaperCss(raw, rawSettings ?? settingsStore.snapshot());
			if (css === '') return;
			const styleTag = document.createElement('style');
			styleTag.id = WALLPAPER_STYLE_ID;
			styleTag.dataset.plugin = PLUGIN_ID;
			styleTag.textContent = css;
			const userSheet = document.getElementById(USER_STYLE_ID);
			if (userSheet !== null && userSheet.parentElement === document.head) {
				document.head.insertBefore(styleTag, userSheet);
			}
			else {
				document.head.appendChild(styleTag);
			}
		}

		/**
		 * Read the wallpaper this browser last applied.
		 *
		 * Kept in browser storage rather than only on the Host because the first paint is the
		 * whole point: reading it from a route would leave every page load wallpaper-less until
		 * a request comes back. It is a per-browser copy for the same reason the sheet switch
		 * is — the Host copy is the source of truth, and this one only has to be good enough to
		 * paint.
		 * @returns a complete record, or null when there is none.
		 */
		function readLocalWallpaper() {
			try {
				const raw = localStorage.getItem(WALLPAPER_KEY);
				return raw === null ? null : normalizeWallpaper(JSON.parse(raw));
			}
			catch {
				return null;
			}
		}

		/**
		 * Store the applied wallpaper for this browser.
		 * @param settings - a complete record.
		 */
		function writeLocalWallpaper(settings) {
			try {
				localStorage.setItem(WALLPAPER_KEY, JSON.stringify(settings));
			}
			catch {
				// An oversized picture may not fit the storage quota — a data URL of a large
				// photograph is megabytes. The wallpaper still applies for this page; only the
				// next page load loses it, and the panel does not turn that into an error.
			}
		}

		/**
		 * Install a wallpaper everywhere it has to go: the page, this browser, the Host.
		 *
		 * Applied and stored locally FIRST, then written to the Host: the picture is already on
		 * the disk by the time this is called (the upload route stored it), so a failed Host
		 * write must not leave the user looking at the old wallpaper while the panel says
		 * something went wrong. The write is only the copy that survives `localStorage` being
		 * cleared.
		 * @param raw - the wallpaper to install.
		 * @param options - `{ persist }`: false applies it without touching the Host or storage
		 *   (used while a value is being dragged), and `{ gallery }` to skip a re-listing.
		 * @returns the applied record.
		 */
		function commitWallpaper(raw, options = {}) {
			const settings = normalizeWallpaper(raw);
			applyWallpaper(settings);
			if (options.persist === false) {
				wallpaperStore.set({ ...settings, status: 'saving', error: '' });
				// AFTER the store moves, never before: the clock's own visibility rule is "there is
				// a picture", and asking that question of a store that has not been told yet is how
				// removing the wallpaper left a clock on a plain background.
				syncWallpaperClock(settingsStore.snapshot());
				return settings;
			}
			writeLocalWallpaper(settings);
			const epoch = wallpaperStore.snapshot().epoch + 1;
			wallpaperStore.set({ ...settings, epoch, status: 'saving', error: '' });
			syncWallpaperClock(settingsStore.snapshot());
			void (async () => {
				try {
					await post('/write', { name: WALLPAPER_SHEET, css: JSON.stringify(settings, null, 2) + '\n' });
					if (wallpaperStore.snapshot().epoch !== epoch) return;
					wallpaperStore.set({ status: 'saved' });
				}
				catch {
					if (wallpaperStore.snapshot().epoch !== epoch) return;
					// The wallpaper is on the page either way; what failed is the copy that would
					// survive this browser. Said plainly, because "没保存" would send the user
					// hunting for a problem they cannot see.
					wallpaperStore.set({ status: 'idle' });
				}
			})();
			return settings;
		}

		/**
		 * Store one uploaded picture and make it the wallpaper.
		 *
		 * The bytes go to the Host rather than into this record: they are stored under their
		 * own hash, so the same picture picked twice is stored once, and the record stays a few
		 * hundred bytes of settings that both the Host and `localStorage` can hold. A file the
		 * Host refuses — not an image, or larger than the ceiling — is reported as such and
		 * changes nothing.
		 * @param file - the File the picker returned.
		 * @returns true when the wallpaper was installed.
		 */
		async function uploadWallpaper(file) {
			if (file === null || typeof file !== 'object') return false;
			if (!/^image\//i.test(String(file.type ?? ''))) {
				wallpaperStore.set({ status: 'error', error: t('wp.notImage', { name: file.name ?? t('wp.unnamed') }) });
				return false;
			}
			// Refused before the read, not after: turning a 200 MB file into a string is the
			// expensive half, and the Host's own ceiling would only reject it afterwards.
			if (Number(file.size ?? 0) > 32 * 1024 * 1024) {
				wallpaperStore.set({ status: 'error', error: t('wp.tooBig') });
				return false;
			}
			wallpaperStore.set({ status: 'saving', error: '' });
			let dataUrl;
			try {
				dataUrl = await new Promise((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(String(reader.result ?? ''));
					reader.onerror = () => reject(new Error(t('wp.readFailed')));
					reader.readAsDataURL(file);
				});
			}
			catch (error) {
				wallpaperStore.set({ status: 'error', error: t('wp.imageReadFailed', { message: error?.message ?? error }) });
				return false;
			}
			try {
				const stored = await post('/wallpaper-image', { dataUrl, name: file.name });
				// The URL the Host answers with, not one composed here: the name is the Host's
				// (a content hash) and this page has no business guessing it.
				commitWallpaper({ ...wallpaperStore.snapshot(), image: stored.url });
			}
			catch (error) {
				const message = String(error?.message ?? error);
				// `bad-image` is the Host refusing the payload; anything else is a transport
				// failure, and the difference decides whether trying again could help.
				wallpaperStore.set({
					status: 'error',
					error: message.includes('bad-image') ? t('wp.badImage') : t('wp.uploadFailed', { message }),
				});
				return false;
			}
			void loadWallpaperGallery();
			return true;
		}

		/**
		 * Ask the Host which wallpapers it still has stored.
		 *
		 * A failure is silent on purpose: the strip is a convenience that costs nothing when it
		 * is empty, and an error line about a gallery nobody asked for would be noise beside the
		 * wallpaper that is working.
		 */
		async function loadWallpaperGallery() {
			try {
				const payload = await api('/gallery');
				const entries = Array.isArray(payload.wallpapers) ? payload.wallpapers : [];
				wallpaperStore.set({
					gallery: entries
						.filter(entry => entry !== null && typeof entry.name === 'string')
						.map(entry => ({ name: entry.name, bytes: Number(entry.bytes ?? 0), mtime: Number(entry.mtime ?? 0) })),
				});
			}
			catch {
				wallpaperStore.set({ gallery: [] });
			}
			// The gallery is what rotation rotates through, so a changed gallery is a changed
			// rotation: one picture means there is nothing to rotate to, and the timer should not
			// keep waking up to discover that.
			syncWallpaperRotation();
		}

		/**
		 * Load the wallpaper: the browser's copy first so the first paint has it, the Host's
		 * copy when that one is missing (a cleared profile, another browser).
		 */
		async function bootstrapWallpaper() {
			const local = readLocalWallpaper();
			if (local !== null) {
				// A wallpaper recorded on another origin (or under a different route configuration)
				// names its picture with the route it was stored from. Only the name after
				// `?name=` is worth keeping, so it is re-addressed before it is painted — a
				// stale origin would otherwise 404 and leave the page plain for no visible reason.
				const image = wallpaperUrlIsStoredOne(local.image)
					? API + '/wallpaper?name=' + local.image.split('?name=')[1]
					: local.image;
				const settings = { ...local, image };
				applyWallpaper(settings);
				if (settings.image !== local.image) writeLocalWallpaper(settings);
				wallpaperStore.set({ ...settings, status: 'idle' });
			}
			try {
				const sheet = await readSheet(WALLPAPER_SHEET, { optional: true });
				if (sheet.absent) return void loadWallpaperGallery();
				const parsed = JSON.parse(sheet.css);
				const settings = normalizeWallpaper(parsed);
				applyWallpaper(settings);
				writeLocalWallpaper(settings);
				wallpaperStore.set({ ...settings, status: 'idle', error: '' });
			}
			catch {
				// No stored record on the Host: either it was never set, or the sheet has been
				// hand-edited into something that is not JSON. Both mean "nothing to adopt" —
				// the browser's copy, if any, already went up.
			}
			void loadWallpaperGallery();
		}

		/* ═══ 插件设置 ══════════════════════════════════════════════════════════
		 * Settings about how this plugin BEHAVES, kept in a record of their own
		 * (`settings.json.css`) rather than in the wallpaper's: a wallpaper record is the thing a
		 * user reads to find out which picture is installed, and preferences are not part of that
		 * question.
		 *
		 * Everything here paints through the same injected sheet the wallpaper uses, so a change
		 * takes effect on the page immediately and needs neither a reload nor a Host restart —
		 * which is the whole reason this batch exists before the ones that add Host routes.
		 * ═══════════════════════════════════════════════════════════════════════ */

		/** The settings as the page last applied them. */
		let pluginSettings = { ...SETTINGS_DEFAULTS };
		const settingsListeners = new Set();
		const settingsStore = {
			set(patch) {
				pluginSettings = { ...pluginSettings, ...patch };
				for (const listener of settingsListeners) listener();
			},
			subscribe(listener) {
				settingsListeners.add(listener);
				return () => {
					settingsListeners.delete(listener);
				};
			},
			snapshot() {
				return pluginSettings;
			},
		};

		/**
		 * Measure a settings record into the shape the sheet and the controls expect.
		 *
		 * Same discipline as the wallpaper's: the record comes from a file and from browser storage,
		 * both of which outlive a version of this plugin, so a value this build does not know
		 * becomes the default instead of being written into a stylesheet.
		 * @param raw - a stored record, or anything else.
		 * @returns a complete, in-range record.
		 */
		function normalizeSettings(raw) {
			const source = raw !== null && typeof raw === 'object' ? raw : {};
			const clamp = (value, fallback, low, high) => {
				const parsed = typeof value === 'number' ? value : Number(value);
				if (!Number.isFinite(parsed)) return fallback;
				return Math.min(high, Math.max(low, Math.round(parsed)));
			};
			// A rotation value is a string in the record (`'off'` or a number of seconds as text),
			// because that is what a `<select>` hands back and what a hand-edited file reads as.
			// Anything unknown — including a hand-typed `'5'` — falls back to off rather than to a
			// rotation nobody asked for.
			const rotate = ROTATE_CHOICES.some(([value]) => value === String(source.rotate))
				? String(source.rotate)
				: SETTINGS_DEFAULTS.rotate;
			const pick = (value, choices, fallback) => {
				const wanted = String(value);
				return choices.some(([option]) => String(option) === wanted) ? wanted : fallback;
			};
			return {
				rotate,
				scrim: clamp(source.scrim, SETTINGS_DEFAULTS.scrim, 0, 80),
				blur: clamp(source.blur, SETTINGS_DEFAULTS.blur, 0, 24),
				clock: source.clock === true,
				// The editor's preferences are whitelists for the same reason rotation is: a record
				// edited by hand should not be able to arm a 3-second-per-keystroke debounce or a Tab
				// that inserts 400 spaces.
				saveDelay: Number(pick(source.saveDelay, SAVE_DELAY_CHOICES, SETTINGS_DEFAULTS.saveDelay)),
				validate: pick(source.validate, VALIDATE_CHOICES, SETTINGS_DEFAULTS.validate),
				lineNumbers: source.lineNumbers !== false,
				// 只有显式的 false 才关掉：老记录里没有这个键，默认是允许。
				devApi: source.devApi !== false,
				tabWidth: Number(pick(source.tabWidth, TAB_WIDTH_CHOICES, SETTINGS_DEFAULTS.tabWidth)),
				// 排除名单是自由文本（选择器），所以不做取值白名单，只要求是字符串。
				exclude: typeof source.exclude === 'string' ? source.exclude : SETTINGS_DEFAULTS.exclude,
			};
		}

		/** How long typing settles before a write; the editor's debounce reads this. */
		function saveDelayMs() {
			return normalizeSettings(settingsStore.snapshot()).saveDelay;
		}

		/** Spaces one Tab (and one formatter step) uses. */
		function tabWidth() {
			return normalizeSettings(settingsStore.snapshot()).tabWidth;
		}

		/** Whether the editor's own checks run, and how far they go. */
		function validationMode() {
			return normalizeSettings(settingsStore.snapshot()).validate;
		}

		/** How long one rotation step is, in ms, or 0 when rotation is off. */
		function rotateIntervalMs(raw) {
			const value = normalizeSettings(raw).rotate;
			if (value === 'off') return 0;
			const seconds = Number(value) * 1000;
			if (!Number.isFinite(seconds) || seconds <= 0) return 0;
			return Math.min(ROTATE_MAX_MS, seconds);
		}

		/**
		 * Read the settings this browser last applied.
		 * @returns a complete record, or null when there is none.
		 */
		function readLocalSettings() {
			try {
				const raw = localStorage.getItem(SETTINGS_KEY);
				return raw === null ? null : normalizeSettings(JSON.parse(raw));
			}
			catch {
				return null;
			}
		}

		/**
		 * Store the applied settings for this browser.
		 * @param next - a complete record.
		 */
		function writeLocalSettings(next) {
			try {
				localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
			}
			catch {
				// Same trade as the wallpaper's: the settings still apply for this page.
			}
		}

		/**
		 * Apply one settings record everywhere it has to go.
		 *
		 * The wallpaper is re-painted from the CURRENT record rather than left alone: scrim and the
		 * clock are stylesheet rules, so the only way a settings change reaches them is by writing
		 * the sheet again. The write is local-first for the same reason the wallpaper's is — the
		 * page is the thing the user is looking at.
		 * @param raw - the settings to install.
		 * @param options - `{ persist }`: false applies without writing (used while dragging).
		 * @returns the applied record.
		 */
		function commitSettings(raw, options = {}) {
			const next = normalizeSettings(raw);
			settingsStore.set(next);
			// The record IS the style, so committing it repaints the sheet through the wallpaper
			// path — and then the clock is synced against the store that has just moved, which is
			// the order its own rule needs. Re-implementing the repaint here is how the two sheets
			// drift apart (the picture kept the old scrim for exactly one commit before this).
			applyWallpaper(wallpaperStore.snapshot(), next);
			syncWallpaperClock(next);
			if (options.persist === false) return next;
			writeLocalSettings(next);
			void post('/write', { name: SETTINGS_SHEET, css: JSON.stringify(next, null, 2) + '\n' }).catch(() => {
				// A Host write that fails costs the copy that would outlive this browser; the
				// settings are on the page either way, and an error line for that would be noise.
			});
			return next;
		}

		/**
		 * Keep the corner clock in step with the settings.
		 *
		 * The element is OURS (`data-dshcc-owned`), created and removed by this function and by
		 * nothing else, and the interval only exists while the clock is on. `aria-hidden` is set
		 * because it is decoration: a screen reader announcing the time every thirty seconds would
		 * be an accessibility defect, not a feature.
		 * @param raw - the settings to honour.
		 */
		function syncWallpaperClock(raw) {
			const next = normalizeSettings(raw);
			const existing = document.getElementById(CLOCK_ELEMENT_ID);
			if (next.clock && wallpaperStore.snapshot().image === '') {
				// A clock on a plain background is just a strange overlay; it belongs to a wallpaper.
				if (existing !== null) existing.remove();
				return;
			}
			if (!next.clock) {
				if (existing !== null) existing.remove();
				if (clockTimer !== null) clearInterval(clockTimer);
				clockTimer = null;
				return;
			}
			const clock = existing ?? document.createElement('div');
			if (existing === null) {
				clock.id = CLOCK_ELEMENT_ID;
				clock.setAttribute(OWNED_ATTR, '');
				clock.setAttribute('aria-hidden', 'true');
				clock.className = 'dshWp_clock';
				document.body.appendChild(clock);
			}
			const paint = () => {
				const now = new Date();
				const two = value => String(value).padStart(2, '0');
				clock.textContent = two(now.getHours()) + ':' + two(now.getMinutes());
			};
			paint();
			if (clockTimer === null) {
				// Thirty seconds is enough for a minutes-only readout and cheap enough to leave
				// running: at most one repaint per half minute, and none at all when it is off.
				clockTimer = setInterval(() => {
					if (document.visibilityState === 'hidden') return;
					paint();
				}, 30000);
			}
		}

		/** The corner clock's repaint timer, or null when the clock is off. */
		let clockTimer = null;

		/**
		 * Rotate the wallpaper through the pictures the Host still has.
		 *
		 * Driven from the gallery rather than from a second list of its own: the pictures are the
		 * ones the gallery already reports, so rotation and the strip can never disagree about what
		 * is available. One step picks the next picture after the current one, which makes a manual
		 * pick and a rotation step the same movement.
		 */
		function rotateWallpaperOnce() {
			const current = wallpaperStore.snapshot();
			const gallery = Array.isArray(current.gallery) ? current.gallery : [];
			if (gallery.length < 2 || current.image === '') return false;
			const urls = gallery.map(entry => API + '/wallpaper?name=' + encodeURIComponent(entry.name));
			const at = urls.indexOf(current.image);
			const next = urls[at < 0 ? 0 : (at + 1) % urls.length];
			if (next === current.image) return false;
			commitWallpaper({ ...current, image: next });
			return true;
		}

		/**
		 * Start or stop the rotation timer to match the settings.
		 *
		 * Called whenever the settings or the gallery change, and never left running: one timer at
		 * a time, replaced rather than stacked, and stopped outright when rotation is off — an
		 * idle interval would keep waking the page for nothing.
		 */
		function syncWallpaperRotation() {
			const period = rotateIntervalMs(settingsStore.snapshot());
			if (rotationTimer !== null) clearInterval(rotationTimer);
			rotationTimer = null;
			if (period === 0) return;
			rotationTimer = setInterval(() => {
				if (document.visibilityState === 'hidden') return;
				rotateWallpaperOnce();
			}, period);
		}

		/** The wallpaper rotation timer, or null when rotation is off. */
		let rotationTimer = null;

		/**
		 * Load the plugin settings: this browser's copy first, the Host's when that one is missing.
		 */
		async function bootstrapSettings() {
			const local = readLocalSettings();
			if (local !== null) {
				settingsStore.set(local);
				applyWallpaper(wallpaperStore.snapshot(), local);
				syncWallpaperClock(local);
				syncWallpaperRotation();
			}
			try {
				const sheet = await readSheet(SETTINGS_SHEET, { optional: true });
				if (sheet.absent) return;
				const next = normalizeSettings(JSON.parse(sheet.css));
				settingsStore.set(next);
				writeLocalSettings(next);
				applyWallpaper(wallpaperStore.snapshot(), next);
				syncWallpaperClock(next);
				syncWallpaperRotation();
			}
			catch {
				// No stored record on the Host: never set, or hand-edited into something that is not
				// JSON. Both mean "nothing to adopt" — the browser's copy already went up.
			}
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
			/**
			 * Set when the file on disk is no longer the copy this plugin last saw: `{ name, disk }`.
			 * While it is set, writes are refused rather than clobbering the other copy.
			 */
			conflict: null,
			/** Whether the element picker is armed. Lives here so it outlives the row. */
			picking: false,
			/**
			 * Bumped by the picker when it leaves a rule for the row to open.
			 *
			 * The handoff itself lives at module scope (`pendingOpenSelector`) so it survives
			 * the row being unmounted, and THIS counter is how a row that is already on
			 * screen hears about it. It has to be explicit: a pick that reuses an existing
			 * rule writes no text, so `state.css` stays the identical string and a consumer
			 * keyed on it never re-runs — the panel never opened, and the handoff waited
			 * until the next unrelated edit to jump the row somewhere the user no longer was.
			 */
			openRequest: 0,
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
		 * Open this plugin's page in the plugin manager, on the wallpaper section.
		 *
		 * The supported route is the `pluginNavigation` service the plugin manager provides — the
		 * voice-input plugin navigates the same way — and it is reached through `ctx.get` rather
		 * than declared in `exports.inject`, because a required service this plugin cannot work
		 * without is a dependency that would stop it loading at all on a DSH whose plugin manager
		 * does not provide one. Waiting at CLICK time costs nothing when nobody clicks, and the DOM
		 * fallback below covers the rest.
		 *
		 * The fallback clicks the entry the user themself would click, exactly as
		 * `openSettingsSurface` does for the settings dialog: wrong clicks are worse than an
		 * unfinished gesture, so it looks for the sidebar's plugin row by its label and gives up
		 * silently if it cannot identify it. The section is not scrolled into view afterwards —
		 * the page opens at the top and the section is a scroll away, which is honest about what
		 * happened.
		 */
		function openWallpaperSection() {
			const navigate = getPluginNavigation?.();
			if (typeof navigate?.openBundle === 'function') {
				try {
					navigate.openBundle(PLUGIN_ID);
					return;
				}
				catch {
					// Fall through: a navigation service that throws must not swallow the click.
				}
			}
			const entry = [...document.querySelectorAll('button, [role="button"], a')].find(node => {
				if (typeof node.closest === 'function' && node.closest('.dshCc_row') !== null) return false;
				const name = node.getAttribute('aria-label') ?? node.getAttribute('title') ?? node.textContent ?? '';
				return /^(插件|plugins)$/i.test(String(name).trim());
			});
			if (entry !== undefined) entry.click();
		}

		/**
		 * The row's in-flight write, handed to code that writes from outside the editor.
		 *
		 * The row owns the debounce and the picker does not: without the handoff, an edit
		 * still inside its 400 ms window fires after a picked rule is written and puts the
		 * old text back — the pick is lost, with no error anywhere.
		 *
		 * The contract is deliberately two-way, and both directions carry weight.
		 * `takeOver()` goes first: it cancels that pending debounce and bumps the row's
		 * epoch, so the write being replaced can no longer report for the sheet.
		 * `settled(ok)` goes last, once the outside write is known to have landed or
		 * failed. A one-way take-over left the footer on "保存中" for good: the timer it
		 * cancelled was the only thing that would ever have cleared it. Only
		 * `settled(true)` may claim the sheet is saved.
		 */
		let externalWrite = null;

		/** Selector the picker put in the sheet, for the row to open when it next renders. */
		let pendingOpenSelector = null;
		/** Where the caret belongs in that rule, applied once the row is on screen. */
		let pendingOpenCaret = null;

		/**
		 * Reads the plugin manager's navigation service, when one is installed.
		 *
		 * A reader rather than the service itself: the service is looked up at CLICK time so this
		 * plugin does not declare a dependency it cannot load without (see `openWallpaperSection`).
		 * `null` until `apply` sets it, which is also what a composition without a plugin manager
		 * looks like — in that case the row falls back to clicking the sidebar entry.
		 */
		let getPluginNavigation = null;

		/**
		 * Bring the settings surface back, best effort.
		 *
		 * The plugin has no API for opening DSH's own settings page, so this looks for the
		 * entry the user themself would click and clicks it. If that entry cannot be
		 * identified, nothing happens: the rule is already written, and a wrong click
		 * would be worse than an unfinished gesture.
		 */
		function openSettingsSurface() {
			if (document.querySelector('.dshCc_row') !== null) return;
			const entry = [...document.querySelectorAll('button, [role="button"], a')].find(node => {
				if (node === null || node === undefined) return false;
				if (typeof node.closest === 'function' && node.closest('.dshCc_pickPanel') !== null) return false;
				const name = node.getAttribute('aria-label') ?? node.getAttribute('title') ?? '';
				return /^(设置|settings|偏好|preferences)$/i.test(String(name).trim());
			});
			if (entry !== undefined) entry.click();
		}
		/** The running pick session. It outlives the settings row on purpose. */
		let pickSession = null;

		/**
		 * Apply an edit made outside the editor.
		 *
		 * A pick is a discrete action rather than a keystroke stream, so it writes
		 * through immediately instead of joining the editor's debounce — and because it
		 * borrows the row's write slot, it owes both halves of the handoff: take the
		 * pending debounce over before writing, settle after it so the footer can stop
		 * waiting. Only the file path can fail; the browser-local path settles at once.
		 * @param css - the new sheet text.
		 */
		function editSheetText(css) {
			// Captured before the write starts: a response that lands after the row has
			// gone must report to the handoff that was taken over, if anything at all.
			const handoff = externalWrite;
			if (handoff !== null) handoff.takeOver();
			const current = store.snapshot();
			// An edit made outside the editor is undoable too, and it is a step of its own: a
			// pick is a gesture, not a keystroke, so it must not join the typing beside it.
			// The caret is unknown here (`null`) — that state is restored without moving it.
			if (current.mode === 'files' && current.active !== null && css !== current.css) {
				rememberEdit(current.active, { css: current.css, caret: null });
			}
			store.set({ css });
			applySheet(current.active, css, current.disabled);
			if (current.mode !== 'files' || current.active === null) {
				writeLegacyCss(css);
				// Browser-local storage cannot fail here, so the outside gesture is done —
				// and the footer must hear so, exactly as it does on the file path.
				if (handoff !== null) handoff.settled(true);
				return;
			}
			writeSheet(current.active, css).then((ok) => {
				if (handoff !== null) handoff.settled(ok);
			});
		}

		/**
		 * Put a picked selector into the sheet: open the rule that already has it, or
		 * append one seeded with the chosen token declarations.
		 * @param selector - the chosen candidate.
		 * @param declarations - declarations for a newly appended rule.
		 */
		function insertPickedRule(selector, declarations) {
			const rules = parseRules(store.snapshot().css);
			const existing = findRuleIndex(rules, selector);
			pendingOpenSelector = selector;
			// The caret belongs to a rule this gesture CREATED: an existing rule is opened for
			// the declarations it already has, and dropping the cursor into text the user did
			// not ask to edit is the surprise rather than the help. Clearing it here also
			// disposes of an earlier handoff's caret, which would otherwise move the cursor on
			// some later, unrelated edit.
			pendingOpenCaret = null;
			if (existing < 0) {
				const next = appendRule(store.snapshot().css, selector, declarations);
				editSheetText(next.css);
				pendingOpenCaret = next.caret;
			}
			// Wake the row up. The append above already moved `css`, but reusing a rule moves
			// nothing, and the consumer cannot be keyed on a value that does not change — so
			// the notification is its own state (see `openRequest`).
			store.set({ openRequest: store.snapshot().openRequest + 1 });
			// The gesture ends where the work continues: settings reopened on the rule,
			// caret inside it when it was just written, ready to type.
			openSettingsSurface();
		}

		/** One node of the picker's own chrome. */
		function chrome(tag, className, text) {
			const node = document.createElement(tag);
			node.className = className;
			if (text !== undefined) node.textContent = text;
			return node;
		}

		/**
		 * The panel a pick session shows.
		 *
		 * It carries what the decision needs — what is highlighted, the candidate
		 * selectors, the tokens the element resolves to — plus the way out. It is not
		 * modal: the rest of the interface keeps working, which is what makes picking
		 * anywhere in the app possible.
		 * @returns the panel and the parts the session drives.
		 */
		function buildPickPanel() {
			const panel = chrome('div', 'dshCc_pickPanel');
			panel.setAttribute('role', 'dialog');
			panel.setAttribute('aria-label', t('pick.title'));
			const head = chrome('div', 'dshCc_pickPanelHead');
			const readout = chrome('span', 'dshCc_pickPanelInfo', t('pick.hint'));
			const cancel = chrome('button', 'dshCc_pickBarBtn', t('pick.cancel'));
			cancel.type = 'button';
			head.appendChild(readout);
			head.appendChild(cancel);
			const list = chrome('div', 'dshCc_pickPanelList');
			const tokens = chrome('div', 'dshCc_pickPanelTokens');
			const foot = chrome('div', 'dshCc_pickPanelFoot');
			const up = chrome('button', 'dshCc_pickBarBtn', t('pick.up'));
			const down = chrome('button', 'dshCc_pickBarBtn', t('pick.down'));
			const insert = chrome('button', 'dshCc_pickInsert', t('pick.insert'));
			up.type = 'button';
			down.type = 'button';
			insert.type = 'button';
			const helpTrigger = chrome('span', 'dshCc_pickHelpTrigger', t('pick.keys'));
			const help = chrome('div', 'dshCc_pickHelp');
			for (const line of [t('pick.keyUp'), t('pick.keyDown'), t('pick.keyEnter'), t('pick.keyEsc')]) {
				help.appendChild(chrome('div', 'dshCc_pickHelpRow', line));
			}
			helpTrigger.addEventListener('mouseenter', () => help.setAttribute('data-open', 'true'));
			helpTrigger.addEventListener('mouseleave', () => help.removeAttribute('data-open'));
			const slider = chrome('input', 'dshCc_pickSlider');
			slider.type = 'range';
			slider.min = '0';
			slider.max = '6';
			slider.value = '0';
			slider.title = t('pick.depthTitle');
			// A range input has no content, so without this its accessible name is the tooltip's
			// — and a `title` is not reliably an accessible name. Found by measuring the picker's
			// own accessibility surface in the browser: every button there was named, and this
			// was the one control whose name came only from `title`.
			slider.setAttribute('aria-label', t('pick.depth'));
			foot.appendChild(helpTrigger);
			foot.appendChild(help);
			foot.appendChild(slider);
			foot.appendChild(up);
			foot.appendChild(down);
			foot.appendChild(insert);
			panel.appendChild(head);
			panel.appendChild(list);
			panel.appendChild(tokens);
			panel.appendChild(foot);
			return { panel, readout, list, tokens, slider, cancel, up, down, insert };
		}

		/**
		 * Arm the element picker.
		 *
		 * The session lives at module scope, not in the row: most of what a user wants to
		 * style is outside the settings page, so picking has to survive closing it. No
		 * click is intercepted and nothing is dimmed — the highlight follows the pointer
		 * and Enter (or the panel's button) commits it.
		 */
		function startPicking(options = {}) {
			if (pickSession !== null) return;
			const parts = buildPickPanel();
			// Two boxes: a light one that follows the pointer and a solid one that stays on
			// the element a click locked. Hovering must never look like a commitment.
			const box = chrome('div', 'dshCc_pickBox');
			const locked = chrome('div', 'dshCc_pickBox dshCc_pickLocked');
			// Into the marked container rather than into the body: these are this plugin's own
			// chrome, they must not be counted as page content by anyone's selector, and each
			// body child added here is one more that shifts `body > div:nth-child(N)` for the
			// structural-path candidate this very picker generates.
			const root = paintRoot();
			root.appendChild(box);
			root.appendChild(locked);
			root.appendChild(parts.panel);
			const place = (node, target) => {
				const rect = node.getBoundingClientRect();
				target.style.top = rect.top + 'px';
				target.style.left = rect.left + 'px';
				target.style.width = rect.width + 'px';
				target.style.height = rect.height + 'px';
				return rect;
			};
			let candidates = [];
			let suggested = [];
			let chosen = 0;
			const off = new Set();
			let last = null;

			/**
			 * How a candidate's match count reads on the panel.
			 *
			 * An unknown count says so instead of being guessed at: the picker refuses to
			 * treat it as unique (see `probeMatches`), and someone choosing a candidate by
			 * hand deserves the same honesty about what was and was not checked.
			 * @param matches - the count, or undefined when it could not be obtained.
			 * @returns the label.
			 */
			const matchesLabel = (matches) => {
				if (matches === undefined) return t('pick.unknownHits');
				return matches === 1 ? t('pick.onlyOne') : t('pick.hits', { count: matches });
			};

			const candidateRow = (candidate, index) => {
				const row = chrome('button', 'dshCc_candidate');
				row.type = 'button';
				row.setAttribute('aria-pressed', index === chosen);
				row.appendChild(chrome('code', 'dshCc_candidateSel', candidate.selector));
				row.appendChild(chrome('span', 'dshCc_candidateKind', candidate.kind));
				row.appendChild(chrome('span', 'dshCc_candidateMatches', matchesLabel(candidate.matches)));
				row.addEventListener('click', () => {
					chosen = index;
					paint();
				});
				return row;
			};

			const tokenChip = (entry) => {
				const chip = chrome('button', 'dshCc_tokenChip', entry.property + ': var(' + entry.token + ')');
				chip.type = 'button';
				chip.title = t('pick.chipTitle', { property: entry.property, value: entry.value });
				chip.setAttribute('aria-pressed', !off.has(entry.token));
				chip.addEventListener('click', () => {
					if (off.has(entry.token)) off.delete(entry.token);
					else off.add(entry.token);
					paint();
				});
				return chip;
			};

			const paint = () => {
				while (parts.list.children.length > 0) parts.list.removeChild(parts.list.children[0]);
				candidates.forEach((candidate, index) => parts.list.appendChild(candidateRow(candidate, index)));
				while (parts.tokens.children.length > 0) parts.tokens.removeChild(parts.tokens.children[0]);
				for (const entry of suggested) parts.tokens.appendChild(tokenChip(entry));
			};

			/** Inspect one element: readout, candidates and token chips. */
			const inspect = (node) => {
				if (node === last) return;
				last = node;
				// 排除名单（默认根级元素）：不给候选、不写规则，并说明为什么 —— 静默不响应
				// 会让人以为拾取器坏了。
				const exclude = parseExclude(settingsStore.snapshot().exclude === undefined
					? DEFAULT_EXCLUDE
					: settingsStore.snapshot().exclude);
				if (isExcludedNode(node, exclude)) {
					parts.readout.textContent = t('pick.excluded', { list: exclude.join(', ') });
					candidates = [];
					suggested = [];
					paint();
					return;
				}
				const rect = node.getBoundingClientRect();
				parts.readout.textContent = describeNode(node) + ' · ' + Math.round(rect.width) + '×' + Math.round(rect.height);
				// The count excludes the picker's own chrome, and that is not tidiness — it is what
				// decides which candidate wins. A structural path is only offered when it is
				// unique, so counting an overlay this plugin put on the page would demote the
				// selector it just generated.
				candidates = selectorCandidates(node, selector => queryOwned(document, selector).length);
				suggested = tokenSuggestions(window.getComputedStyle(node), collectTokens(document.styleSheets, node));
				chosen = 0;
				paint();
			};

			/** Commit the chosen candidate. */
			const commit = () => {
				const candidate = candidates[chosen];
				if (candidate === undefined) return;
				const declarations = suggested
					.filter(entry => !off.has(entry.token))
					.map(entry => entry.property + ': var(' + entry.token + ');');
				stopPicking();
				// Two callers: the row (which inserts the rule into the sheet) and the page API
				// (`dshCss.pick()`, which just hands the answer back). The sink decides which.
				if (typeof options.onResult === 'function') {
					options.onResult({ selector: candidate.selector, declarations });
					return;
				}
				insertPickedRule(candidate.selector, declarations);
			};

			const session = startPickSession({
				listen: (type, handler, capture) => {
					document.addEventListener(type, handler, capture === true);
				},
				unlisten: (type, handler, capture) => {
					document.removeEventListener(type, handler, capture === true);
				},
				elementAt: (x, y) => document.elementFromPoint(x, y),
				relative: (node, direction) => relativeNode(node, direction),
				isChrome: (target) => target === parts.panel
					|| (typeof target?.closest === 'function' && target.closest('.dshCc_pickPanel') !== null),
				// Hovering only previews: the highlight follows the pointer and nothing else
				// changes, so a moving mouse can never lose an established selection.
				showBox: (node) => {
					const rect = place(node, box);
					box.dataset.label = Math.round(rect.width) + '×' + Math.round(rect.height);
				},
				// A click locks the element and inspects it; the session stays open, and the
				// page's own click is left alone (see onSelect in the session). The reported
				// depth keeps the slider honest — resetting it here is what made a drag snap
				// back to zero the moment it moved.
				onSelect: (node, levels, silent) => {
					place(node, locked);
					parts.slider.value = String(levels);
					if (silent === true) return;
					inspect(node);
				},
				hideBox: () => {
					box.style.width = '0';
					box.style.height = '0';
				},
				onPick: () => {
					commit();
				},
				onCancel: () => {
					// The API's promise resolves `null` (nothing picked) rather than rejecting: a
					// cancelled pick is a normal answer, and a rejection in the console reads like a bug.
					if (typeof options.onCancel === 'function') options.onCancel();
					stopPicking();
				},
			});
			parts.up.addEventListener('click', () => session.step('parent'));
			parts.down.addEventListener('click', () => session.step('child'));
			parts.insert.addEventListener('click', () => session.confirm());
			parts.cancel.addEventListener('click', () => stopPicking());
			parts.slider.addEventListener('input', () => session.setDepth(Number(parts.slider.value)));
			pickSession = {
				stop: () => {
					session.stop();
					box.remove();
					locked.remove();
					parts.panel.remove();
				},
			};
			store.set({ picking: true });
		}

		/** Disarm the picker and take its chrome down. */
		function stopPicking() {
			if (pickSession === null) return;
			const running = pickSession;
			pickSession = null;
			running.stop();
			store.set({ picking: false });
		}

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
				return items.length === 0 ? null : { items, word, kind: t('comp.property') };
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
			return items.length === 0 ? null : { items, word, kind: t('comp.value') };
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
		 *
		 * Attribute values are free text, so they can carry a line break — and a raw newline
		 * ends a CSS string: the selector stops being a selector, every probe on it throws,
		 * and the rule styles nothing. Control characters have no literal form inside a
		 * string, so they go out as hex escapes (`\a ` for a newline; the space terminates
		 * the escape and is not part of the value). Escaped in one pass, so the backslashes
		 * this adds are never escaped twice.
		 * @param value - the raw value.
		 * @returns the quoted, escaped literal.
		 */
		function cssString(value) {
			return '"' + String(value).replace(/["\\\u0000-\u001f\u007f]/g, (character) => {
				if (character === '"') return '\\"';
				if (character === '\\') return '\\\\';
				return '\\' + character.codePointAt(0).toString(16) + ' ';
			}) + '"';
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
		 * How many elements a selector matches, or `undefined` when that cannot be known —
		 * the engine refused the selector, or there is no DOM to ask at all.
		 *
		 * Unknown is deliberately NOT one. Scoring a failed probe as "one match" gave the
		 * least trustworthy candidate the bonus uniqueness earns, which is how a selector
		 * with a raw newline in it won the default and got written into the sheet. Unknown
		 * is also not zero: zero would claim the selector matches nothing, which is a
		 * different statement from "could not be checked".
		 * @param probe - `selector → count`, absent when there is nothing to ask.
		 * @param selector - the selector to test.
		 * @returns the match count, or `undefined` when unknown.
		 */
		function probeMatches(probe, selector) {
			if (probe === undefined) return undefined;
			try {
				const count = probe(selector);
				return typeof count === 'number' && Number.isFinite(count) ? count : undefined;
			}
			catch {
				return undefined;
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
			// kind, not enough to lose to the structural fallback at rank 5. An unknown
			// match count takes the same penalty — "could not be checked" is not a
			// reason to be preferred, and `probeMatches` explains why it is not one.
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
					t('pick.kind.attr'), t('pick.kind.attrHint'), 0);
			}

			// 2. The accessibility layer: stable, readable, but a label can repeat.
			const label = attrOf(node, 'aria-label');
			if (typeof label === 'string' && label !== '') {
				add(tag + '[aria-label=' + cssString(label) + ']',
					t('pick.kind.aria'), t('pick.kind.ariaHint'), 1);
			}

			// 3. Hand-written classes — how plugins like the music player name things.
			const semantic = classes.find(name => SEMANTIC_CLASS.test(name) && !MODULE_CLASS.test(name));
			if (semantic !== undefined) {
				add(tag + '.' + semantic, t('pick.kind.semantic'), t('pick.kind.semanticHint'), 2);
			}

			// 4. A generated class, matched without its rotating hash.
			const generated = classes.find(name => MODULE_CLASS.test(name));
			if (generated !== undefined) {
				add(tag + '[class*=' + cssString(MODULE_CLASS.exec(generated)[1] + '_') + ']',
					t('pick.kind.hash'), t('pick.kind.hashHint'), 3);
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
			add(anchor + path, t('pick.kind.path'), t('pick.kind.pathHint'), 5);

			candidates.sort((left, right) => left.rank - right.rank);
			return candidates.slice(0, 3);
		}

		/**
		 * One element-pick session.
		 *
		 * Everything outside the plugin's own tree goes through \`host\`, so the state
		 * machine — hover reports an element, click resolves it, Escape cancels, and
		 * stopping detaches exactly what was attached — is testable without a DOM.
		 * \`host.clickToPick === false\` leaves clicks alone: the page keeps working and the
		 * session commits on Enter or on a button of its own. That is what lets the picker
		 * be used on any page without taking the interface hostage.
		 * @param host - listener registry, \`elementAt(x, y)\`, box drawing and callbacks.
		 * @returns \`{ stop }\` plus the level/confirm commands its chrome drives.
		 */
		function startPickSession(host) {
			let stopped = false;
			// `selected` is what a click locked; `hovered` is only a preview. The keys and
			// the slider move from the locked element, so what the pointer happens to be
			// over cannot silently change what is being edited.
			let selected = null;
			let hovered = null;
			/** Levels above the clicked anchor, so the slider can mirror the keys. */
			let depth = 0;
			const stop = () => {
				if (stopped) return;
				stopped = true;
				host.unlisten('pointermove', onMove, false);
				host.unlisten('click', onClick, true);
				host.unlisten('keydown', onKey, true);
				host.unlisten('scroll', reposition, true);
				host.unlisten('resize', reposition, false);
				host.hideBox();
			};
			const preview = (node) => {
				if (node === undefined || node === null) return;
				hovered = node;
				host.showBox(node);
			};
			// The level walk is anchored on the element a click chose, and remembers the
			// route taken up it: "下一级" has to come back DOWN that route. Walking into the
			// current node's first child instead lands in a different branch, and the deeper
			// the user went the further off it was.
			let anchor = null;
			/** anchor → … → selected, so descending can retrace the ascent. */
			let path = [];
			const lock = (node, options = {}) => {
				if (node === undefined || node === null) return;
				selected = node;
				hovered = node;
				if (options.anchor === true) {
					anchor = node;
					path = [node];
					depth = 0;
				}
				else if (options.ascend === true) {
					path = [...path, node];
					depth = path.length - 1;
				}
				else if (options.descend === true) {
					path = path.slice(0, -1);
					depth = Math.max(0, path.length - 1);
				}
				host.showBox(node);
				if (host.onSelect !== undefined) host.onSelect(node, depth, options.silent === true);
			};
			const setDepth = (levels) => {
				if (stopped || anchor === null) return;
				const climbed = [anchor];
				let node = anchor;
				while (climbed.length - 1 < levels) {
					const parent = host.relative(node, 'parent');
					if (parent === null) break;
					node = parent;
					climbed.push(parent);
				}
				path = climbed;
				depth = climbed.length - 1;
				lock(node, { silent: false });
			};
			const step = (direction) => {
				if (stopped || selected === null) return;
				if (direction === 'parent') {
					const parent = host.relative(selected, 'parent');
					if (parent !== null) lock(parent, { ascend: true });
					return;
				}
				if (direction === 'child') {
					// Retrace: the node one step back down the route that was climbed.
					if (path.length > 1) lock(path[path.length - 2], { descend: true });
					return;
				}
				// A sibling is a different branch, so it becomes the new anchor.
				const sibling = host.relative(selected, direction);
				if (sibling !== null) lock(sibling, { anchor: true });
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
				preview(host.elementAt(event.clientX, event.clientY));
			};
			const onClick = (event) => {
				// Our own chrome keeps its clicks, and everything else keeps them too: the
				// click is deliberately NOT cancelled, which is what lets the user close the
				// settings surface — or use any other page — without leaving the picker.
				if (isChrome(event.target)) return;
				const node = host.elementAt(event.clientX, event.clientY) ?? event.target;
				lock(node, { anchor: true });
			};
			const reposition = () => {
				if (stopped) return;
				if (hovered !== null) host.showBox(hovered);
				if (selected !== null && host.onSelect !== undefined) host.onSelect(selected, depth, true);
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
			// Not in the capture phase: the page's own handlers run first, so a click that
			// does something (closing the settings surface) still does it.
			host.listen('click', onClick, false);
			host.listen('keydown', onKey, true);
			// Capture phase: a scroll inside any container moves the element too.
			host.listen('scroll', reposition, true);
			host.listen('resize', reposition, false);
			return { stop, step, confirm, setDepth };
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
				// A hand-written class describes the element; a generated one describes the
				// build. The readout prefers the former, exactly like the candidates do.
				const usable = name => !name.startsWith('dshCc') && !name.startsWith('_dshCc');
				const semantic = classes.find(name => SEMANTIC_CLASS.test(name) && !MODULE_CLASS.test(name) && usable(name))
					?? classes.find(name => MODULE_CLASS.test(name) && usable(name));
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
		function collectTokens(sheets, element) {
			const found = new Map();
			/**
			 * Whether a rule can define a custom property for this element at all.
			 *
			 * A token only counts where its defining rule matches the element or one of its
			 * ancestors: that is the only way the value is in scope where the rule this plugin
			 * is about to write will apply. A rule with no readable selector (a test double) is
			 * taken at face value, and a selector the engine refuses (`:after` and friends, which
			 * do carry definitions) is skipped rather than reported as matching.
			 */
			const defines = (rule) => {
				if (element === undefined || element === null) return true;
				const selector = rule?.selectorText;
				if (typeof selector !== 'string' || selector === '') return true;
				for (let node = element; node !== null && node !== undefined; node = node.parentElement ?? null) {
					if (typeof node.matches !== 'function') return true;
					try {
						if (node.matches(selector)) return true;
					}
					catch {
						return false;
					}
				}
				return false;
			};
			const add = (name, value) => {
				if (!name.startsWith('--') || value === undefined || String(value).trim() === '') return;
				const key = String(value).trim();
				if (!found.has(key)) found.set(key, []);
				const names = found.get(key);
				if (!names.includes(name)) names.push(name);
			};
			const walk = (rules) => {
				for (const rule of rules ?? []) {
					if (rule?.style && defines(rule)) {
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
				// The map is keyed by VALUE, so tokens of unrelated kinds sit under one key —
				// `--dsl-terminal-line-height: 22px` is right next to anything else that is 22px.
				// Only a name that reads like this property is offered: suggesting nothing is
				// better than suggesting a token that will not resolve (`border-radius:
				// var(--dsl-terminal-line-height)` is what the old fallback produced).
				const match = names.find(name => preference.test(name));
				if (match === undefined) continue;
				found.push({ property, value: resolved, token: match });
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
		 *
		 * The search hits are wrapped in the same pass rather than by a second one over the
		 * markup: a find bar's offsets are offsets into the TEXT, and once this function has
		 * escaped a `<` into `&lt;` the two no longer line up. Each run therefore reports
		 * both offsets, and `markMatches` maps between them.
		 * @param css - the sheet text.
		 * @param rules - the parsed rules, so a selector run can carry its rule index.
		 * @param hits - `{ start, end }` per search hit, in document order.
		 * @param active - index of the hit to single out, or -1.
		 * @returns escaped HTML with one span per token, and a mark around each hit.
		 */
		function highlightCss(css, rules, hits = [], active = -1) {
			const parts = [];
			/** One entry per emitted run: where it sat in the text, and where its TEXT landed. */
			const runs = [];
			let htmlAt = 0;
			let buffer = '';
			let state = 'sel';
			const kindOf = () => (state === 'sel' ? 'Sel' : (state === 'val' ? 'Val' : 'Prop'));
			/**
			 * Emit one already-rendered piece.
			 *
			 * The position recorded is where the run's TEXT landed, not where its markup
			 * begins: `markMatches` slices this string at those positions, and a slice starting
			 * at the `<` of an opening tag cuts the tag in half. The tag length is passed
			 * separately because the markup around the text is not part of the text.
			 */
			const emit = (markup, at, length, tagLength) => {
				runs.push({ at, htmlAt: htmlAt + tagLength, length });
				parts.push(markup);
				htmlAt += markup.length;
			};
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
					const open = '<span class="dshCc_tok' + kindOf() + '">';
					emit(open + escapeHtml(buffer) + '</span>', runStart, buffer.length, open.length);
				}
				else {
					const open = '<span class="dshCc_tokSel dshCc_clickable" data-rule="' + ruleIndex + '">';
					emit(open + escapeHtml(buffer) + '</span>', runStart, buffer.length, open.length);
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
					const open = '<span class="dshCc_tokComment">';
					emit(open + escapeHtml(css.slice(index, stop)) + '</span>', index, stop - index, open.length);
					index = stop - 1;
					continue;
				}
				if (ch === '{' || ch === '}' || ch === ':' || ch === ';') {
					flush(index);
					const open = '<span class="dshCc_tokPunc">';
					emit(open + ch + '</span>', index, 1, open.length);
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
			return markMatches(parts.join('') + '\n', runs, hits, active, css);
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
						: t('validate.syntax');
				}
				if (name === 'inherits') {
					return value === 'true' || value === 'false' ? null : t('validate.inherits');
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
					issues.push({ line: startLine, message: t('validate.unparsable', { text: text.slice(0, 24) }) });
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
					issues.push({ line: startLine, message: t('validate.badValue', { property: match[1], value: value.slice(0, 24) }) });
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
						issues.push({ line, message: t('validate.commentOpen') });
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
						issues.push({ line, message: t('validate.strayBrace') });
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
			if (depth > 0) issues.push({ line, message: t('validate.missingBrace', { count: depth }) });
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
		 * Where the hit for a search query starts, one entry per occurrence.
		 *
		 * Plain text, not a pattern: this is the editor's find bar, and a stylesheet author
		 * searching for `border-radius` means those eleven characters.
		 *
		 * Case folding is the engine's, and a fold can change length — `İ`.toLowerCase() is two
		 * code units — so a hit found in the folded text is an offset into THAT string. The
		 * hits are converted back through a map of folded offsets to offsets in the sheet, or
		 * every hit after such a character would sit one position to the right of what it
		 * marked. The fast path (no length change, which is all of ASCII) skips the map.
		 * @param text - the sheet text.
		 * @param query - what was typed into the find field.
		 * @param matchCase - true to keep the comparison case-sensitive.
		 * @returns `{ start, end }` per occurrence, in document order.
		 */
		function searchHits(text, query, matchCase = false) {
			const hits = [];
			if (typeof query !== 'string' || query === '') return hits;
			const foldedQuery = query.toLowerCase();
			const fold = !matchCase;
			const haystack = fold ? text.toLowerCase() : text;
			const needle = fold ? foldedQuery : query;
			// One entry per code unit of the folded text: the offset in the sheet it came from.
			const back = haystack.length === text.length ? null : (() => {
				const map = [];
				for (let index = 0; index < text.length; index += 1) {
					const width = text[index].toLowerCase().length;
					for (let step = 0; step < width; step += 1) map.push(index);
				}
				return map;
			})();
			const toSheet = (offset) => (back === null ? offset : (back[offset] ?? text.length));
			let at = haystack.indexOf(needle);
			while (at >= 0) {
				const start = toSheet(at);
				hits.push({ start, end: Math.min(text.length, start + query.length) });
				// Advance by one, not by the match: an overlapping query (`aa` in `aaa`) is
				// two hits, and skipping by `query.length` would miss the second one.
				at = haystack.indexOf(needle, at + 1);
			}
			return hits;
		}

		/**
		 * The index of the hit to land on when the caret is at `from`.
		 *
		 * The first hit at or after the caret, wrapping to the top of the sheet — the
		 * behaviour every editor's find bar has, and the one that makes Ctrl+F then Enter
		 * mean "the next one" rather than "the first one every time".
		 * @param hits - the hits, in document order.
		 * @param from - caret offset.
		 * @returns an index into `hits`, or -1 when there are none.
		 */
		function hitAtOrAfter(hits, from) {
			if (hits.length === 0) return -1;
			const at = hits.findIndex(hit => hit.start >= from);
			return at < 0 ? 0 : at;
		}

		/**
		 * Wrap every search hit inside a run of already-rendered, already-escaped HTML.
		 *
		 * The colour layer is built as one string of spans, so marking a hit has to happen
		 * inside that string — and the offsets it is given are offsets into the TEXT, not
		 * into the markup it produced. The caller therefore hands over one entry per run
		 * with both: where the run sat in the text, and where it landed in the HTML.
		 *
		 * A `<mark>` rather than a background on the token span: a hit may span several
		 * tokens (searching `color: red` crosses three), and the mark has to cover all of
		 * them in one box.
		 * @param html - the rendered layer.
		 * @param marks - `{ at, htmlAt, length }` per run, in document order.
		 * @param hits - the hits, in document order.
		 * @param active - index of the hit to single out, or -1.
		 * @param source - the sheet text, so a run's markup can be checked against it.
		 * @returns the layer with a mark around each hit.
		 */
		function markMatches(html, marks, hits, active, source = '') {
			if (hits.length === 0) return html;
			/**
			 * Where a hit's text sits in the markup, or null when it cannot be marked exactly.
			 *
			 * A hit qualifies only when all of it lies inside one run AND that run's rendered
			 * text is exactly its own text. The second test is what catches escaping: `&`
			 * becomes five characters, so the markup no longer lines up with the offsets. The
			 * first catches a hit that touches the gap between two runs — the newline between
			 * two lines belongs to no span. Such a hit is left unmarked rather than marked a
			 * few characters off; the bar still counts and steps through every hit.
			 */
			const place = (hit) => {
				const run = marks.find(entry => hit.start >= entry.at && hit.end <= entry.at + entry.length);
				if (run === undefined) return null;
				if (html.slice(run.htmlAt, run.htmlAt + run.length) !== source.slice(run.at, run.at + run.length)) return null;
				return { head: run.htmlAt + (hit.start - run.at), tail: run.htmlAt + (hit.end - run.at) };
			};
			const ordered = hits
				.map((hit, index) => ({ hit, index }))
				.sort((left, right) => left.hit.start - right.hit.start);
			let out = '';
			let cursor = 0;
			for (const entry of ordered) {
				const box = place(entry.hit);
				// Overlapping hits cannot share a character: the second one is unreachable
				// inside the first one's mark.
				if (box === null || box.head < cursor) continue;
				const classes = entry.index === active ? 'dshCc_hit dshCc_hitActive' : 'dshCc_hit';
				out += html.slice(cursor, box.head) + '<mark class="' + classes + '">' + html.slice(box.head, box.tail) + '</mark>';
				cursor = box.tail;
			}
			return out + html.slice(cursor);
		}

		/**
		 * Re-flow a sheet so each closing brace opens a new line and each nesting level is
		 * indented two spaces.
		 *
		 * Blank lines are dropped and every line is trimmed, which is the part that actually
		 * helps a sheet that grew by machine: the declarations are fine, their arrangement is
		 * not. Braces inside strings and comments are not counted — `content: "}"` is one
		 * character of a string, not the end of a rule — and an unbalanced sheet is left
		 * exactly as it is, because the validator is the thing that should report that, and
		 * re-flowing broken text moves the broken part somewhere new.
		 * @param css - the sheet text.
		 * @returns the re-flowed sheet, or the original text when there is nothing to do.
		 */
		function formatCss(css) {
			let depth = 0;
			for (let index = 0; index < css.length; index += 1) {
				const ch = css[index];
				if (ch === '"' || ch === "'") {
					index = skipString(css, index) - 1;
					continue;
				}
				if (ch === '/' && css[index + 1] === '*') {
					index = scanComment(css, index).stop - 1;
					continue;
				}
				if (ch === '{') depth += 1;
				else if (ch === '}') depth -= 1;
				if (depth < 0) return css;
			}
			if (depth !== 0) return css;

			const lines = [];
			let current = '';
			/** Emit the line gathered so far, indented for the level it is about to sit at. */
			const push = (atDepth) => {
				const text = current.trim();
				current = '';
				if (text !== '') lines.push(' '.repeat(tabWidth()).repeat(Math.max(0, atDepth)) + text);
			};
			let level = 0;
			for (let index = 0; index < css.length; index += 1) {
				const ch = css[index];
				if (ch === '"' || ch === "'") {
					const stop = skipString(css, index);
					current += css.slice(index, stop);
					index = stop - 1;
					continue;
				}
				if (ch === '/' && css[index + 1] === '*') {
					const stop = scanComment(css, index).stop;
					current += css.slice(index, stop);
					index = stop - 1;
					continue;
				}
				if (ch === '{') {
					// The selector stays on this line; the body starts on the next one.
					current += ch;
					level += 1;
					push(level - 1);
					continue;
				}
				if (ch === '}') {
					// Whatever was being gathered is a body line; then the brace closes at the
					// level the body sat at, not at the level it is leaving.
					push(level);
					level = Math.max(0, level - 1);
					current = '}';
					continue;
				}
				if (ch === '\n') {
					push(level);
					continue;
				}
				current += ch;
			}
			push(level);
			return lines.length === 0 ? css : lines.join('\n') + '\n';
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
		/**
		 * 效果预设：把一组声明写进**当前规则**。
		 *
		 * 参数一律引用令牌（\`--dsh-material-*\`），不写死数字：调一次材质，所有用了它的规则一起变。
		 * 也不写 \`border\` / \`background\` 简写 —— 简写会把 \`border-radius\`、\`background-image\`
		 * 一起重置（examples/acrylic.css 的文件头原则 3，是踩出来的）。
		 */
		const PRESETS = [
			{
				id: 'acrylic',
				label: '亚克力',
				hint: '透但清楚',
				declarations: [
					['background-color', 'var(--dsh-material-acrylic-bg)'],
					['backdrop-filter', 'blur(var(--dsh-material-acrylic-blur)) saturate(var(--dsh-material-acrylic-saturate))'],
					['border-width', '0.5px'],
					['border-style', 'solid'],
					['border-color', 'var(--dsh-material-acrylic-border)'],
					['box-shadow', 'inset 0 1px 0 color-mix(in srgb, #ffffff 60%, transparent), var(--dsw-elevation-prominent)'],
				],
			},
			{
				id: 'frost',
				label: '毛玻璃',
				hint: '糊得明显',
				declarations: [
					['background-color', 'var(--dsh-material-frost-bg)'],
					['backdrop-filter', 'blur(var(--dsh-material-frost-blur)) saturate(var(--dsh-material-frost-saturate))'],
					['border-width', '0.5px'],
					['border-style', 'solid'],
					['border-color', 'var(--dsw-alias-border-l1)'],
				],
			},
			{
				id: 'mica',
				label: '云母',
				hint: '几乎不糊，只换质感',
				declarations: [
					['background-color', 'var(--dsh-material-mica-bg)'],
					['backdrop-filter', 'blur(var(--dsh-material-mica-blur)) saturate(var(--dsh-material-mica-saturate))'],
					['background-image', "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='var(--dsh-material-mica-grain)'/%3E%3C/svg%3E\")"],
					['border-width', '0.5px'],
					['border-style', 'solid'],
					['border-color', 'var(--dsw-alias-border-l1)'],
					['box-shadow', 'inset 0 1px 0 color-mix(in srgb, #ffffff 34%, transparent)'],
				],
			},
			{
				id: 'hairline',
				label: '细描边卡片',
				hint: '最小的一种',
				declarations: [
					['border-width', '0.5px'],
					['border-style', 'solid'],
					['border-color', 'var(--dsw-alias-border-l2)'],
					['box-shadow', 'var(--dsw-elevation-soft)'],
				],
			},
		];

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
		 * Crosshair for the rule-highlight toggle, drawn at the same 14px box and 1.4 stroke
		 * as the other glyphs here so it sits level with the chevron that opens the menu.
		 *
		 * A crosshair rather than an eye: an eye means "show or hide this thing", while what
		 * this control does is point at the elements a selector lands on — which is what a
		 * crosshair says, and what the element picker next to it already means.
		 * @returns the 14px crosshair.
		 */
		function CrosshairIcon() {
			return React.createElement(
				'svg',
				{ width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', className: 'dshCc_crosshair' },
				React.createElement('circle', {
					cx: 7,
					cy: 7,
					r: 3,
					stroke: 'currentColor',
					strokeWidth: 1.4,
				}),
				React.createElement('path', {
					d: 'M7 0.8V4M7 10V13.2M0.8 7H4M10 7H13.2',
					stroke: 'currentColor',
					strokeWidth: 1.4,
					strokeLinecap: 'round',
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
		 * A property field that says when its value is not valid CSS.
		 *
		 * The verdict is taken on **blur**, not while typing, and that is the whole point rather
		 * than a nicety: half-typed values are invalid by definition. Measured on the way in —
		 * `re`, `rgb(`, `calc(` and `8` are all rejected by `CSS.supports`, so a live check would
		 * turn the field red on almost every keystroke and stay red until the value happened to
		 * become legal. Blur is also what the platform does: `:user-invalid` exists precisely
		 * because validating an unfinished field is noise.
		 *
		 * The red is the existing `[aria-invalid="true"]` rule on `.dshCc_propText` — that rule
		 * was written when this panel was built and, until now, nothing ever set the attribute.
		 *
		 * @param props - `property` (kebab-case name), plus the props of the input itself:
		 *   `value`, `onChange`, `placeholder`, `aria-label`, `title`.
		 * @returns the input element.
		 */
		function PropValueInput(props) {
			// The text while it is being edited; null means "show what the sheet holds". Same
			// arrangement `selectorDraft` uses in the panel, and for the same reason: the sheet
			// is not the right place for a half-typed value, but the field has to show it.
			const [draft, setDraft] = React.useState(null);
			// `null` = not judged yet, so a value the user has not finished with is neither
			// marked nor unmarked.
			const [verdict, setVerdict] = React.useState(null);
			const shown = draft === null ? props.value : draft;
			const invalid = verdict === true;
			return React.createElement('input', {
				className: 'dshCc_propText',
				'aria-label': props['aria-label'],
				title: invalid
					? t('prop.badValue', { value: String(props.value).trim(), property: props.property })
					: props.title,
				// Only ever `true`, never `false`: an absent attribute is the resting state, and
				// writing `aria-invalid="false"` would put a value there for assistive technology
				// to read as a claim.
				...(invalid ? { 'aria-invalid': 'true' } : {}),
				placeholder: props.placeholder,
				spellCheck: false,
				value: shown,
				onChange: (event) => {
					setDraft(event.target.value);
					// Anything typed is un-judged again — including typing over a value that was
					// just marked wrong.
					setVerdict(null);
					props.onChange(event);
				},
				onBlur: () => {
					setVerdict(valueInvalid(props.property, shown) ? true : false);
					setDraft(null);
				},
			});
		}

		/**
		 * A snapshot stamp as local time.
		 *
		 * The Host names a snapshot with a millisecond timestamp, which is the one piece
		 * of information in the list that is not already in the entry: two versions of the
		 * same sheet are told apart by when they were taken, and the stamp is what the
		 * restore request needs, so it is shown rather than merely parsed.
		 * @param stamp - the timestamp string as the Host reports it.
		 * @returns `MM-DD HH:mm:ss`, or the stamp itself when it is not a moment in time.
		 */
		function formatStamp(stamp) {
			const at = new Date(Number(stamp));
			if (Number.isNaN(at.getTime())) return String(stamp);
			const pad = (value) => String(value).padStart(2, '0');
			return pad(at.getMonth() + 1) + '-' + pad(at.getDate())
				+ ' ' + pad(at.getHours()) + ':' + pad(at.getMinutes()) + ':' + pad(at.getSeconds());
		}

		/**
		 * The size of one snapshot, in the unit a stylesheet is actually measured in.
		 * @param bytes - the byte count.
		 * @returns a short human size.
		 */
		function formatSize(bytes) {
			const size = Number(bytes);
			if (!Number.isFinite(size) || size < 0) return '';
			return size < 1024 ? size + ' B' : (Math.round(size / 102.4) / 10) + ' KB';
		}

		/** Longest a dropdown menu may get, and the gap it keeps from the window edges. */
		const MENU_MAX_HEIGHT = 260;
		const MENU_EDGE_GAP = 8;
		/** Narrowest a menu may be squeezed to on a small window. */
		const MENU_MIN_WIDTH = 160;
		/** Shortest a menu may be squeezed to before it stops shrinking and scrolls. */
		const MENU_MIN_HEIGHT = 96;

		/**
		 * How tall a dropdown may be once the viewport is taken into account.
		 *
		 * The cap used to be the flat `MENU_MAX_HEIGHT` and nothing else, which is only
		 * correct while the window is tall. Measured on the real row: the visible
		 * viewport is about 800px, and the settings dialog is what scrolls — so a menu
		 * opened low in that dialog had far less than 260px below it and its last rows
		 * sat under the window edge with no way to reach them. `MENU_MAX_HEIGHT` stays
		 * as the preferred height; this is the ceiling the available space imposes.
		 *
		 * The space below is used when there is room for at least
		 * `MENU_MIN_HEIGHT`; otherwise the menu flips above the trigger and takes what
		 * is there. When neither side can hold it, the larger side wins and the menu
		 * scrolls inside it — a short scrollable list beats a list that is cut off.
		 * @param box - the trigger's viewport rect, or undefined while it has no layout.
		 * @param viewport - `{ width, height }` of the window.
		 * @returns the max height in px, at least `MENU_MIN_HEIGHT`.
		 */
		function menuMaxHeight(box, viewport) {
			if (box === undefined || box === null || !(viewport.height > 0)) return MENU_MAX_HEIGHT;
			const below = viewport.height - box.bottom - MENU_EDGE_GAP * 2;
			const above = box.top - MENU_EDGE_GAP * 2;
			const usable = Math.max(below, above, MENU_MIN_HEIGHT);
			return Math.max(MENU_MIN_HEIGHT, Math.min(MENU_MAX_HEIGHT, Math.floor(usable)));
		}

		/**
		 * Whether a menu opened from this box has to flip above the trigger.
		 *
		 * Kept in one place because two decisions read it: the positioning in
		 * `placeMenu` and the height ceiling in `menuMaxHeight`. When they disagree the
		 * menu is placed on one side and sized for the other, which is how a menu ends
		 * up half outside the window while looking correctly anchored.
		 * @param box - the trigger's viewport rect.
		 * @param viewport - `{ width, height }` of the window.
		 * @param needed - the height the menu would like to have.
		 * @returns true when there is not enough room below but more above.
		 */
		function menuFlipsUp(box, viewport, needed) {
			if (!(viewport.height > 0)) return false;
			const below = viewport.height - box.bottom - MENU_EDGE_GAP;
			const above = box.top - MENU_EDGE_GAP;
			return below < needed && above > below;
		}

		/**
		 * Where a dropdown's menu goes, and how wide it may be.
		 *
		 * Two failures this exists to prevent, both of them from a menu anchored near the right
		 * end of a row (the file bar's outline is exactly that): a menu laid out as
		 * `left: trigger.left` runs off the right edge of the window, and a menu whose width is
		 * only a `min-width` grows with its content — which for a `white-space:nowrap` entry
		 * like a long selector means it grows past the screen, taking the ellipsis with it.
		 * @param rect - the trigger's box, or undefined while it has no layout.
		 * @param viewport - `{ width, height }` of the window.
		 * @param wantedWidth - the width the caller wants, or undefined for content-driven.
		 * @returns the menu's inline style, or undefined without a rect.
		 */
		function placeMenu(rect, viewport, wantedWidth) {
			if (rect === undefined || rect === null) return undefined;
			const available = Math.max(MENU_MIN_WIDTH, Math.round(viewport.width) - MENU_EDGE_GAP * 2);
			const width = wantedWidth === undefined
				? undefined
				: Math.max(MENU_MIN_WIDTH, Math.min(wantedWidth, available));
			// The flip is decided on the width that will actually be used; for a content-driven
			// menu the trigger's own width is the best estimate available up front.
			const footprint = width ?? Math.max(MENU_MIN_WIDTH, Math.round(rect.width));
			const anchorRight = viewport.width > 0 && rect.left + footprint > viewport.width - MENU_EDGE_GAP;
			const maxHeight = menuMaxHeight(rect, viewport);
			const flipUp = menuFlipsUp(rect, viewport, maxHeight);
			return {
				position: 'fixed',
				...(anchorRight
					? { right: Math.max(MENU_EDGE_GAP, Math.round(viewport.width - rect.right)) + 'px' }
					: { left: Math.round(rect.left) + 'px' }),
				...(width === undefined
					? { minWidth: Math.round(rect.width) + 'px', maxWidth: available + 'px' }
					: { width: width + 'px' }),
				maxHeight: maxHeight + 'px',
				...(flipUp
					? { bottom: Math.round(viewport.height - rect.top + 4) + 'px' }
					: { top: Math.round(rect.bottom + 4) + 'px' }),
			};
		}

		/**
		 * A dropdown for the rule panel.
		 *
		 * The native `<select>` popup cannot be styled — it renders square with the OS
		 * palette — so the panel uses the same own-element menu as the sheet picker
		 * (rounded, layered, DSH tokens). The menu is positioned `fixed` from the
		 * trigger's rect: the panel's own scrolling and the container's `overflow:
		 * hidden` cannot clip it, and it flips above the trigger when the viewport has
		 * no room below.
		 * @param props - items, current label, aria label, wrapper class, menu width and pick callback.
		 * @returns the trigger plus, while open, the menu.
		 */
		function Dropdown(props) {
			const [open, setOpen] = React.useState(false);
			// Which row the keyboard is on. `null` means "the list itself has focus" —
			// which is where focus lands when the menu opens, so Tab walks into the
			// first row from a known place instead of appearing at an arbitrary one.
			const [activeIndex, setActiveIndex] = React.useState(null);
			const triggerRef = React.useRef(null);
			const menuRef = React.useRef(null);
			// Why a tick rather than reading the rect during render: the anchored menu is
			// `position: fixed` from the trigger's viewport rect, and that rect stops being
			// true the moment anything scrolls or the window resizes. The counter is what
			// makes those events re-run the measurement — see the effect below.
			const [anchorTick, setAnchorTick] = React.useState(0);
			const anchorBoxRef = React.useRef(undefined);
			// Set only by the outside-pointer path, so the focus-restoring effect can tell
			// "you dismissed this with the mouse" from "this closed because you chose a row".
			const pointerDismissRef = React.useRef(false);

			/**
			 * Close the menu unconditionally and forget the keyboard position.
			 *
			 * Everything that closes the menu goes through this rather than calling
			 * `setOpen(false)` directly, because the menu's open state and the row the
			 * keyboard was on are one piece of state as far as the user is concerned: a
			 * menu that reopens on a row someone left days ago is disorienting.
			 * @param options - `{ dismiss }` marks a pointer dismissal (focus goes back to
			 * the anchor; choosing with the mouse sends focus somewhere else on purpose).
			 */
			function closeMenu(options = {}) {
				pointerDismissRef.current = options.dismiss === true;
				setOpen(false);
				setActiveIndex(null);
			}

			/**
			 * Move the keyboard to a row, and put focus somewhere that makes the arrow keys
			 * reach the handler that owns them.
			 *
			 * Focus travels between the rows rather than staying on the list with
			 * `aria-activedescendant` alone, because the rows are real `<button>`s: a
			 * keyboard user pressing Enter should hit the row they can see highlighted,
			 * not a virtual one they cannot.
			 * @param index - the row to move to.
			 */
			function focusRow(index) {
				if (props.items.length === 0) return;
				const count = props.items.length;
				const next = ((index % count) + count) % count;
				setActiveIndex(next);
				const rows = menuRef.current === null ? [] : menuRef.current.querySelectorAll('.dshUi_choiceItem');
				rows[next]?.focus();
			}

			React.useLayoutEffect(() => {
				if (!open) {
					anchorBoxRef.current = undefined;
					return undefined;
				}
				if (typeof window.addEventListener !== 'function') return undefined;
				anchorBoxRef.current = triggerRef.current?.getBoundingClientRect();
				// Three things invalidate the measurement, and all three have to be watched:
				// the window resizing, anything scrolling (the settings dialog is the thing
				// that actually scrolls here, so the listener has to be in the capture phase
				// to catch a scroller that is not the document), and the menu's own size
				// changing while it is open — a menu that grows after it was placed is
				// placed for a height it no longer has.
				const reanchor = () => setAnchorTick(tick => tick + 1);
				window.addEventListener('resize', reanchor);
				window.addEventListener('scroll', reanchor, true);
				let observer = null;
				if (typeof ResizeObserver === 'function' && menuRef.current !== null) {
					observer = new ResizeObserver(reanchor);
					observer.observe(menuRef.current);
				}
				return () => {
					window.removeEventListener('resize', reanchor);
					window.removeEventListener('scroll', reanchor, true);
					if (observer !== null) observer.disconnect();
				};
			}, [open]);

			// Tell the group headings when they are actually stuck to the top.
			//
			// The heading has been `position: sticky` with a `[data-stuck]` fill rule since the
			// batch that aligned this menu with DSH's, and nothing ever set the attribute — so
			// the fill never painted. Measured, the case is worth serving: the add-property menu
			// lists ~120 properties in a dozen groups inside a scrolling, height-capped list, so
			// a heading does sit over the rows below it while the user scrolls to the group they
			// want.
			//
			// An IntersectionObserver rather than a scroll handler, which is what DSH does: the
			// root is the list itself, so the callback fires exactly when a heading crosses the
			// list's top padding edge. `rootMargin` lifts the bottom edge far above the list so
			// that only the top contact counts — without it a heading that has just left the
			// viewport would flip the attribute on its way out.
			//
			// Guarded on the API existing: an environment without it keeps a plain sticky
			// heading, which is the correct degradation and not an error.
			React.useEffect(() => {
				const menu = menuRef.current;
				if (!open || menu === null || typeof IntersectionObserver !== 'function') return undefined;
				const headings = menu.querySelectorAll('.dshUi_choiceGroup');
				if (headings.length === 0) return undefined;
				const watcher = new IntersectionObserver((entries) => {
					for (const entry of entries) {
						if (entry.isIntersecting) entry.target.setAttribute('data-stuck', '');
						else entry.target.removeAttribute('data-stuck');
					}
				}, { root: menu, rootMargin: '0px 0px -90% 0px', threshold: 0 });
				for (const heading of headings) watcher.observe(heading);
				return () => {
					watcher.disconnect();
					for (const heading of headings) heading.removeAttribute('data-stuck');
				};
			}, [open]);

			// Focus has to move, so this is a layout effect rather than a render-time
			// decision: on open it makes the list itself focusable and lands focus there,
			// and on close it hands focus back to the trigger — the contract DSH's own Menu
			// documents ("Escape or Shift+Tab close it and return focus to the anchor's
			// first button"). A menu that closes and drops focus on the body leaves a
			// keyboard user with no idea where they are, and the next Tab restarts from the
			// top of the page.
			React.useLayoutEffect(() => {
				const menu = menuRef.current;
				if (!open) {
					// Only the pointer path restores focus. Choosing a row closes the menu
					// too, but that is a selection — the caller moves focus where it belongs
					// (the outline jumps the caret into the editor), and stealing it back
					// here would undo that.
					if (pointerDismissRef.current) {
						pointerDismissRef.current = false;
						triggerRef.current?.focus?.({ preventScroll: true });
					}
					return;
				}
				if (menu === null || typeof menu.focus !== 'function') return;
				menu.focus({ preventScroll: true });
			}, [open]);

			React.useEffect(() => {
				if (!open) return undefined;
				// The effect is inert without a DOM (contract tests drive the props instead).
				if (typeof document.addEventListener !== 'function') return undefined;
				const onPointerDown = (event) => {
					if (triggerRef.current?.contains(event.target)) return;
					if (menuRef.current?.contains(event.target)) return;
					closeMenu({ dismiss: true });
				};
				document.addEventListener('mousedown', onPointerDown);
				return () => {
					document.removeEventListener('mousedown', onPointerDown);
				};
			}, [open]);

			// 菜单进 top layer（原生 popover）：设置对话框带 transform，position:fixed 会退化成
			// 「相对它定位」，再被编辑器外壳的 overflow:hidden 裁掉 —— 实测大纲菜单 rect 完全在外壳
			// 上方，屏幕上什么都看不到，自然「点不了」。top layer 不受这两者影响。
			React.useEffect(() => {
				if (!open) return undefined;
				const element = menuRef.current;
				if (element === null || element === undefined) return undefined;
				if (typeof element.showPopover === 'function') {
					try {
						if (element.matches?.(':popover-open') !== true) element.showPopover();
					}
					catch { /* 已经是 open，或这个元素不在文档里：都不影响菜单本身 */ }
				}
				return () => {
					try { element.hidePopover?.(); }
					catch { /* 已经被关掉 */ }
				};
			}, [open]);

			/**
			 * The list's own keys.
			 *
			 * Enter and Space are deliberately absent: the rows are buttons, so the browser
			 * activates whichever one has focus, and intercepting those keys here would run
			 * the selection twice. Arrow keys are what this owns — plus Home/End, because a
			 * sheet outline can be long enough that walking it is not a real option.
			 * @param event - the keydown on the list or one of its rows.
			 */
			function onMenuKeyDown(event) {
				if (event.key === 'Escape') {
					// Escape is the keyboard's dismissal, so it restores focus like the
					// pointer path does — and it must NOT reach the settings panel around it.
					//
					// Measured, not assumed: without this, one Escape closes the menu AND the
					// whole settings dialog, leaving the row gone and focus on whatever the
					// page has underneath. The first Escape belongs to the innermost layer,
					// which is also what DSH's own modal layer documents ("while a menu is
					// open inside the dialog, Escape belongs to that menu first").
					event.stopPropagation();
					closeMenu({ dismiss: true });
					return;
				}
				if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
					event.preventDefault();
					const step = event.key === 'ArrowDown' ? 1 : -1;
					focusRow(activeIndex === null ? (step === 1 ? 0 : props.items.length - 1) : activeIndex + step);
					return;
				}
				if (event.key === 'Home' || event.key === 'End') {
					event.preventDefault();
					focusRow(event.key === 'Home' ? 0 : props.items.length - 1);
				}
			}

			// Re-read on every render the tick drives, so a scroll or a resize moves the menu
			// with its trigger instead of leaving it behind.
			if (open && anchorTick !== undefined && typeof triggerRef.current?.getBoundingClientRect === 'function') {
				const fresh = triggerRef.current.getBoundingClientRect();
				if (fresh.width > 0 || fresh.height > 0) anchorBoxRef.current = fresh;
			}
			const rect = open ? anchorBoxRef.current : undefined;
			const viewport = typeof window === 'undefined'
				? { width: 0, height: 0 }
				: { width: window.innerWidth, height: window.innerHeight };
			const menuStyle = placeMenu(rect, viewport, props.menuWidth);

			const rows = [];
			let lastGroup = null;
			// The index of the row being built, in the same terms the keyboard uses. Its own
			// counter rather than the array length, because group headings are also pushed
			// into `rows` and would otherwise shift every row after them.
			let rowIndex = 0;
			for (const item of props.items) {
				if (item.group !== undefined && item.group !== lastGroup) {
					lastGroup = item.group;
					rows.push(React.createElement(
						'div',
						{ key: 'group-' + item.group, className: 'dshUi_choiceGroup' },
						item.group,
					));
				}
				const index = rowIndex;
				rowIndex += 1;
				rows.push(React.createElement(
					'button',
					{
						key: item.value === '' ? 'empty' : item.value,
						type: 'button',
						role: 'option',
						className: 'dshUi_choiceItem',
						// The row's address for `aria-activedescendant` and for `focusRow`.
						id: 'dshCc-opt-' + index,
						// A label cut short by the ellipsis still says what it is on hover — the
						// outline's entries are selectors, and half a selector is no use.
						title: typeof item.label === 'string' ? item.label : undefined,
						'aria-selected': item.selected === true,
						onClick: () => {
							// A guard rather than decoration: the `key` above already
							// acknowledges that a row can carry an empty value (the panel's
							// "remove this property" entry does), and `Number('')` is 0 — so
							// without this a click on such a row would silently mean "jump to
							// rule 0".
							if (item.value === '') return;
							closeMenu();
							props.onPick(item.value);
						},
					},
					React.createElement('span', { className: 'dshUi_choiceLabel' }, item.label),
					item.selected === true ? React.createElement(CheckMark, {}) : null,
				));
			}

			return React.createElement(
				'span',
				{ className: 'dshUi_choiceWrap' + (props.wrapperClassName === undefined ? '' : ' ' + props.wrapperClassName) },
				React.createElement(
					'button',
					{
						type: 'button',
						ref: triggerRef,
						className: 'dshUi_choice' + (open ? ' dshUi_choiceOpen' : ''),
						// A dropdown with nothing to choose from is disabled rather than
						// clickable-but-empty: opening it would show a menu with no rows, and
						// that reads as broken rather than as "there is nothing here yet".
						// The caller decides — it knows what its items mean.
						disabled: props.disabled === true,
						'aria-haspopup': 'listbox',
						'aria-expanded': open,
						'aria-label': props.ariaLabel,
						onClick: () => {
							if (open) closeMenu();
							else setOpen(true);
						},
						// Closing from the trigger: on a keyboard-opened menu the focus never
						// left the trigger, so Escape has to be handled here as well as on the
						// list — otherwise the first Escape after opening by keyboard does
						// nothing at all, which reads as the menu being stuck.
						onKeyDown: (event) => {
							if (event.key === 'Escape' && open) {
								event.preventDefault();
								// Same reason as the list's handler: the panel around this row
								// treats Escape as "close the settings", so a menu dismissal
								// that leaks upward takes the whole dialog with it.
								event.stopPropagation();
								closeMenu({ dismiss: true });
							}
						},
					},
					React.createElement('span', { className: 'dshUi_choiceValue' }, props.display),
					React.createElement(ChevronDown, {}),
				),
				open ? React.createElement('div', {
					className: 'dshUi_choiceMenu',
					// popover 让它进 top layer；manual 表示不自动 light-dismiss（关菜单的逻辑仍归这里）。
					popover: 'manual',
					role: 'listbox',
					// Focusable itself, so the menu opens with focus *inside* it: Tab then walks
					// into the first row from a known place, and the arrow keys reach the
					// handler below without requiring focus to already be on a row.
					tabIndex: -1,
					onKeyDown: onMenuKeyDown,
					'aria-label': props.ariaLabel,
					'aria-activedescendant': activeIndex === null ? undefined : 'dshCc-opt-' + activeIndex,
					ref: menuRef,
					style: menuStyle,
				}, ...rows) : null,
			);
		}

		/**
		 * The `#` sheet glyph shown in the file bar, drawn on the shipped 14px grid.
		 * @returns the icon element.
		 */
		function CssIcon() {			return React.createElement(
				'svg',
				{ width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', className: 'dshCc_codeIcon', 'aria-hidden': true },
				React.createElement('path', {
					d: 'M6.4 1.9 5.9 5H3v1.4h2.7l-.5 3.2H2.8v1.4h2.1l-.5 3.1 1.4.2.5-3.3h2.9l-.5 3.1 1.4.2.5-3.3h2.6V9.6h-2.4l.5-3.2h2.4V5h-2.2l.5-3.1-1.4-.2-.5 3.3H7.4l.5-3.1-1.5-.2Zm.2 4.5h2.9l-.5 3.2H6.1l.5-3.2Z',
					fill: 'currentColor',
				}),
			);
		}

		/** Human labels for the four fill modes, in the panel's order. */
		const WALLPAPER_FIT_LABELS = [
			['cover', 'wp.fillCover'],
			['contain', 'wp.fillContain'],
			['fill', 'wp.fillStretch'],
			['tile', 'wp.fillTile'],
		];

		/**
		 * The wallpaper section's stylesheet.
		 *
		 * Two jobs in one sheet, because they are one thing on screen: the panel's controls, and the
		 * section chrome around them. Both are built on specs the interface already uses — DSH's
		 * 34px field, its 36px button, its type scale and radii, and the plugin manager's own
		 * section geometry (14px/500 title, `gap: 12`, definition-list facts). Every colour is a
		 * `--dsw-*` token, so both colour schemes come out right without a branch per theme.
		 */
		const WALLPAPER_CSS = [
			'.dshWp_root{container-type:inline-size;container-name:dshwp;display:flex;flex-direction:column;gap:12px;width:100%;min-width:0}',
			// The intro paragraph belongs to the SECTION (`dshUi_desc`), not to the panel: the
			// panel renders controls, and a mount that wants different copy writes its own.
			//
			// The preview and the controls: side by side while there is room for both, stacked when
			// there is not. A container query rather than `flex-wrap` — measured in the dev
			// instance's settings dialog with a right-hand panel open (a 198px column), the default
			// wrap put the 260px preview on its own line above 691px of controls, and the controls
			// then overflowed their box by up to 124px because a 96px label plus its slider cannot
			// fit beside itself.
			//
			// ⚠ The two container blocks that implement it live at the END of this sheet, and that
			// is load-bearing: a container query adds NO specificity, so an override that comes
			// before the base rule it means to beat loses on source order. Written here, above the
			// rules below, the `min-width:600px` block was parsed, matched, and still lost — the
			// preview column stayed `width:100%` of an 870px panel and the picture sat above the
			// controls instead of beside them.
			'.dshWp_columns{display:flex;flex-wrap:wrap;align-items:flex-start;gap:12px;width:100%;min-width:0}',
			'.dshWp_previewCol{display:flex;flex-direction:column;gap:8px;flex:none;width:100%;min-width:0}',
			'.dshWp_preview{box-sizing:border-box;position:relative;flex:none;width:100%;aspect-ratio:16/9;',
			'border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);overflow:hidden;',
			'background:var(--dsw-alias-bg-layer-3)}',
			'.dshWp_previewImg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}',
			'.dshWp_previewPane{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
			'transition:background .12s ease-out}',
			'.dshWp_previewEmpty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
			'color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}',
			'.dshWp_previewNote{margin:0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);line-height:18px}',
			// ── the clock on the wallpaper ────────────────────────────────────────
			// Bottom-right, where the shell leaves space, and ZERO z-index on purpose: the clock is
			// part of the picture, so interface content paints over it instead of being covered by
			// it. `mix-blend-mode` keeps it readable on both a dark and a light photograph without
			// a second control for colour.
			'.dshWp_clock{position:fixed;right:20px;bottom:16px;z-index:0;pointer-events:none;',
			'color:rgba(255,255,255,.92);text-shadow:0 1px 6px rgba(0,0,0,.6);',
			'font:var(--dsw-font-s-14);font-variant-numeric:tabular-nums;letter-spacing:.02em}',
			'.dshWp_rows{display:flex;flex-direction:column;gap:10px;flex:1 1 380px;min-width:0}',
			// A group heading inside the settings panel: the section is one seat, so its two groups
			// (wallpaper behaviour, editor preferences) need a divider that is not a second section.
			'.dshUi_group{margin:6px 0 0;padding-top:10px;border-top:0.5px solid var(--dsw-alias-border-l2);',
			'color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}',
			'.dshUi_row{display:flex;align-items:center;gap:12px;min-width:0;flex-wrap:wrap}',
			// `flex-wrap: wrap` rather than `nowrap` on the control rows: a 96px label plus a
			// slider plus a readout is about 380px of real minimum, so on a narrow-but-not-very-
			// narrow box the controls wrap among themselves instead of being squeezed and
			// overflowing their own column — measured at 198px, where `nowrap` produced 96–126px
			// of overflow on every row.
			'.dshUi_rowLabel{flex:none;width:96px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12)}',
			'.dshUi_rowControls{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}',
			// Every control in this section is the settings row's own: `rowButton` renders
			// `.dshUi_button`, `rowSwitch` `.dshUi_switch`, the choice rows the row's `Dropdown`, the URL
			// field `.dshUi_field`. That is why this sheet styles NO control any more — it styles
			// layout only, and the control look has exactly one owner.
			//
			// The one thing added here is the dropdown's width: the row's trigger is `width:100%`
			// because it lives in a full-width field, while this panel wants it to size to its
			// choices inside a flex row.
			'.dshWp_choice{width:auto;min-width:196px;flex:0 1 260px}',
			'.dshUi_slider{flex:1;min-width:120px;max-width:220px;accent-color:var(--dsw-alias-brand-primary)}',
			// The slider's only state beyond disabled is focus: a range input draws its own thumb,
			// so the visible-focus ring is the one thing this sheet owes it.
			'.dshUi_slider:focus-visible{outline-style:solid;outline-offset:1px}',
			'.dshUi_slider:disabled{opacity:.4;cursor:not-allowed}',
			'.dshUi_value{flex:none;min-width:52px;color:var(--dsw-alias-label-caption);font-size:12px;text-align:right;',
			'font-variant-numeric:tabular-nums}',
			'.dshUi_status{margin:0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);min-height:18px}',
			'.dshUi_hint{margin:0;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);line-height:18px}',
			// The status line's four states. `data-state` is not used: the class carries the state
			// because the element already exists in three panels and a class is what a caller can
			// see in the DOM without knowing this sheet. The `role=status` + `aria-live` pair comes
			// from `ui.status`, so a change is announced as well as painted.
			'.dshUi_statusBusy{color:var(--dsw-alias-label-secondary)}',
			'.dshUi_statusOk{color:var(--dsw-alias-state-success-primary)}',
			// The empty state: one muted line in a dashed box, so "nothing here yet" does not read
			// like an error or like a disabled control.
			'.dshUi_empty{margin:0;padding:10px 12px;border:0.5px dashed var(--dsw-alias-border-l3);',
			'border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12);line-height:18px}',
			'.dshUi_statusBad{color:var(--dsw-alias-state-error-primary)}',
			// The gallery: what the Host still has on disk, as thumbnails. Fixed 78×44 boxes so a
			// strip of them reads as one row rather than a ragged line.
			'.dshWp_gallery{display:flex;flex-wrap:wrap;gap:8px}',
			'.dshWp_thumb{position:relative;box-sizing:border-box;width:78px;height:44px;padding:0;overflow:hidden;cursor:pointer;',
			'border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-3)}',
			'.dshWp_thumb:hover{border-color:var(--dsw-alias-border-l1)}',
			'.dshWp_thumb[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);outline:1px solid var(--dsw-alias-brand-primary)}',
			'.dshWp_thumbImg{width:100%;height:100%;object-fit:cover;display:block}',
			// The path readout beside 「文件夹」: a real path is a string, so it is set as code the
			// way the plugin manager sets the install spec (`SourceSection` renders a `<code>` in
			// its definition list). It wraps rather than scrolling: at a 198px column this is
			// longer than the box, and a one-line scroller there hides the end of the path — the
			// part that says which directory it is.
			'.dshWp_path{display:block;min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);',
			'font-family:var(--ds-font-family-code);font-size:12px;line-height:18px}',
			// ── the section's own chrome ──────────────────────────────────────────
			// The official contract for this seat is "an entry draws its own section chrome", so
			// these are the shipped section's specs rather than this plugin's invention:
			// `.X_2TxG_detailSection` is `flex column, gap 12`, its `.sectionTitle` is 14px/500,
			// and `SourceSection`'s facts are a definition list. Read out of the plugin manager's
			// own bundle (`dsh-client-ui-plugin-manager/lib/client.js`) — that class HASH changes
			// between DSH builds, which is exactly why the values are copied instead of the name.
			'.dshUi_section{display:flex;flex-direction:column;gap:12px}',
			'.dshUi_sectionTitle{display:flex;align-items:center;gap:8px;margin:0;color:var(--dsw-alias-label-primary);',
			'font-size:14px;font-weight:500;line-height:20px}',
			'.dshUi_desc{margin:0;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);line-height:20px}',
			'.dshUi_facts{display:flex;flex-direction:column;gap:6px;margin:0}',
			'.dshUi_facts>div{display:grid;grid-template-columns:minmax(72px,max-content) 1fr;gap:12px;align-items:baseline}',
			'.dshUi_facts dt{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xxs-12)}',
			'.dshUi_facts dd{margin:0;min-width:0;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);',
			'overflow-wrap:anywhere}',
			'.dshUi_facts dd code{font-family:var(--ds-font-family-code)}',
			// Links inside the facts: the business token, which is the one this theme actually paints
			// (measured rgb(65,118,230)) — `--dsw-alias-brand-primary` resolves to near-black here and
			// made a link look like body text.
			'.dshUi_link{color:var(--dsw-alias-state-business-primary);text-decoration:none}',
			'.dshUi_link:hover{text-decoration:underline}',
			// ── the container queries, LAST on purpose ────────────────────────────
			// Both of them override base rules above (`.dshWp_previewCol`, `.dshWp_columns`,
			// `.dshUi_row`, `.dshUi_facts>div`), and a container query carries no extra
			// specificity: at equal specificity the later declaration wins, so these have to come
			// after the rules they beat. Placed earlier they were parsed, matched, and ignored.
			//
			// 600px is where a 260px preview and a control column of ~398px stop fitting on one
			// line. Below it everything stacks — the honest layout for the width rather than a
			// squeeze — and that is the state the plugin manager's 198px column lands in.
			'@container dshwp (min-width:600px){.dshWp_columns{flex-direction:row}.dshWp_previewCol{flex:0 0 260px;width:260px}}',
			'@container dshwp (max-width:599px){.dshWp_columns{flex-direction:column;align-items:stretch}',
			'.dshUi_row{flex-direction:column;align-items:stretch;gap:6px}.dshUi_rowLabel{width:auto}',
			'.dshWp_rows{flex:0 1 auto;width:100%}.dshUi_slider{max-width:none}.dshUi_value{text-align:left}',
			// The shipped `facts` list is a two-column definition list, so it collapses to one column
			// with everything else rather than a threshold of its own: measured at 422px the label
			// column still read fine and the value column had 338px, but two thresholds metres apart
			// in one sheet is how a layout drifts apart later.
			'.dshUi_facts>div{grid-template-columns:1fr;gap:2px}}',
		].join('');

		/**
		 * Install the wallpaper section's chrome, the way the row's own sheet is installed.
		 *
		 * Called from the bottom of the module body, once, rather than from `apply()`: the sheet has
		 * to exist before the section can render, and the section is mounted by a seat the plugin
		 * manager owns — doing it here means nothing about that seat's timing is load-bearing. It
		 * also has to run after the sheet above is defined: a module-scope block next to the row's
		 * own would read this `const` inside its temporal dead zone.
		 */
		function installWallpaperCss() {
			if (typeof document === 'undefined') return;
			if (document.querySelector('style[data-plugin-css=' + JSON.stringify(WALLPAPER_CSS_TAG) + ']') !== null) return;
			const styleTag = document.createElement('style');
			styleTag.dataset.plugin = PLUGIN_ID;
			styleTag.dataset.pluginCss = WALLPAPER_CSS_TAG;
			styleTag.textContent = WALLPAPER_CSS;
			document.head.appendChild(styleTag);
		}

		/**
		 * Whether a stored wallpaper URL is still addressed the way this page would reach it.
		 *
		 * A wallpaper stored through an earlier origin (or a differently configured route) still
		 * answers on the current one: the route is absolute and the name is a content hash, so
		 * the path after `/wallpaper?name=` is all that is worth keeping. An `http(s)`, `file:`
		 * or `data:` value is left exactly as it is — the last two are the user's own, and the
		 * first is a decision only the user can make.
		 * @param url - the stored URL.
		 * @returns true when it should be re-addressed to this page's route.
		 */
		function wallpaperUrlIsStoredOne(url) {
			return typeof url === 'string' && /\/wallpaper\?name=/.test(url) && !/^[a-z]+:/i.test(url);
		}

		/**
		 * Make one stored wallpaper the applied one.
		 *
		 * Switching between stored pictures keeps every other setting: the picture is the thing
		 * being chosen, and resetting the fill mode or the transparency because of it would
		 * undo a decision the user made about how they want the interface to look.
		 * @param name - the stored wallpaper's file name.
		 */
		function pickStoredWallpaper(name) {
			commitWallpaper({
				...wallpaperStore.snapshot(),
				image: API + '/wallpaper?name=' + encodeURIComponent(name),
			});
		}

		/**
		 * The wallpaper panel: one picture, four settings, and what is already stored.
		 *
		 * Mounted from ONE seat — this plugin's page in the plugin manager — and it reads a
		 * module-scope store because that seat is not the only writer: the panel itself writes on
		 * upload, and the store is what keeps a second mount, if one is ever added back, from
		 * disagreeing with this one. The record it saves lives in `WALLPAPER_SHEET` (a sheet of its
		 * own, explained where that constant is declared).
		 *
		 * The section's title, description and storage facts belong to `WallpaperSection`, not
		 * here: this renders the controls only, so a future mount can add its own chrome without
		 * inheriting copy written for the plugin page.
		 * @returns the panel element.
		 */
		function WallpaperPanel() {
			const state = React.useSyncExternalStore(wallpaperStore.subscribe, wallpaperStore.snapshot, wallpaperStore.snapshot);
			const fileRef = React.useRef(null);
			// The URL field is a draft: it holds what is being typed, and only the button writes it.
			// Deliberately NOT seeded from the current picture — the record may hold a data: URL from
			// an upload, and putting a megabyte of base64 into a text field is not a draft, it is a
			// rendering hazard.
			const [urlDraft, setUrlDraft] = React.useState('');
			const [urlNote, setUrlNote] = React.useState('');
			const hasImage = state.image !== '';
			/** A picture that came from a URL rather than an upload: shown as such, and re-editable. */
			const imageIsRemote = hasImage && !wallpaperUrlIsStoredOne(state.image);
			const transparent = Math.min(60, Math.max(0, Number(state.transparent) || 0));
			// The preview stands in for the whole point of the control: the app's own surfaces at
			// the chosen strength, over this picture. It is an approximation of the real page —
			// the shell's colours, not the shell — and it is the difference between "24%" being
			// a number and being a look.
			const previewPaneStyle = {
				// The same function the injected sheet uses, so the preview cannot drift from the
				// real surface. The pane stands in for `--dsw-alias-bg-base`, whose floor is 14.
				backgroundColor: 'color-mix(in srgb, ' + (transparent === 0 ? '#ffffff' : 'light-dark(#ffffff, #16181c)')
					+ ' ' + interfaceOpacity(14, transparent) + '%, transparent)',
			};
			// The status line speaks for the RECORD (saving / saved / failed). "There is no picture
			// yet" is not a status of the record — it is an empty state, and it is drawn as one below,
			// through `ui.empty`. Mixing the two made an untouched panel look like it was reporting
			// something.
			const statusText = state.error !== ''
				? state.error
				: state.status === 'saving' ? t('wp.saving')
					: state.status === 'saved' ? t('wp.saved')
						: '';
			const gallery = Array.isArray(state.gallery) ? state.gallery.slice(0, WALLPAPER_GALLERY_MAX) : [];
			// Whether the active sheet sets the same background tokens this sheet redefines. That
			// is a skin (the shipped acrylic example does it), and a skin wins that tie by source
			// order — so the one control that cannot take effect is named, instead of the user
			// dragging a slider that moves a number and nothing else. The picture layer is a
			// different story: it carries `!important`, so it wins in both directions.
			const rowCss = rowState.mode === 'files' && rowState.css !== '' ? rowState.css : '';
			const skinOverridesTokens = rowCss.includes('--dsw-alias-bg-base')
				|| rowCss.includes('--dsw-alias-bg-layer-1')
				|| rowCss.includes('--dsw-alias-bg-layer-2');

			/**
			 * Install whatever is in the URL field as the picture.
			 *
			 * The value is checked here, in the panel, rather than only where it is written: the same
			 * rule governs both, and a refusal is worth a sentence next to the field instead of a
			 * silent no-op. A rejected value never reaches the record, so a typo cannot take the
			 * current picture away.
			 */
			const applyUrl = () => {
				const url = urlDraft.trim();
				if (url === '') return;
				if (!wallpaperUrlAllowed(url)) {
					setUrlNote(t('wp.urlRejected'));
					return;
				}
				setUrlNote('');
				setUrlDraft('');
				commitWallpaper({ ...wallpaperStore.snapshot(), image: url });
			};

			return React.createElement(
				'div',
				{ className: 'dshWp_root', 'data-dsh-wallpaper': 'panel' },
				React.createElement('div', { className: 'dshWp_columns' },
					React.createElement('div', { className: 'dshWp_previewCol' },
						React.createElement('div', { className: 'dshWp_preview', 'data-dsh-wp-preview': true },
							hasImage
								? React.createElement('img', { className: 'dshWp_previewImg', src: state.image, alt: t('wp.previewAlt') })
								: null,
							React.createElement('span', { className: 'dshWp_previewPane', style: previewPaneStyle, 'aria-hidden': true }),
							hasImage
								? null
								: React.createElement('span', { className: 'dshWp_previewEmpty' }, t('wp.none'))),
						React.createElement('p', { className: 'dshWp_previewNote' },
							t('wp.previewNote')),
					),
					React.createElement('div', { className: 'dshWp_rows' },
					ui.row(t('wp.image'), [
						React.createElement('input', {
							ref: fileRef,
							type: 'file',
							accept: 'image/*',
							style: { display: 'none' },
							'aria-hidden': true,
							tabIndex: -1,
							onChange: (event) => {
								// Read before anything else: the input is uncontrolled and the same
								// picture picked twice is a normal thing to want.
								const file = event.target.files?.[0] ?? null;
								void uploadWallpaper(file);
							},
						}),
						ui.button({
							busy: state.status === 'saving',
							onClick: () => fileRef.current?.click(),
						}, hasImage ? t('wp.changeImage') : t('wp.chooseImage')),
						hasImage
							? ui.button({
								onClick: () => commitWallpaper({ ...wallpaperStore.snapshot(), image: '' }),
							}, t('wp.remove'))
							: null,
					]),
					ui.row(imageIsRemote ? t('wp.url') : t('wp.orUrl'), [
						ui.field({
							placeholder: t('wp.urlPlaceholder'),
							value: urlDraft,
							'aria-label': t('wp.urlAria'),
							onChange: (event) => { setUrlDraft(event.target.value); setUrlNote(''); },
							onKeyDown: (event) => {
								if (event.key === 'Enter') { event.preventDefault(); applyUrl(); }
							},
						}),
						ui.button({
							disabled: urlDraft.trim() === '',
							onClick: () => applyUrl(),
						}, t('wp.useUrl')),
						urlNote !== '' ? ui.status({ state: 'error', text: urlNote }) : null,
					]),
					ui.row(t('wp.fill'), ui.choice({
						ariaLabel: t('wp.fillAria'),
						choices: WALLPAPER_FIT_LABELS.map(([value, key]) => [value, t(key)]),
						value: state.fit,
						onChange: (picked) => commitWallpaper({ ...wallpaperStore.snapshot(), fit: picked }),
					})),
					ui.row(t('wp.opacity'),
						React.createElement(React.Fragment, null,
							// Dragging applies to the page but does not write: a drag is a hundred values,
							// and persisting each one would be a hundred writes and a hundred revisions of
							// the wallpaper record. The write happens when the gesture ENDS — which is
							// what `onCommit` is for, including the blur case: a slider that is no longer
							// focused has no gesture left to finish, so leaving it must not leave the
							// value unsaved.
							ui.slider({
								value: transparent,
								min: 0,
								max: 60,
								step: 2,
								disabled: !hasImage,
								ariaLabel: t('wp.opacityAria'),
								onInput: (value) => commitWallpaper({ ...wallpaperStore.snapshot(), transparent: value }, { persist: false }),
								onCommit: () => commitWallpaper(wallpaperStore.snapshot()),
							}),
							ui.value(transparent + '%'),
						)),
					ui.row(t('wp.brightness'),
						React.createElement(React.Fragment, null,
							ui.slider({
								value: Number(state.brightness) || 0,
								min: -60,
								max: 60,
								step: 5,
								disabled: !hasImage,
								ariaLabel: t('wp.brightnessAria'),
								onInput: (value) => commitWallpaper({ ...wallpaperStore.snapshot(), brightness: value }, { persist: false }),
								onCommit: () => commitWallpaper(wallpaperStore.snapshot()),
							}),
							ui.value(((Number(state.brightness) || 0) > 0 ? '+' : '') + (Number(state.brightness) || 0) + '%'),
						)),
					gallery.length === 0
						? null
						: ui.row(t('wp.used'), React.createElement('div', { className: 'dshWp_gallery' },
							gallery.map(entry => {
								const url = API + '/wallpaper?name=' + encodeURIComponent(entry.name);
								const selected = state.image === url;
								return React.createElement('button', {
									key: entry.name,
									type: 'button',
									className: 'dshWp_thumb',
									'aria-pressed': selected,
									'aria-label': t('wp.useWallpaper', { name: entry.name }),
									title: entry.name,
									onClick: () => pickStoredWallpaper(entry.name),
								}, React.createElement('img', { className: 'dshWp_thumbImg', src: url, alt: '', loading: 'lazy' }));
							}),
						)),
					ui.row(t('wp.folder'), [
						React.createElement('code', { className: 'dshWp_path', title: t('wp.folderTitle') },
							'~/.dsh/custom-css/.wallpapers/'),
						ui.button({
							disabled: state.gallery.length === 0,
							onClick: () => { void loadWallpaperGallery(); },
						}, t('wp.reload')),
					]),
					ui.status({
						state: state.error !== '' ? 'error' : (state.status === 'saving' ? 'busy' : (state.status === 'saved' ? 'ok' : 'idle')),
						text: statusText,
					}),
					hasImage
						? null
						: ui.empty(t('wp.empty')),
					hasImage && skinOverridesTokens
						? ui.hint(t('wp.skinNote'))
						: null,
				),
				),
			);
		}

		/**
		 * The wallpaper settings panel: rotation, scrim, blur, and the corner clock.
		 *
		 * Every control here writes to `settings.json.css` and repaints the injected sheet, so the
		 * effect is visible on the page without a reload — which is what makes these the settings
		 * that could ship before the ones needing Host routes.
		 * @returns the panel element.
		 */
		function SettingsPanel() {
			const prefs = React.useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.snapshot);
			const galleryCount = Array.isArray(wallpaperStore.snapshot().gallery) ? wallpaperStore.snapshot().gallery.length : 0;
			const apply = (patch) => commitSettings({ ...settingsStore.snapshot(), ...patch });
			/** The two data actions report through one line, and only one of them can run at a time. */
			const [dataBusy, setDataBusy] = React.useState('');
			const [dataNote, setDataNote] = React.useState('');
			const [dataBad, setDataBad] = React.useState(false);
			const [confirmReset, setConfirmReset] = React.useState(false);
			/** 排除名单的输入草稿：null = 显示已保存的值。 */
			const [excludeDraft, setExcludeDraft] = React.useState(null);
			/**
			 * What the Host half says it is, read once when this panel mounts.
			 *
			 * `null` until the answer arrives, and `undefined`-free by design: the row renders a
			 * placeholder rather than disappearing, because "the version row vanished" is a worse
			 * reading than "the version is not known yet".
			 */
			const [about, setAbout] = React.useState(null);
			React.useEffect(() => {
				let live = true;
				void api('/about')
					.then(payload => { if (live) setAbout(payload); })
					.catch(() => { if (live) setAbout({ version: null }); });
				return () => { live = false; };
			}, []);
			const say = (note, bad = false) => { setDataNote(note); setDataBad(bad); };

			/**
			 * Download everything the plugin owns as one JSON file.
			 *
			 * A Blob and an anchor rather than a navigation: this is a save, not a page load, and the
			 * filename carries the timestamp so two exports in one session do not overwrite each other
			 * in the downloads folder.
			 */
			const exportBackup = async () => {
				setDataBusy('export');
				try {
					const bundle = await api('/export');
					const stamp = new Date().toISOString().replace(/[:.]/g, '-');
					const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
					const url = URL.createObjectURL(blob);
					const anchor = document.createElement('a');
					anchor.href = url;
					anchor.download = 'dsh-custom-css-' + stamp + '.json';
					document.body.appendChild(anchor);
					anchor.click();
					anchor.remove();
					// Revoked on the next tick: revoking in the same turn cancels the download in some
					// browsers before it has started reading the blob.
					setTimeout(() => URL.revokeObjectURL(url), 1000);
					say(t('data.exported', { sheets: Object.keys(bundle.sheets).length, wallpapers: bundle.wallpapers?.length ?? 0 }));
				}
				catch (error) {
					say(t('data.exportFailed', { message: error?.message ?? error }), true);
				}
				finally {
					setDataBusy('');
				}
			};

			/**
			 * Reset by archiving, and say where the archive went.
			 *
			 * The browser half's own records live in `localStorage` as well as on disk, so a reset
			 * that only moved the files would come back to life on the next page load. Both are
			 * cleared, and the page is reloaded so every piece of state — the editor, the wallpaper,
			 * this panel — starts from the archived state rather than from a half-cleared one.
			 */
			const resetPlugin = async () => {
				setConfirmReset(false);
				setDataBusy('reset');
				try {
					// No seed text: the Host writes an empty `custom.css`, and the NEXT page load's
					// bootstrap sees the plugin has no content and seeds it the way a fresh install is
					// seeded. Sending text from here would be a second copy of that rule.
					const result = await post('/archive-and-reset', {});
					// Written through the same route the panels use, so a record that the host just
					// archived is not resurrected by the copy in this browser.
					localStorage.removeItem(WALLPAPER_KEY);
					localStorage.removeItem(SETTINGS_KEY);
					say(t('data.archived', {
						moved: result.moved.length,
						backup: result.backup,
						skipped: result.skipped?.length > 0 ? t('data.archivedSkipped', { count: result.skipped.length }) : '',
					}));
					setTimeout(() => { window.location.reload(); }, 1200);
				}
				catch (error) {
					setDataBusy('');
					say(t('data.resetFailed', { message: error?.message ?? error }), true);
				}
			};
			/** A slider that paints while the pointer moves and writes when the gesture ends. */
			const slider = (key, low, high, step) => ui.slider({
				value: Number(prefs[key]) || 0,
				min: low,
				max: high,
				step,
				ariaLabel: WALLPAPER_SETTING_LABELS[key].aria,
				onInput: (value) => commitSettings({ ...settingsStore.snapshot(), [key]: value }, { persist: false }),
				onCommit: () => commitSettings(settingsStore.snapshot()),
			});
			/** One labelled row: `ui.row` plus this panel's label table. */
			const row = (key, control, note) => ui.row(WALLPAPER_SETTING_LABELS[key].name, control, note);
			/**
			 * A choice from a fixed list, as the settings row's own dropdown.
			 *
			 * The row already has a menu for choosing one of several values — the sheet picker, the
			 * outline, the property list — and this is that component with a narrower wrapper. A
			 * native `<select>` was the earlier answer here; it is a platform control, but its popup
			 * renders square with the OS palette and cannot be styled, so it looked like a second
			 * product next to the row's rounded, token-coloured menu. Same reasoning the row's own
			 * comment gives for not using `<select>`.
			 */
			const choose = (key, choices, value) => ui.choice({
				ariaLabel: WALLPAPER_SETTING_LABELS[key].aria,
				choices,
				value,
				// `dshWp_choice` sizes the trigger to its choices inside this panel's flex row;
				// the kit's own wrapper is `width:100%` because it normally fills a settings field.
				className: 'dshWp_choice',
				onChange: (picked) => apply({ [key]: picked }),
			});
			return React.createElement(
				'div',
				{ className: 'dshWp_root', 'data-dsh-wallpaper': 'settings' },
				React.createElement('div', { className: 'dshWp_rows' },
					row('rotate', choose('rotate', ROTATE_CHOICES.map(([value, key]) => [value, t(key)]), prefs.rotate),
					galleryCount < 2
						? ui.hint(t('set.rotateHint'))
						: null),
					row('scrim', slider('scrim', 0, 80, 5),
						ui.value(prefs.scrim + '%')),
					row('blur', slider('blur', 0, 24, 2),
						ui.value(prefs.blur + 'px')),
					// The row's switch, with its two states spelled out: the same control the settings row
					// uses for "is this sheet on", so a reader learns one switch, not two.
					row('clock', ui.switch({
						checked: prefs.clock,
						ariaLabel: WALLPAPER_SETTING_LABELS.clock.aria,
						labelText: prefs.clock ? t('set.shown') : t('set.hidden'),
						onChange: (next) => apply({ clock: next }),
					})),
					ui.hint(t('set.hint.wallpaper')),
					ui.group(t('set.group.editor')),
					row('saveDelay', choose('saveDelay', SAVE_DELAY_CHOICES.map(([value, key]) => [String(value), t(key)]), String(prefs.saveDelay))),
					row('validate', choose('validate', VALIDATE_CHOICES.map(([value, key]) => [value, t(key)]), prefs.validate)),
					row('lineNumbers', ui.switch({
						checked: prefs.lineNumbers !== false,
						ariaLabel: WALLPAPER_SETTING_LABELS.lineNumbers.aria,
						labelText: prefs.lineNumbers !== false ? t('set.shown') : t('set.hide'),
						onChange: (next) => apply({ lineNumbers: next }),
					})),
					row('tabWidth', choose('tabWidth', TAB_WIDTH_CHOICES.map(([value, key]) => [String(value), t(key)]), String(prefs.tabWidth))),
					ui.hint(t('set.hint.editor')),
					ui.group(t('set.group.exclude')),
					// 一行文本，不是开关：名单要能写成 `:root, body`，也要能留空（那就什么都不排除）。
					ui.row(t('set.exclude'), [
						ui.field({
							className: 'dshCc_excludeField',
							'aria-label': t('set.excludeAria'),
							placeholder: DEFAULT_EXCLUDE,
							value: excludeDraft === null ? (prefs.exclude ?? DEFAULT_EXCLUDE) : excludeDraft,
							onChange: (event) => { setExcludeDraft(event.target.value); },
							onBlur: (event) => { setExcludeDraft(null); apply({ exclude: event.target.value }); },
							onKeyDown: (event) => {
								if (event.key === 'Enter') { event.preventDefault?.(); setExcludeDraft(null); apply({ exclude: event.target.value }); event.target.blur?.(); }
							},
						}),
						ui.hint(t('set.excludeHint')),
					]),
					ui.group(t('set.group.dev')),
					row('devApi', ui.switch({
						checked: prefs.devApi !== false,
						ariaLabel: WALLPAPER_SETTING_LABELS.devApi.aria,
						labelText: prefs.devApi !== false ? t('set.allowed') : t('set.readonly'),
						onChange: (next) => apply({ devApi: next }),
					})),
					ui.hint(t('set.hint.dev')),
					ui.group(t('set.group.data')),
					ui.row(t('set.backup'), [
						ui.button({
							busy: dataBusy === 'export',
							disabled: dataBusy !== '',
							onClick: () => { void exportBackup(); },
						}, t('set.exportAll')),
						ui.hint(t('set.hint.backup')),
					]),
					ui.row(t('set.reset'), [
						ui.button({
							busy: dataBusy === 'reset',
							disabled: dataBusy !== '',
							onClick: () => {
								// Two clicks, same as deleting a sheet: the first arms, the second
								// performs. Archiving is reversible, but a reset is not something to
								// do by accident either.
								if (!confirmReset) { setConfirmReset(true); return; }
								void resetPlugin();
							},
						}, confirmReset ? t('set.resetAgain') : t('set.resetPlugin')),
						ui.hint(
							confirmReset
								? t('set.resetTitleConfirm')
								: t('set.resetTitle'),
						),
					]),
					dataNote !== ''
						? ui.status({ state: dataBad ? 'error' : 'idle', text: dataNote })
						: null,
					ui.group(t('set.group.about')),
					// Facts about the plugin, not controls: the same `dl` shape the section above uses,
					// which is why it is the kit's `facts` and not a second copy of the markup.
					ui.facts([
						{
							term: t('set.term.version'),
							value: (about?.version ?? '…')
								+ (about?.name === undefined ? '' : ' · ' + (about?.license ?? '—')),
						},
						{ term: t('set.term.dir'), value: React.createElement('code', {}, about?.dir ?? '…') },
						{
							term: t('set.term.host'),
							value: about?.platform === undefined
								? '…'
								: (about.platform + ' · Node ' + String(about.node).replace(/^v/, '')),
						},
						{
							term: t('set.term.links'),
							value: [
								ui.link({ href: repoUrl(about) }, t('set.link.repo')),
								' · ',
								ui.link({ href: repoUrl(about) + '/tree/main/docs' }, t('set.link.docs')),
							],
						},
					]),
				),
			);
		}

		/**
		 * A browsable URL for the plugin's repository.
		 *
		 * `package.json` carries the `git+https://…` form a package manager wants, which is not a
		 * link a browser can open. Stripped here rather than written correctly in the manifest: the
		 * manifest's form is the one npm resolves, and there is one right place to fix a value that
		 * has two consumers.
		 * @param about - the `/about` payload, or null while it is still loading.
		 * @returns an https URL.
		 */
		function repoUrl(about) {
			const raw = typeof about?.repository === 'string' ? about.repository : '';
			const cleaned = raw.replace(/^git\+/, '').replace(/\.git$/, '');
			return /^https?:\/\//.test(cleaned) ? cleaned : 'https://github.com/FOX4096/dsh-custom-css';
		}

		/** Labels for the settings rows — the name a user reads and the name a screen reader hears. */
		const WALLPAPER_SETTING_LABELS = {
			rotate: { name: t('set.rotate'), aria: t('set.rotateAria') },
			scrim: { name: t('set.scrim'), aria: t('set.scrimAria') },
			blur: { name: t('set.blur'), aria: t('set.blurAria') },
			clock: { name: t('set.clock'), aria: t('set.clockAria') },
			saveDelay: { name: t('set.saveDelay'), aria: t('set.saveDelayAria') },
			validate: { name: t('set.validate'), aria: t('set.validateAria') },
			lineNumbers: { name: t('set.lineNumbers'), aria: t('set.lineNumbersAria') },
			tabWidth: { name: t('set.tabWidth'), aria: t('set.tabWidthAria') },
			devApi: { name: t('set.devApi'), aria: t('set.devApiAria') },
		};

		/**
		 * The settings section on this plugin's page in the plugin manager.
		 *
		 * Registered with a LOWER order than the wallpaper section, so it reads as
		 * 「壁纸 → 壁纸设置」 on the page. Same contract as the other contribution: it draws its own
		 * section chrome and returns null for a subject it has nothing for.
		 * @param props - the owner's props; `subject` names the open page.
		 * @returns the section, or null on another plugin's page.
		 */
		function SettingsSection(props) {
			const subject = props?.subject;
			if (subject === null || typeof subject !== 'object') return null;
			if (subject.kind !== 'bundle') return null;
			if (subject.pkg?.name !== PLUGIN_ID) return null;
			return ui.section({
				kind: 'settings-section',
				title: t('set.title'),
				badge: t('set.badge'),
				desc: t('set.desc'),
				children: React.createElement(SettingsPanel, {}),
			});
		}

		/**
		 * This plugin's wallpaper section on its own page in the plugin manager.
		 *
		 * The seat (`plugins.detail.section`) is rendered for EVERY detail page, and the official
		 * contract has two consequences this component carries: an entry **draws its own section
		 * chrome**, and it **returns null for a subject it has nothing for**. The subject arrives
		 * as an owner prop — the page's own `{ kind, pkg }` — and owner props win over anything a
		 * registration injects, so this is the page the component is really on rather than a
		 * guess. `subject.kind === 'bundle'` because this plugin is a bundle; a row or an official
		 * item of the same name would be a different page.
		 *
		 * The chrome is the shape the shipped sections use: a 14px/500 title, a description
		 * line, and a small definition list for facts — the same spec as `SourceSection`, taken
		 * from the plugin manager's own sheet rather than invented. What it says is what a user
		 * can act on: where the file went, and what the installed skin means for one control.
		 * @param props - the owner's props; `subject` names the open page.
		 * @returns the section, or null on another plugin's page.
		 */
		function WallpaperSection(props) {
			const subject = props?.subject;
			if (subject === null || typeof subject !== 'object') return null;
			if (subject.kind !== 'bundle') return null;
			if (subject.pkg?.name !== PLUGIN_ID) return null;
			return ui.section({
				kind: 'section',
				title: t('wp.title'),
				// A badge carries a fact rather than a control: this section is the one that writes to
				// the Host, so a reader can tell it from the purely local section below.
				badge: t('wp.badge'),
				desc: t('wp.desc'),
					
				children: [
					React.createElement(WallpaperPanel, {}),
					ui.facts([
						{ term: t('wp.fact.images'), value: React.createElement('code', {}, '~/.dsh/custom-css/.wallpapers/') },
						{ term: t('wp.fact.limit'), value: t('wp.fact.limitValue') },
						{ term: t('wp.fact.skin'), value: t('wp.fact.skinValue') },
					]),
				],
			});
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

				const sheet = await readSheet(active);
				// A reset leaves the directory with one EMPTY seed sheet, which is not the same state
				// as "a directory that never had a sheet": the old test (`files.length === 0`) missed
				// it, so a reset page came up with a blank editor. Seeding on an empty seed sheet
				// closes that — and only when the sheet really is empty, so a user who deleted all
				// their text on purpose is not overwritten on the next load.
				if (sheet.css === '' && files.length === 1 && active === DEFAULT_NAME && legacyCss() !== '') {
					await post('/write', { name: active, css: legacyCss() });
					sheet.css = legacyCss();
					files = (await api('/list')).files;
				}
				store.set({ files, active, css: sheet.css, disabled, mode: 'files', error: '' });
				applySheet(active, sheet.css, disabled);
				// 令牌覆盖排在用户表之前，所以必须在用户表注入之后再插一次（见 applyTokenCss）。
				await loadTokenSheet();
			}
			catch (error) {
				const css = legacyCss();
				store.set({
					mode: 'unavailable',
					css,
					error: t('error.hostFiles', { message: error?.message ?? error }),
				});
				applyUserCss(css);
			}
		}

		/**
		 * Bring the line a caret offset sits on into view.
		 *
		 * Only the textarea scrolls: the colour layer and the gutter are positioned by
		 * transforms this plugin writes, so a scroll made here has to be mirrored into them by
		 * the caller. Leaving the whole thing to the browser is not enough — the picker appends
		 * a rule at the end of a sheet that may be hundreds of lines long, and the caret then
		 * sits below the viewport with the view still where it was.
		 *
		 * Idempotent on purpose: if the engine already scrolled the caret line into the port,
		 * the port is left exactly as it is, so the two never fight over the position.
		 * @param editor - the textarea that owns the scroll port.
		 * @param offset - the caret offset.
		 * @param text - the sheet text the offset refers to.
		 */
		function revealCaretLine(editor, offset, text) {
			const height = editor.clientHeight;
			if (!(height > 0)) return;
			const source = String(text ?? '');
			const caret = Math.max(0, Math.min(offset, source.length));
			const line = source.slice(0, caret).split('\n').length - 1;
			const top = line * LINE_HEIGHT;
			if (top >= editor.scrollTop && top + LINE_HEIGHT <= editor.scrollTop + height) return;
			// Two lines of context above the caret, the way an editor's scrolloff would.
			editor.scrollTop = Math.max(0, top - LINE_HEIGHT * 2);
		}

		/** How many undo steps one sheet keeps. */
		const HISTORY_LIMIT = 200;
		/** Typing inside this window is one undo step rather than one per keystroke. */
		const BURST_MS = 700;

		/**
		 * Undo history, one sheet at a time.
		 *
		 * A controlled textarea has no usable stack of its own: React writes `value` on every
		 * keystroke, and that assignment clears whatever the engine had recorded — so Ctrl+Z
		 * in this editor would do nothing. The plugin therefore keeps its own, and it lives at
		 * module scope for the same reason the picker does: the row can be unmounted (the
		 * picker keeps working with the settings page closed) while its sheet is still edited.
		 *
		 * Entries are the state an edit is about to LEAVE, with the caret it had; the live
		 * state is the store's. That is what makes "undo" a matter of popping one and
		 * re-applying it through the normal write path.
		 */
		let history = { name: null, undo: [], redo: [], burstAt: 0, bursting: false };

		/**
		 * Start over for one sheet.
		 * @param name - the sheet the history belongs to.
		 */
		function resetHistory(name) {
			history = { name, undo: [], redo: [], burstAt: 0, bursting: false };
		}

		/**
		 * Record the state an edit is about to leave.
		 *
		 * Typing joins the step already in progress (a burst), so walking back a typed
		 * declaration is one press of Ctrl+Z rather than a dozen; anything else — a panel
		 * change, a picked rule, a paste from a menu item — is always a step of its own.
		 * @param name - the active sheet.
		 * @param before - `{ css, caret }` as it was before the edit.
		 * @param continuous - true when this edit is a keystroke continuing the burst.
		 */
		function rememberEdit(name, before, continuous = false) {
			if (history.name !== name) resetHistory(name);
			const now = Date.now();
			const joins = continuous && history.bursting && now - history.burstAt < BURST_MS;
			history.burstAt = now;
			history.bursting = continuous;
			if (joins) return;
			history.undo.push(before);
			if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
			// A new edit is a new branch: whatever was undone is no longer reachable forward.
			history.redo.length = 0;
		}

		/**
		 * Take one step through the history.
		 * @param direction - `undo` or `redo`.
		 * @param name - the active sheet.
		 * @param current - `{ css, caret }` as it is now.
		 * @returns the state to apply, or null when there is nowhere to go.
		 */
		function stepHistory(direction, name, current) {
			if (history.name !== name) return null;
			const from = direction === 'redo' ? history.redo : history.undo;
			const to = direction === 'redo' ? history.undo : history.redo;
			const step = from.pop();
			if (step === undefined) return null;
			to.push(current);
			// Two states in a row now: the next keystroke starts a step of its own rather
			// than joining one that has already been rewound.
			history.bursting = false;
			return step;
		}

		/** How long the editor waits before asking the document about `var()` (see `checkVariables`). */
		const VAR_CHECK_DELAY_MS = 600;
		/**
		 * How often the row asks the Host whether the active sheet changed on disk.
		 *
		 * The Host watches the directory and would happily push, but a push needs a socket the
		 * plugin does not have; one small JSON read every 1.5s is the cheap version that makes a
		 * save in a text editor show up while the user is still looking at the row. Measured cost
		 * of the read itself: a `stat` plus a file read of a few kilobytes.
		 */
		const WATCH_POLL_MS = 1500;
		/** Ceiling on that check: rules walked, and elements sampled per rule. */
		const VAR_CHECK_RULES = 240;
		const VAR_CHECK_SAMPLES = 3;

		/**
		 * What the document says about each rule: how many elements it hits, and which of its
		 * `var()`s have no value where it applies.
		 *
		 * A custom property is *inherited*, so "does this resolve" is a question about elements
		 * rather than about text: another component's card can define `--dsl-terminal-line-height`
		 * and it is then simply absent everywhere else — the engine drops the affected
		 * declarations and says nothing, which is the worst possible way to find out. So is a
		 * selector that hits nothing: a rule that does nothing looks exactly like a rule that
		 * works. Both are answered by asking the document, in one pass.
		 *
		 * Silence is deliberate for the variable list in two cases — a rule that matches nothing
		 * (there is nobody to ask) and a `var()` carrying a fallback (there is nothing to lose).
		 * A check that cries wolf about those would be turned off within a day, and then it
		 * would catch nothing at all.
		 * @param css - the sheet text.
		 * @param doc - the document to ask.
		 * @returns `{ counts, variables }`: `counts[i]` is the match count for rule `i` and
		 *   `null` when the engine refused the selector, `variables` the `{ line, message }`
		 *   records, both in sheet order.
		 */
		function inspectSheet(css, doc) {
			const counts = [];
			const variables = [];
			if (doc === undefined || doc === null || typeof doc.querySelectorAll !== 'function') {
				return { counts, variables };
			}
			const rules = parseRules(css).slice(0, VAR_CHECK_RULES);
			for (let index = 0; index < rules.length; index += 1) {
				const rule = rules[index];
				let found;
				try {
					// Excludes this plugin's own chrome: the outline's "n hits" column is a claim
					// about the user's page, and an overlay of the plugin's own making is not part
					// of the user's page.
					found = queryOwned(doc, rule.selector);
				}
				catch {
					// A selector the engine refuses is the validator's business, not this one's.
					counts[index] = null;
					continue;
				}
				counts[index] = found.length;
				const samples = [...found].slice(0, VAR_CHECK_SAMPLES);
				if (samples.length === 0) continue;
				const styles = [];
				for (const element of samples) {
					try {
						styles.push(window.getComputedStyle(element));
					}
					catch {
						// Not an element of this document (a test double, say).
					}
				}
				if (styles.length === 0) continue;
				for (const piece of splitDeclarations(css.slice(rule.bodyStart, rule.bodyEnd))) {
					for (const use of piece.chunk.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
						// `var(--x, fallback)` already says what happens when it is missing.
						if (use[2] === ',') continue;
						const name = use[1];
						if (styles.some(style => String(style.getPropertyValue(name) ?? '').trim() !== '')) continue;
						const offset = rule.bodyStart + piece.start + use.index;
						variables.push({
							line: css.slice(0, offset).split('\n').length,
							message: t('validate.varUnreadable', { name }),
						});
					}
				}
			}
			return { counts, variables };
		}

		/**
		 * What this plugin believes sits on disk, per sheet: the Host-reported revision
		 * (`size/mtime`), which every read and every write hands back.
		 *
		 * A sheet is a real file in a real directory, and 「打开文件」 exists precisely so it can be
		 * edited elsewhere — so the copy a row holds can go stale without anything saying so, and
		 * the next debounced write lands on top of the other editor's work. That is the one
		 * failure here that loses data instead of looking untidy.
		 *
		 * A revision rather than the text it used to hold: comparing text cannot tell a touch
		 * from an edit, and an editor that rewrites the SAME content (a CRLF change, a re-save
		 * after formatting) produced a full data-loss prompt for nothing.
		 */
		const sheetOnDisk = new Map();

		/**
		 * Read one sheet, and record the revision it came back with.
		 *
		 * `optional` is for the two RECORDS (`wallpaper.json.css` / `settings.json.css`): on a fresh
		 * install they simply do not exist, and asking for them with a plain GET produced a 404 in
		 * DevTools on every page load. With `optional` the Host answers "absent" instead of failing,
		 * so the console stays empty and the caller checks the flag rather than catching a throw.
		 * @param name - the sheet or record to read.
		 * @param options - `{ optional }`.
		 * @returns `{ css, rev, absent }`.
		 */
		async function readSheet(name, options) {
			const optional = options?.optional === true;
			let sheet;
			try {
				sheet = await api('/read?name=' + encodeURIComponent(name) + (optional ? '&optional=1' : ''));
			}
			catch (error) {
				// A Host from before the `optional` flag answers 404 here. That is the same situation
				// as "absent" — a fresh install with nothing to adopt — so it must not become a
				// failure the caller has to know about. The browser may still log the 404 itself;
				// only a restart of the Host can stop that, and this keeps the code path clean either way.
				if (optional) return { css: '', rev: null, absent: true };
				throw error;
			}
			if (sheet.absent === true) return { css: '', rev: null, absent: true };
			const rev = sheet.rev ?? null;
			sheetOnDisk.set(name, rev);
			return { css: sheet.css, rev, absent: false };
		}

		/**
		 * What to do about the file, given what this plugin last saw and what the editor holds.
		 *
		 * The whole of the external-change policy is this function, so it can be tested without a
		 * filesystem, a timer or a DOM:
		 *
		 * - nobody moved it → `idle`;
		 * - it moved and the editor has unsaved work → `conflict`, which never loses anything:
		 *   the write is refused and the footer asks which copy to keep;
		 * - it moved and the editor is clean → `adopt`, which is what makes saving in a text
		 *   editor show up here. Nothing can be lost, because there is nothing to lose.
		 * @param baseline - the revision this plugin last saw, or undefined when it never looked.
		 * @param current - the revision on disk now, or null when the Host could not stat it.
		 * @param dirty - whether the editor holds an edit that has not landed yet.
		 * @returns `idle`, `adopt` or `conflict`.
		 */
		function externalChange(baseline, current, dirty) {
			if (baseline === undefined || current === null) return 'idle';
			if (baseline === current) return 'idle';
			return dirty ? 'conflict' : 'adopt';
		}

		/**
		 * Ask the Host whether the sheet moved, and act on the answer.
		 * @param name - the sheet to ask about.
		 * @param options - `{ dirty }`: whether the editor holds an edit that has not landed.
		 * @returns `{ verdict, css, rev }` — `verdict` is `idle`, `adopt` or `conflict`, and the
		 *   other two fields are the disk copy the read returned.
		 */
		async function checkSheet(name, options = {}) {
			const sheet = await api('/read?name=' + encodeURIComponent(name));
			const current = sheet.rev ?? null;
			const verdict = externalChange(sheetOnDisk.get(name), current, options.dirty === true);
			if (verdict === 'idle') {
				// Record the revision either way: a null one means the Host could not stat the
				// file, and holding on to it would leave the next check with nothing to compare.
				sheetOnDisk.set(name, current);
			}
			return { verdict, css: sheet.css, rev: current };
		}

		/**
		 * Write one sheet, after confirming nobody else moved it.
		 *
		 * Every write goes through here — the editor's debounce, a picked rule, a restore — so
		 * the "has the ground moved?" question is asked in exactly one place. A refusal is not a
		 * failure: the text stays in the editor and the footer asks which copy to keep.
		 * @param name - the sheet to write.
		 * @param css - the text to write.
		 * @returns `true` when it landed, `false` when it failed or was refused.
		 */
		async function writeSheet(name, css) {
			try {
				const answer = await checkSheet(name, { dirty: true });
				if (answer.verdict !== 'idle') {
					// Somebody else moved it: refuse, and let the footer ask which copy to keep.
					sheetOnDisk.set(name, answer.rev);
					store.set({ conflict: { name, disk: answer.css }, error: '' });
					return false;
				}
				const written = await post('/write', { name, css });
				sheetOnDisk.set(name, written.rev ?? null);
				store.set({ error: '' });
				return true;
			}
			catch (error) {
				store.set({ error: t('error.save', { message: error?.message ?? error }) });
				return false;
			}
		}

		/**
		 * 把 `tokens.css` 的文本读成覆盖表。
		 *
		 * 容错的：文件是插件写的，但用户可以手改（文档里鼓励「接管项就是一份普通的 CSS」），
		 * 所以只认 `--名字: 值;` 这种声明，不认的忽略 —— 不因为多了一行注释就整份不生效。
		 * @param css - the file's text.
		 * @returns a Map of token name to value.
		 */
		function parseTokenSheet(css) {
			const found = new Map();
			for (const match of String(css ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
				found.set(match[1], match[2].trim());
			}
			return found;
		}

		/**
		 * 把覆盖表渲染成 `tokens.css` 的文本。
		 *
		 * 选择器必须是 `body, body[data-ds-dark-theme]`：DSH 把令牌定义在 `body` 上，深色那套在
		 * `body[data-ds-dark-theme]`（特异性 (0,1,1)）。只写 `body`（(0,0,1)）在浅色下赢、深色下输 ——
		 * 这是 `examples/acrylic.css` 里踩过的那一条。
		 * @param overrides - a Map of token name to value.
		 * @returns the file text (empty string when there is nothing to write).
		 */
		function renderTokenSheet(overrides) {
			const names = [...overrides.keys()].sort();
			if (names.length === 0) return '';
			const lines = names.map(name => '  ' + name + ': ' + overrides.get(name) + ';');
			return [
				'/* dsh-custom-css · 令牌覆盖',
				' * 由「设置 → 通用 → 自定义 CSS → 更多操作 → 令牌」维护，手改也会被读回来。',
				' * 注入顺序：在其它扩展之后、你自己的样式表之前 —— 所以它压得过往 DSH 与扩展，压不过你。',
				' */',
				'body,',
				'body[data-ds-dark-theme] {',
				...lines,
				'}',
				'',
			].join('\n');
		}

		/**
		 * 注入令牌覆盖那份样式，并保证它排在用户样式表之前。
		 *
		 * 没有覆盖时**保留一个空的 \`<style>\`**，而不是把它删掉：删掉就要依赖 `remove()`
		 * 真的把节点摘干净，而这个标签在「撤销最后一条」时正好被复用；一个空标签的代价是零，
		 * 一次摘不干净却会让撤销看起来没生效。顺序在两种情况下都要对：用户表可能早就在了
		 * （这时把覆盖插到它前面），也可能是刚 append 出来的（那它本来就在后面）。
		 * @param css - the override sheet's text.
		 */
		function applyTokenCss(css) {
			let tag = document.getElementById(TOKENS_STYLE_ID);
			if (tag === null) {
				tag = document.createElement('style');
				tag.id = TOKENS_STYLE_ID;
				tag.dataset.plugin = PLUGIN_ID;
				document.head.appendChild(tag);
			}
			tag.textContent = typeof css === 'string' ? css : '';
			// 顺序：覆盖表永远紧贴用户表之前 —— 它压得过往 DSH 与扩展，但压不过用户自己。
			const userTag = document.getElementById(USER_STYLE_ID);
			const owner = userTag?.parentElement ?? userTag?.parentNode ?? null;
			if (owner !== null && typeof owner.insertBefore === 'function') {
				owner.insertBefore(tag, userTag);
			}
		}

		/**
		 * 读 `tokens.css` 并注入；文件不存在就等于「没有覆盖」。
		 * @returns the overrides that were loaded.
		 */
		async function loadTokenSheet() {
			try {
				const sheet = await readSheet(TOKENS_SHEET, { optional: true });
				tokenOverrides.clear();
				for (const [name, value] of parseTokenSheet(sheet.css)) tokenOverrides.set(name, value);
			}
			catch { /* 没有这个文件（或 Host 早于 optional）：当作没有覆盖 */ }
			applyTokenCss(renderTokenSheet(tokenOverrides));
			return tokenOverrides;
		}

		/**
		 * 写令牌覆盖文件。
		 *
		 * 第一次写不能走 `writeSheet`：它的第一步是问「磁盘上那份有没有被别处改过」，而这要文件
		 * 先存在 —— 第一次写的回答是 404，覆盖就永远落不了盘（实测：注入成功了、文件没生成）。
		 * 所以文件不存在时直接写，宿主会把它建出来；之后才交给 `writeSheet` 管冲突。
		 * @param text - the file text.
		 */
		async function writeTokenSheet(text) {
			if (!sheetOnDisk.has(TOKENS_SHEET)) {
				try {
					const written = await post('/write', { name: TOKENS_SHEET, css: text });
					sheetOnDisk.set(TOKENS_SHEET, written.rev ?? null);
					store.set({ error: '' });
				}
				catch (error) {
					store.set({ error: t('error.save', { message: error?.message ?? error }) });
				}
				return;
			}
			await writeSheet(TOKENS_SHEET, text);
		}

		/**
		 * Every highlight box currently painted on the page.
		 *
		 * Module scope, not component state: the boxes live in `document.body` and are driven
		 * by direct DOM writes (they have to track a scrolling page and a live selector, and
		 * re-rendering React on every scroll event to move a rectangle is the wrong tool).
		 * Keeping the list here means the row's unmount can still clean them up.
		 */
		let highlightBoxes = [];

		/**
		 * The one element this plugin appends to `document.body`, marked as its own chrome.
		 *
		 * One container rather than many siblings, and that is the point: the boxes used to be
		 * appended to the body directly, which moved the app's own root along the `body > *`
		 * axis and shifted every `body > div:nth-child(N)` after them. A single extra child is
		 * still an extra child, but it is one stable fact rather than a number that changes with
		 * how many things happen to be highlighted.
		 *
		 * It carries no layout of its own: `display: contents` keeps the boxes positioned
		 * against the viewport exactly as they were, and `position: fixed` on each box means
		 * nothing here establishes a containing block for them.
		 * @returns the container, created on first use.
		 */
		function paintRoot() {
			// Scanned rather than queried: the container is always a direct child of the body, so
			// this needs no selector engine, and `children` is cheap even at the app's scale.
			// `getAttribute` rather than `hasAttribute`: the same question, and it is the part of
			// the element API a test double is most likely to provide. Compared against `null`
			// rather than tested for truthiness — a bare attribute reads back as the EMPTY STRING,
			// which is falsy, so `if (getAttribute(...))` answers "no" for a container that exists.
			// That mistake created one container per call.
			for (const child of document.body.children) {
				if (child.getAttribute?.(OWNED_ATTR) !== null && child.getAttribute?.(OWNED_ATTR) !== undefined) return child;
			}
			const root = document.createElement('div');
			root.setAttribute(OWNED_ATTR, '');
			// `display: contents` rather than a positioned box: the container must not become a
			// containing block for its `position: fixed` children, or every box would be placed
			// relative to the container instead of the viewport.
			root.style.display = 'contents';
			document.body.appendChild(root);
			return root;
		}

		/**
		 * Drop the plugin's own elements from a `querySelectorAll` result.
		 *
		 * A wrapper rather than a filter at each call site, because there are four of them
		 * (this row's highlight count, the outline's per-rule counts, the picker's candidate
		 * ranking, and the token sampler) and a rule that has to be remembered in four places
		 * is a rule that will be forgotten in one.
		 *
		 * Filters rather than rewrites the selector: the count and the nodes have to describe
		 * the same set, and quietly editing what the user typed would be a worse lie than a
		 * count that says what it excluded.
		 * @param doc - the document to ask.
		 * @param selector - the selector to resolve.
		 * @returns the matching elements, minus the plugin's own.
		 */
		function queryOwned(doc, selector) {
			const found = Array.from(doc.querySelectorAll(selector));
			if (found.length === 0) return found;
			// One query for the marked elements rather than a `closest()` per node: the list is
			// short (usually empty) and this keeps the cost proportional to the chrome, not to
			// how broad the user's selector is.
			const owned = doc.querySelectorAll('[' + OWNED_ATTR + ']');
			if (owned.length === 0) return found;
			return found.filter((node) => {
				for (const owner of owned) {
					if (owner === node || owner.contains(node)) return false;
				}
				return true;
			});
		}

		/** Take every rule-highlight box off the page. */
		function clearHighlights() {
			for (const box of highlightBoxes) box.remove();
			highlightBoxes = [];
		}

		/**
		 * Resolve a selector the way the page would, reporting *why* when it cannot.
		 *
		 * The distinctions are the point. Three different situations otherwise collapse into
		 * the same "0 matches", and "0" is exactly the number the user is looking at this to
		 * interpret:
		 *
		 *   · the engine rejects the text outright — `@media (…)` is an at-rule, not a
		 *     selector. (Unreachable through the panel, which does not open on an at-rule at
		 *     all; kept because the function must be right about its own input rather than
		 *     relying on a caller to have filtered it.)
		 *   · the selector is fine but matches nothing — `.cm-peak-strip` in a page that has
		 *     no such class.
		 *   · the rule is written against a PSEUDO-element — `a::before`. There is no element
		 *     to outline, so "no matches" would be a lie that also hides the useful answer:
		 *     the host element usually does match. `{ pseudo: true }` says which it is.
		 * @param selector - the text to resolve.
		 * @returns `{ nodes }` or `{ invalid: true }` or `{ nodes: [], pseudo: true }`.
		 */
		function resolveSelector(selector) {
			const text = String(selector ?? '').trim();
			// An empty selector is not an error worth reporting — it is a field the user is
			// still typing in.
			if (text === '') return { nodes: [] };
			// Both spellings resolve to the same thing in CSS: `::before` is the modern form,
			// `:before` the one that still works. Matched without a word boundary after the
			// name so `::before-x` does not slip through.
			if (/::[-a-zA-Z]|:(before|after|marker|placeholder|selection|first-line|first-letter)\b/.test(text)) {
				return { nodes: [], pseudo: true };
			}
			try {
				return { nodes: queryOwned(document, text) };
			}
			catch {
				return { invalid: true };
			}
		}

		/**
		 * 一处偏移在第几行（1 开始）。
		 * @param text - 整段文本。
		 * @param offset - 目标偏移。
		 * @returns 行号。
		 */
		function lineOfOffset(text, offset) {
			let line = 1;
			for (let index = 0; index < offset && index < text.length; index += 1) {
				if (text[index] === '\n') line += 1;
			}
			return line;
		}

		/**
		 * 一条规则在源码里的结束偏移（`}` 之后），用来把它整条注释掉。
		 * @param css - the sheet text.
		 * @param rule - one entry from {@link parseRules}.
		 * @returns the offset just past the rule.
		 */
		function ruleEndOffset(css, rule) {
			return css[rule.bodyEnd] === '}' ? rule.bodyEnd + 1 : rule.bodyEnd;
		}

		/**
		 * 当前页面上「命不中」的规则，带源码位置 —— 选择器体检页的列表。
		 *
		 * 和 `window.dshCss.css.deadSelectors()` 判的是同一件事，但**多带一个位置**：体检页要能
		 * 把规则整条注释掉，而只拿到选择器字符串时没法定位到源码。判据也保持同一套：
		 *   · `@media` 里嵌套的规则不报（当前视口不满足时匹配数就是 0，规则本身没坏）；
		 *   · 状态伪类 / 状态类不报（`:hover` 在静止页面上永远 0 命中）；
		 *   · 选择器本身是非法的、或它是伪元素，也判不了 —— 三种都跳过，只报「确定不命中」的。
		 * @param css - the sheet text.
		 * @returns `{ selector, line, start, end }` 数组，源码顺序。
		 */
		function deadRuleList(css) {
			const dead = [];
			for (const rule of parseRules(css)) {
				if (authoringStateDependent(rule.selector)) continue;
				const resolved = resolveSelector(rule.selector);
				if (resolved.invalid === true || resolved.pseudo === true) continue;
				if (resolved.nodes.length > 0) continue;
				dead.push({
					selector: rule.selector,
					line: lineOfOffset(css, rule.selectorStart),
					start: rule.selectorStart,
					end: ruleEndOffset(css, rule),
				});
			}
			return dead;
		}

		/**
		 * 把一段规则文本包成注释，保留原文。
		 *
		 * 块里如果本来就有 `*&#47;`（例如 `color:red;*&#47;* keep *&#47;` 这样的行内注释），直接外包会让
		 * 注释提前结束、后半条规则继续生效 —— 那比不注释更糟。所以内部的**结束标记**先改写成 `* /`：
		 * 它已经在注释里，少一个斜杠没有任何语义，用户还能一眼看出被注释掉的是什么。
		 *
		 * 只处理结束标记：CSS 注释不嵌套，内部的 `/*` 在外层注释里只是普通字符，改它只会把保留的
		 * 原文弄花。
		 * @param text - the rule's source text.
		 * @returns the commented-out version.
		 */
		function commentOutText(text) {
			return '/* ' + text.replace(/\*\//g, '* /') + ' */';
		}

		/**
		 * Draw one box per matched element, positioned from live viewport rects.
		 *
		 * Reuses whatever boxes are already on the page instead of rebuilding them, so a
		 * scroll or a keystroke in the selector field only moves rectangles. `position:fixed`
		 * is what the picker's own boxes use, and for the same reason: the page under the
		 * settings dialog scrolls, so a box anchored to the document would slide away from
		 * the element it is pointing at.
		 * @param nodes - the elements to outline.
		 */
		function paintHighlightBoxes(nodes) {
			// Hidden and zero-sized elements have no box to draw. `display:none` measures 0x0
			// and one of those at the viewport corner is a stray dot with no meaning.
			const visible = nodes.filter((node) => {
				const rect = node.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0;
			});
			const sole = visible.length === 1;
			while (highlightBoxes.length > visible.length) highlightBoxes.pop().remove();
			while (highlightBoxes.length < visible.length) {
				const box = chrome('div', 'dshCc_hlBox');
				// Into the marked container, never into the body directly — see `paintRoot`.
				paintRoot().appendChild(box);
				highlightBoxes.push(box);
			}
			visible.forEach((node, index) => {
				const box = highlightBoxes[index];
				const rect = node.getBoundingClientRect();
				box.style.top = rect.top + 'px';
				box.style.left = rect.left + 'px';
				box.style.width = rect.width + 'px';
				box.style.height = rect.height + 'px';
				// One match is outlined harder and left unfilled (see the stylesheet): there is
				// nothing to tell it apart from, and a wash over the element hides the very
				// thing the user is looking at.
				if (sole) box.dataset.sole = 'true';
				else delete box.dataset.sole;
			});
		}

		/**
		 * Whether a value is worth marking invalid.
		 *
		 * `CSS.supports` answers "无效" for the empty string, which is not a mistake — it is a
		 * field being cleared, or one that was never filled in. Measured: `color: ''`,
		 * `gap: ''`, `width: ''` all come back false. So emptiness is checked first.
		 *
		 * Everything else is left to the engine: this row has no business keeping its own list
		 * of which values are legal.
		 * @param property - kebab-case property name.
		 * @param value - the text in the field.
		 * @returns true when the field should say the value is wrong.
		 */
		function valueInvalid(property, value) {
			if (String(value).trim() === '') return false;
			return !supported(property, value);
		}

		/* ═══ UI 组件库 ══════════════════════════════════════════════════════════
		 * 这个扩展所有界面元素的唯一来源。加功能只调用 ui.*，不要再手写
		 * dshUi_button / dshUi_switch / dshUi_row 这些结构 —— 那会重新长出第二套控件。
		 * 每个组件的 props 与状态见 docs/ui-kit.md；tests/audit-ui.mjs 会拒绝绕过这里的写法。
		 *
		 * 三条约定：
		 *  1. 状态只写在属性上（disabled / aria-checked / aria-pressed / aria-invalid /
		 *     aria-busy / data-state），CSS 只从属性取值 —— 读屏器读到的与眼睛看到的同源；
		 *  2. onChange 一律收新值，不收事件对象；
		 *  3. 传 className 是追加，不替换默认类。
		 *
		 * 类名归属：dshUi_* 全部属于这里（控件样式在 ROW_CSS，行布局在 WALLPAPER_CSS，
		 * 两张表都在模块加载时装好）。特性自己的类不进来：壁纸预览/缩略图/时钟是
		 * dshWp_*，编辑器外壳与行号是 dshCc_*。
		 * ══════════════════════════════════════════════════════════════════════ */
		const ui = {
			/* ── 控件 ──────────────────────────────────────────────────────── */

			/**
			 * 按钮：`.dshUi_button`（36px、模块底色、`radius-md`）。
			 * @param props - `disabled` · `busy`（转圈 + 禁用 + `aria-busy`）· `danger` · `title` · `className` · `onClick`
			 * @param children - 标签文字。
			 * @returns 按钮元素。
			 */
			button(props, ...children) {
				const { className, busy, danger, ...rest } = props ?? {};
				return React.createElement(
					'button',
					{
						type: 'button',
						...rest,
						disabled: rest.disabled === true || busy === true,
						'aria-busy': busy === true ? 'true' : undefined,
						className: 'dshUi_button'
							+ (danger === true ? ' dshUi_buttonDanger' : '')
							+ (className === undefined ? '' : ' ' + className),
					},
					busy === true ? React.createElement('span', { className: 'dshUi_spinner', 'aria-hidden': true }) : null,
					...children,
				);
			},

			/**
			 * 开关：真的 `button[role=switch]`，成色画在 `aria-checked` 上。
			 * @param props - `checked` · `ariaLabel` · `labelText` · `disabled` · `title` · `onChange(next)`
			 * @returns 开关元素。
			 */
			switch(props) {
				const checked = props.checked === true;
				return React.createElement(
					'button',
					{
						type: 'button',
						role: 'switch',
						'aria-checked': checked,
						'aria-label': props.ariaLabel,
						className: 'dshUi_switch' + (props.className === undefined ? '' : ' ' + props.className),
						disabled: props.disabled === true,
						title: props.title,
						onClick: () => { props.onChange(!checked); },
					},
					React.createElement(
						'span',
						{ className: 'dshUi_switchTrack', 'aria-hidden': true },
						React.createElement('span', { className: 'dshUi_switchThumb' }),
					),
					props.labelText === undefined
						? null
						: React.createElement('span', { className: 'dshUi_switchLabel' }, props.labelText),
				);
			},

			/**
			 * 外链：`.dshUi_link`（商业色、下划线只在悬停时出现）。
			 * @param props - `{ href, ...rest }`（`target` / `rel` 由这里补齐，外链一律新标签页）。
			 * @param children - 文字。
			 * @returns a 元素。
			 */
			link(props, ...children) {
				const { className, ...rest } = props ?? {};
				return React.createElement('a', {
					...rest,
					target: rest.target ?? '_blank',
					rel: rest.rel ?? 'noreferrer noopener',
					className: 'dshUi_link' + (className === undefined ? '' : ' ' + className),
				}, ...children);
			},

			/**
			 * 徽标：只读小 chip（`.dshUi_badge`）。
			 * @param text - 内容。
			 * @returns span 元素。
			 */
			badge(text) {
				return React.createElement('span', { className: 'dshUi_badge' }, text);
			},

			/**
			 * 下拉选择：复用行里那个 `Dropdown`（fixed 菜单、键盘导航、外点关闭）。
			 * @param props - `ariaLabel` · `choices: [[value,label]]` · `value` · `disabled` · `onChange(value)` · `className`
			 * @returns 下拉元素。
			 */
			choice(props) {
				const found = props.choices.find(([value]) => value === props.value) ?? props.choices[0];
				return React.createElement(Dropdown, {
					items: props.choices.map(([value, label]) => ({ value, label, selected: value === props.value })),
					display: found === undefined ? '' : found[1],
					ariaLabel: props.ariaLabel,
					disabled: props.disabled === true,
					wrapperClassName: 'dshUi_choiceWrap' + (props.className === undefined ? '' : ' ' + props.className),
					onPick: props.onChange,
				});
			},

			/**
			 * 文本框：`.dshUi_field`（34px、`border-l4`、`bg-layer-3`）。
			 *
			 * `invalid` 同时开 `aria-invalid` 与一条错误说明，两者由同一个布尔决定 ——
			 * 只画红边不告诉读屏器「这个值不对」，等于只给看得见的人报错。
			 * @param props - `value` · `onChange` · `placeholder` · `disabled` · `readOnly` · `invalid` · `message` · `aria-label`
			 * @returns 字段元素（有 `message` 时是一段「输入框 + 说明」）。
			 */
			field(props) {
				const { className, invalid, message, ...rest } = props ?? {};
				const input = React.createElement('input', {
					type: 'text',
					...rest,
					'aria-invalid': invalid === true ? 'true' : undefined,
					className: 'dshUi_field'
						+ (invalid === true ? ' dshUi_fieldInvalid' : '')
						+ (className === undefined ? '' : ' ' + className),
				});
				if (message === undefined) return input;
				return React.createElement(
					'span',
					{ className: 'dshUi_fieldFail' },
					input,
					React.createElement(
						'span',
						{ className: 'dshUi_fieldMessage' + (invalid === true ? ' dshUi_fieldMessageBad' : '') },
						message,
					),
				);
			},

			/**
			 * 滑块：原生 `input[type=range]`。`onInput` 持续回调（拖动时即时预览），
			 * `onCommit` 在手势结束时回调一次（真正落盘）。
			 * @param props - `value` · `min` · `max` · `step` · `ariaLabel` · `disabled` · `onInput(v)` · `onCommit()`
			 * @returns 滑块元素。
			 */
			slider(props) {
				return React.createElement('input', {
					type: 'range',
					className: 'dshUi_slider',
					min: props.min,
					max: props.max,
					step: props.step,
					value: props.value,
					disabled: props.disabled === true,
					'aria-label': props.ariaLabel,
					onChange: (event) => { if (props.onInput !== undefined) props.onInput(Number(event.target.value)); },
					onPointerUp: () => { if (props.onCommit !== undefined) props.onCommit(); },
					onKeyUp: () => { if (props.onCommit !== undefined) props.onCommit(); },
					onBlur: () => { if (props.onCommit !== undefined) props.onCommit(); },
				});
			},

			/* ── 行布局 ────────────────────────────────────────────────────── */

			/**
			 * 一行设置：左边名字（96px 列），右边控件，可再跟一句说明。
			 * @param label - 名字。
			 * @param control - 控件元素。
			 * @param note - 控件后的说明（可选）。
			 * @returns 行元素。
			 */
			row(label, control, note) {
				return React.createElement(
					'div',
					{ className: 'dshUi_row' },
					React.createElement('span', { className: 'dshUi_rowLabel' }, label),
					React.createElement('div', { className: 'dshUi_rowControls' }, control, note ?? null),
				);
			},

			/**
			 * 分组标题。
			 * @param text - 标题。
			 * @returns p 元素。
			 */
			group(text) {
				return React.createElement('p', { className: 'dshUi_group' }, text);
			},

			/**
			 * 说明文字。
			 * @param text - 内容。
			 * @returns p 元素。
			 */
			hint(text) {
				return React.createElement('p', { className: 'dshUi_hint' }, text);
			},

			/**
			 * 读数（滑块右侧那个数字）。
			 * @param text - 内容。
			 * @returns span 元素。
			 */
			value(text) {
				return React.createElement('span', { className: 'dshUi_value' }, text);
			},

			/**
			 * 事实表：`dt` + `dd` 的竖排定义列表。
			 * @param rows - `[{ term, value }]`，`value` 可以是任意元素。
			 * @returns dl 元素。
			 */
			facts(rows) {
				return React.createElement(
					'dl',
					{ className: 'dshUi_facts' },
					...rows.map((entry, index) => React.createElement(
						'div',
						{ key: String(index) },
						React.createElement('dt', {}, entry.term),
						React.createElement('dd', {}, entry.value),
					)),
				);
			},

			/* ── 反馈 ──────────────────────────────────────────────────────── */

			/**
			 * 状态行：idle / busy / ok / error 四态，`role=status` + `aria-live=polite`。
			 *
			 * 以前每个面板自己拼一段文案加一个 class；四态化之后，「正在保存」与「保存失败」
			 * 不可能画成同一个样子，读屏器也会念出变化。
			 * @param props - `{ state, text }`；`state` 缺省为 `idle`。
			 * @returns p 元素。
			 */
			status(props) {
				const state = props.state ?? 'idle';
				return React.createElement(
					'p',
					{
						className: 'dshUi_status'
							+ (state === 'error' ? ' dshUi_statusBad' : '')
							+ (state === 'ok' ? ' dshUi_statusOk' : '')
							+ (state === 'busy' ? ' dshUi_statusBusy' : ''),
						role: 'status',
						'aria-live': 'polite',
					},
					props.text ?? '',
				);
			},

			/**
			 * 空态：一行灰字，给「还没有壁纸 / 目录里没有样式表」这类占位。
			 * @param text - 内容。
			 * @returns p 元素。
			 */
			empty(text) {
				return React.createElement('p', { className: 'dshUi_empty' }, text);
			},

			/* ── 小节 ──────────────────────────────────────────────────────── */

			/**
			 * 插件详情页的一节：14px/500 标题 + 可选徽标 + 一句说明 + 内容。
			 *
			 * `plugins.detail.section` 的官方约定是「每个条目自己画 chrome」，这就是那份 chrome；
			 * 别的作者的页面上没话可说时，调用方 `return null`。
			 * @param props - `{ kind, title, badge, desc, ariaLabel, children }`
			 * @returns section 元素。
			 */
			section(props) {
				return React.createElement(
					'section',
					{
						className: 'dshUi_section',
						'data-dsh-wallpaper': props.kind,
						'aria-label': props.ariaLabel ?? props.title,
					},
					React.createElement(
						'h4',
						{ className: 'dshUi_sectionTitle' },
						React.createElement('span', {}, props.title),
						props.badge === undefined ? null : ui.badge(props.badge),
					),
					props.desc === undefined ? null : React.createElement('p', { className: 'dshUi_desc' }, props.desc),
					// One child or many: callers pass either, and `...children` on a lone element
					// throws "spread requires iterable" — which is a bad way to learn that.
					...[].concat(props.children ?? []),
				);
			},
		};

		/**
		 * The custom-CSS preference row: title, sheet picker, open-file and reset
		 * actions, an inline "new sheet" input, the editor, and a status footer.
		 * @returns the row element tree.
		 */
/**
 * 查找 / 替换栏。
 *
 * 纯展示：所有状态由调用方持有，这里只发事件。抽出来的原因很直接 —— 它曾是行组件里最长的一段
 * JSX（约 140 行），而且和编辑器状态没有耦合，只和「查找会话」有关。不调 hook，所以行的 hook
 * 顺序不受影响。
 * @param props - `{ fieldRef, query, replacement, caseSensitive, hits, activeHit, activeRange,
 *   onQuery, onReplacement, onStep, onClose, onToggleCase, onReplace, onReplaceAll }`.
 * @returns the bar.
 */
function FindBar(props) {
					return React.createElement(
					'div',
					{ className: 'dshCc_findBar' },
					React.createElement('input', {
					ref: props.fieldRef,
					type: 'text',
					className: 'dshCc_findField',
					placeholder: t('find.search'),
					'aria-label': t('find.search'),
					spellCheck: false,
					value: props.query,
					onChange: (event) => {
					props.onQuery(event.target.value);
					},
					onKeyDown: (event) => {
					if (event.key === 'Enter') {
					event.preventDefault();
					props.onStep(event.shiftKey === true ? -1 : 1);
					}
					else if (event.key === 'Escape') {
					event.preventDefault();
					props.onClose();
					}
					},
					}),
					React.createElement('input', {
					type: 'text',
					className: 'dshCc_findField',
					placeholder: t('find.replacement'),
					'aria-label': t('find.replacement'),
					spellCheck: false,
					value: props.replacement,
					onChange: (event) => { props.onReplacement(event.target.value); },
					onKeyDown: (event) => {
					if (event.key === 'Escape') {
					event.preventDefault();
					props.onClose();
					}
					},
					}),
					// The count speaks for itself: no hits is where the query is wrong,
					// so that is the one state worth a colour of its own.
					React.createElement(
					'span',
					{
					key: 'count',
					className: props.query !== '' && props.hits.length === 0 ? 'dshCc_findCountBad' : 'dshCc_findCount',
					},
					props.query === '' ? '' : (props.hits.length === 0 ? t('find.none') : (props.activeHit + 1) + ' / ' + props.hits.length),
					),
					React.createElement(
					'button',
					{
					type: 'button',
					// `dshCc_findOn` is the same state as `aria-pressed`, as a class: the
					// rule below is keyed on the attribute (so it cannot drift from the
					// state), and the class is what a contract test can see in a render.
					className: 'dshCc_findBtn dshCc_findIcon' + (props.caseSensitive ? ' dshCc_findOn' : ''),
					title: t('find.case'),
					// The visible label is the two letters "Aa", which is a fine picture of
					// the option and a poor accessible name. `aria-pressed` still carries
					// the state, so the name only has to say what the setting is.
					'aria-label': t('find.case'),
					'aria-pressed': props.caseSensitive,
					disabled: props.query === '',
					onClick: () => {
					props.onToggleCase();
					},
					},
					'Aa',
					),
					React.createElement(
					'button',
					{
					type: 'button',
					className: 'dshCc_findBtn dshCc_findIcon',
					title: t('find.prev'),
					// The button holds a chevron and nothing else, so without this its
					// accessible name is the tooltip's — and a `title` is not reliably
					// an accessible name. Assistive technology may announce "button"
					// and drop the tooltip entirely; a touch device never shows it.
					'aria-label': t('find.prevAria'),
					disabled: props.hits.length === 0,
					onClick: () => { props.onStep(-1); },
					},
					React.createElement(ChevronDown, {}),
					),
					React.createElement(
					'button',
					{
					type: 'button',
					className: 'dshCc_findBtn dshCc_findIcon dshCc_findNext',
					title: t('find.next'),
					'aria-label': t('find.nextAria'),
					disabled: props.hits.length === 0,
					onClick: () => { props.onStep(1); },
					},
					React.createElement(ChevronDown, {}),
					),
					React.createElement(
					'button',
					{
					type: 'button',
					className: 'dshCc_findBtn dshCc_findWide',
					title: t('find.replaceOneTitle'),
					'aria-label': t('find.replaceOne'),
					disabled: props.activeRange === null,
					onClick: props.onReplace,
					},
					React.createElement('span', { className: 'dshCc_findLabel' }, t('find.replace')),
					// Shown instead of the label on a narrow row: the button keeps its
					// title and aria-label either way, so it is never unlabelled.
					React.createElement('span', { className: 'dshCc_findIconOnly', 'aria-hidden': true }, '↦'),
					),
					React.createElement(
					'button',
					{
					type: 'button',
					className: 'dshCc_findBtn dshCc_findWide',
					title: t('find.replaceAllTitle'),
					'aria-label': t('find.replaceAll'),
					disabled: props.hits.length === 0,
					onClick: props.onReplaceAll,
					},
					React.createElement('span', { className: 'dshCc_findLabel' }, t('find.replaceAll')),
					React.createElement('span', { className: 'dshCc_findIconOnly', 'aria-hidden': true }, '⇉'),
					),
					React.createElement(
					'button',
					{
					type: 'button',
					className: 'dshCc_findBtn dshCc_findIcon',
					title: t('find.closeTitle'),
					// The visible glyph is "✕", which a screen reader may read as
					// "multiplication sign" or skip.
					'aria-label': t('find.close'),
					onClick: props.onClose,
					},
					'✕',
					),
					);
}


		/**
		 * 单条规则的属性面板：选择器改名、命中数/框选开关、已有声明的编辑、添加属性、插入模板。
		 *
		 * 纯展示但不纯：它只读上面这几个值和回调，所有写入都经 `setProperty` / `renameRule` /
		 * `insertTemplate` 回到行组件，由行组件统一走 `onEdit`。抽出来的理由和 FindBar 一样 ——
		 * 它是行组件里剩下最长的一段 JSX（约 200 行），只和「打开的那条规则」有关。不调 hook。
		 * @param props - 见下面的解构；`openRule` 非空才调用它。
		 * @returns the panel element.
		 */
		function RulePanel(props) {
			const {
				openRule,
				declarations,
				selectorDraft,
				setSelectorDraft,
				highlight,
				highlightSelector,
				highlightCount,
				highlightOn,
				setHighlightOn,
				setProperty,
				applyPreset,
				presetNote,
				previewCompare,
				setPreviewCompare,
				previewDirty,
				previewList,
				setPreviewList,
				previewIndex,
				setPreviewIndex,
				previewMatches,
				previewMatchCount,
				previewChips,
				toggleChip,
				previewExcluded,
				excludeText,
				previewFindings,
				previewFull,
				setPreviewFull,
				fullDialogRef,
				renameRule,
				insertTemplate,
				setOpenIndex,
			} = props;
			/**
			 * 面板正文：预设 → 声明 → 添加属性 → 模板。
			 *
			 * 抽成函数是因为**全屏视图要的是同一份正文**（docs/naming.md E 节：全屏规则面板就是同一个
			 * 组件，不是副本）。复制一遍 JSX 会让「在那边改一条属性，左右两块一起动」变成两份要同步维护的
			 * 代码 —— 而它们迟早会不同步。
			 * @returns the body nodes.
			 */
			const renderBody = () => [
				// 效果预设：一排按钮，写的是**这一条规则**的一组声明。摆在声明区上方 ——
				// 预设是「先挑一种材质」，再在下面微调具体值。
				React.createElement('p', { className: 'dshCc_panelSection' }, t('panel.presets')),
				React.createElement(
					'div',
					{ className: 'dshCc_tplGrid' },
					...PRESETS.map(preset => React.createElement(
						'button',
						{
							key: preset.id,
							type: 'button',
							className: 'dshCc_tpl',
							title: t('preset.hintTitle', { preset: content(preset.label) }),
							onClick: () => {
								applyPreset(preset);
							},
						},
						content(preset.label),
						React.createElement('span', { className: 'dshCc_tplHint' }, content(preset.hint)),
					)),
				),
				presetNote === ''
					? null
					: React.createElement('p', { className: 'dshCc_versionsNote' }, presetNote),
				React.createElement(
					'div',
					{ className: 'dshCc_propGrid' },
				...(declarations === null || declarations.size === 0
					? [React.createElement('p', { key: 'empty', className: 'dshCc_empty' }, t('panel.empty'))]
					: Array.from(declarations).map(([declared, current]) => {
						const entry = PROPERTY_UI.find(item => item.name === declared);
						const label = entry === undefined ? declared : content(entry.label);
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
											React.createElement('span', { className: 'dshCc_partName' }, content(part.label)),
											React.createElement(PropValueInput, {
												// What a single part is checked against: the shorthand
												// itself. `margin: 8px` is legal and `margin: 8` is not, and
												// the engine's judgement of the whole is the same as its
												// judgement of the part here.
												property: declared,
												'aria-label': label + ' · ' + content(part.label),
												title: label + ' · ' + content(part.label),
												// The field name is the label above it; the placeholder stays a value hint.
												placeholder: part.hint,
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
								React.createElement(PropValueInput, {
									property: declared,
									'aria-label': label,
									placeholder: entry?.hint ?? '',
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
							React.createElement('span', { className: 'dshCc_propLabel', title: declared }, content(entry.label)),
							React.createElement(Dropdown, {
								items: [
									// A value typed by hand (or laid down by a template) stays visible
									// instead of being dropped by the menu.
									...(known === undefined ? [{ value: current, label: current, selected: true }] : []),
									...entry.values.map(pair => ({
										value: pair[0],
										label: content(pair[1]),
										selected: pair[0] === current,
									})),
									{ value: '', label: t('panel.removeOption'), selected: false },
								],
								display: known === undefined ? current : content(known[1]),
								ariaLabel: content(entry.label),
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
						{ value: '', label: t('panel.addProp'), selected: true },
						...PROPERTY_GROUPS.flatMap(group => PROPERTY_UI
							.filter(entry => entry.group === group
								&& !(declarations?.has(entry.name) ?? false))
							.map(entry => ({
								value: entry.name,
								label: content(entry.label) + (activeLocaleTag === 'en' ? ' (' : '（') + entry.name + (activeLocaleTag === 'en' ? ')' : '）'),
								group: content(group),
							}))),
					],
					display: t('panel.addProp'),
					ariaLabel: t('panel.addPropAria'),
					wrapperClassName: 'dshCc_addPropWrap',
					onPick: (picked) => {
						const entry = PROPERTY_UI.find(item => item.name === picked);
						if (entry !== undefined) setProperty(entry.name, initialValue(entry));
					},
				}),
				React.createElement('p', { className: 'dshCc_panelSection' }, t('panel.templates')),
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
						content(template.label),
						React.createElement('span', { className: 'dshCc_tplHint' }, content(template.hint)),
					)),
				),
			];

			return React.createElement(
				'div',
				{ className: 'dshCc_panel' },
				React.createElement(
					'div',
					{ className: 'dshCc_panelField' },
					React.createElement('input', {
						className: 'dshCc_panelName',
						'aria-label': t('panel.selector'),
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
							className: 'dshCc_hlToggle',
							// Disabled for BOTH nothing-to-show cases, which are different
							// problems with different explanations — see the title below.
							disabled: highlight.invalid === true || highlight.pseudo === true || highlightCount === 0,
							'aria-pressed': highlightOn,
							title: highlight.invalid === true
								? t('panel.notSelector', { text: highlightSelector.trim().slice(0, 24) })
								: (highlight.pseudo === true
									? t('panel.pseudo')
									: (highlightCount === 0
										? t('panel.noMatch')
										: (highlightOn ? t('panel.offHint') : t('panel.onHint', { count: highlightCount })))),
							onClick: () => {
								setHighlightOn(!highlightOn);
							},
						},
						// The glyph, then the count. The count is the part that answers the
						// question people actually have at this field — "did I write this
						// selector right" — so it is never hidden behind the tooltip.
						React.createElement(CrosshairIcon, {}),
						highlight.invalid === true
							? t('panel.labelInvalid')
							: (highlight.pseudo === true
								? t('panel.labelPseudo')
								: (highlightCount === 0 ? t('panel.labelNone') : t('panel.labelCount', { count: highlightCount }))),
					),
					React.createElement(
						'button',
						{
							type: 'button',
							className: 'dshCc_panelClose',
							'aria-label': t('panel.close'),
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
				// 预览块：只在打开某条规则时出现（与面板同进同退），位置在声明区上方。
				// 左右两块只在对比模式下同时出现；样本由行里的 effect 填（见 paintPreview）。
				React.createElement(
					'div',
					{ className: 'dshCc_preview' },
					React.createElement(
						'div',
						{ className: 'dshCc_previewHead' },
						React.createElement('code', { className: 'dshCc_previewRule', title: openRule?.selector ?? '' }, openRule?.selector ?? ''),
						React.createElement(
							'div',
							{ className: 'dshCc_previewTools' },
							React.createElement('button', {
								type: 'button',
								className: 'dshCc_hlToggle',
								// 全屏：原生 dialog + showModal（见行里的 effect）。Esc / × 都能退出。
								'aria-label': t('preview.full'),
								title: t('preview.fullTitle'),
								onClick: () => { setPreviewFull(true); },
							}, t('preview.full')),
							React.createElement('button', {
								type: 'button',
								className: 'dshCc_hlToggle',
								'aria-pressed': previewCompare,
								'aria-label': t('preview.compare'),
								title: t('preview.compareTitle'),
								onClick: () => { setPreviewCompare(!previewCompare); },
							}, t('preview.compare')),
							React.createElement('button', {
								type: 'button',
								className: 'dshCc_hlToggle',
								// 列表 = 卡片导航：一排卡片，一张对应一个命中元素，点哪张就预览哪个。
								'aria-pressed': previewList,
								'aria-label': t('preview.list'),
								title: t('preview.listTitle'),
								onClick: () => { setPreviewList(!previewList); },
							}, t('preview.list')),
						),
					),
					previewList
						? React.createElement(
							'div',
							{ className: 'dshCc_sampleCards' },
							...previewMatches.map((entry, position) => React.createElement(
								'button',
								{
									key: position,
									type: 'button',
									className: 'dshCc_hlToggle',
									'aria-pressed': position === previewIndex,
									title: entry.selector,
									onClick: () => { setPreviewIndex(position); },
								},
								entry.label,
							)),
						)
						: null,
					// 状态芯片：三个「能强制」的（在真页面上改选择器 + 加类）加两个伪元素（只在样本里合成）。
					// 只在单屏模式出现 —— 对比/全屏下左边那块也会被强制态污染，比出来的东西就没有意义了。
					previewCompare || previewFull
						? null
						: React.createElement(
							'div',
							{ className: 'dshCc_stateChips' },
							...PREVIEW_STATES.map(state => React.createElement('button', {
								key: state.id,
								type: 'button',
								className: 'dshCc_hlToggle',
								'aria-pressed': previewChips.includes(state.id),
								'aria-label': t(state.labelKey),
								title: t('preview.chipsTitle'),
								onClick: () => { toggleChip(state.id); },
							}, t(state.labelKey))),
							...['before', 'after'].map(id => React.createElement('button', {
								key: id,
								type: 'button',
								className: 'dshCc_hlToggle',
								'aria-pressed': previewChips.includes(id),
								'aria-label': '::' + id,
								title: t('preview.pseudoTitle'),
								onClick: () => { toggleChip(id); },
							}, '::' + id)),
						),
					// 「演示中」：强制态是**真的改了页面**，必须让人看见这一点。
					previewChips.some(id => PREVIEW_STATES.some(state => state.id === id))
						? React.createElement('span', { className: 'dshCc_previewDemo' }, t('preview.demoing'))
						: null,
					React.createElement(
						'div',
						{ className: 'dshCc_previewStage' },
						previewCompare
							? React.createElement(
								'div',
								{ className: 'dshCc_previewBox dshCc_previewBoxCurrent' },
								React.createElement('span', { className: 'dshCc_previewLabel' }, t('preview.current')),
								previewDirty === true
									? React.createElement('div', { className: 'dshCc_previewCurrent', 'data-dshcc-owned': '' })
									: React.createElement('span', { className: 'dshCc_previewSame' }, t('preview.same')),
							)
							: null,
						React.createElement(
							'div',
							{ className: 'dshCc_previewBox dshCc_previewBoxModified' },
							React.createElement('span', { className: 'dshCc_previewLabel' }, t('preview.modified')),
							React.createElement('div', { className: 'dshCc_previewAfter', 'data-dshcc-owned': '' }),
						),
					),
					previewFindings.length === 0 ? null : React.createElement('p', {
						className: 'dshCc_previewDemo',
						role: 'status',
					}, previewFindings.map(finding => t('diag.' + finding.id)).join(' · ')),
					previewExcluded === true
						? React.createElement('p', { className: 'dshCc_previewDemo' }, t('preview.excluded', { list: excludeText }))
						: null,
					React.createElement('p', { className: 'dshCc_previewNote' }, t('preview.note')),
				),
				...renderBody(),
				// 全屏视图：原生 dialog（showModal 进 top layer），两块并排 + 同一份面板正文。
				previewFull
					? React.createElement(
						'dialog',
						{
							className: 'dshCc_full',
							ref: fullDialogRef,
							'aria-label': t('preview.fullAria'),
							onCancel: (event) => {
								event?.preventDefault?.();
								setPreviewFull(false);
								clearPreviewForcing();
							},
						},
						React.createElement(
							'div',
							{ className: 'dshCc_fullHead' },
							React.createElement('code', { className: 'dshCc_previewRule', title: openRule?.selector ?? '' }, openRule?.selector ?? ''),
							// 全屏里看不到行内的「N 个命中」与卡片序号，这两条上下文在这里补回来：
							// 不知道在预览第几个元素，是这块界面上最容易迷路的地方。
							React.createElement('span', { className: 'dshCc_fullMeta' }, t('preview.meta', {
								count: previewMatchCount,
								index: previewMatchCount > 0 ? previewIndex + 1 : 0,
							})),
							// 全屏里没有卡片导航，所以给一对 prev/next（只在一个以上命中时出现）。
							previewMatchCount > 1
								? React.createElement(
									'div',
									{ className: 'dshCc_fullKeys' },
									React.createElement('button', {
										type: 'button',
										className: 'dshCc_fullNav',
										'aria-label': t('preview.prev'),
										title: t('preview.prev'),
										onClick: () => { setPreviewIndex((previewIndex - 1 + previewMatchCount) % previewMatchCount); },
									}, '‹'),
									React.createElement('button', {
										type: 'button',
										className: 'dshCc_fullNav',
										'aria-label': t('preview.next'),
										title: t('preview.next'),
										onClick: () => { setPreviewIndex((previewIndex + 1) % previewMatchCount); },
									}, '›'),
								)
								: null,
							React.createElement('span', { className: 'dshCc_fullEsc' }, t('preview.esc')),
							React.createElement('button', {
								type: 'button',
								className: 'dshCc_panelClose',
								'aria-label': t('preview.fullClose'),
								title: t('preview.fullClose'),
								onClick: () => {
									setPreviewFull(false);
									clearPreviewForcing();
								},
							}, '×'),
						),
						React.createElement(
							'div',
							{ className: 'dshCc_previewStage dshCc_fullStage' },
							React.createElement(
								'div',
								{ className: 'dshCc_previewBox dshCc_previewBoxCurrent' },
								React.createElement('span', { className: 'dshCc_previewLabel' }, t('preview.current')),
								previewDirty === true
									? React.createElement('div', { className: 'dshCc_previewCurrent', 'data-dshcc-owned': '' })
									: React.createElement('span', { className: 'dshCc_previewSame' }, t('preview.same')),
							),
							React.createElement(
								'div',
								{ className: 'dshCc_previewBox dshCc_previewBoxModified' },
								React.createElement('span', { className: 'dshCc_previewLabel' }, t('preview.modified')),
								React.createElement('div', { className: 'dshCc_previewAfter', 'data-dshcc-owned': '' }),
							),
						),
						React.createElement('div', { className: 'dshCc_fullBody' }, ...renderBody()),
					)
					: null,
			);
		}


		function CustomCssRow() {
			const state = React.useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
			// The row follows the editor preferences, so a change in the settings section is visible
			// here without a reload: `ref` into the store the settings section writes.
			const prefs = React.useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.snapshot);
			const [creating, setCreating] = React.useState(false);
			const [draftName, setDraftName] = React.useState('');
			const [saved, setSaved] = React.useState(true);
			const [pickerOpen, setPickerOpen] = React.useState(false);
			/**
			 * Whether the open rule's matches are outlined on the page.
			 *
			 * Stays on after the panel closes on purpose: the point of the feature is to look
			 * at the page, and the panel sits on top of the thing being looked at. It is
			 * cleared when the row itself goes away, so a closed settings dialog never leaves
			 * boxes behind with nothing on screen to explain them.
			 */
			const [highlightOn, setHighlightOn] = React.useState(false);
			const [suggest, setSuggest] = React.useState(null);
			/** What the document said about this sheet: per-rule match counts and `var()` problems. */
			const [inspection, setInspection] = React.useState({ counts: [], variables: [] });
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
			/**
			 * Which page of the actions menu is showing: the actions, or the versions of the
			 * active sheet.
			 *
			 * In-menu rather than a second popover: the list is reached from the actions menu
			 * and belongs to it, and a nested floating layer would need its own outside-click
			 * handling and its own placement, both of which the menu already has.
			 */
			const [actionsPage, setActionsPage] = React.useState('actions');
			/** The active sheet's snapshots, newest first, as the Host reports them. */
			const [versions, setVersions] = React.useState([]);
			const [versionsBusy, setVersionsBusy] = React.useState(false);
			/** Why the versions list is not showing what was asked for. */
			const [versionsNote, setVersionsNote] = React.useState('');
			/** 预设写入后那一行说明（拒绝或提醒时才非空）。 */
			const [presetNote, setPresetNote] = React.useState('');
			/** 预览块：单屏 / 对比。 */
			const [previewCompare, setPreviewCompare] = React.useState(false);
			/** 预览块：卡片导航是否展开，以及看第几个命中元素。 */
			const [previewList, setPreviewList] = React.useState(false);
			const [previewIndex, setPreviewIndex] = React.useState(0);
			/** 预览块：勾选的状态芯片（hover / focus / placeholder / before / after）。 */
			const [previewChips, setPreviewChips] = React.useState([]);
			/** 预览块：全屏视图是否打开。 */
			const [previewFull, setPreviewFull] = React.useState(false);
			/** 全屏视图那个 dialog 的引用（showModal / close 得直接调）。 */
			const fullDialogRef = React.useRef(null);
			/** 令牌页的搜索词（只在这一页用，切页时保留）。 */
			const [tokenQuery, setTokenQuery] = React.useState('');
			/**
			 * Whether the current note reports a failure.
			 *
			 * Kept as its own flag: it used to be derived from the note's text
			 * (`startsWith('已恢复')`), which stops working the moment the copy is translated — in
			 * English every note would then be coloured as an error.
			 */
			const [versionsNoteBad, setVersionsNoteBad] = React.useState(false);
			/** The draft in the rename field, and whether that field is showing. */
			const [renameDraft, setRenameDraft] = React.useState('');
			/**
			 * Deleting is the one action here that cannot be undone by typing the text back, so it is
			 * confirmed in the menu itself: the first click turns the entry into the question, and only
			 * a second one deletes. Same reasoning as the versions page being inside this menu — a
			 * second floating layer would need its own outside-click handling and its own placement.
			 */
			const [confirmDelete, setConfirmDelete] = React.useState(false);
			/**
			 * The find bar. `open` is its own flag rather than "the query is not empty",
			 * because a bar the user opened and has not typed into yet is still open.
			 */
			const [searchOpen, setSearchOpen] = React.useState(false);
			const [searchQuery, setSearchQuery] = React.useState('');
			const [searchReplacement, setSearchReplacement] = React.useState('');
			const [searchCase, setSearchCase] = React.useState(false);
			const [searchIndex, setSearchIndex] = React.useState(0);
			/** 每次「跳到某个命中」加一：只为了让放光标的那个 effect 每次都跑。 */
			const [searchTick, setSearchTick] = React.useState(0);
			const searchRef = React.useRef(null);
			const rowRef = React.useRef(null);

			// A draft belongs to the rule it was typed in: moving the panel to another
			// rule must not show that rule the previous one's half-typed selector.
			React.useEffect(() => {
				setSelectorDraft(null);
			}, [openIndex]);

			// The find field takes the caret the moment the bar appears — opened from the
			// toolbar or by Ctrl+F, the next thing typed is the query either way.
			React.useEffect(() => {
				if (!searchOpen) return;
				searchRef.current?.focus();
				searchRef.current?.select?.();
			}, [searchOpen]);

			// A rule a pick appended is opened once the sheet actually contains it: the write
			// goes through the debounced store, so the index cannot be known here. The picker
			// runs at module scope, so a rule it left behind is remembered there and opened
			// here as soon as this row is on screen.
			//
			// `openRequest` is part of the deps because a pick that REUSES a rule changes no
			// text: with only `state.css` to go on, this effect never re-ran for it and the
			// handoff sat pending until some later, unrelated edit consumed it (see the field).
			React.useEffect(() => {
				if (pendingOpenSelector === null) return;
				const index = findRuleIndex(parseRules(store.snapshot().css), pendingOpenSelector);
				if (index < 0) return;
				pendingOpenSelector = null;
				setOpenIndex(index);
				// The picker picked this rule out; put the caret where the rule was written
				// so the panel is open and the editor is ready for typing.
				if (pendingOpenCaret !== null) {
					pendingCaret.current = pendingOpenCaret;
					pendingOpenCaret = null;
				}
			}, [state.css, state.openRequest]);
			const fileInput = React.useRef(null);
			const pickerRef = React.useRef(null);
			const actionsRef = React.useRef(null);
			/** The actions menu itself, so the outside-click test can tell the menu from the page. */
			const menuRef = React.useRef(null);
			const editorRef = React.useRef(null);
			const gutterRef = React.useRef(null);
			const gutterInnerRef = React.useRef(null);
			const highlightRef = React.useRef(null);
			const pendingSave = React.useRef(null);
			const pendingCaret = React.useRef(null);
			/** 下一次放置光标时是否把焦点也交给编辑器（搜索时不能抢 —— 抢了输入框就丢焦点）。 */
			const pendingFocus = React.useRef(true);
			/** Set while a history entry is being re-applied, so it is not recorded again. */
			const restoring = React.useRef(false);
			/**
			 * Whether the editor holds an edit that has not landed on disk yet.
			 *
			 * This is the one thing that separates "take the disk copy" from "ask which copy to
			 * keep", so it is an explicit flag rather than a comparison: the debounce means the
			 * editor is routinely ahead of the file, and a comparison against `sheetOnDisk` would
			 * call that state "different" and either prompt or clobber on every keystroke.
			 */
			const dirty = React.useRef(false);
			const saveTimer = React.useRef(0);
			/** Bumped on every edit; a finishing write only reports for its own epoch. */
			const saveEpoch = React.useRef(0);
			const fileMode = state.mode === 'files';
			const lineCount = state.css.split('\n').length;
			const activeEnabled = state.active === null ? true : !state.disabled.includes(state.active);
			/** The hits for the find bar, recomputed from the sheet on every render. */
			const hits = searchOpen ? searchHits(state.css, searchQuery, searchCase) : [];
			/** Which hit the bar is pointing at: always a valid index while there are hits. */
			const activeHit = hits.length === 0 ? -1 : Math.min(searchIndex, hits.length - 1);
			const activeRange = activeHit < 0 ? null : hits[activeHit];

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
						store.set({ error: t('error.toggle', { message }) });
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
				const ok = await writeSheet(pending.name, pending.css);
				// The editor is only clean once its text is actually on disk: an external-change
				// check running while a write is in flight must not adopt over it.
				if (ok) dirty.current = false;
				return ok;
			};

			// Persist after a pause. The unmount path flushes rather than dropping the
			// pending write: closing the settings panel must not lose an edit.
			React.useEffect(() => () => {
				clearTimeout(saveTimer.current);
				void flushSave();
			}, []);

			// The picker writes through immediately; let it take this row's pending
			// debounced write out of the way, and let it report back when its own write has
			// landed. Both halves are needed: the debounce it took over was the only thing
			// that would have cleared the footer, so a silent take-over parked it on
			// "保存中" for good (see externalWrite).
			React.useEffect(() => {
				const handoff = {
					takeOver() {
						clearTimeout(saveTimer.current);
						pendingSave.current = null;
						// The write this row was waiting on is gone, so its promise must not
						// speak for the sheet either: it would otherwise announce "已保存"
						// while the picker's own write is still in flight.
						saveEpoch.current += 1;
					},
					settled(ok) {
						// Only the install that handed this over may report: a response
						// landing after the row unmounted has no footer left to talk to.
						if (externalWrite !== handoff) return;
						if (ok === true) {
							dirty.current = false;
							setSaved(true);
						}
					},
				};
				externalWrite = handoff;
				return () => {
					if (externalWrite === handoff) externalWrite = null;
				};
			}, []);

			const persist = (css) => {
				const current = store.snapshot();
				if (current.mode !== 'files' || current.active === null) {
					clearTimeout(saveTimer.current);
					writeLegacyCss(css);
					dirty.current = false;
					setSaved(true);
					return;
				}
				// The target sheet is captured together with the text: the debounce
				// can outlive a sheet switch, and the text belongs where it was typed.
				pendingSave.current = { name: current.active, css };
				clearTimeout(saveTimer.current);
				setSaved(false);
				dirty.current = true;
				saveEpoch.current += 1;
				const epoch = saveEpoch.current;
				saveTimer.current = setTimeout(() => {
					void flushSave().then((ok) => {
						// Two ways the indicator could lie: a write landing after a newer
						// edit (epoch), and a write that failed outright (ok) — which used
						// to print "已保存" right next to its own error notice.
						if (ok && epoch === saveEpoch.current) setSaved(true);
					});
				}, saveDelayMs());
			};

			// The inspection reads the document, so it waits for a pause rather than running per
			// keystroke, and it only runs for a sheet that parses: syntax first, then the quieter
			// questions (see `inspectSheet`).
			React.useEffect(() => {
				if (state.mode !== 'files' || state.css.trim() === '') {
					setInspection({ counts: [], variables: [] });
					return undefined;
				}
				// The setting is read here, at the start of each pass, so switching it takes effect on
				// the next edit rather than on the next page load.
				const mode = validationMode();
				if (mode === 'off') {
					setInspection({ counts: [], variables: [] });
					return undefined;
				}
				const timer = setTimeout(() => {
					const problems = mode === 'syntax' ? [] : validateCss(state.css);
					setInspection(problems.length > 0
						? { counts: [], variables: [] }
						: inspectSheet(state.css, document));
				}, VAR_CHECK_DELAY_MS);
				return () => {
					clearTimeout(timer);
				};
			}, [state.css, state.active, state.mode]);

			/**
			 * The sheet's rules as outline entries, each with what the document said about it.
			 *
			 * The count is the point of the outline as much as the jumping is: a selector that
			 * hits nothing is a rule that does nothing, and on a long sheet those pile up
			 * silently (a structural path that survived one redesign and not the next).
			 * @param rules - records from `parseRules`.
			 * @returns dropdown items, in sheet order.
			 */
			const outlineItems = (rules) => rules.map((rule, index) => {
				const count = inspection.counts[index];
				const note = count === undefined
					? ''
					: (count === null ? t('panel.invalid') : (count === 0 ? t('panel.zeroHits') : t('panel.hitCount', { count })));
				return { value: String(index), label: rule.selector + note };
			});

			/**
			 * Put the editor on one rule: open its panel, park the caret on its selector and
			 * let the caret effect bring that line into view.
			 * @param index - the rule's index in the sheet.
			 */
			const jumpToRule = (index) => {
				const rule = parseRules(state.css)[index];
				if (rule === undefined) return;
				setOpenIndex(index);
				setSuggest(null);
				pendingCaret.current = rule.selectorStart;
			};

			/**
			 * Look for an outside edit to the active sheet, and act on it.
			 *
			 * This is what makes saving in a text editor show up here, and it runs on a timer while
			 * the page is on screen (see the effect below) rather than only when the user does
			 * something: 「打开文件 → 改 → 保存」 has no other moment to be noticed. The whole policy
			 * is `externalChange`:
			 *
			 * - the editor is CLEAN → take the disk copy, silently. Nothing can be lost because
			 *   there is nothing to lose, and the alternative is the user staring at a file that is
			 *   three saves behind.
			 * - the editor has unsaved work → raise the conflict, and never overwrite: the footer
			 *   asks which copy to keep, exactly as it does when a write is refused.
			 *
			 * A failed check is not worth a notice of its own: the write path checks again.
			 * @param options - `{ adopt }`: true to install a new disk copy when the editor is
			 *   clean. The timer passes true; the visibility check passes false, because a tab
			 *   coming back into view must not silently rewrite what the user was reading.
			 */
			const checkForOutsideEdit = async (options = {}) => {
				const current = store.snapshot();
				if (current.mode !== 'files' || current.active === null || current.conflict !== null) return;
				try {
					const answer = await checkSheet(current.active, { dirty: dirty.current });
					if (answer.verdict === 'conflict') {
						store.set({ conflict: { name: current.active, disk: answer.css } });
						return;
					}
					if (answer.verdict !== 'adopt' || options.adopt !== true) return;
					// The read is one round trip behind the store: if the sheet changed (or the row
					// moved on) while it was in flight, this copy is not the one to install.
					if (store.snapshot().active !== current.active) return;
					sheetOnDisk.set(current.active, answer.rev);
					store.set({ css: answer.css, error: '' });
					applySheet(current.active, answer.css, store.snapshot().disabled);
					// The undo stack and the rule panel both point INTO the text that was just
					// replaced: stepping back into text that is no longer there, or editing a rule
					// index that moved, is worse than losing the stack.
					resetHistory(current.active);
					setInspection({ counts: [], variables: [] });
					setSuggest(null);
					// The panel points at a rule INDEX, and the sheet underneath it just changed:
					// closing it is the honest move.
					setOpenIndex(null);
					setSaved(true);
				}
				catch {
					// The next tick tries again.
				}
			};

			// Look for an outside edit on a timer, and when the page comes back into view.
			//
			// A timer rather than a push from the Host: the Host's watcher (`watchSheets`) is a
			// doorbell nobody can ring without keeping a socket open, and a 1.5s poll of one small
			// JSON answer is the cheapest thing that makes 「保存后在插件里看到」 true without a
			// protocol. It only runs while the page is visible — a background tab has nothing to
			// show — and only in files mode with a sheet loaded.
			//
			// The two callers differ on ONE thing: the timer may adopt a new disk copy, the
			// visibility check may not. A tab that comes back into view is being read by someone
			// who may be mid-sentence in the editor, and rewriting the field under their cursor
			// because a file changed while they were away is the kind of surprise this whole
			// feature exists to avoid; the timer's case (a clean editor, a file that changed
			// while they were looking at it) has nothing to lose.
			React.useEffect(() => {
				if (typeof document.addEventListener !== 'function') return undefined;
				const onVisible = () => {
					if (document.visibilityState === 'hidden') return;
					void checkForOutsideEdit();
				};
				document.addEventListener('visibilitychange', onVisible);
				const timer = setInterval(() => {
					if (document.visibilityState === 'hidden') return;
					void checkForOutsideEdit({ adopt: true });
				}, WATCH_POLL_MS);
				return () => {
					document.removeEventListener('visibilitychange', onVisible);
					clearInterval(timer);
				};
			}, []);

			/**
			 * Take the disk copy: the other editor's text becomes the sheet here.
			 *
			 * The revision is re-read rather than assumed: the baseline has to be the file the
			 * text actually came from, or the very next write would be refused by a check that
			 * thinks the ground has moved.
			 */
			const takeDiskCopy = async () => {
				const conflict = store.snapshot().conflict;
				if (conflict === null) return;
				try {
					const sheet = await readSheet(conflict.name);
					sheetOnDisk.set(conflict.name, sheet.rev);
					store.set({ conflict: null, error: '', css: sheet.css });
					applySheet(conflict.name, sheet.css, store.snapshot().disabled);
				}
				catch (error) {
					store.set({ error: t('error.read', { message: error?.message ?? error }) });
					return;
				}
				// The text underneath the undo stack and the open rule panel is gone.
				resetHistory(conflict.name);
				setOpenIndex(null);
				dirty.current = false;
				setSaved(true);
				setSuggest(null);
			};

			/**
			 * Keep this editor's text, deliberately overwriting what is on disk.
			 *
			 * The disk revision is adopted as the baseline first — that is what the write is about
			 * to replace — so the confirmation cannot trip over the very change it is confirming.
			 */
			const keepMine = async () => {
				const conflict = store.snapshot().conflict;
				if (conflict === null) return;
				const answer = await checkSheet(conflict.name, { dirty: true }).catch(() => null);
				if (answer !== null) sheetOnDisk.set(conflict.name, answer.rev);
				store.set({ conflict: null });
				const ok = await writeSheet(conflict.name, store.snapshot().css);
				if (ok) {
					dirty.current = false;
					setSaved(true);
				}
			};

			/**
			 * Open the versions page of the actions menu and load the list it shows.
			 *
			 * The sheet is named once, here: an await separates the click from the load, and the
			 * user may well switch sheets while it is in flight — so the reply is dropped unless
			 * the same sheet is still active when it arrives, rather than being shown under the
			 * new sheet's name.
			 */
			const openVersions = () => {
				setActionsPage('versions');
				const name = store.snapshot().active;
				if (name === null) return;
				void loadVersions(name);
			};

			/**
			 * Fetch one sheet's versions.
			 *
			 * Nothing here clears the note: a restore reports its outcome in that line, and the
			 * reload it triggers would wipe the message before it could be read. The note is
			 * cleared where the page is entered and where a new action starts.
			 * @param name - the sheet to list.
			 */
			const loadVersions = async (name) => {
				setVersionsBusy(true);
				try {
					const payload = await api('/history?name=' + encodeURIComponent(name));
					if (store.snapshot().active !== name) return;
					setVersions(Array.isArray(payload.entries) ? payload.entries : []);
				}
				catch (error) {
					if (store.snapshot().active !== name) return;
					setVersions([]);
					setVersionsNote(t('error.history', { message: error?.message ?? error }));
					setVersionsNoteBad(true);
				}
				finally {
					setVersionsBusy(false);
				}
			};

			/**
			 * Put one snapshot back into the editor and onto disk.
			 *
			 * The Host writes it — the same bytes the write path would produce — and this side
			 * re-reads the sheet instead of assuming the text: a restore is a write like any
			 * other, and the editor should show what is actually there.
			 * @param stamp - the snapshot to restore.
			 */
			const restoreVersion = async (stamp) => {
				const name = store.snapshot().active;
				if (name === null || versionsBusy) return;
				setVersionsBusy(true);
				setVersionsNote('');
				try {
					await post('/restore', { name, stamp });
					const sheet = await readSheet(name);
					if (store.snapshot().active === name) {
						store.set({ css: sheet.css, conflict: null, error: '' });
						applySheet(name, sheet.css, store.snapshot().disabled);
						// The undo stack belongs to the text that was just replaced: leaving it in
						// place would let Ctrl+Z undo straight back onto the version the user
						// deliberately left.
						resetHistory(name);
						setOpenIndex(null);
						dirty.current = false;
						editorRef.current?.focus();
						setSaved(true);
						setSuggest(null);
						setVersionsNote(t('versions.restored', { at: formatStamp(stamp) }));
					setVersionsNoteBad(false);
					}
					await loadVersions(name);
				}
				catch (error) {
					setVersionsNote(t('versions.restoreFailed', { message: error?.message ?? error }));
					setVersionsNoteBad(true);
				}
				finally {
					setVersionsBusy(false);
				}
			};

			/**
			 * Apply an edit and remember where it came from.
			 *
			 * `typing` distinguishes a keystroke (which joins the burst in progress) from a
			 * structural change — a panel edit, a picked rule — which is always its own undo
			 * step. `restoring` marks the re-application of a history entry, so stepping
			 * through the history does not record itself.
			 * @param css - the new sheet text.
			 * @param options - `typing: true` for a keystroke.
			 */
			const onEdit = (css, options = {}) => {
				if (restoring.current !== true && state.active !== null && css !== state.css) {
					rememberEdit(
						state.active,
						{ css: state.css, caret: editorRef.current?.selectionStart ?? null },
						options.typing === true,
					);
				}
				store.set({ css });
				applySheet(state.active, css, state.disabled);
				persist(css);
			};

			/**
			 * Walk one step through the undo history.
			 * @param direction - `undo` or `redo`.
			 */
			const stepEditorHistory = (direction) => {
				if (state.active === null) return;
				const step = stepHistory(direction, state.active, {
					css: state.css,
					caret: editorRef.current?.selectionStart ?? null,
				});
				if (step === null) return;
				restoring.current = true;
				onEdit(step.css);
				restoring.current = false;
				if (step.caret !== null) pendingCaret.current = step.caret;
				setSuggest(null);
			};

			/**
			 * Two spaces in, two out — what Tab does in an editor. Only reached when no
			 * completion list is open, where Tab accepts the suggestion instead.
			 * @param outdent - true for Shift+Tab.
			 */
			const indentAtCaret = (outdent) => {
				const editor = editorRef.current;
				if (editor === null) return;
				const width = tabWidth();
				const text = state.css;
				const caret = editor.selectionStart ?? 0;
				const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
				if (outdent) {
					// One PRESS removes one press's worth, whatever the width is; the old `{1,2}` only
					// ever worked because two was the only value the editor could have.
					const removed = new RegExp('^ {1,' + width + '}').exec(text.slice(lineStart))?.[0].length ?? 0;
					if (removed === 0) return;
					onEdit(text.slice(0, lineStart) + text.slice(lineStart + removed));
					pendingCaret.current = Math.max(lineStart, caret - removed);
					return;
				}
				const spaces = ' '.repeat(width);
				onEdit(text.slice(0, caret) + spaces + text.slice(caret));
				pendingCaret.current = caret + spaces.length;
			};

			/**
			 * Open the find bar, taking the editor's own selection as the query.
			 *
			 * `Ctrl+F` after selecting `border-radius` should search for it, not for whatever
			 * was searched last — that is what the shortcut means in every editor. A
			 * single-line selection only: a multi-line one is never a search string.
			 *
			 * The caret moves to the hit the bar lands on, which is the first one at or after
			 * it: opening the bar in the middle of a sheet should show the hit that is right
			 * there, not the top of the file, and it makes Enter mean "the next one".
			 */
			const openSearch = () => {
				const editor = editorRef.current;
				const start = editor?.selectionStart ?? 0;
				const end = editor?.selectionEnd ?? start;
				const picked = end > start ? state.css.slice(start, end) : '';
				const query = picked !== '' && !picked.includes('\n') ? picked : searchQuery;
				if (query !== searchQuery) setSearchQuery(query);
				setSearchOpen(true);
				const found = searchHits(state.css, query, searchCase);
				const at = hitAtOrAfter(found, start);
				setSearchIndex(Math.max(0, at));
				if (at >= 0) pendingCaret.current = found[at].start;
			};

			/** Close the find bar and hand the caret back to the editor. */
			const closeSearch = () => {
				setSearchOpen(false);
				setSearchIndex(0);
				editorRef.current?.focus();
			};

			/**
			 * Put the caret on one hit and bring it into view.
			 * @param index - the hit to land on.
			 */
			const focusHit = (index) => {
				if (hits.length === 0) return;
				const at = ((index % hits.length) + hits.length) % hits.length;
				// 焦点留在查找框里：把它交给编辑器会有两个后果（都实测过）—— 下一步的 Enter 跑进
				// 编辑器（虽然也走了 stepHit，但输入框已经看不见光标），以及 Esc 再也不关查找条，
				// 用户只能点 × 退出。
				pendingFocus.current = false;
				pendingCaret.current = hits[at].start;
				setSearchIndex(at);
				// 命中数只有一条、或目标没变化时 setSearchIndex 不会触发渲染，光标就永远落不下去。
				setSearchTick(tick => tick + 1);
			};

			/** Move to the hit before or after the one the bar is pointing at. */
			const stepHit = (delta) => {
				if (hits.length === 0) return;
				if (activeHit < 0) focusHit(0);
				else focusHit(activeHit + delta);
			};

			/**
			 * Replace the hit the bar is pointing at, and move to the next one.
			 *
			 * One edit, so it is one undo step: Ctrl+Z after a replace puts that occurrence
			 * back, exactly where it was.
			 */
			const replaceCurrent = () => {
				if (activeRange === null) return;
				const next = state.css.slice(0, activeRange.start) + searchReplacement + state.css.slice(activeRange.end);
				onEdit(next);
				pendingCaret.current = activeRange.start + searchReplacement.length;
				setSearchIndex(activeHit);
			};

			/**
			 * Replace every hit at once — one edit, so it is also one undo step.
			 *
			 * The scan decides what counts as a hit; the replacement itself cannot go through
			 * `String.replaceAll`, whose needle would be a pattern where the search is plain
			 * text (`border-radius` would still work, `a.b` would not).
			 */
			const replaceAll = () => {
				if (hits.length === 0) return;
				let next = '';
				let cursor = 0;
				for (const hit of hits) {
					next += state.css.slice(cursor, hit.start) + searchReplacement;
					cursor = hit.end;
				}
				next += state.css.slice(cursor);
				onEdit(next);
				setSearchIndex(0);
			};

			/**
			 * Re-flow the whole sheet.
			 *
			 * A reformat is one edit like any other: it is undoable in one press, and it lands
			 * through the same debounced write as typing. The sheet is replaced whole, so an
			 * unparseable sheet comes back as the same text (see `formatCss`) and the only thing
			 * that changes is that the caret goes home.
			 */
			const formatSheet = () => {
				const next = formatCss(state.css);
				if (next === state.css) return;
				onEdit(next);
				pendingCaret.current = 0;
				setSuggest(null);
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
				// The `8` is the popup's own vertical padding (4px top + 4px bottom), and the `26`
				// matches `.dshCc_suggestItem`'s min-height. Both are hand-kept in step with the
				// stylesheet — the flip decision below is wrong if they drift, and wrong in the
				// quiet way: the list would open off the bottom of the editor instead of above it.
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
				onEdit(value, { typing: true });
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
				const modifier = event.ctrlKey === true || event.metaKey === true;
				const key = String(event.key ?? '').toLowerCase();
				// The editor's own shortcuts come first: the completion branch below returns
				// early when no list is open, and Ctrl+Z has to work in that state too.
				if (modifier && key === 'z') {
					event.preventDefault();
					stepEditorHistory(event.shiftKey === true ? 'redo' : 'undo');
					return;
				}
				if (modifier && key === 'y') {
					event.preventDefault();
					stepEditorHistory('redo');
					return;
				}
				if (modifier && key === 's') {
					// The debounce would land it in 400 ms anyway; this is for whoever wants to
					// watch it land — and it keeps the browser's own save dialog out of the way.
					event.preventDefault();
					void flushSave().then((ok) => {
						if (ok) setSaved(true);
					});
					return;
				}
				if (modifier && key === 'f') {
					// The browser's own find is about the rendered page, and everything in this
					// row is either a textarea or a transparent layer over it — so it has
					// nothing to find here, and the editor's own bar is what the key should mean.
					event.preventDefault();
					openSearch();
					return;
				}
				if (modifier && key === 'g') {
					event.preventDefault();
					stepHit(event.shiftKey === true ? -1 : 1);
					return;
				}
				if (suggest === null) {
					// Escape belongs to the innermost open layer: the find bar when it is up, the
					// completion list when that is up, and otherwise the panel.
					if (searchOpen && event.key === 'Escape') {
						event.preventDefault();
						event.stopPropagation();
						closeSearch();
						return;
					}
					// Enter walks the hits while the find bar is open, and a newline is what it
					// does otherwise. The two cannot share: a sheet is edited a line at a time,
					// so Enter has to keep making lines — but with the bar open, the keystroke
					// that follows typing a query must not insert a newline into the sheet.
					if (searchOpen && event.key === 'Enter') {
						event.preventDefault();
						stepHit(event.shiftKey === true ? -1 : 1);
						return;
					}
					if (event.key === 'Tab') {
						event.preventDefault();
						indentAtCaret(event.shiftKey === true);
					}
					return;
				}
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

			/**
			 * Keep the colour layer and the gutter under the textarea's own scroll offsets.
			 *
			 * Both are absolutely positioned and never scroll themselves, so they are the
			 * plugin's job — and they are why the scroll event is not the only caller: an
			 * explicit scroll (see `revealCaretLine`) would otherwise leave one frame — or, if
			 * the event never arrives, for good — with the caret somewhere the text is not.
			 * @param scrollLeft - the textarea's horizontal offset.
			 * @param scrollTop - the textarea's vertical offset.
			 */
			const syncEditorLayers = (scrollLeft, scrollTop) => {
				if (gutterInnerRef.current !== null) {
					gutterInnerRef.current.style.transform = 'translateY(' + (-scrollTop) + 'px)';
				}
				if (highlightRef.current !== null) {
					highlightRef.current.style.transform = 'translate('
						+ (-scrollLeft) + 'px,' + (-scrollTop) + 'px)';
				}
			};

			// Restore the caret after a completion replaced the word under it, or after the
			// picker put a rule in the sheet. Three things beyond naming the offset are needed,
			// and the last two were missing: the text has to be there first (the row can return
			// from the picker before its sheet has been read, and a caret placed into an empty
			// textarea clamps to 0 without moving anything), the caret's line has to be brought
			// into view, and the layers positioned from the port have to follow it.
			React.useEffect(() => {
				const caret = pendingCaret.current;
				if (caret === null) return;
				const editor = editorRef.current;
				if (editor === null) return;
				if (state.css.length < caret) return;
				if (pendingFocus.current !== false) editor.focus();
				pendingFocus.current = true;
				editor.setSelectionRange(caret, caret);
				revealCaretLine(editor, caret, state.css);
				syncEditorLayers(editor.scrollLeft ?? 0, editor.scrollTop);
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
					const sheet = await readSheet(value);
					// A failed flush raised its own notice: switching sheets must not wipe
					// it, or the edit that never landed becomes invisible.
					store.set({ active: value, css: sheet.css, ...(flushed ? { error: '' } : {}) });
					applySheet(value, sheet.css, store.snapshot().disabled);
					// The panel, the undo stack and the search hits all point into the sheet that
					// was just left behind.
					setOpenIndex(null);
					dirty.current = false;
					setSaved(true);
				}
				catch (error) {
					store.set({ error: t('error.switch', { message: error?.message ?? error }) });
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
					store.set({ error: message === 'exists' ? t('error.exists', { name }) : t('error.create', { message }) });
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
					store.set({ error: t('error.refresh', { message: error?.message ?? error }) });
				}
			};

			/**
			 * Reload the listing from the Host and adopt it, keeping the editor's own state honest.
			 *
			 * The manage actions each change the directory, and each one needs the same three things
			 * afterwards: the new listing, the name the Host now says is active, and a sheet body that
			 * matches. Written once because three copies of it is how the picker and the editor drift
			 * apart.
			 * @param preferred - the sheet to select when the Host does not name one.
			 */
			const reloadSheets = async (preferred) => {
				const listing = await api('/list');
				const active = listing.active ?? preferred ?? store.snapshot().active;
				let css = '';
				if (active !== null && active !== undefined) {
					const sheet = await api('/read?name=' + encodeURIComponent(active)).catch(() => undefined);
					css = sheet === undefined ? '' : sheet.css;
				}
				store.set({ files: listing.files, disabled: listing.disabled ?? [], active: active ?? null, css, error: '' });
				applySheet(active ?? null, css, store.snapshot().disabled);
				setSaved(true);
				return listing;
			};

			/**
			 * Rename the active sheet — the operation for a name typed wrong the first time.
			 *
			 * The Host refuses a name that is taken, and this reports that as a sentence rather than a
			 * silent no-op: the two sheets involved are both somebody's work, and the menu does not get
			 * to decide which one survives.
			 */
			const onRename = async () => {
				const current = store.snapshot();
				if (current.active === null) return;
				const to = normalizeName(renameDraft);
				if (to === current.active) { setActionsPage('actions'); return; }
				await flushSave();
				try {
					await post('/rename', { name: current.active, to });
				}
				catch (error) {
					const message = String(error?.message ?? error);
					store.set({ error: message === 'exists' ? t('error.exists', { name: to }) : t('error.rename', { message }) });
					return;
				}
				setActionsPage('actions');
				setRenameDraft('');
				await reloadSheetsWithError(to);
			};

			/**
			 * Delete the active sheet, after the menu has asked once.
			 *
			 * The last sheet is a special case the Host refuses (`last-sheet`) and this explains: with
			 * no sheets at all the row has nothing to show, and the directory would come back looking
			 * like a fresh install.
			 */
			const onDelete = async () => {
				const current = store.snapshot();
				if (current.active === null) return;
				await flushSave();
				try {
					await post('/delete', { name: current.active });
				}
				catch (error) {
					const message = String(error?.message ?? error);
					setConfirmDelete(false);
					store.set({
						error: message === 'last-sheet'
							? t('error.lastSheet')
							: t('error.delete', { message }),
					});
					return;
				}
				setConfirmDelete(false);
				setActionsPage('actions');
				await reloadSheetsWithError();
			};

			/**
			 * The shared tail of the manage actions: reload, and say so when the reload fails.
			 *
			 * A file operation that succeeded and a refresh that failed is a state worth naming —
			 * "删除失败" would be wrong (it was deleted) and silence would leave the row showing a file
			 * that is not there any more.
			 * @param preferred - the sheet to show when the Host names none.
			 */
			const reloadSheetsWithError = async (preferred) => {
				try {
					await reloadSheets(preferred);
				}
				catch (error) {
					store.set({ error: t('error.refresh', { message: error?.message ?? error }) });
				}
			};

			/** Ask the Host to show the stylesheet directory in the OS file manager. */			const onOpenFolder = async () => {
				try {
					await post('/open-dir', {});
				}
				catch (error) {
					store.set({ error: t('error.openFolder', { message: error?.message ?? error }) });
				}
			};

			/**
			 * Hand the active sheet to the OS default application — an editor,
			 * usually — so it can be edited in a real tool.
			 */			const onOpen = async () => {
				const current = store.snapshot();
				if (current.active === null) return;				// The editor may hold text the debounce has not written yet; the file
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
							? t('error.noRoute')
							: t('error.open', { message }),
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
					store.set({ error: t('error.open', { message: error?.message ?? error }) });
				}
			};

			/**
			 * The actions menu's first page: everything that is not a version.
			 *
			 * Ordered by what the entries are, not by when they were added: the four file
			 * actions together, then the two whole-sheet actions, and 重置 — the one entry
			 * that destroys work — last, where the pointer has to travel to it and cannot
			 * land on it on the way to anything else.
			 * @returns the menu items.
			 */
			const actionsList = () => [
				{
					key: 'open',
					label: t('menu.open'),
					hint: t('menu.openHint'),
					disabled: state.active === null,
					run: () => { void onOpen(); },
				},
				{
					key: 'import',
					label: t('menu.import'),
					hint: t('menu.importHint'),
					disabled: false,
					run: () => { fileInput.current?.click(); },
				},
				{
					key: 'export',
					label: t('menu.export'),
					hint: t('menu.exportHint'),
					disabled: state.active === null,
					run: () => { void onExport(); },
				},
				// A whole-sheet action like the three above, and disabled exactly when it would
				// write the same text back: re-running the formatter is a no-op, and a menu
				// entry that does nothing when clicked reads as broken.
				{
					key: 'format',
					label: t('menu.format'),
					hint: t('menu.formatHint'),
					disabled: formatCss(state.css) === state.css,
					run: () => { formatSheet(); },
				},
				// Whole-sheet actions run in the order a sheet gets cleaned up: reformat it, find the
				// rules that no longer match anything, then go back in time. The audit entry opens a
				// page instead of acting immediately — commenting rules out is a judgement call.
				{
					key: 'tokens',
					label: t('menu.tokens'),
					hint: t('menu.tokensHint'),
					disabled: false,
					run: () => { setActionsPage('tokens'); },
					close: false,
				},
				{
					key: 'audit',
					label: t('menu.audit'),
					hint: t('menu.auditHint'),
					disabled: state.css.trim() === '',
					run: () => { setActionsPage('audit'); },
					close: false,
				},
				// Last but one, and the only other entry that does not close the menu: it turns the
				// menu over to the versions page.
				{
					key: 'versions',
					label: t('menu.versions'),
					hint: t('menu.versionsHint'),
					disabled: state.active === null,
					run: () => { openVersions(); },
					close: false,
				},
				// The three file operations. Rename and delete turn the menu over the way the versions
				// page does, because both need an answer from the user before anything happens.
				{
					key: 'rename',
					label: t('menu.rename'),
					hint: t('menu.renameHint'),
					disabled: state.active === null,
					run: () => { setRenameDraft(state.active ?? ''); setConfirmDelete(false); setActionsPage('rename'); },
					close: false,
				},
				{
					key: 'open-folder',
					label: t('menu.folder'),
					hint: t('menu.folderHint'),
					disabled: false,
					run: () => { void onOpenFolder(); },
				},
				{
					key: 'delete',
					label: confirmDelete ? t('menu.deleteAgain') : t('menu.delete'),
					hint: confirmDelete ? t('menu.deleteConfirmHint') : t('menu.deleteHint'),
					disabled: state.active === null || (state.files ?? []).length <= 1,
					danger: true,
					run: () => {
						// Two clicks on purpose: the first arms, the second deletes. A single click that
						// destroys a sheet is the one thing the menu must not make easy, and there is no
						// undo for a file that is gone from the directory.
						if (!confirmDelete) { setConfirmDelete(true); return; }
						void onDelete();
					},
					close: false,
				},
				{
					key: 'reset',
					label: t('menu.reset'),
					hint: t('menu.resetHint'),
					disabled: state.css === '',
					danger: true,
					run: () => { onEdit(''); },
				},
			].map(item => React.createElement(
				'button',
				{
					key: item.key,
					type: 'button',
					role: 'menuitem',
					className: item.danger === true ? 'dshUi_menuItem dshCc_menuItemDanger' : 'dshUi_menuItem',
					disabled: item.disabled,
					title: item.hint,
					onClick: () => {
						if (item.close !== false) setActionsOpen(false);
						item.run();
					},
				},
				React.createElement('span', { className: 'dshUi_menuLabel' }, item.label),
				React.createElement('span', { className: 'dshUi_menuHint' }, item.hint),
			));

			/**
			 * The actions menu's rename page: one field, the current name as the draft.
			 *
			 * A page rather than a prompt because the Host's rules are worth showing while the name is
			 * being typed — `NAME_PATTERN` accepts `.css` numbers, dashes and letters, and a name typed
			 * past that comes back as `bad-name` with no clue as to which character did it.
			 * @returns the page's nodes.
			 */
			const renameView = () => React.createElement(
				'div',
				{ className: 'dshCc_versionsHead' },
				React.createElement(
					'button',
					{
						type: 'button',
						className: 'dshCc_versionsBack',
						title: t('rename.backTitle'),
						onClick: () => { setActionsPage('actions'); },
					},
					t('rename.heading'),
				),
				React.createElement('p', { className: 'dshCc_versionsNote' },
					t('rename.desc')),
				ui.field({
					'aria-label': t('rename.fieldAria'),
					value: renameDraft,
					autoFocus: true,
					onChange: (event) => { setRenameDraft(event.target.value); },
					onKeyDown: (event) => {
						if (event.key === 'Enter') void onRename();
						if (event.key === 'Escape') setActionsPage('actions');
					},
				}),
				ui.button({
					disabled: normalizeName(renameDraft) === '' || normalizeName(renameDraft) === state.active,
					onClick: () => { void onRename(); },
				}, t('rename.submit')),
			);

			/**
			 * The actions menu's second page: the active sheet's versions, newest first.
			 *
			 * The list is what the Host kept before each overwrite — the editor's own writes
			 * included, so the version a bad edit replaced is reachable without having opened the
			 * file anywhere else.
			 * @returns the page's nodes.
			 */
			const versionsView = () => {
				const nodes = [React.createElement(
					'div',
					{ key: 'head', className: 'dshCc_versionsHead' },
					React.createElement(
						'button',
						{
							type: 'button',
							className: 'dshCc_versionsBack',
							title: t('page.backToActions'),
							onClick: () => { setActionsPage('actions'); },
						},
						React.createElement(ChevronDown, {}),
						t('page.back'),
					),
					React.createElement('span', { className: 'dshCc_versionsFor', title: state.active ?? '' }, state.active ?? ''),
				)];
				if (versionsNote !== '') {
					nodes.push(React.createElement(
						'div',
						{
							key: 'note',
							className: versionsNoteBad ? 'dshCc_versionsNote dshCc_versionsNoteBad' : 'dshCc_versionsNote',
						},
						versionsNote,
					));
				}
				if (versions.length === 0) {
					nodes.push(React.createElement(
						'div',
						{ key: 'empty', className: 'dshCc_versionsEmpty' },
						versionsBusy ? t('versions.reading') : t('versions.empty'),
					));
					return nodes;
				}
				for (const entry of versions) {
					const at = formatStamp(entry.stamp);
					nodes.push(React.createElement(
						'button',
						{
							key: entry.stamp,
							type: 'button',
							role: 'menuitem',
							className: 'dshUi_menuItem dshCc_versionsItem',
							disabled: versionsBusy,
							title: t('versions.restoreTitle', { at }),
							onClick: () => { void restoreVersion(entry.stamp); },
						},
						React.createElement('span', { className: 'dshUi_menuLabel' }, at),
						React.createElement('span', { className: 'dshUi_menuHint' }, formatSize(entry.bytes)),
					));
				}
				return nodes;
			};
			/**
			 * 写一条令牌覆盖，并立刻重新注入。
			 *
			 * 空值 = 撤销这条覆盖（而不是写一个空声明 —— 空值会让 `var()` 解析成空、整条声明被丢弃，
			 * 看起来像「改了没反应」）。全部撤销后删掉文件，不留一个空表。
			 * @param name - token name.
			 * @param value - the override value; empty string removes it.
			 */
			const commitToken = async (name, value) => {
				const trimmed = String(value ?? '').trim();
				const next = new Map(tokenOverrides);
				if (trimmed === '') next.delete(name);
				else next.set(name, trimmed);
				tokenOverrides.clear();
				for (const [key, entry] of next) tokenOverrides.set(key, entry);
				const text = renderTokenSheet(tokenOverrides);
				applyTokenCss(text);
				if (text === '') {
					try { await post('/delete', { name: TOKENS_SHEET }); }
					catch { /* 本来就没有这个文件 */ }
					// 覆盖没了，文件也没了：把它从文件列表里拿掉，免得选择器里还留着一项。
					const files = store.snapshot().files.filter(file => file.name !== TOKENS_SHEET);
					store.set({ files });
					return;
				}
				await writeTokenSheet(text);
				const files = store.snapshot().files;
				if (!files.some(file => file.name === TOKENS_SHEET)) {
					store.set({ files: [...files, { name: TOKENS_SHEET, bytes: text.length, mtime: Date.now() }] });
				}
			};

			/**
			 * 令牌页：列出 DSH 与其它扩展定义的 \`--*\` 令牌（反引号在这里只是注释文字）
			 *
			 * 这一版是**只读**的（发现 + 来源 + 用量）：先让「我改的是哪个令牌」这件事看得见，
			 * 接管（写 `tokens.css`）是下一步，见 docs/token-manager.md。
			 * @returns the page's nodes.
			 */
			const tokensView = () => {
				const { entries, unreadable } = collectTokenList();
				// 材质令牌置顶：它们是这一页里唯一「插件自己定义」的一组，而且是最常调的一组。
				const material = entries.filter(entry => entry.name.startsWith('--dsh-material-'));
				const rest = entries.filter(entry => !entry.name.startsWith('--dsh-material-'));
				const query = tokenQuery.trim().toLowerCase();
				const matches = (entry) => query === ''
					|| entry.name.toLowerCase().includes(query)
					|| entry.value.toLowerCase().includes(query)
					|| entry.source.toLowerCase().includes(query);
				const shownMaterial = material.filter(matches);
				const shown = rest.filter(matches);
				const nodes = [
					React.createElement(
						'div',
						{ key: 'head', className: 'dshCc_versionsHead' },
						React.createElement(
							'button',
							{
								type: 'button',
								className: 'dshCc_versionsBack',
								title: t('page.backToActions'),
								onClick: () => { setActionsPage('actions'); },
							},
							React.createElement(ChevronDown, {}),
							t('page.back'),
						),
						React.createElement(
							'span',
							{ className: 'dshCc_versionsFor' },
							t('tokens.count', { count: entries.length })
								+ (unreadable === 0 ? '' : t('tokens.unreadable', { count: unreadable })),
						),
					),
					// 组件统一：搜索框用共享的那套字段（`.dshUi_field`），这里只多一个布局类。
					ui.field({
						key: 'search',
						className: 'dshCc_tokenSearch',
						type: 'search',
						placeholder: t('tokens.search'),
						'aria-label': t('tokens.search'),
						value: tokenQuery,
						onChange: (event) => { setTokenQuery(event.target.value); },
					}),
				];
				if (shown.length === 0) {
					nodes.push(React.createElement(
						'div',
						{ key: 'empty', className: 'dshCc_versionsEmpty' },
						entries.length === 0 ? t('tokens.empty') : t('tokens.noMatch', { query: tokenQuery.trim() }),
					));
					return nodes;
				}
				// 两行一条，不是三列：这一页长在设置行里，宽度只够 ~270px。三列格子会把名字挤成 0，
				// 而名字是这一页最先要读的东西。
				const rowOf = (entry) => {
					const overridden = tokenOverrides.has(entry.name);
					return React.createElement(
						'div',
						{ key: entry.name, className: 'dshCc_tokenRow' },
						React.createElement(
							'div',
							{ className: 'dshCc_tokenTop' },
							React.createElement('code', { className: 'dshCc_tokenName', title: entry.name }, entry.name),
							React.createElement(
								'span',
								{ className: 'dshCc_tokenMeta', title: t('tokens.uses', { count: entry.uses }) },
								(entry.conditional ? t('tokens.conditionalShort') : '')
									+ (entry.uses === 0 ? '' : t('tokens.uses', { count: entry.uses })),
							),
							overridden
								? React.createElement(
									'button',
									{
										type: 'button',
										className: 'dshCc_hlToggle',
										'aria-pressed': true,
										title: t('tokens.releaseTitle'),
										onClick: () => { void commitToken(entry.name, ''); },
									},
									t('tokens.release'),
								)
								: React.createElement(
									'button',
									{
										type: 'button',
										className: 'dshCc_hlToggle',
										title: t('tokens.takeoverTitle', { source: entry.source }),
										onClick: () => { void commitToken(entry.name, entry.resolved === '' ? entry.value : entry.resolved); },
									},
									t('tokens.takeover'),
								),
						),
						React.createElement(
							'div',
							{ className: 'dshCc_tokenSub' },
							overridden
								? ui.field({
									className: 'dshCc_tokenInput',
									defaultValue: tokenOverrides.get(entry.name),
									'aria-label': t('tokens.overrideAria', { name: entry.name }),
									title: t('tokens.valueHint'),
									onKeyDown: (event) => {
										if (event.key === 'Enter') { event.preventDefault?.(); void commitToken(entry.name, event.target.value); event.target.blur?.(); }
										if (event.key === 'Escape') { event.prevent?.(); event.target.blur?.(); }
									},
									onBlur: (event) => { void commitToken(entry.name, event.target.value); },
								})
								: React.createElement(
									'span',
									{ className: 'dshCc_tokenValue', title: entry.value },
									entry.resolved === '' ? entry.value : entry.resolved,
								),
							React.createElement(
								'span',
								{ className: 'dshCc_tokenSource', title: entry.source + (entry.conditional ? t('tokens.conditionalHint') : '') },
								entry.source,
							),
						),
					);
				};
				if (shownMaterial.length > 0) {
					nodes.push(React.createElement(
						'div',
						{ key: 'materialHead', className: 'dshCc_tokenSection' },
						t('tokens.material'),
					));
					nodes.push(React.createElement(
						'div',
						{ key: 'material', className: 'dshCc_tokenList' },
						...shownMaterial.map(rowOf),
					));
				}
				if (shown.length > 0) {
					nodes.push(React.createElement(
						'div',
						{ key: 'allHead', className: 'dshCc_tokenSection' },
						t('tokens.all'),
					));
					nodes.push(React.createElement(
						'div',
						{ key: 'list', className: 'dshCc_tokenList' },
						...shown.map(rowOf),
					));
				}
				return nodes;
			};

			/**
			 * 体检页的列表：当前页面上「命不中」的规则，点一行就把那条整条注释掉。
			 *
			 * 为什么值得做：自定义 CSS 里大量选择器依赖 DSH 的**构建哈希类名**（`[class*="_footArea"]`
			 * 这种）。DSH 换代改名之后，规则不会报错、也不会消失，只是**永远不再命中** —— 用户看到
			 * 的是「我明明写了却没生效」。这个页面把「没生效」变成一张可以逐条处理的清单。
			 *
			 * 不新增样式：这是菜单里的第二张分页，版式与历史版本页完全一致（同一组 `dshCc_versions*`
			 * 类），换一套类名只会多出一份要维护的 CSS。
			 * @returns the page's nodes.
			 */
			const auditView = () => {
				const sheet = state.css.trim();
				const head = React.createElement(
					'div',
					{ key: 'head', className: 'dshCc_versionsHead' },
					React.createElement(
						'button',
						{
							type: 'button',
							className: 'dshCc_versionsBack',
							title: t('page.backToActions'),
							onClick: () => { setActionsPage('actions'); },
						},
						React.createElement(ChevronDown, {}),
						t('page.back'),
					),
					React.createElement('span', { className: 'dshCc_versionsFor', title: state.active ?? '' }, state.active ?? ''),
				);
				if (sheet === '') {
					return [head, React.createElement(
						'div',
						{ key: 'empty', className: 'dshCc_versionsEmpty' },
						t('audit.empty'),
					)];
				}
				const dead = deadRuleList(state.css);
				if (dead.length === 0) {
					return [head, React.createElement(
						'div',
						{ key: 'clean', className: 'dshCc_versionsNote' },
						t('audit.clean'),
					)];
				}
				const nodes = [head, React.createElement(
					'div',
					{ key: 'note', className: 'dshCc_versionsNote' },
					// 说明「哪些不算」比说明「哪些算」更重要：状态样式本来就在静止页面上 0 命中，
					// 把它们报成死规则，用户第一次体检就会看到一屏红色。
					t('audit.found', { count: dead.length })
					
				)];
				// 40 行封顶：菜单是浮层，几百条会把返回按钮顶出视口；剩下的条数写在末尾。
				const shown = dead.slice(0, 40);
				for (const entry of shown) {
					nodes.push(React.createElement(
						'button',
						{
							key: entry.start,
							type: 'button',
							role: 'menuitem',
							className: 'dshUi_menuItem dshCc_versionsItem',
							title: t('audit.rowTitle', { selector: entry.selector }),
							onClick: () => {
								onEdit(state.css.slice(0, entry.start) + commentOutText(state.css.slice(entry.start, entry.end)) + state.css.slice(entry.end));
							},
						},
						React.createElement('span', { className: 'dshUi_menuLabel' }, t('audit.line', { line: entry.line })),
						React.createElement('span', { className: 'dshUi_menuHint' }, entry.selector),
					));
				}
				if (dead.length > shown.length) {
					nodes.push(React.createElement(
						'div',
						{ key: 'rest', className: 'dshCc_versionsNote' },
						t('audit.more', { count: dead.length - shown.length }),
					));
				}
				// 批量那条写在最后：它是「一次改很多行」，紧挨着列表末尾、离返回最远，
				// 和删除菜单项的摆法同一个道理。
				nodes.push(React.createElement(
					'button',
					{
						key: 'all',
						type: 'button',
						role: 'menuitem',
						className: 'dshUi_menuItem dshCc_versionsItem',
						title: t('audit.commentAllTitle', { count: dead.length }),
						onClick: () => {
							// 从后往前改，前面的偏移才不会被打乱。
							let next = state.css;
							for (const entry of [...dead].reverse()) {
								next = next.slice(0, entry.start) + commentOutText(next.slice(entry.start, entry.end)) + next.slice(entry.end);
							}
							onEdit(next);
						},
					},
					React.createElement('span', { className: 'dshUi_menuLabel' }, t('audit.commentAll')),
					React.createElement('span', { className: 'dshUi_menuHint' }, t('audit.commentAllHint', { count: dead.length })),
				));
				return nodes;
			};



			// Parsed rules drive both the click targets in the colour layer and the
			// panel.
			const rules = parseRules(state.css);
			const openRule = openIndex === null || openIndex >= rules.length ? null : rules[openIndex];
			const declarations = openRule === null ? null : readDeclarations(state.css, openRule);
			/** 打开之后改过没有 —— 没改时「当前」与「修改后」必然一样，界面要这么说，而不是摆一个空盒子。 */
			const previewDirty = previewBaselineCss !== null && previewBaselineCss !== state.css;
			/**
			 * 卡片导航的标签：一张卡对应一个命中元素。
			 *
			 * 卡片里放的是**标签**（`button · 2/5`）而不是又一个克隆缩略：一次渲染里再克隆 6 份、
			 * 每份三百多条内联声明，代价比它带来的信息多；而「长什么样」上面那块大样本已经给了。
			 */
			/** 预览与拾取共用的排除名单（根级元素默认在里面）。 */
			const excludeSelectors = parseExclude(prefs.exclude === undefined ? DEFAULT_EXCLUDE : prefs.exclude);
			const excludeText = excludeSelectors.join(', ');
			/** 当前要预览的那个元素在不在名单里 —— 在的话样本换成合成的，并说明原因。 */
			const previewTargetNode = openRule === null
				? undefined
				: (resolveSelector(previewTargetSelector(openRule.selector)).nodes ?? [])[previewIndex];
			const previewExcluded = isExcludedNode(previewTargetNode, excludeSelectors);
			/** 这个元素上的透明/定位问题（三个会「真的坏掉」的检查）。 */
			const previewFindings = previewExcluded || previewTargetNode === undefined
				? []
				: diagnoseElement(previewTargetNode);
			const previewMatchCount = openRule === null ? 0 : (resolveSelector(openRule.selector).nodes ?? []).length;
			const previewMatches = openRule === null
				? []
				: (resolveSelector(openRule.selector).nodes ?? []).slice(0, 6).map((node, position) => ({
					selector: openRule.selector,
					label: (String(node.tagName ?? '').toLowerCase() || 'element')
						+ ' · ' + (position + 1) + '/' + previewMatchCount,
				}));

			/** Set, or clear, one declaration on the open rule. */
			const setProperty = (name, value) => {
				if (openRule === null) return;
				onEdit(writeDeclaration(state.css, openRule, name, value));
			};

			/**
			 * 把一条预设写进当前规则。
			 *
			 * 一次编辑：几条声明在内存里连起来改完，最后只 \`onEdit\` 一次 —— 于是 Ctrl+Z 一下
			 * 就整体撤回（与规则面板里所有写入口径一致）。
			 *
			 * 写之前先检查，检查不通过时**说明原因**而不是静默失败：一个点了没反应的按钮比
			 * 一个报错的按钮更糟。三种结论：拒绝（同插件自己的控件）/ 有提醒但照写（透明底、
			 * 元素太小）/ 直接写。
			 * @param preset - one entry of PRESETS.
			 */
			const applyPreset = (preset) => {
				if (openRule === null) return;
				const hits = resolveSelector(openRule.selector).nodes ?? [];
				const target = hits[0];
				if (target === undefined) {
					setPresetNote(t('preset.noTarget'));
					return;
				}
				const ownChrome = typeof target.closest === 'function'
					? target.closest('.dshCc_row, [data-dshcc-owned]')
					: null;
				if (ownChrome !== null && ownChrome !== undefined) {
					setPresetNote(t('preset.ownChrome'));
					return;
				}
				// 浏览器里 getComputedStyle 是 window 的方法；测试床只把它挂在 window 上，
				// 所以两条路都试，都没有就用一个空对象（检查项退化成「判断不了」）。
				const readStyle = typeof getComputedStyle === 'function'
					? getComputedStyle
					: (typeof window !== 'undefined' ? window.getComputedStyle : undefined);
				const computed = typeof readStyle === 'function' ? readStyle(target) : { backgroundColor: '', getPropertyValue: () => '' };
				const declares = (property) => {
					const map = readDeclarations(state.css, openRule);
					return map !== null && map.has(property);
				};
				const transparent = /^(transparent|rgba\(0, 0, 0, 0\))$/.test(String(computed.backgroundColor ?? '').trim());
				// 拿不到尺寸（非元素节点、或测试床的假节点）时跳过「太小」这一条，而不是抛错。
				const rect = typeof target.getBoundingClientRect === 'function'
					? target.getBoundingClientRect()
					: null;
				const warnings = [];
				if (transparent && !declares('background-color') && !declares('background')) warnings.push(t('preset.needsFill'));
				if (rect !== null && (rect.width < 40 || rect.height < 24)) {
					warnings.push(t('preset.tooSmall', { width: Math.round(rect.width), height: Math.round(rect.height) }));
				}
				let css = state.css;
				for (const [name, value] of preset.declarations) css = writeDeclaration(css, openRule, name, value);
				onEdit(css);
				setPresetNote(warnings.length === 0 ? '' : t('preset.warn', { preset: content(preset.label), why: warnings.join('；') }));
			};

			// 全屏视图用原生 <dialog> + showModal()：它进 top layer，不受设置对话框的 transform /
			// overflow 影响。position:fixed 的浮层会被有 transform 的祖先变成「相对它定位」，
			// 那样「全屏」实际上只有对话框那么大 —— 这是选 dialog 而不是浮层的原因。
			React.useEffect(() => {
				const dialog = fullDialogRef.current ?? null;
				if (dialog === null || typeof dialog.showModal !== 'function') return;
				if (previewFull) {
					if (dialog.open !== true) dialog.showModal();
				}
				else if (dialog.open === true) dialog.close();
			});

			// 预览块里的样本：克隆 + 冻结的计算样式（见 paintPreview）。放在行里而不是面板里，
			// 因为面板是被**当普通函数调用**的（openRule 为空时直接不调用），在它里面用 hook
			// 就是条件 hook。
			React.useEffect(() => {
				if (openRule === null) {
					// 面板关掉了：强制态必须原样撤掉，芯片也归零。
					clearPreviewForcing();
					if (previewChips.length > 0) setPreviewChips([]);
					return;
				}
				const panel = rowRef.current?.querySelector?.('.dshCc_panel') ?? null;
				if (panel === null) return;
				// 打开规则后滚一次，让预览块露出来：它在声明区上方，长表面里常在折叠之下。
				if (previewScrollPending) {
					previewScrollPending = false;
					panel.scrollIntoView?.({ block: 'nearest' });
				}
				const pseudos = previewChips
					.filter(id => id === 'before' || id === 'after')
					.map(id => '::' + id);
				const signature = [openRule.selector, state.css.length, previewCompare, previewFull, previewIndex, previewChips.join(','), previewExcluded].join('|');
				if (signature === previewSignature) return;
				paintPreview(panel, openRule, state.css, previewCompare || previewFull, previewIndex, pseudos, previewExcluded);
			});

			/** Open the panel on one rule index. */
			const openRuleAt = (index) => {
				if (rules[index] === undefined) return;
				// 基线：打开这条规则那一刻的文本。「当前」= 它，「修改后」= 现在的文本。
				previewBaselineCss = state.css;
				// 上一条规则留下的强制态与芯片不能带到新规则上。
				clearPreviewForcing();
				setPreviewChips([]);
				setPreviewFull(false);
				previewScrollPending = true;
				setOpenIndex(index);
			};

			/**
			 * 开 / 关一个状态芯片。
			 *
			 * 三个「能强制」的（hover / focus / placeholder）会动真页面：改写选择器 + 加类；
			 * 两个伪元素（before / after）只在样本里合成，不动页面。切芯片之后样本必须重画
			 * —— 强制态改变了计算样式，而样本读的就是计算样式。
			 * @param id - the chip id.
			 */
			const toggleChip = (id) => {
				const next = previewChips.includes(id)
					? previewChips.filter(item => item !== id)
					: [...previewChips, id];
				setPreviewChips(next);
				clearPreviewForcing();
				previewSignature = '';
				if (openRule === null) return;
				const states = PREVIEW_STATES.filter(state => next.includes(state.id));
				if (states.length === 0) return;
				const target = (resolveSelector(previewTargetSelector(openRule.selector)).nodes ?? [])[previewIndex];
				forcePreviewStates(openRule, state.css, states, target);
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
			// sheets involved are a few kilobytes at most. The `var()` part is the exception —
			// it has to read the live DOM, so it arrives from `variableIssues` (see below) and
			// joins the same list, which is where the status line already reports from.
			//
			// The strictness setting gates BOTH halves: "只查语法" still parses the sheet (a sheet
			// that does not parse is a sheet that styles nothing) but skips the document-level
			// questions, and "关闭校验" reports the plugin's own failures only. The line is never
			// silent — a setting that turns off the status line entirely would hide a failed write.
			const strict = validationMode();
			const issues = strict === 'off'
				? []
				: [...validateCss(state.css), ...(strict === 'syntax' ? [] : inspection.variables)]
					.sort((left, right) => left.line - right.line);
			const problem = state.error !== ''
				? state.error
				: (issues.length === 0
					? null
					: (t('status.problem', { line: issues[0].line, message: issues[0].message })
						+ (issues.length > 1 ? t('status.problemMore', { count: issues.length }) : '')));

			const statusText = () => {
				if (state.mode === 'loading') return t('status.loading');
				const suffix = state.css.trim() === ''
					? t('status.unset')
					: t('status.size', { lines: state.css.split('\n').length, chars: state.css.length });
				const off = activeEnabled ? '' : t('status.off');
				if (!fileMode) return suffix + t('status.browser');
				return (saved ? t('status.saved') : t('status.saving')) + suffix + off;
			};

			// One name for "a write is on its way to disk", read by three things that must
			// agree: the switch (which refuses input while it is true), the status dot
			// (which shows the loading semantic), and the live region text.
			//
			// DSH's Switch documents this as the owner's job — "owners also set it while a
			// write is in flight, not only when a deployment locks the toggle" — and it
			// matters here: the switch writes `active.json` through the same Host route the
			// editor debounces into, so a second press while the first is in flight is a
			// race, not a preference.
			const saving = fileMode && !saved;
			const dotState = !activeEnabled ? 'off' : (saving ? 'ongoing' : 'on');

			/**
			 * The selector the highlight follows: the field's draft while it is being edited,
			 * otherwise the open rule's own text.
			 *
			 * The draft is part of why this is not simply `openRule.selector` — the panel
			 * deliberately withholds an empty selector from the sheet (see `renameRule`), so
			 * typing `div >` has to move the highlight without waiting for the sheet to catch
			 * up.
			 */
			const draftSelector = selectorDraft === null
				? (openRule === null ? '' : openRule.selector)
				: selectorDraft;

			/**
			 * The last selector that was worth outlining.
			 *
			 * Remembered because the panel closing must not stop the highlight: closing sets
			 * `openRule` to null, which would otherwise empty the selector and take the boxes
			 * down with it — measured, and it made the whole feature useless for its stated
			 * purpose (looking at the page, which the panel sits on top of).
			 *
			 * Kept in a ref rather than state so it survives without causing a render, and
			 * updated only from a real selector: an in-progress or broken edit must not
			 * overwrite the last thing that worked.
			 */
			const rememberedSelector = React.useRef('');
			const draftResolved = resolveSelector(draftSelector);
			if (draftSelector.trim() !== '' && draftResolved.invalid !== true
				&& draftSelector !== rememberedSelector.current) {
				rememberedSelector.current = draftSelector;
			}
			const highlightSelector = highlightOn ? rememberedSelector.current : draftSelector;
			const highlight = resolveSelector(highlightSelector);

			/**
			 * The count the toggle shows, re-measured on every commit.
			 *
			 * It cannot be `highlight.nodes.length`, and the reason is not performance — it is
			 * that the page changes without the selector changing. Measured: with the panel
			 * closed the page answered 292 matches for `[class]`; opening the panel pushes that
			 * to 336, because the panel is 44 more elements with classes, and the toggle went on
			 * showing **292**. Computing the count inside a memo keyed on the selector text meant
			 * the number described a page state that had already been replaced.
			 *
			 * A number that answers "did I write this right" and a number that answers "how many
			 * are there now" are two different jobs, and only the second one can be cached.
			 */
			const [highlightCount, setHighlightCount] = React.useState(0);

			// Live re-measure, not a one-shot draw. Scrolling does not fire a React render, and
			// `position:fixed` boxes are anchored to the viewport, so without this the outlines
			// would stay where the elements used to be the moment the page moved.
			React.useEffect(() => {
				// Re-count first, for both states: the count is shown whether or not the
				// highlight is on, and it is wrong the moment the page changes under it.
				setHighlightCount(highlight.invalid === true || highlight.pseudo === true
					? 0
					: highlight.nodes.length);
				if (!highlightOn) {
					clearHighlights();
					return undefined;
				}
				if (highlight.invalid === true) {
					clearHighlights();
					return undefined;
				}
				// Re-resolve on each repaint rather than reusing `highlight.nodes`: a scroll does
				// not change the match set, but the element list can change between renders, and
				// the boxes must describe what is on the page now.
				const repaint = () => {
					const live = resolveSelector(highlightSelector);
					paintHighlightBoxes(live.invalid === true ? [] : live.nodes);
				};
				repaint();
				window.addEventListener('scroll', repaint, true);
				window.addEventListener('resize', repaint);
				return () => {
					window.removeEventListener('scroll', repaint, true);
					window.removeEventListener('resize', repaint);
				};
			});

			// The boxes outlive the panel, so `openRule` going null must not take them down —
			// but the row going away must, or a closed settings dialog leaves outlines on the
			// page with no control anywhere to switch them off.
			React.useEffect(() => clearHighlights, []);

			return React.createElement(
				'div',
				{ className: 'dshCc_row' + (prefs.lineNumbers === false ? ' dshCc_noGutter' : ''), ref: rowRef },
				React.createElement(
					'div',
					{ className: 'dshCc_head' },
					React.createElement('div', { className: 'dshCc_title' }, t('row.title')),
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
										state.active ?? t('row.noFile'),
									),
									React.createElement(ChevronDown, {}),
								),
								pickerOpen
									? React.createElement(
										'div',
										{ className: 'dshUi_menu', role: 'menu' },
										// tokens.css 由「令牌」页维护：放进选择器会被误当成一张可编辑的表。
									...state.files.filter(file => file.name !== TOKENS_SHEET).map(file => React.createElement(
											'button',
											{
												key: file.name,
												type: 'button',
												role: 'menuitemradio',
												'aria-checked': file.name === state.active,
												className: 'dshUi_menuItem',
												onClick: () => {
													setPickerOpen(false);
													void onPick(file.name);
												},
											},
											React.createElement('span', { className: 'dshUi_menuLabel' }, file.name),
											file.name === state.active ? React.createElement(CheckMark, {}) : null,
										)),
										React.createElement(
											'button',
											{
												type: 'button',
												className: 'dshUi_menuItem',
												onClick: () => {
													setPickerOpen(false);
													void onPick(NEW_OPTION);
												},
											},
											React.createElement('span', { className: 'dshUi_menuLabel' }, t('row.newSheet')),
										),
									)
									: null,
							)
							: null,
						ui.button({
							className: 'dshCc_pickBtn',
							disabled: !fileMode,
							'aria-pressed': state.picking,
							title: t('row.pickTitle'),
							onClick: () => {
								if (state.picking) stopPicking();
								else startPicking();
							},
						}, state.picking ? t('row.pickCancel') : t('row.pick')),
						// The find bar's way in. Folding it into 更多操作 would hide a control
						// whose whole point is that it appears while the caret is in the text,
						// and a menu cannot be reached from every state the caret can be in.
						ui.button({
							className: 'dshCc_pickBtn',
							'aria-pressed': searchOpen,
							title: t('row.findTitle'),
							onClick: () => {
								if (searchOpen) closeSearch();
								else openSearch();
							},
						}, searchOpen ? t('row.findClose') : t('row.find')),
						React.createElement(
							'div',
							{ className: 'dshCc_picker', ref: actionsRef },
							// An outlined action button, the same family as 拾取元素: the filled
							// pill is the selector chrome, and a second pill next to the file
							// selector read as two selectors instead of one value plus actions.
							ui.button({
								className: 'dshCc_menuBtn',
								'aria-haspopup': 'menu',
								'aria-expanded': actionsOpen,
								disabled: !fileMode,
								title: t('row.moreTitle'),
								onClick: () => {
									if (actionsOpen) setActionsOpen(false);
									else {
										// Always the actions first: the versions page is somewhere
										// the user went, not where the menu opens.
										setActionsPage('actions');
										setVersionsNote('');
										setActionsOpen(true);
									}
								},
							}, t('row.more'), React.createElement(ChevronDown, {})),
							actionsOpen
								? React.createElement(
									'div',
									{ className: 'dshUi_menu', role: 'menu', ref: menuRef },
									actionsPage === 'versions' ? versionsView()
										: actionsPage === 'tokens' ? tokensView()
						: actionsPage === 'audit' ? auditView()
											: actionsPage === 'rename' ? renameView()
												: actionsList(),
								)
								: null,
						),
					),
				),
				creating
					? React.createElement(
						'div',
						{ className: 'dshCc_newRow' },
						ui.field({
							'aria-label': t('row.newAria'),
							placeholder: t('row.newPlaceholder'),
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
						ui.button({ onClick: () => { void onCreate(); } }, t('row.create')),
						ui.button({ onClick: () => { setCreating(false); } }, t('row.cancel')),
					)
					: null,
				React.createElement(
					'p',
					{ className: 'dshCc_desc' },
					fileMode
						? t('row.descFile')
						: t('row.descBrowser'),
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
								state.active ?? t('row.noFile'),
							),
							ui.badge('CSS'),
						),
						React.createElement(
							'div',
							{ className: 'dshCc_fileBarRight' },
							React.createElement(Dropdown, {
								items: outlineItems(rules),
								display: t('row.outline'),
								ariaLabel: t('row.outlineAria'),
								wrapperClassName: 'dshCc_outline',
								// Nothing in the sheet means nothing to outline: an empty menu is
								// not a useful answer to "what rules are in here".
								disabled: rules.length === 0,
								// A definite width, not a minimum: the entries are selectors, and a
								// content-sized menu would walk off the screen with them.
								menuWidth: 320,
								onPick: (value) => {
									jumpToRule(Number(value));
								},
							}),
							React.createElement('span', {
								className: 'dshCc_statusDot',
								// The loading semantic is DSH's own `StateDot` vocabulary
								// (`done`/`warning`/`ongoing`/`error`/`idle`), so the dot says
								// the same thing here as it does everywhere else in the app.
								'data-state': dotState,
								'aria-hidden': true,
							}),
							ui.switch({
								checked: activeEnabled,
								ariaLabel: t('row.enableTitle'),
								labelText: activeEnabled ? t('row.enabled') : t('row.disabled'),
								disabled: state.active === null || saving,
								title: saving
									? t('row.busyTitle')
									: (activeEnabled
										? t('row.disableTitle')
										: t('row.reenableTitle')),
								onChange: (next) => { void setActiveEnabled(next); },
							}),
						),
					),
					React.createElement(
						'div',
						{ className: 'dshCc_main' },
						React.createElement(
							'div',
							{ className: 'dshCc_editorWrap' },
				searchOpen ? FindBar({
					fieldRef: searchRef,
					query: searchQuery,
					replacement: searchReplacement,
					caseSensitive: searchCase,
					hits,
					activeHit,
					activeRange,
					onQuery: (value) => { setSearchQuery(value); setSearchIndex(0); },
					onReplacement: setSearchReplacement,
					onStep: stepHit,
					onClose: closeSearch,
					onToggleCase: () => { setSearchCase(!searchCase); setSearchIndex(0); },
					onReplace: replaceCurrent,
				onReplaceAll: replaceAll,
			}) : null,
							React.createElement(
								'div',
								{ className: 'dshCc_editorRow' },
						// The gutter is hidden rather than unmounted when the setting is off: the
						// editor's colour layer, its caret reveal and its scroll mirror all position
						// themselves against this row, and removing a column changes the geometry the
						// other parts were measured against. `display:none` through a class keeps the
						// layout maths identical while the numbers stop being drawn.
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
								dangerouslySetInnerHTML: { __html: highlightCss(state.css, rules, hits, activeHit) },
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
								'aria-label': t('row.title'),
								spellCheck: false,
								// The attribute, not just the CSS: it is what really turns wrapping
								// off in a textarea, and the style is the belt to its braces.
								wrap: 'off',
								placeholder: t('row.placeholder'),
								value: state.css,
								onChange: onType,
								onKeyDown: onEditorKeyDown,
								onScroll: (event) => {
									const target = event.target;
									syncEditorLayers(target.scrollLeft, target.scrollTop);
									// The completion list is anchored to a line box, so it is
									// stale the moment the text moves underneath it.
									setSuggest(null);
								},
								onBlur: () => {
									setSuggest(null);
								},
							}),
						),
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
					openRule === null ? null : RulePanel({
						openRule, declarations, selectorDraft, setSelectorDraft,
						highlight, highlightSelector, highlightCount, highlightOn,
						setHighlightOn, setProperty, applyPreset, presetNote, renameRule, insertTemplate,
						previewCompare, setPreviewCompare, previewDirty,
						previewList, setPreviewList, previewIndex, setPreviewIndex, previewMatches, previewMatchCount,
						previewChips, toggleChip, previewFull, setPreviewFull, fullDialogRef,
						previewExcluded, excludeText, previewFindings,
						setOpenIndex,
					}),
				),
				React.createElement(
					'div',
					{ className: 'dshCc_foot' },
					state.conflict !== null ? React.createElement(
						'span',
						{ className: 'dshCc_conflict' },
						t('row.conflict', { name: state.conflict.name }),
						React.createElement('button', {
							type: 'button',
							className: 'dshCc_conflictBtn',
							onClick: takeDiskCopy,
						}, t('row.conflictReload')),
						React.createElement('button', {
							type: 'button',
							className: 'dshCc_conflictBtn',
							onClick: () => {
								void keepMine();
							},
						}, t('row.conflictOverwrite')),
					) : React.createElement(
						'span',
						{
							className: problem === null ? 'dshCc_status' : 'dshCc_error',
							// The status line changes on its own — the debounce writes, a
							// validation runs, a sheet is restored — and until now nothing
							// announced any of it: measured, this row had ZERO live regions, so
							// "保存中" turning into "已保存" (or into a validation failure) was
							// information only sighted users received.
							//
							// `polite` for the ordinary transitions (announced at the next
							// pause, never interrupting), `assertive` for a problem — a sheet
							// that does not parse is worth interrupting for.
							// `aria-atomic` because the text is a sentence being rewritten,
							// not a value being appended: a reader should hear the whole line,
							// not just the fragment that changed.
							role: problem === null ? undefined : 'alert',
							'aria-live': problem === null ? 'polite' : 'assertive',
							'aria-atomic': true,
						},
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
				// A LINK to the wallpaper section, not the section itself. The sheet editor is this
				// row's subject and a second control cluster under it made the row answer two
				// questions at once — measured at 535px of extra height in a list whose other rows
				// are one line each. The section lives on this plugin's page in the plugin manager,
				// which is where a plugin's own settings belong.
				React.createElement(
					'div',
					{ className: 'dshCc_wallpaperLinkRow' },
					React.createElement(
						'button',
						{
							type: 'button',
							className: 'dshCc_linkBtn',
							onClick: () => {
								openWallpaperSection();
							},
						},
						t('row.wallpaperLink'),
					),
					React.createElement('span', { className: 'dshCc_linkNote' }, t('row.linkNote')),
				),
			);
		}

		/**
		 * 设置槽位等不到时的兜底日志：把「插件安静消失」变成一条能搜索的 warn。
		 *
		 * DSH 换代如果改了槽位名，`slots.inject` 的回调**永远不会被调用** —— 插件不报错，只是
		 * 什么都不出现。用户看到的是「设置 → 通用里没有『自定义 CSS』这一行」，这类问题没人会来
		 * 提 issue，作者这边也拿不到任何信号。这是这个插件最后一个真正的盲区。
		 *
		 * 3 秒是量出来的，不是拍的：0.2.1-rc.2 上，页面加载后约 **470ms** 回调就到位了（探针
		 * 实测，数字记在 docs/testing.md），所以慢机器上也不会误报。槽位一旦就位，这个定时器
		 * 立刻被撤掉。
		 */
		const SLOT_SEAT_TIMEOUT_MS = 3000;

		/** 一个页面只报一次：`apply` 只跑一遍，但这个函数也可能被别处调用。 */
		let seatWarningSent = false;

		/**
		 * 报一条「设置槽位没就位」的警告。
		 * @param detail - 版本信息那一行；空串表示没查到。
		 */
		function warnMissingSettingsSeat(detail) {
			if (seatWarningSent) return;
			seatWarningSent = true;
			console.warn([
				t('warn.seatTitle'),
				t('warn.seatWhy'),
				...(detail === '' ? [] : [detail]),
				t('warn.seatWhere'),
			].join('\n'));
		}

		/**
		 * 给那条警告补上版本号。
		 *
		 * `/about` 是 Host 那边唯一知道版本的地方，而这条警告的价值有一半在「哪个 DSH 把它弄坏的」。
		 * 拿不到就不写这一行 —— 一条日志为了版本号失败没有意义。
		 * @returns 一行 `版本：插件 x · DSH y（commit）`，或空串。
		 */
		async function describeRelease() {
			const about = await api('/about').catch(() => null);
			if (about === null) return '';
			const parts = [];
			if (about.version) parts.push(t('warn.pluginVersion', { version: about.version }));
			if (about.dsh) parts.push('DSH ' + about.dsh + (about.dshCommit ? '（' + about.dshCommit + '）' : ''));
			return parts.length === 0 ? '' : t('warn.versions', { parts: parts.join(' · ') });
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
			// 材质令牌的默认值：与样式表无关，所以同步插；预设引用的就是它。
			applyMaterialTokens();
			// The wallpaper has nothing to do with sheets, so it is loaded on its own: a page
			// whose Host routes are down still gets the picture this browser already has.
			void bootstrapWallpaper();
			// Settings after the wallpaper, and not in parallel: applying a settings record repaints
			// the wallpaper sheet, so it has to run against the picture that is already in the store.
			void bootstrapSettings();
			// Captured, not declared in `inject`: the row's 「自定义壁纸…」 link calls it, and a
			// composite without a plugin manager has no such service — requiring one would take
			// this plugin out of a working composition just because a link had nowhere to go.
			getPluginNavigation = () => ctx.get('pluginNavigation');

			// 语言：把两份词典交给 DSH 的 locale 服务，再绑成 `t`。
			//
			// 服务是**可选**的（`ctx.get` + `ctx.inject` 兜底，和 `pluginNavigation` 一个路数）：
			// 没有它的组合保持中文，行为与加国际化之前逐字一致 —— 这也让测试床不必造一个假服务。
			// 语言切换时让两个 store 各前进一步：挂在 `useSyncExternalStore` 上的组件因此重渲染，
			// 而 `t` 在调用时才读当前语言，所以换字不需要重新挂载。
			const useLocale = (locale) => {
				if (locale === undefined || locale === null) return;
				// 内容词典（属性名 / 值名 / 模板名）按 tag 选表，所以这里记住当前语言。
				const syncTag = () => {
					const active = locale.getLocale?.().active;
					if (typeof active === 'string' && active !== '') activeLocaleTag = active;
				};
				const registerBoth = () => {
					const disposers = [];
					if (typeof locale.register === 'function') {
						disposers.push(locale.register(LOCALE_NS, 'zh', STRINGS.zh));
						disposers.push(locale.register(LOCALE_NS, 'en', STRINGS.en));
					}
					if (typeof locale.subscribe === 'function') {
						disposers.push(locale.subscribe(() => {
							// 先更新 tag（`content` 在重渲染时用它），再推 store 让组件重跑一次。
							syncTag();
							store.set({});
							wallpaperStore.set({});
						}));
					}
					return () => {
						for (const dispose of disposers) {
							if (typeof dispose === 'function') dispose();
						}
					};
				};
				if (typeof ctx.effect === 'function') ctx.effect(registerBoth, 'dsh-custom-css: locale dictionaries');
				else registerBoth();
				if (typeof locale.bind === 'function') translate = locale.bind(LOCALE_NS);
				syncTag();
			};
			const localeNow = typeof ctx.get === 'function' ? ctx.get('locale') : undefined;
			if (localeNow !== undefined) useLocale(localeNow);
			else if (typeof ctx.inject === 'function') {
				// 服务激活可能晚于本插件挂载（`clientModules.release` 上踩过同一个坑），所以走
				// cordis 的 inject 而不是「挂载时问一次」。
				try {
					ctx.inject(['locale'], (localeCtx) => {
						useLocale(typeof localeCtx.get === 'function' ? localeCtx.get('locale') : localeCtx.locale);
					});
				}
				catch { /* 组合里没有 locale 服务：保持中文 */ }
			}
			// Armed before the first `inject` so a seat that never arrives cannot slip past it: the
			// callback clears this, so the only way it fires is "DSH never asked for the seat".
			let settingsSeatServed = false;
			const seatWatchdog = setTimeout(() => {
				if (settingsSeatServed) return;
				void describeRelease().then((detail) => {
					warnMissingSettingsSeat(detail);
				});
			}, SLOT_SEAT_TIMEOUT_MS);
			ctx.slots.inject('settings.general.item', () => {
				settingsSeatServed = true;
				clearTimeout(seatWatchdog);
				return ctx.slots.register({
					name: 'settings.general.item',
					id: 'custom-css',
					order: 12,
					registrant: PLUGIN_ID,
				}, CustomCssRow);
			});
			// Two sections on this plugin's own page, ordered so the page reads
			// 「壁纸 → 壁纸设置」. Both entries are the same shape and carry the same contract: the
			// seat is rendered for every detail page, so each one checks the subject and declines
			// the pages it has nothing to say about.
			ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
				name: 'plugins.detail.section',
				id: 'custom-css-wallpaper',
				order: 20,
				registrant: PLUGIN_ID,
			}, WallpaperSection));
			ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
				name: 'plugins.detail.section',
				id: 'custom-css-wallpaper-settings',
				order: 21,
				registrant: PLUGIN_ID,
			}, SettingsSection));
		}

		/** Browser services this plugin needs before its body runs. */
		const inject = ['slots'];


		// CSS 公共层先装：它在用户自己那张表之前，所以用户规则天然赢过它。
		// Last thing in the body, so the sheet it installs is defined by the time it is read.
		installWallpaperCss();
		// The sidebar is resizable, and the account menu is a portal: keep its width on the trigger.
		installMenuWidthFollower();

		/* ═══ 写 CSS 用的页面 API（window.dshCss）════════════════════════════════════
		 * 设计见 docs/authoring-api.md。这个对象的唯一职责是「把插件已有的能力摆到控制台里」：
		 * 读/写样式表、查选择器命中、列出死选择器、反查令牌、拾取元素 —— 全部走已经存在的实现，
		 * 不再另起一套。
		 *
		 * 约定：
		 *   · 只有 window.dshCss 一个全局；内部函数不外露。
		 *   · 写盘受设置项 `devApi` 控制（默认允许），`css.apply` 永远只在本页生效、刷新即消失。
		 *   · 所有「找不到」都返回 null / 空数组，而不是抛错 —— 在控制台里报错比返回空更难用。
		 * ═════════════════════════════════════════════════════════════════════════ */
		const AUTHORING_API_VERSION = 1;

		/** `event → Set<listener>`; a plain map so the API does not depend on EventTarget. */
		const authoringListeners = new Map();

		/** Transient sheets made by `dshCss.css.apply`, by id. */
		const authoringTransient = new Map();

		/** Token names collected from the loaded sheets, once. */
		let authoringTokenCache = null;

		/**
		 * 一张样式表在界面上叫什么。
		 * @param sheet - a CSSStyleSheet.
		 * @returns a short, human name.
		 */
		function tokenSourceName(sheet) {
			const owner = sheet.ownerNode ?? null;
			const tag = owner?.dataset?.pluginCss ?? owner?.dataset?.plugin ?? owner?.id ?? '';
			if (typeof tag === 'string' && tag !== '') return tag;
			const href = String(sheet.href ?? '');
			if (href !== '') return href.split('/').pop();
			return t('tokens.inline');
		}

		/**
		 * 令牌清单：名字、定义值、解析值、来源表、是否在条件块里、被多少条规则用到。
		 *
		 * 为什么值得做：DSH 的背景几乎全是令牌驱动的（45 条设背景的规则里 44 条用 `var(--dsw-…)`，
		 * `--dsw-alias-bg-base` 一个令牌被 31 条规则使用）。所以改一个令牌 ≈ 改整片界面，
		 * 前提是**知道该改哪一个**。
		 *
		 * 「被多少条规则用到」是回答「我改这个会不会炸」的唯一依据，所以它必须便宜：
		 * 把所有可读样式表的 `cssText` 拼成一个大字符串，**一次**扫完所有 `var(--name`。
		 * 每个令牌扫一遍是 418 × 全表，卡的是主线程。
		 * @param sheets - 可选的样式表列表（测试与探针用）。
		 * @returns `{ entries, unreadable }`
		 */
		function collectTokenList(sheets) {
			const list = sheets ?? (typeof document !== 'undefined' ? (document.styleSheets ?? []) : []);
			const byName = new Map();
			const texts = [];
			let unreadable = 0;
			const add = (name, value, from, conditional) => {
				const entry = byName.get(name) ?? { name, value: '', source: '', conditional: false };
				entry.value = String(value ?? '').trim();
				entry.source = from;
				entry.conditional = entry.conditional || conditional === true;
				byName.set(name, entry);
			};
			const walk = (rules, from, conditional) => {
				for (const rule of rules) {
					if (typeof rule.selectorText === 'string') {
						const style = rule.style;
						for (let index = 0; index < (style?.length ?? 0); index += 1) {
							const property = style[index];
							if (typeof property !== 'string' || !property.startsWith('--')) continue;
							add(property, style.getPropertyValue?.(property) ?? '', from, conditional);
						}
					}
					// @media / @supports / @layer 里的定义只在条件成立时才是计算值：标出来。
					if (rule.cssRules !== undefined && rule.cssRules.length > 0) {
						walk([...rule.cssRules], from, conditional || typeof rule.selectorText !== 'string');
					}
				}
			};
			for (const sheet of list) {
				const from = tokenSourceName(sheet);
				try {
					const rules = [...sheet.cssRules];
					walk(rules, from, false);
					texts.push(rules.map(rule => rule.cssText ?? '').join('\n'));
				}
				catch { unreadable += 1; }
			}
			// 一次扫完全部文本，得到每个令牌被引用了多少次。
			const uses = new Map();
			for (const match of texts.join('\n').matchAll(/var\(\s*(--[\w-]+)/g)) {
				uses.set(match[1], (uses.get(match[1]) ?? 0) + 1);
			}
			// 解析值只能问一个真实元素：DSH 把令牌定义在 body 上。
			const computed = typeof getComputedStyle === 'function' && typeof document !== 'undefined'
				? getComputedStyle(document.body)
				: null;
			const entries = [...byName.values()].map((entry) => ({
				...entry,
				resolved: String(computed?.getPropertyValue?.(entry.name) ?? '').trim(),
				uses: uses.get(entry.name) ?? 0,
			}));
			entries.sort((left, right) => (left.name < right.name ? -1 : (left.name > right.name ? 1 : 0)));
			return { entries: entries.slice(0, 600), unreadable };
		}

		/** The `--`-prefixed names that look like DSH tokens. */
		function authoringTokenNames() {
			if (authoringTokenCache !== null) return authoringTokenCache;
			const names = new Set();
			const walk = (rules) => {
				for (const rule of rules) {
					if (typeof rule.selectorText === 'string') {
						const style = rule.style;
						for (let index = 0; index < style.length; index++) {
							const property = style[index];
							if (property.startsWith('--dsw-') || property.startsWith('--ds-')) names.add(property);
						}
						if (rule.cssRules !== undefined && rule.cssRules.length > 0) walk([...rule.cssRules]);
						continue;
					}
					if (rule.cssRules !== undefined && rule.cssRules.length > 0) walk([...rule.cssRules]);
				}
			};
			for (const sheet of document.styleSheets) {
				try { walk([...sheet.cssRules]); }
				catch { /* 跨域样式表读不到：跳过，和浏览器自己的规则一样 */ }
			}
			authoringTokenCache = [...names].sort();
			return authoringTokenCache;
		}

		/** Which file/plugin a stylesheet came from — the answer to "这条规则谁写的". */
		function authoringSheetOwner(sheet) {
			const node = sheet.ownerNode;
			if (node === null || node === undefined) return 'unknown';
			return node.dataset?.pluginCss
				?? node.dataset?.plugin
				?? (node.href !== undefined ? 'link:' + String(node.href).split('/').pop() : 'inline');
		}

		/** Emit one API event to whoever is listening; a broken listener must not break the rest. */
		function authoringEmit(event, payload) {
			const listeners = authoringListeners.get(event);
			if (listeners === undefined) return;
			for (const listener of [...listeners]) {
				try { listener(payload); }
				catch (error) { console.warn('[dshCss] listener failed:', error); }
			}
		}

		/** Refuse a write when the user switched console writes off. */
		function authoringRequireWritable() {
			const prefs = normalizeSettings(settingsStore.snapshot());
			if (prefs.devApi === false) {
				throw new Error('dshCss：写盘已被关掉（设置 → 通用 → 控制台写盘）');
			}
		}

		/**
		 * Every selector in a stylesheet, in source order.
		 *
		 * Deliberately dumb: comments stripped, then any `{` whose head is not an at-rule or a
		 * keyframe percentage starts a selector. That is enough to answer "which selectors match
		 * nothing", and being dumb is the point — it must not reject a stylesheet the browser
		 * itself accepts.
		 * @param cssText - the stylesheet text.
		 * @returns selector strings (comma lists split).
		 */
		function authoringSelectorsOf(cssText) {
			const source = String(cssText ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
			const selectors = [];
			let depth = 0;
			let buffer = '';
			for (const character of source) {
				if (character === '{') {
					const head = buffer.trim();
					buffer = '';
					if (head !== '' && !head.startsWith('@') && !/^\d+%$/.test(head) && head !== 'from' && head !== 'to') {
						for (const part of head.split(',')) {
							const selector = part.trim();
							if (selector !== '') selectors.push({ selector, nested: depth > 0 });
						}
					}
					depth += 1;
				}
				else if (character === '}') { depth = Math.max(0, depth - 1); buffer = ''; }
				else buffer += character;
			}
			return selectors;
		}

		/**
		 * Whether a selector can only match in a state the page is not in right now.
		 *
		 * `deadSelectors` asks "would this ever match"; `:hover`, `:focus` and every other state
		 * pseudo answers 0 in a resting page no matter how healthy the rule is. Counting those as
		 * dead made the first live run report 49 dead selectors, most of them hover styles — noise
		 * that would teach the wrong lesson. Pseudo-elements are skipped for the same reason
		 * (`querySelectorAll` never returns a box for `::before`).
		 * @param selector - one selector from the sheet.
		 * @returns true when the count cannot speak for the selector's health.
		 */
		function authoringStateDependent(selector) {
			if (selector.includes('::')) return true;
			if (/:(hover|focus|focus-visible|focus-within|active|visited|target|checked|indeterminate|invalid|user-invalid|placeholder-shown|open|popover-open|autofill)\b/.test(selector)) return true;
			// State CLASSES are the same trap as state pseudo-classes: `.tab.active` matches nothing
			// until that tab is selected, and reporting it as dead is simply wrong. The list is the
			// vocabulary this plugin's own sheets and the surrounding plugins use; an unknown state
			// class still gets reported, which is the right way round (a false alarm beats a miss).
			return /\.(active|on|current|ghost|danger|add|vip|collect|selected|open|collapsed|simple|off|pressed|disabled|checked)\b/.test(selector);
		}

		/** How many elements a selector matches, excluding this plugin's own chrome. */
		function authoringHits(selector) {
			const resolved = resolveSelector(selector);
			if (resolved.invalid === true) return null;
			return resolved.nodes.length;
		}

		/** The first element a selector resolves to, or undefined. */
		function authoringFirst(selector) {
			const resolved = resolveSelector(selector);
			if (resolved.invalid === true) return undefined;
			return resolved.nodes[0];
		}

		/** Build the API object. Separate from `installAuthoringApi` so a test can drive it. */
		function createAuthoringApi() {
			const apiObject = {
				apiVersion: AUTHORING_API_VERSION,
				/** Filled in lazily from the Host's `/about`; `null` until then. */
				version: null,

				help() {
					const table = [
						['dshCss.sheets.list()', '列出样式表（含 active / disabled）'],
						['dshCss.sheets.read(name)', '读一张表的文本；不存在返回 null'],
						['dshCss.sheets.write(name, css)', '写回磁盘（自动进历史版本）'],
						['dshCss.sheets.create(name, css?)', '新建一张表'],
						['dshCss.sheets.rename(name, to)', '改名'],
						['dshCss.sheets.remove(name)', '删除（进归档）'],
						['dshCss.sheets.activate(name)', '设为活动表'],
						['dshCss.sheets.toggle(name, enabled)', '启用 / 停用'],
						['dshCss.sheets.history(name)', '历史版本列表'],
						['dshCss.sheets.restore(name, stamp)', '恢复某个历史版本'],
						['dshCss.sheets.export()', '导出全部（下载 JSON）'],
						['dshCss.css.apply(css, {id})', '临时表：只在本页生效，刷新即消失'],
						['dshCss.css.remove(id)', '移除临时表'],
						['dshCss.css.selectorHits(sel)', '该选择器命中几个元素'],
						['dshCss.css.computed(sel, props?)', '计算样式'],
						['dshCss.css.rulesFor(sel)', '命中的规则与它们来自哪张表'],
						['dshCss.css.deadSelectors(cssText?)', '匹配 0 个元素的选择器（默认查活动表）'],
						['dshCss.tokens.all()', '所有 --dsw-* 令牌与当前值'],
						['dshCss.tokens.get(name)', '单个令牌'],
						['dshCss.tokens.find(property)', '某个属性该用哪些令牌（拾取器同款反查）'],
						['dshCss.inspect(sel)', '元素结构、尺寸、候选选择器'],
						['dshCss.pick()', '点选页面元素 → 稳定选择器（Esc 取消）'],
						['dshCss.on("change", fn)', '样式表被写入 / 切换时回调'],
						['dshCss.host.get(path)', '裸接口，高级用法'],
					];
					console.table(table.map(([call, what]) => ({ call, what })));
					console.info('用法示例：\n'
						+ '  await dshCss.sheets.read("custom.css")\n'
						+ '  dshCss.css.deadSelectors()\n'
						+ '  await dshCss.pick()\n\n'
						+ 'deadSelectors 只代表「当前页面状态」：只出现在别的标签页或关闭中的面板里的元素，'
						+ '会被算成死的。要审那部分，先打开对应视图再跑一次。');
				},

				sheets: {
					async list() {
						const answer = await api('/list');
						return (answer.files ?? []).map(file => ({
							name: file.name,
							bytes: file.bytes,
							mtime: file.mtime,
							active: file.name === answer.active,
							disabled: (answer.disabled ?? []).includes(file.name),
						}));
					},
					async read(name) {
						const sheet = await readSheet(String(name), { optional: true });
						return sheet.absent ? null : sheet.css;
					},
					async write(name, css) {
						authoringRequireWritable();
						const written = await post('/write', { name: String(name), css: String(css ?? '') });
						// The active sheet is the one on the page: repaint immediately instead of waiting
						// for the next poll, so a console write is visible in the same breath.
						const state = store.snapshot();
						if (state.active === String(name)) applySheet(String(name), String(css ?? ''), state.disabled);
						authoringEmit('change', { kind: 'write', name: String(name), rev: written.rev ?? null });
						return { name: String(name), rev: written.rev ?? null };
					},
					async create(name, css) {
						authoringRequireWritable();
						await post('/create', { name: String(name), css: String(css ?? '') });
						authoringEmit('change', { kind: 'create', name: String(name) });
						return String(name);
					},
					async rename(name, to) {
						authoringRequireWritable();
						await post('/rename', { name: String(name), to: String(to) });
						authoringEmit('change', { kind: 'rename', name: String(name), to: String(to) });
						return String(to);
					},
					async remove(name) {
						authoringRequireWritable();
						await post('/delete', { name: String(name) });
						authoringEmit('change', { kind: 'remove', name: String(name) });
						return true;
					},
					async activate(name) {
						await post('/active', { name: String(name) });
						authoringEmit('change', { kind: 'activate', name: String(name) });
						return String(name);
					},
					async toggle(name, enabled) {
						authoringRequireWritable();
						await post('/toggle', { name: String(name), enabled: enabled === true });
						authoringEmit('change', { kind: 'toggle', name: String(name), enabled: enabled === true });
						return enabled === true;
					},
					async history(name) {
						const answer = await api('/history?name=' + encodeURIComponent(String(name)));
						return answer.entries ?? [];
					},
					async restore(name, stamp) {
						authoringRequireWritable();
						const answer = await post('/restore', { name: String(name), stamp: String(stamp) });
						authoringEmit('change', { kind: 'restore', name: String(name), stamp: String(stamp) });
						return answer;
					},
					async export() {
						window.open(API + '/export', '_blank', 'noopener');
						return true;
					},
				},

				css: {
					apply(cssText, options = {}) {
						const id = String(options.id ?? 'try-' + (authoringTransient.size + 1));
						let tag = authoringTransient.get(id);
						if (tag === undefined) {
							tag = document.createElement('style');
							tag.id = 'dshCss-' + id;
							tag.dataset.authoringId = id;
							tag.dataset.plugin = PLUGIN_ID;
							document.head.appendChild(tag);
							authoringTransient.set(id, tag);
						}
						tag.textContent = String(cssText ?? '');
						return id;
					},
					remove(id) {
						const key = String(id);
						const tag = authoringTransient.get(key);
						if (tag === undefined) return false;
						tag.remove();
						authoringTransient.delete(key);
						return true;
					},
					list() {
						return [...authoringTransient].map(([id, tag]) => ({ id, bytes: String(tag.textContent).length }));
					},
					selectorHits(selector) {
						return authoringHits(selector);
					},
					computed(selector, properties) {
						const node = authoringFirst(selector);
						if (node === undefined) return null;
						const style = window.getComputedStyle(node);
						const names = Array.isArray(properties) && properties.length > 0
							? properties
							: ['display', 'position', 'width', 'height', 'color', 'background-color', 'border-radius', 'font-size', 'line-height', 'padding', 'margin', 'gap'];
						const out = {};
						for (const name of names) out[name] = style.getPropertyValue(String(name));
						return out;
					},
					rulesFor(selector) {
						const node = authoringFirst(selector);
						if (node === undefined) return [];
						const found = [];
						for (const sheet of document.styleSheets) {
							let rules;
							try { rules = sheet.cssRules; }
							catch { continue; }
							const owner = authoringSheetOwner(sheet);
							const walk = (list) => {
								for (const rule of list) {
									if (typeof rule.selectorText === 'string') {
										let matched = false;
										try { matched = node.matches(rule.selectorText); }
										catch { matched = false; }
										if (matched) {
											found.push({ selector: rule.selectorText, sheet: owner, declarations: rule.style.cssText.slice(0, 300) });
											if (found.length >= 50) return;
										}
										if (rule.cssRules !== undefined && rule.cssRules.length > 0) walk([...rule.cssRules]);
										continue;
									}
									if (rule.cssRules !== undefined && rule.cssRules.length > 0) walk([...rule.cssRules]);
								}
							};
							walk([...rules]);
							if (found.length >= 50) break;
						}
						return found;
					},
					deadSelectors(cssText) {
						const source = typeof cssText === 'string' && cssText.trim() !== ''
							? cssText
							: (store.snapshot().css ?? '');
						const dead = [];
						for (const entry of authoringSelectorsOf(source)) {
							// @media / @supports 里的选择器：当前视口或特性不满足时匹配数是 0，但规则本身没坏；
							// 状态伪类同理。两类都跳过，只报「在静止页面上也匹配不到」的。
							if (entry.nested || authoringStateDependent(entry.selector)) continue;
							if (authoringHits(entry.selector) === 0) dead.push(entry.selector);
						}
						return [...new Set(dead)];
					},
				},

				tokens: {
					all() {
						const body = window.getComputedStyle(document.body);
						const root = window.getComputedStyle(document.documentElement);
						const out = {};
						for (const name of authoringTokenNames()) {
							const value = (body.getPropertyValue(name) || root.getPropertyValue(name)).trim();
							if (value !== '') out[name] = value;
						}
						return out;
					},
					get(name) {
						const token = String(name).startsWith('--') ? String(name) : '--' + String(name);
						const body = window.getComputedStyle(document.body).getPropertyValue(token).trim();
						if (body !== '') return body;
						const root = window.getComputedStyle(document.documentElement).getPropertyValue(token).trim();
						return root === '' ? null : root;
					},
					find(property, selector) {
						const node = selector === undefined ? document.body : authoringFirst(selector);
						if (node === undefined) return [];
						const style = window.getComputedStyle(node);
						const suggestions = tokenSuggestions(style, collectTokens(document.styleSheets, node));
						return property === undefined
							? suggestions
							: suggestions.filter(entry => entry.property === String(property));
					},
				},

				inspect(selector) {
					const node = authoringFirst(selector);
					if (node === undefined) return null;
					const rect = node.getBoundingClientRect();
					const chain = [];
					let current = node;
					for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth++) {
						chain.push(describeNode(current, 1));
						current = current.parentElement;
					}
					return {
						selector: String(selector),
						summary: describeNode(node),
						tag: String(node.tagName ?? '').toLowerCase(),
						classes: String(node.className ?? '').split(/\s+/).filter(Boolean),
						rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
						parents: chain,
						candidates: selectorCandidates(node, text => queryOwned(document, text).length)
							.map(candidate => ({ selector: candidate.selector, kind: candidate.kind, matches: candidate.matches })),
					};
				},

				pick() {
					return new Promise((resolve) => {
						startPicking({
							onResult: result => resolve(result),
							onCancel: () => resolve(null),
						});
					});
				},

				on(event, listener) {
					const key = String(event);
					if (typeof listener !== 'function') return () => {};
					if (!authoringListeners.has(key)) authoringListeners.set(key, new Set());
					authoringListeners.get(key).add(listener);
					return () => apiObject.off(key, listener);
				},
				off(event, listener) {
					authoringListeners.get(String(event))?.delete(listener);
				},

				host: {
					get: path => api(String(path)),
					post: (path, body) => post(String(path), body),
				},

				/** The same component kit the plugin's own panels use. */
				ui,
			};

			// Version is informational; a failed fetch must not make the API unusable.
			void api('/about')
				.then((about) => { apiObject.version = about.version ?? null; })
				.catch(() => {});

			return apiObject;
		}

		/** Publish the API on `window`, once. */
		function installAuthoringApi() {
			if (typeof window === 'undefined') return;
			if (window.dshCss !== undefined) return;
			window.dshCss = createAuthoringApi();
		}

		// 写 CSS 用的页面 API（docs/authoring-api.md）。放在这里：它引用的常量就在上面刚定义。
		installAuthoringApi();

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
