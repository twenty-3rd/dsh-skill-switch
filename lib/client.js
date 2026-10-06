window.__ModuleLoader__.load({
	id: "dsh-skill-switch",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/state.ts
		/** 工厂：每次插件激活一份 store。 */
		function createSkillSwitchStore() {
			let state = {
				filter: "all",
				query: ""
			};
			const listeners = /* @__PURE__ */ new Set();
			const emit = () => {
				for (const listener of listeners) listener();
			};
			const set = (patch) => {
				state = {
					...state,
					...patch
				};
				emit();
			};
			return {
				getSnapshot: () => state,
				subscribe(fn) {
					listeners.add(fn);
					return () => {
						listeners.delete(fn);
					};
				},
				actions: {
					setFilter(filter) {
						set({ filter });
					},
					setQuery(query) {
						set({ query });
					}
				}
			};
		}
		//#endregion
		//#region src/client/api.ts
		/**
		* /skill-switch API 的类型化 fetch 封装。每次调用都是 POST
		* `/skill-switch/api/<method>`，带上 sessionId 与（已知时）会话 cwd；
		* 失败抛出带 wire code 的 {@link SkillSwitchApiError}。
		*/
		/** wire 层失败。 */
		var SkillSwitchApiError = class extends Error {
			code;
			constructor(code, message) {
				super(message);
				this.code = code;
				this.name = "SkillSwitchApiError";
			}
		};
		/** 把作用域折进 JSON payload（cwd 只在已知时带上）。 */
		function scopePayload(scope, extra) {
			return {
				sessionId: scope.sessionId,
				...scope.cwd !== void 0 && scope.cwd !== "" ? { cwd: scope.cwd } : {},
				...extra
			};
		}
		async function call(method, payload, signal) {
			let response;
			try {
				response = await fetch(`/skill-switch/api/${method}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload),
					...signal !== void 0 ? { signal } : {}
				});
			} catch (error) {
				throw new SkillSwitchApiError("network", error instanceof Error ? error.message : String(error));
			}
			const parsed = await response.json().catch(() => null);
			if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === void 0) throw new SkillSwitchApiError(parsed?.error?.code ?? "http", parsed?.error?.message ?? `HTTP ${response.status}`);
			return parsed.value;
		}
		/** 面板 API 表面（每个调用都带会话作用域）。 */
		const api = {
			/** 加载面板：作用域 + 根 + 合并后的 skill 表。 */
			load: (scope, signal) => call("panel.load", scopePayload(scope, {}), signal),
			/** 一键开/关某个 skill 在本项目的可见性。 */
			setSwitch: (scope, name, blocked) => call("switches.set", scopePayload(scope, {
				name,
				blocked
			})),
			/** 清空本项目全部开关。 */
			resetSwitches: (scope) => call("switches.reset", scopePayload(scope, {})),
			/** 全局删除该 skill 的所有落盘副本。 */
			deleteSkill: (scope, name) => call("skills.delete", scopePayload(scope, { name })),
			/** 补齐 frontmatter，让判定条件 A（在目录里）重新成立。 */
			repairSkill: (scope, name) => call("skills.repair", scopePayload(scope, { name }))
		};
		//#endregion
		//#region src/client/locales.ts
		/**
		* zh/en 文案。走 DSH 的 i18n 系统：client apply 时挂上 `ctx.locale`，
		* `t()` 从活动 locale 解析文案；两份字典同时注册进 DSH 的 locale registry。
		*
		* 判定词只有两个：**有效**（A 在目录里 ∧ B 模型可调用 ∧ C 用户可调用）与
		* **错误**（任一条不成立）。不给"未生效"留文案：那个词同时指过四件不同的事，
		* 是上一版误报的根源。
		*/
		const LOCALE_NS = "dsh-skill-switch";
		/** zh 字典（同时注册进 DSH locale registry）。 */
		const zh = {
			panelTitle: "Skill 开关",
			filterAll: "全部",
			filterBlocked: "已屏蔽",
			searchPlaceholder: "搜索名字或描述…",
			resetAll: "恢复本项全部",
			resetConfirm: "清空本项目所有开关文件？所有 skill 恢复默认可见性。",
			resetConfirmAllow: "本项目是白名单模式（mode=allow）：只清空 on/ 会让白名单变成空集、所有 skill 全部消失。确认会同时移除 mode 文件，让项目回到默认可见性。",
			loading: "加载中…",
			loadFailed: "加载失败",
			emptyAll: "这个项目里还没有发现任何 skill",
			emptyFiltered: "没有符合条件的 skill",
			emptyBlocked: "本项目当前没有屏蔽任何 skill",
			block: "屏蔽",
			unblock: "启用",
			ops: "操作",
			delete: "删除（全部副本）",
			repair: "补齐 frontmatter",
			cancel: "取消",
			confirm: "确认",
			summary: "共 {total} 个 · 已屏蔽 {blocked} · 错误 {error}",
			rootProjectDsh: "项目 .dsh",
			rootProjectAgents: "项目 .agents",
			rootCustom: "自定义",
			rootUserDsh: "用户",
			rootUserAgents: "共享",
			rootBundled: "内置",
			rootLibrary: "Skill 库",
			badgeBlocked: "已屏蔽",
			badgeValid: "有效",
			badgeError: "错误",
			badgeUnassigned: "未分配",
			badgeBundled: "只读",
			badgeVirtual: "运行时",
			copiesOf: "{count} 处副本",
			verdictNotInRegistry: "不在 skill 注册表里（DSH 不会加载它）",
			verdictModelBlocked: "模型不能主动调用（disable-model-invocation）",
			verdictUserBlocked: "用户不能显式调用（user-invocable: false）",
			verdictUnavailable: "当前会话没有活跃的 agent，本次不显示有效/错误判定。",
			issueMissingFrontmatter: "缺少 YAML frontmatter，DSH 会忽略它",
			issueInvalidFrontmatter: "YAML frontmatter 解析失败，DSH 会忽略它",
			issueMissingName: "frontmatter 缺少 name",
			issueInvalidName: "name 不是合法 kebab-case",
			issueMissingDescription: "frontmatter 缺少 description",
			issueInvalidEntryName: "目录/文件名不是合法 kebab-case",
			issueInvalidInvocation: "invocation 字段非法（含遗留键），DSH 会忽略它",
			descFromBody: "描述取自正文首段",
			nameFromEntry: "名字取自目录名",
			notBlockable: "名字不合法，无法按名写开关",
			deleteConfirm: "将在下列位置永久删除该 skill（不可恢复）。其他项目自己的 .dsh/skills 不在本面板扫描范围内：",
			protectedCopy: "受保护，将跳过",
			skippedOf: "有 {count} 处副本被跳过（受保护或删除失败）",
			catalogUnavailable: "runtime skill 目录读取失败，本次不显示有效/错误判定。",
			errBadRequest: "请求不合法（名字或参数有问题）",
			errNotFound: "找不到该 skill 的落盘副本",
			errProtected: "它由运行时提供，磁盘上没有可删除的副本",
			errForbidden: "出于安全考虑拒绝了这次操作",
			errNetwork: "无法连接到 DSH 服务",
			deleteProtected: "该 skill 由运行时提供，磁盘上没有可删除的副本",
			repairConfirm: "给下列文件补上 frontmatter（只改 frontmatter，正文不动）：",
			resetDone: "已清空本项目全部开关",
			toggleDone: "已更新",
			deleteDone: "已删除",
			repairDone: "已补齐 frontmatter",
			wireError: "请求失败"
		};
		/** en 字典（keys 与 zh 完全一致）。 */
		const en = {
			panelTitle: "Skill Switches",
			filterAll: "All",
			filterBlocked: "Blocked",
			searchPlaceholder: "Filter by name or description…",
			resetAll: "Restore all",
			resetConfirm: "Clear every switch file of this project? All skills return to their default visibility.",
			resetConfirmAllow: "This project is in whitelist mode (mode=allow): clearing on/ alone would empty the whitelist and hide every skill. Confirming also removes the mode file so the project returns to its default visibility.",
			loading: "Loading…",
			loadFailed: "Load failed",
			emptyAll: "No skills discovered for this project",
			emptyFiltered: "No skill matches the filter",
			emptyBlocked: "Nothing is blocked in this project",
			block: "Block",
			unblock: "Allow",
			ops: "Actions",
			delete: "Delete (all copies)",
			repair: "Fix frontmatter",
			cancel: "Cancel",
			confirm: "Confirm",
			summary: "{total} total · {blocked} blocked · {error} errors",
			rootProjectDsh: "project .dsh",
			rootProjectAgents: "project .agents",
			rootCustom: "custom",
			rootUserDsh: "user",
			rootUserAgents: "shared",
			rootBundled: "bundled",
			rootLibrary: "library",
			badgeBlocked: "Blocked",
			badgeValid: "Valid",
			badgeError: "Error",
			badgeUnassigned: "Unassigned",
			badgeBundled: "Read-only",
			badgeVirtual: "Runtime",
			copiesOf: "{count} copies",
			verdictNotInRegistry: "not in the skill registry (DSH will not load it)",
			verdictModelBlocked: "the model cannot invoke it (disable-model-invocation)",
			verdictUserBlocked: "the user cannot invoke it (user-invocable: false)",
			verdictUnavailable: "No live agent for this session, so no valid/error verdict is shown.",
			issueMissingFrontmatter: "No YAML frontmatter — DSH ignores it",
			issueInvalidFrontmatter: "YAML frontmatter failed to parse — DSH ignores it",
			issueMissingName: "frontmatter has no name",
			issueInvalidName: "name is not kebab-case",
			issueMissingDescription: "frontmatter has no description",
			issueInvalidEntryName: "directory/file name is not kebab-case",
			issueInvalidInvocation: "invalid invocation field (or a legacy key) — DSH ignores it",
			descFromBody: "description taken from the first body line",
			nameFromEntry: "name taken from the directory name",
			notBlockable: "invalid name — cannot write a switch file",
			deleteConfirm: "Permanently delete this skill from every location below (cannot be undone). Other projects' own .dsh/skills are outside this panel's scan:",
			protectedCopy: "protected — will be skipped",
			skippedOf: "{count} copy/copies were skipped (protected or failed)",
			catalogUnavailable: "The runtime skill catalog could not be read, so no valid/error verdict is shown.",
			errBadRequest: "Invalid request (bad name or argument)",
			errNotFound: "No on-disk copy of that skill was found",
			errProtected: "It is provided by the runtime; there is no on-disk copy to delete",
			errForbidden: "Refused for safety reasons",
			errNetwork: "Cannot reach the DSH service",
			deleteProtected: "This skill is provided by the runtime; there is no on-disk copy to delete",
			repairConfirm: "Add frontmatter to these files (frontmatter only; the body is untouched):",
			resetDone: "All switches cleared for this project",
			toggleDone: "Updated",
			deleteDone: "Deleted",
			repairDone: "Frontmatter fixed",
			wireError: "Request failed"
		};
		/** DSH locale 服务（未挂上时退回浏览器语言）。 */
		let localeService;
		/**
		* 挂上（或传 undefined 摘掉）DSH locale 服务。组件继续调普通的 `t()`，
		* 面板订阅 locale 快照变化后自行重渲染。
		*/
		function attachLocale(service) {
			localeService = service;
		}
		/** 活动 locale（'zh' | 'en' | …）。 */
		function activeLocale() {
			return localeService?.getSnapshot().active ?? (typeof navigator !== "undefined" ? navigator.language : "") ?? "en";
		}
		/** 按活动 locale 取文案；`{name}` 占位符由 params 插值。 */
		function t(key, params) {
			let text = (activeLocale().toLowerCase().startsWith("zh") ? zh : en)[key] ?? key;
			if (params !== void 0) for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
			return text;
		}
		//#endregion
		//#region \0dsh-css:/Users/eggshell/Documents/dsh_doc/ai_skill/packages/dsh-skill-switch/src/client/SkillSwitchPanel.module.css.mjs
		const css = ".U3KkrG_viewRoot{box-sizing:border-box;flex-direction:column;flex:1;align-items:center;height:100%;min-height:0;display:flex;overflow:hidden}.U3KkrG_viewInner{flex-direction:column;flex:1;width:100%;max-width:880px;min-height:0;padding:0 24px;display:flex}.U3KkrG_toolbar{flex:none;align-items:center;gap:8px;padding:8px 14px 0;display:flex}.U3KkrG_filters{gap:6px;min-width:0;display:flex}.U3KkrG_chip{border:1px solid var(--dsw-alias-border-l2,#0000001a);color:var(--dsw-alias-label-secondary,#555);cursor:pointer;background:0 0;border-radius:999px;align-items:center;gap:5px;padding:5px 12px;font-size:12px;line-height:18px;display:inline-flex}.U3KkrG_chipActive{background:var(--dsw-alias-button-primary-fill,#1664ff);border-color:var(--dsw-alias-button-primary-fill,#1664ff);color:var(--dsw-alias-label-primary-inverted,#fff)}.U3KkrG_chipCount{font-variant-numeric:tabular-nums;opacity:.75}.U3KkrG_actions{flex:none;align-items:center;gap:8px;margin-left:auto;display:flex}.U3KkrG_searchInput{border:1px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-bg-layer-2,#fff);width:190px;color:var(--dsw-alias-label-primary,#1a1a1a);box-sizing:border-box;border-radius:8px;outline:none;padding:5px 10px;font-size:12px;line-height:18px}.U3KkrG_searchInput:focus{border-color:var(--dsw-alias-brand-primary,#1664ff)}.U3KkrG_ghostButton{border:1px solid var(--dsw-alias-border-l2,#0000001a);color:var(--dsw-alias-label-secondary,#555);cursor:pointer;background:0 0;border-radius:8px;align-items:center;gap:6px;padding:5px 10px;font-size:12px;line-height:18px;display:inline-flex}.U3KkrG_ghostButton:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000d)}.U3KkrG_ghostButton:disabled,.U3KkrG_chip:disabled{opacity:.5;cursor:default}.U3KkrG_dangerButton{border-color:var(--dsw-alias-state-error-primary,#d93838);color:var(--dsw-alias-state-error-primary,#d93838)}.U3KkrG_dangerButton:hover{background:var(--dsw-alias-state-error-primary,#d93838);color:var(--dsw-alias-label-primary-inverted,#fff)}.U3KkrG_body{flex:1;min-height:0;padding:6px 14px 16px;overflow-y:auto}.U3KkrG_status{text-align:center;color:var(--dsw-alias-label-tertiary,#888);padding:24px 0;font-size:13px}.U3KkrG_summary{color:var(--dsw-alias-label-tertiary,#888);padding:2px 2px 8px;font-size:12px;line-height:18px}.U3KkrG_error{border:1px solid var(--dsw-alias-state-error-primary,#d93838);color:var(--dsw-alias-state-error-primary,#d93838);white-space:pre-wrap;word-break:break-all;border-radius:8px;margin:8px 0;padding:12px;font-size:12px;line-height:18px}.U3KkrG_notice{border:1px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-interactive-bg-hover-accent,#1664ff0f);color:var(--dsw-alias-label-secondary,#555);word-break:break-all;border-radius:8px;margin:8px 0;padding:8px 12px;font-size:12px;line-height:18px}.U3KkrG_skillList{flex-direction:column;gap:8px;display:flex}.U3KkrG_skillCard{border:1px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-bg-layer-2,#fff);text-align:left;border-radius:10px;align-items:flex-start;gap:10px;padding:10px 12px;display:flex;position:relative}.U3KkrG_skillCard:hover,.U3KkrG_skillCardActive{background:var(--dsw-alias-interactive-bg-hover-accent,#1664ff0f)}.U3KkrG_skillCardBlocked .U3KkrG_skillName,.U3KkrG_skillCardBlocked .U3KkrG_skillDesc{opacity:.55}.U3KkrG_skillMain{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.U3KkrG_skillNameRow{align-items:center;gap:6px;min-width:0;display:flex}.U3KkrG_skillName{color:var(--dsw-alias-label-primary,#1a1a1a);text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;line-height:20px;overflow:hidden}.U3KkrG_badge{white-space:nowrap;background:var(--dsw-alias-interactive-bg-active,#0000000f);color:var(--dsw-alias-label-secondary,#555);border:1px solid #0000;border-radius:999px;flex:none;align-items:center;padding:0 8px;font-size:10px;font-weight:500;line-height:16px;display:inline-flex}.U3KkrG_badgeBlocked{background:var(--dsw-alias-state-error-primary,#d93838);color:var(--dsw-alias-label-primary-inverted,#fff)}.U3KkrG_badgeValid{border-color:var(--dsw-alias-state-success-primary,#1a8f4a);color:var(--dsw-alias-state-success-primary,#1a8f4a);background:0 0}.U3KkrG_badgeError{border-color:var(--dsw-alias-state-error-primary,#d93838);color:var(--dsw-alias-state-error-primary,#d93838);background:0 0}.U3KkrG_badgeSource{background:var(--dsw-alias-button-primary-fill,#1664ff);color:var(--dsw-alias-label-primary-inverted,#fff)}.U3KkrG_skillDesc{color:var(--dsw-alias-label-secondary,#555);text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px;overflow:hidden}.U3KkrG_skillMeta{color:var(--dsw-alias-label-tertiary,#888);flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:11px;line-height:16px;display:flex}.U3KkrG_metaWarn{color:var(--dsw-alias-state-error-primary,#d93838)}.U3KkrG_controls{flex:none;align-items:center;gap:8px;display:flex}.U3KkrG_switchButton{cursor:pointer;color:var(--dsw-alias-label-secondary,#555);background:0 0;border:none;align-items:center;gap:6px;padding:0;font-size:11px;line-height:16px;display:inline-flex}.U3KkrG_switchButton:disabled{opacity:.45;cursor:default}.U3KkrG_switchTrack{background:var(--dsw-alias-interactive-bg-active,#00000024);border-radius:999px;width:32px;height:18px;transition:background .12s;display:inline-block;position:relative}.U3KkrG_switchTrackOn{background:var(--dsw-alias-button-primary-fill,#1664ff)}.U3KkrG_switchKnob{background:#fff;border-radius:50%;width:14px;height:14px;transition:transform .12s;position:absolute;top:2px;left:2px;box-shadow:0 1px 2px #00000040}.U3KkrG_switchTrackOn .U3KkrG_switchKnob{transform:translate(14px)}.U3KkrG_opsButton{border:1px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-interactive-bg-active,#0000000f);color:var(--dsw-alias-label-secondary,#555);cursor:pointer;border-radius:999px;flex:none;padding:2px 10px;font-size:11px;line-height:16px}.U3KkrG_opsButton:hover,.U3KkrG_opsButtonActive{background:var(--dsw-alias-button-primary-fill,#1664ff);border-color:var(--dsw-alias-button-primary-fill,#1664ff);color:var(--dsw-alias-label-primary-inverted,#fff)}.U3KkrG_cardMenu{z-index:50;border:1px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-bg-layer-2,#fff);border-radius:10px;flex-direction:column;gap:2px;min-width:190px;max-width:420px;padding:4px;display:flex;position:absolute;top:calc(100% - 4px);right:8px;box-shadow:0 6px 20px #00000024}.U3KkrG_menuItem{text-align:left;color:var(--dsw-alias-label-primary,#1a1a1a);cursor:pointer;background:0 0;border:none;border-radius:6px;padding:7px 10px;font-size:12px;line-height:18px}.U3KkrG_menuItem:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000d)}.U3KkrG_menuItem:disabled{opacity:.55;cursor:default}.U3KkrG_menuDanger{color:var(--dsw-alias-state-error-primary,#d93838)}.U3KkrG_menuText{color:var(--dsw-alias-label-primary,#1a1a1a);padding:2px 4px;font-size:12px;line-height:18px}.U3KkrG_menuList{color:var(--dsw-alias-label-secondary,#555);word-break:break-all;margin:0;padding:0 4px 2px 18px;font-size:11px;line-height:16px}.U3KkrG_menuActions{gap:6px;padding:4px 4px 2px;display:flex}.U3KkrG_menuError{color:var(--dsw-alias-state-error-primary,#d93838);word-break:break-all;padding:4px 4px 2px;font-size:11px;line-height:16px}";
		const tagId = "dsh-skill-switch/SkillSwitchPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-skill-switch";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SkillSwitchPanel_module_css_default = {
			"actions": "U3KkrG_actions",
			"badge": "U3KkrG_badge",
			"badgeBlocked": "U3KkrG_badgeBlocked",
			"badgeError": "U3KkrG_badgeError",
			"badgeSource": "U3KkrG_badgeSource",
			"badgeValid": "U3KkrG_badgeValid",
			"body": "U3KkrG_body",
			"cardMenu": "U3KkrG_cardMenu",
			"chip": "U3KkrG_chip",
			"chipActive": "U3KkrG_chipActive",
			"chipCount": "U3KkrG_chipCount",
			"controls": "U3KkrG_controls",
			"dangerButton": "U3KkrG_dangerButton",
			"error": "U3KkrG_error",
			"filters": "U3KkrG_filters",
			"ghostButton": "U3KkrG_ghostButton",
			"menuActions": "U3KkrG_menuActions",
			"menuDanger": "U3KkrG_menuDanger",
			"menuError": "U3KkrG_menuError",
			"menuItem": "U3KkrG_menuItem",
			"menuList": "U3KkrG_menuList",
			"menuText": "U3KkrG_menuText",
			"metaWarn": "U3KkrG_metaWarn",
			"notice": "U3KkrG_notice",
			"opsButton": "U3KkrG_opsButton",
			"opsButtonActive": "U3KkrG_opsButtonActive",
			"searchInput": "U3KkrG_searchInput",
			"skillCard": "U3KkrG_skillCard",
			"skillCardActive": "U3KkrG_skillCardActive",
			"skillCardBlocked": "U3KkrG_skillCardBlocked",
			"skillDesc": "U3KkrG_skillDesc",
			"skillList": "U3KkrG_skillList",
			"skillMain": "U3KkrG_skillMain",
			"skillMeta": "U3KkrG_skillMeta",
			"skillName": "U3KkrG_skillName",
			"skillNameRow": "U3KkrG_skillNameRow",
			"status": "U3KkrG_status",
			"summary": "U3KkrG_summary",
			"switchButton": "U3KkrG_switchButton",
			"switchKnob": "U3KkrG_switchKnob",
			"switchTrack": "U3KkrG_switchTrack",
			"switchTrackOn": "U3KkrG_switchTrackOn",
			"toolbar": "U3KkrG_toolbar",
			"viewInner": "U3KkrG_viewInner",
			"viewRoot": "U3KkrG_viewRoot"
		};
		//#endregion
		//#region src/client/SkillSwitchPanel.tsx
		/**
		* Skill 开关面板：本项目 skill 的一键屏蔽/恢复 + 全局删除。
		*
		* 刻意只做这两件事（外加「缺 name/description 的 skill 也要看得见」这一点
		* 优化）。dsh-skills-manager 的创建 / 编辑 / 库分配 / 重命名 / 同步等能力
		* 一律不在这里重复。
		*
		* 视觉与交互沿用同一个会话视图座位的语言（同款工具栏、卡片、徽标、
		* 「操作」下拉菜单与二次确认），所以两个面板切换时手感一致。
		*
		* 数据全部来自 host 半体的 /skill-switch API；每次变更都用服务端回传的完整
		* 面板数据替换本地状态，避免第二次请求引入的竞态。
		*/
		/**
		* 把 wire 失败折成一行**本地化**消息。
		*
		* host 侧的 error.message 是机器/开发者面的（英文细节），直接显示会让中文界面
		* 冒出英文、英文界面冒出中文。这里按 wire code 出本地化文案，只有未知 code
		* 才退回原始消息。
		*/
		function messageOf(error) {
			if (error instanceof SkillSwitchApiError) switch (error.code) {
				case "bad-request": return t("errBadRequest");
				case "not-found": return t("errNotFound");
				case "protected": return t("errProtected");
				case "forbidden": return t("errForbidden");
				case "network": return t("errNetwork");
				default: return `${t("wireError")}: ${error.message}`;
			}
			return error instanceof Error ? error.message : String(error);
		}
		/** 来源根 id → 本地化徽标文案。 */
		function sourceLabel(source) {
			switch (source) {
				case "project-dsh": return t("rootProjectDsh");
				case "project-agents": return t("rootProjectAgents");
				case "custom": return t("rootCustom");
				case "user-dsh": return t("rootUserDsh");
				case "user-agents": return t("rootUserAgents");
				case "bundled": return t("rootBundled");
				case "library": return t("rootLibrary");
				default: return source;
			}
		}
		/** frontmatter 事实 → 本地化文案（作为「错误」的解释：为什么它不在目录里）。 */
		function issueLabel(issue) {
			switch (issue) {
				case "missing-frontmatter": return t("issueMissingFrontmatter");
				case "invalid-frontmatter": return t("issueInvalidFrontmatter");
				case "missing-name": return t("issueMissingName");
				case "invalid-name": return t("issueInvalidName");
				case "missing-description": return t("issueMissingDescription");
				case "invalid-entry-name": return t("issueInvalidEntryName");
				case "invalid-invocation": return t("issueInvalidInvocation");
				default: return issue;
			}
		}
		/**
		* 判定失败项 → 本地化文案。
		*
		* 「错误」必须说清是 A/B/C 哪一条不成立：只写"错误"用户无法行动，而"原因未知"
		* 那种兜底说法（上一版）是把"我没读到"当成了结论。
		*/
		function verdictLabel(error) {
			switch (error) {
				case "not-in-registry": return t("verdictNotInRegistry");
				case "model-not-invocable": return t("verdictModelBlocked");
				case "user-not-invocable": return t("verdictUserBlocked");
				default: return error;
			}
		}
		/**
		* 面板主体：筛选栏 + 作用域行 + skill 列表。
		* `scope` 由挂载它的会话视图提供（座位作用域，不读全局"当前会话"）。
		*/
		function SkillSwitchBody(props) {
			const { store, scope } = props;
			const state = store.getSnapshot();
			const [, force] = (0, react.useState)(0);
			(0, react.useEffect)(() => store.subscribe(() => force((v) => v + 1)), [store]);
			const sessionId = scope.sessionId;
			const cwd = scope.cwd;
			const [data, setData] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			const [busyName, setBusyName] = (0, react.useState)(null);
			const [busyGlobal, setBusyGlobal] = (0, react.useState)(false);
			const [confirmReset, setConfirmReset] = (0, react.useState)(false);
			const [menu, setMenu] = (0, react.useState)(null);
			const requestSeq = (0, react.useRef)(0);
			const load = (0, react.useCallback)(async () => {
				const seq = ++requestSeq.current;
				setLoading(true);
				setError(null);
				try {
					const next = await api.load(cwd !== void 0 && cwd !== "" ? {
						sessionId,
						cwd
					} : { sessionId });
					if (seq !== requestSeq.current) return;
					setData(next);
					setLoading(false);
				} catch (cause) {
					if (seq !== requestSeq.current) return;
					setError(messageOf(cause));
					setLoading(false);
				}
			}, [sessionId, cwd]);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			/** 菜单外点击 / Esc 关闭。 */
			(0, react.useEffect)(() => {
				if (menu === null) return;
				const onPointerDown = (event) => {
					const el = event.target;
					if (el !== null && el.closest("[data-skill-card]")) return;
					setMenu(null);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setMenu(null);
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [menu]);
			const scopeOf = (0, react.useCallback)(() => cwd !== void 0 && cwd !== "" ? {
				sessionId,
				cwd
			} : { sessionId }, [sessionId, cwd]);
			/** 所有变更共用的执行壳：忙态、错误、用服务端回传的数据整体替换、成功提示。 */
			const run = (0, react.useCallback)(async (key, action, done) => {
				setBusyName(key);
				setError(null);
				setNotice(null);
				try {
					const next = await action();
					setData(next);
					const skipped = next.lastAction?.skipped?.length ?? 0;
					setNotice(skipped > 0 ? `${done(next)} · ${t("skippedOf", { count: skipped })}` : done(next));
					setMenu(null);
				} catch (cause) {
					setError(messageOf(cause));
				} finally {
					setBusyName(null);
				}
			}, []);
			const toggle = (0, react.useCallback)(async (row) => {
				await run(row.name, () => api.setSwitch(scopeOf(), row.name, !row.blocked), () => t("toggleDone"));
			}, [run, scopeOf]);
			const removeSkill = (0, react.useCallback)(async (row) => {
				await run(row.name, () => api.deleteSkill(scopeOf(), row.name), () => t("deleteDone"));
			}, [run, scopeOf]);
			const repairSkill = (0, react.useCallback)(async (row) => {
				await run(row.name, () => api.repairSkill(scopeOf(), row.name), () => t("repairDone"));
			}, [run, scopeOf]);
			const resetAll = (0, react.useCallback)(async () => {
				setBusyGlobal(true);
				setError(null);
				setNotice(null);
				try {
					const next = await api.resetSwitches(scopeOf());
					setData(next);
					setNotice(t("resetDone"));
					setConfirmReset(false);
				} catch (cause) {
					setError(messageOf(cause));
					setConfirmReset(false);
				} finally {
					setBusyGlobal(false);
				}
			}, [scopeOf]);
			const query = state.query.trim().toLowerCase();
			const rows = (data?.skills ?? []).filter((row) => {
				if (state.filter === "blocked" && !row.blocked) return false;
				if (query !== "") {
					if (!`${row.name} ${row.description}`.toLowerCase().includes(query)) return false;
				}
				return true;
			});
			const total = data?.skills.length ?? 0;
			const blockedCount = (data?.skills ?? []).filter((row) => row.blocked).length;
			const errorCount = (data?.skills ?? []).filter((row) => (row.errors ?? []).length > 0).length;
			const switchCount = (data?.off.length ?? 0) + (data?.on.length ?? 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: SkillSwitchPanel_module_css_default.toolbar,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SkillSwitchPanel_module_css_default.filters,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilterChip, {
							label: t("filterAll"),
							count: total,
							active: state.filter === "all",
							onClick: () => store.actions.setFilter("all")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilterChip, {
							label: t("filterBlocked"),
							count: blockedCount,
							active: state.filter === "blocked",
							onClick: () => store.actions.setFilter("blocked")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SkillSwitchPanel_module_css_default.actions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: SkillSwitchPanel_module_css_default.searchInput,
							value: state.query,
							placeholder: t("searchPlaceholder"),
							"aria-label": t("searchPlaceholder"),
							onChange: (event) => store.actions.setQuery(event.target.value)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: SkillSwitchPanel_module_css_default.ghostButton,
							disabled: busyGlobal || data === null || switchCount === 0,
							title: t("resetAll"),
							onClick: () => setConfirmReset(true),
							children: t("resetAll")
						})]
					})]
				}),
				confirmReset && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: SkillSwitchPanel_module_css_default.notice,
					children: [data?.mode === "allow" ? t("resetConfirmAllow") : t("resetConfirm"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SkillSwitchPanel_module_css_default.menuActions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: `${SkillSwitchPanel_module_css_default.ghostButton} ${SkillSwitchPanel_module_css_default.dangerButton}`,
							disabled: busyGlobal,
							onClick: () => {
								resetAll();
							},
							children: busyGlobal ? "…" : t("confirm")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: SkillSwitchPanel_module_css_default.ghostButton,
							disabled: busyGlobal,
							onClick: () => setConfirmReset(false),
							children: t("cancel")
						})]
					})]
				}),
				error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: SkillSwitchPanel_module_css_default.error,
					children: error
				}),
				notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: SkillSwitchPanel_module_css_default.notice,
					children: notice
				}),
				data?.catalogError === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: SkillSwitchPanel_module_css_default.error,
					children: t("catalogUnavailable")
				}),
				data !== null && data.verdictAvailable === false && data.catalogError !== true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: SkillSwitchPanel_module_css_default.notice,
					children: t("verdictUnavailable")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: SkillSwitchPanel_module_css_default.body,
					children: [
						loading && data === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: SkillSwitchPanel_module_css_default.status,
							children: t("loading")
						}),
						!loading && data === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: SkillSwitchPanel_module_css_default.status,
							children: t("loadFailed")
						}),
						data !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: SkillSwitchPanel_module_css_default.summary,
							children: t("summary", {
								total,
								blocked: blockedCount,
								error: errorCount
							})
						}), rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: SkillSwitchPanel_module_css_default.status,
							children: emptyLabel(state.filter, query !== "", total)
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: SkillSwitchPanel_module_css_default.skillList,
							children: rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillCard, {
								row,
								showVerdict: data.verdictAvailable,
								busy: busyName === row.name,
								menu: menu !== null && menu.name === row.name ? menu : null,
								onToggle: () => {
									toggle(row);
								},
								onOpenMenu: () => {
									setMenu((prev) => prev !== null && prev.name === row.name && prev.mode === "actions" ? null : {
										name: row.name,
										mode: "actions"
									});
								},
								onAskDelete: () => setMenu({
									name: row.name,
									mode: "confirm-delete"
								}),
								onAskRepair: () => setMenu({
									name: row.name,
									mode: "confirm-repair"
								}),
								onConfirmDelete: () => {
									removeSkill(row);
								},
								onConfirmRepair: () => {
									repairSkill(row);
								},
								onCloseMenu: () => setMenu(null)
							}, row.name))
						})] })
					]
				})
			] });
		}
		/** 一个筛选 chip。 */
		function FilterChip(props) {
			const { label, count, active, onClick } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: `${SkillSwitchPanel_module_css_default.chip} ${active ? SkillSwitchPanel_module_css_default.chipActive : ""}`,
				onClick,
				children: [label, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: SkillSwitchPanel_module_css_default.chipCount,
					children: count
				})]
			});
		}
		/** 空列表文案：区分"本来就没有"和"被筛选掉了"。 */
		function emptyLabel(filter, searching, total) {
			if (total === 0) return t("emptyAll");
			if (searching) return t("emptyFiltered");
			if (filter === "blocked") return t("emptyBlocked");
			return t("emptyFiltered");
		}
		/**
		* 一张 skill 卡片：左事实（名字 / 来源 / 描述 / 判定与原因），右操作
		* （一键开关键与「操作」菜单）。导出是为了能在不启动 effect 的服务端渲染里
		* 覆盖每条分支。
		*/
		function SkillCard(props) {
			const { row, showVerdict, busy, menu } = props;
			const hasIssues = row.issues.length > 0;
			const canRepair = hasIssues && row.descriptionSource !== "none" && row.copies.some((copy) => copy.deletable);
			const libraryOnly = row.copies.length > 0 && row.copies.every((copy) => !copy.live);
			const errors = showVerdict ? row.errors ?? [] : [];
			const valid = errors.length === 0;
			const showMeta = errors.length > 0 || hasIssues || row.nameSource === "entry" || row.descriptionSource === "body" || row.copies.length > 1 || !row.blockable;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `${SkillSwitchPanel_module_css_default.skillCard} ${row.blocked ? SkillSwitchPanel_module_css_default.skillCardBlocked : ""} ${menu !== null ? SkillSwitchPanel_module_css_default.skillCardActive : ""}`,
				"data-skill-card": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SkillSwitchPanel_module_css_default.skillMain,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: SkillSwitchPanel_module_css_default.skillNameRow,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SkillSwitchPanel_module_css_default.skillName,
										title: row.name,
										children: row.name
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `${SkillSwitchPanel_module_css_default.badge} ${SkillSwitchPanel_module_css_default.badgeSource}`,
										children: sourceLabel(row.source)
									}),
									showVerdict && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `${SkillSwitchPanel_module_css_default.badge} ${valid ? SkillSwitchPanel_module_css_default.badgeValid : SkillSwitchPanel_module_css_default.badgeError}`,
										children: valid ? t("badgeValid") : t("badgeError")
									}),
									row.blocked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `${SkillSwitchPanel_module_css_default.badge} ${SkillSwitchPanel_module_css_default.badgeBlocked}`,
										children: t("badgeBlocked")
									}),
									libraryOnly && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SkillSwitchPanel_module_css_default.badge,
										children: t("badgeUnassigned")
									}),
									row.source === "bundled" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SkillSwitchPanel_module_css_default.badge,
										children: t("badgeBundled")
									}),
									row.form === "virtual" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SkillSwitchPanel_module_css_default.badge,
										children: t("badgeVirtual")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: SkillSwitchPanel_module_css_default.skillDesc,
								title: row.description,
								children: row.description !== "" ? row.description : "—"
							}),
							showMeta && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: SkillSwitchPanel_module_css_default.skillMeta,
								children: [
									errors.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SkillSwitchPanel_module_css_default.metaWarn,
										children: errors.map(verdictLabel).join(" · ")
									}),
									hasIssues && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SkillSwitchPanel_module_css_default.metaWarn,
										children: row.issues.map(issueLabel).join(" · ")
									}),
									row.nameSource === "entry" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("nameFromEntry") }),
									row.descriptionSource === "body" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("descFromBody") }),
									row.copies.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("copiesOf", { count: row.copies.length }) }),
									!row.blockable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SkillSwitchPanel_module_css_default.metaWarn,
										children: t("notBlockable")
									})
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SkillSwitchPanel_module_css_default.controls,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: SkillSwitchPanel_module_css_default.switchButton,
							disabled: busy || !row.blockable,
							title: row.blockable ? `${row.blocked ? t("unblock") : t("block")} · ${row.name}` : t("notBlockable"),
							onClick: props.onToggle,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: `${SkillSwitchPanel_module_css_default.switchTrack} ${row.blocked ? SkillSwitchPanel_module_css_default.switchTrackOn : ""}`,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: SkillSwitchPanel_module_css_default.switchKnob })
							}), busy ? "…" : row.blocked ? t("unblock") : t("block")]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: `${SkillSwitchPanel_module_css_default.opsButton} ${menu !== null ? SkillSwitchPanel_module_css_default.opsButtonActive : ""}`,
							"aria-label": t("ops"),
							onClick: props.onOpenMenu,
							children: t("ops")
						})]
					}),
					menu !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: SkillSwitchPanel_module_css_default.cardMenu,
						onClick: (event) => event.stopPropagation(),
						children: menu.mode === "confirm-delete" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: SkillSwitchPanel_module_css_default.menuText,
								children: t("deleteConfirm")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: SkillSwitchPanel_module_css_default.menuList,
								children: row.copies.map((copy) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [copy.form === "bundle" ? copy.directory : copy.path, copy.deletable ? "" : ` — ${t("protectedCopy")}`] }, copy.path))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: SkillSwitchPanel_module_css_default.menuActions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${SkillSwitchPanel_module_css_default.ghostButton} ${SkillSwitchPanel_module_css_default.dangerButton}`,
									disabled: busy,
									onClick: props.onConfirmDelete,
									children: busy ? "…" : t("delete")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: SkillSwitchPanel_module_css_default.ghostButton,
									disabled: busy,
									onClick: props.onCloseMenu,
									children: t("cancel")
								})]
							})
						] }) : menu.mode === "confirm-repair" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: SkillSwitchPanel_module_css_default.menuText,
								children: t("repairConfirm")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: SkillSwitchPanel_module_css_default.menuList,
								children: row.copies.filter((copy) => copy.deletable).map((copy) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: copy.path }, copy.path))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: SkillSwitchPanel_module_css_default.menuActions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: SkillSwitchPanel_module_css_default.ghostButton,
									disabled: busy,
									onClick: props.onConfirmRepair,
									children: busy ? "…" : t("repair")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: SkillSwitchPanel_module_css_default.ghostButton,
									disabled: busy,
									onClick: props.onCloseMenu,
									children: t("cancel")
								})]
							})
						] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							canRepair && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: SkillSwitchPanel_module_css_default.menuItem,
								disabled: busy,
								onClick: props.onAskRepair,
								children: t("repair")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${SkillSwitchPanel_module_css_default.menuItem} ${SkillSwitchPanel_module_css_default.menuDanger}`,
								disabled: busy || row.copies.length === 0,
								title: row.copies.length === 0 ? t("deleteProtected") : void 0,
								onClick: props.onAskDelete,
								children: t("delete")
							}),
							row.copies.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: SkillSwitchPanel_module_css_default.menuError,
								children: t("deleteProtected")
							})
						] })
					})
				]
			});
		}
		//#endregion
		//#region src/client/SkillSwitchView.tsx
		/**
		* Skill 开关作为会话视图标签——与 对话（chat）/ 轨迹（trajectory）/
		* Skills 管理器（skills）占同一个座位：会话头部的标签条选中它，中间栏
		* 用它替换对话记录。
		*
		* 座位是会话作用域的：`inject` 工厂把本实例所属的 SessionId 交给组件，
		* 请求作用域从不依赖全局"当前会话"字段（DSH 0.2 已移除该字段）。
		*/
		/**
		* 一个会话的 Skill 开关视图。
		* @param props - 注入的上下文、store 与所属会话。
		* @returns 铺满会话视图区域的面板主体。
		*/
		function SkillSwitchView(props) {
			const { ctx, store, sessionId } = props;
			const [, force] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				const offSessions = ctx.sessions.list.subscribe(() => force((v) => v + 1));
				const offLocale = ctx.locale.subscribe(() => force((v) => v + 1));
				return () => {
					offSessions();
					offLocale();
				};
			}, [ctx]);
			const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
			const scope = cwd !== void 0 && cwd !== "" ? {
				sessionId,
				cwd
			} : { sessionId };
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: SkillSwitchPanel_module_css_default.viewRoot,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: SkillSwitchPanel_module_css_default.viewInner,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillSwitchBody, {
						store,
						scope
					})
				})
			});
		}
		//#endregion
		//#region src/client/index.tsx
		/** 客户端挂载前需要的服务（由 client runtime 提供）。 */
		const inject = [
			"slots",
			"locale",
			"sessions"
		];
		/** 视图标签 id：与本会话其它视图（chat / trajectory / skills）不冲突。 */
		const SKILL_SWITCH_VIEW_ID = "skill-switch";
		/** 标签条内的顺序：chat 0、trajectory 10、skills 20、skill-switch 30。 */
		const SKILL_SWITCH_VIEW_ORDER = 30;
		/**
		* client 插件主体。
		* @param ctx - client cordis 上下文（slots / locale / sessions）。
		*/
		function apply(ctx) {
			attachLocale(ctx.locale);
			ctx.effect(() => {
				const offZh = ctx.locale.register(LOCALE_NS, "zh", zh);
				const offEn = ctx.locale.register(LOCALE_NS, "en", en);
				return () => {
					offZh();
					offEn();
					attachLocale(void 0);
				};
			}, "dsh-skill-switch: dictionaries");
			const store = createSkillSwitchStore();
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: SKILL_SWITCH_VIEW_ID,
				order: 30,
				label: () => t("panelTitle"),
				inject: (sessionId) => ({
					ctx,
					store,
					sessionId
				})
			}, SkillSwitchView));
		}
		//#endregion
		exports.SKILL_SWITCH_VIEW_ID = SKILL_SWITCH_VIEW_ID;
		exports.SKILL_SWITCH_VIEW_ORDER = SKILL_SWITCH_VIEW_ORDER;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map