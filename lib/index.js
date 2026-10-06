import Schema from "@deepseek-ai/schemastery";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { parse } from "yaml";
//#region src/wire.ts
/** One API failure with its wire code and HTTP status. */
var SwitchError = class extends Error {
	code;
	status;
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
		this.name = "SwitchError";
	}
};
/** Body size bound of one JSON request (defense against unbounded reads). */
const MAX_BODY_BYTES = 1 << 21;
/** Read and parse the JSON request body (bounded; malformed → bad-request). */
async function readJsonBody(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		total += buffer.length;
		if (total > MAX_BODY_BYTES) throw new SwitchError("bad-request", "request body too large");
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.trim() === "") return {};
	try {
		return JSON.parse(text);
	} catch {
		throw new SwitchError("bad-request", "request body is not valid JSON");
	}
}
/** Write a JSON response with the given status. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(payload);
}
/** Write the success envelope. */
function writeOk(res, value) {
	writeJson(res, 200, {
		ok: true,
		value
	});
}
/** Write the failure envelope for any thrown value (unknown → internal 500). */
function writeError(res, error) {
	if (error instanceof SwitchError) {
		writeJson(res, error.status, {
			ok: false,
			error: {
				code: error.code,
				message: error.message
			}
		});
		return;
	}
	writeJson(res, 500, {
		ok: false,
		error: {
			code: "internal",
			message: error instanceof Error ? error.message : String(error)
		}
	});
}
/** Narrow an unknown payload value to a non-empty string, else throw bad-request. */
function requireString(payload, key) {
	const value = payload?.[key];
	if (typeof value !== "string" || value === "") throw new SwitchError("bad-request", `missing or invalid "${key}"`);
	return value;
}
/** Narrow an unknown payload value to a string (empty allowed), else throw bad-request. */
function optionalString(payload, key) {
	const value = payload?.[key];
	if (value === void 0 || value === null) return "";
	if (typeof value !== "string") throw new SwitchError("bad-request", `invalid "${key}"`);
	return value;
}
/** Narrow an unknown payload value to a boolean, else throw bad-request. */
function requireBoolean(payload, key) {
	const value = payload?.[key];
	if (typeof value !== "boolean") throw new SwitchError("bad-request", `missing or invalid "${key}" (expected boolean)`);
	return value;
}
//#endregion
//#region src/trust-fence.ts
function header(headers, name) {
	const value = headers[name];
	return typeof value === "string" ? value : void 0;
}
/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return;
	}
}
/** Whether a normalized URL hostname names the local loopback authority. */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** Canonical authority form: hostname, or hostname:port when a port was written. */
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
/** Whether the request authority matches a trustedHosts entry (exact or port-less). */
function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		const entryUrl = parseAuthority(entry);
		if (entryUrl === void 0) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host;
	});
}
/**
* Decide whether one skill-switch request may reach the plugin routes.
* @param request - node HTTP request facts (headers).
* @param trustedHosts - non-loopback authorities this deployment serves.
* @returns true when the Host is ours (loopback or trusted) and browser markers are same-origin.
*/
function isTrustedApiRequest(request, trustedHosts) {
	const host = header(request.headers, "host");
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
	const origin = header(request.headers, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
//#endregion
//#region src/switches.ts
/**
* dsh-skill-switch 的纯逻辑半体：项目根解析、开关目录读写、目录过滤。
*
* 本模块不依赖 cordis / dsh 任何运行时服务，只依赖 node:fs / node:path，
* 因此可以独立单测（见 tests/switches.spec.ts）。宿主接线在 src/index.ts。
*
* 开关文件协议（相对项目根）——与 v1 完全兼容，v1 手写的开关目录无需迁移：
*
*   <projectRoot>/.dsh/skill-switches/
*   ├── mode           # 可选：内容第一行为 "deny"（默认）或 "allow"
*   ├── off/<name>     # deny 模式：隐藏该 skill（文件名 <name> 或 <name>.md）
*   └── on/<name>      # allow 模式：仅这些 skill 可见
*
* - 项目根 = 自 cwd 向上找到第一个含 .git 的目录；找不到则用 cwd 本身
*   （与 @deepseek-ai/dsh-skill-filesystem 的 findProjectRoot 语义一致）。
* - 开关文件内容是自由文本（写给人和日志看），过滤只看文件名。
* - 非法名字（非 kebab-case）与子目录会被忽略并上报，绝不抛错。
*
* "屏蔽 / 不屏蔽" 与集合的映射（让面板的开关在两种模式下都语义一致）：
* - deny 模式：屏蔽 = 在 off/ 建文件；恢复 = 删掉 off/ 里的同名文件
* - allow 模式：屏蔽 = 删掉 on/ 里的同名文件；恢复 = 在 on/ 建文件
* 两种情况下都会顺手清掉另一侧的同名文件，避免模式切换后语义漂移。
*/
/** 公开 skill 名语法（与 dsh-skill 的 SKILL_NAME / isSkillName 一致）。 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** 一个 skill 名是否符合公开 kebab-case 语法。 */
function isSkillName(name) {
	return SKILL_NAME.test(name);
}
/** 开关目录不存在或不可读时返回的空状态：过滤器看到它就纯透传。 */
const ABSENT_STATE = Object.freeze({
	present: false,
	mode: "deny",
	off: Object.freeze(/* @__PURE__ */ new Set()),
	on: Object.freeze(/* @__PURE__ */ new Set()),
	ignored: Object.freeze([])
});
/**
* 自 cwd 向上找项目根：第一个包含 .git 的目录；到文件系统顶还没找到
* 就回退为 cwd 自身。与 dsh-skill-filesystem 的同名函数语义保持一致，
* 保证开关目录和 .dsh/skills 解析到同一个根。
* @param cwd - 会话工作目录（session.header.cwd）。
* @returns 项目根的绝对路径。
*/
async function findProjectRoot(cwd) {
	let current = resolve(cwd);
	for (;;) {
		if (await pathExists$2(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return resolve(cwd);
		current = parent;
	}
}
/**
* 解析 mode 文件内容：取第一行、去空白、转小写；只认 "deny" / "allow"。
* @param text - mode 文件的原始内容。
* @returns 识别出的模式，无法识别返回 undefined。
*/
function parseMode(text) {
	if (typeof text !== "string") return void 0;
	const firstLine = text.split(/\r?\n/, 1)[0]?.trim().toLowerCase() ?? "";
	if (firstLine === "deny") return "deny";
	if (firstLine === "allow") return "allow";
}
/**
* 把一个开关文件名归一化为 skill 名：剥掉可选的 .md 后缀并做语法校验。
* @param fileName - 目录项名字（如 "review"、"api-design.md"）。
* @returns 合法 skill 名；非法（大写、空格、.txt 等）返回 undefined。
*/
function normalizeSwitchName(fileName) {
	const base = fileName.endsWith(".md") ? fileName.slice(0, -3) : fileName;
	if (!SKILL_NAME.test(base)) return void 0;
	return base;
}
/**
* 读取一个开关集合目录（off/ 或 on/），返回合法 skill 名集合与被忽略项。
* 目录不存在或不可读都视为空集合，绝不抛错。
* @param dir - 集合目录的绝对路径。
*/
async function readNameSet(dir) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return {
			names: /* @__PURE__ */ new Set(),
			ignored: []
		};
	}
	const names = /* @__PURE__ */ new Set();
	const ignored = [];
	for (const entry of entries) {
		if (!entry.isFile()) {
			ignored.push(`${entry.name}/`);
			continue;
		}
		const normalized = normalizeSwitchName(entry.name);
		if (normalized === void 0) ignored.push(entry.name);
		else names.add(normalized);
	}
	return {
		names,
		ignored
	};
}
/**
* 读取项目根下开关目录的完整状态。
* @param projectRoot - 项目根（来自 findProjectRoot）。
* @param switchesDir - 相对项目根的开关目录（配置项 switchesDir）。
* @param defaultMode - 无 mode 文件（或内容无法识别）时的默认模式。
* @returns 状态；present 为 false 表示目录不存在，调用方应纯透传。
*/
async function readSwitchState(projectRoot, switchesDir, defaultMode) {
	const base = join(projectRoot, switchesDir);
	try {
		await readdir(base);
	} catch {
		return {
			present: false,
			mode: defaultMode === "allow" ? "allow" : "deny",
			off: /* @__PURE__ */ new Set(),
			on: /* @__PURE__ */ new Set(),
			ignored: []
		};
	}
	let mode;
	try {
		mode = parseMode(await readFile(join(base, "mode"), "utf8"));
	} catch {}
	if (mode !== "deny" && mode !== "allow") mode = defaultMode === "allow" ? "allow" : "deny";
	const off = await readNameSet(join(base, "off"));
	const on = await readNameSet(join(base, "on"));
	return {
		present: true,
		mode,
		off: off.names,
		on: on.names,
		ignored: [...off.ignored.map((name) => `off/${name}`), ...on.ignored.map((name) => `on/${name}`)]
	};
}
/**
* 判定一个 skill 名在给定状态下是否应被隐藏。
* @param state - readSwitchState 的结果。
* @param name - skill 名。
* @returns true 表示应从目录与 get() 中隐藏。
*/
function isHidden(state, name) {
	if (state === void 0 || state.present !== true) return false;
	if (state.mode === "allow") return !state.on.has(name);
	return state.off.has(name);
}
/**
* 按状态过滤 skill 摘要数组（过滤是幂等的，重复应用同一状态无害）。
* @param state - readSwitchState 的结果。
* @param skills - skill 摘要（含 name 字段）数组。
* @returns 过滤后的新数组；状态不生效时原样返回。
*/
function filterSkills(state, skills) {
	if (state === void 0 || state.present !== true) return skills;
	if (state.mode === "allow") return skills.filter((skill) => state.on.has(skill.name));
	return skills.filter((skill) => !state.off.has(skill.name));
}
/**
* 计算状态的比较指纹，用于变更日志的差量检测。
* @param state - readSwitchState 的结果。
*/
function stateFingerprint(state) {
	if (state === void 0 || state.present !== true) return "absent";
	return JSON.stringify({
		mode: state.mode,
		off: [...state.off].sort(),
		on: [...state.on].sort()
	});
}
/** 表达 "屏蔽" 的集合目录（deny → off/，allow → on/）。 */
function collectionFor(mode) {
	return mode === "allow" ? "on" : "off";
}
/** 开关目录的绝对路径。 */
function switchesPath(projectRoot, switchesDir) {
	return join(resolve(projectRoot), switchesDir);
}
/** 一个人工可读的开关文件正文（过滤只看文件名，内容是给人看的）。 */
function switchNote(blocked, projectRoot, mode) {
	const at = (/* @__PURE__ */ new Date()).toISOString();
	return [
		`# dsh-skill-switch ${blocked ? "blocked" : "allowed"} this skill for the project`,
		`# project: ${resolve(projectRoot)}`,
		`# mode: ${mode} (the file NAME is the switch; this note is free-form)`,
		`${blocked ? "blockedAt" : "allowedAt"}: ${at}`,
		""
	].join("\n");
}
/**
* 写入一个开关：`blocked=true` 屏蔽该 skill，`false` 恢复可见。
*
* 同一个 `blocked` 在两种模式下的落盘动作不同，因为两个集合的**成员含义**
* 相反：
* - deny 模式（off/ = 被隐藏）：屏蔽 = 建 off/<name>，恢复 = 删 off/<name>
* - allow 模式（on/ = 被放行）：屏蔽 = 删 on/<name>，恢复 = 建 on/<name>
* 无论哪种，另一侧的同名残留都会被清掉，避免模式切换后语义漂移。
*
* 目录按需创建；不写 mode 文件（缺省即 defaultMode，默认 deny）。
*
* @param projectRoot - 项目根。
* @param switchesDir - 相对项目根的开关目录。
* @param name - 合法 kebab-case skill 名。
* @param blocked - true = 本项目隐藏该 skill；false = 本项目可见。
* @param mode - 当前生效的模式。
* @returns 写入/删除的绝对路径列表，供调用方回报。
*/
async function writeSwitch(projectRoot, switchesDir, name, blocked, mode) {
	if (!isSkillName(name)) throw new Error(`invalid skill name "${name}" (expected kebab-case)`);
	const base = switchesPath(projectRoot, switchesDir);
	const activeDir = collectionFor(mode);
	const otherDir = activeDir === "off" ? "on" : "off";
	const shouldCreate = mode === "deny" ? blocked : !blocked;
	const touched = [];
	await mkdir(join(base, activeDir), { recursive: true });
	const target = join(base, activeDir, name);
	if (shouldCreate) {
		await writeFile(target, switchNote(blocked, projectRoot, mode), "utf8");
		touched.push(target);
	} else for (const candidate of [target, join(base, activeDir, `${name}.md`)]) if (await removeIfPresent(candidate)) touched.push(candidate);
	const staleDir = join(base, otherDir);
	for (const candidate of [join(staleDir, name), join(staleDir, `${name}.md`)]) if (await removeIfPresent(candidate)) touched.push(candidate);
	return touched;
}
/**
* 把一个名字从**两侧**开关集合里清掉（off/ 与 on/，含 `.md` 变体），
* 不创建任何文件。用于"删除 skill 后顺手清掉它的开关"：此时不能用
* `writeSwitch(..., blocked=false)`，因为 allow 模式下那等于往 `on/`
* 写一个"预授权可见"的幽灵条目。
* @returns 被删除的绝对路径列表。
*/
async function removeSwitchFiles(projectRoot, switchesDir, name) {
	if (!isSkillName(name)) return [];
	const base = switchesPath(projectRoot, switchesDir);
	const touched = [];
	for (const collection of ["off", "on"]) for (const candidate of [join(base, collection, name), join(base, collection, `${name}.md`)]) if (await removeIfPresent(candidate)) touched.push(candidate);
	return touched;
}
/**
* 清空一个项目的全部开关：删除 off/ 与 on/ 两个集合目录里的所有条目，
* 并把两侧空目录一并移除；`includeMode` 为真时连 mode 文件一起删。
* 项目没有开关目录时是 no-op。
* @param projectRoot - 项目根。
* @param switchesDir - 相对项目根的开关目录。
* @param options - 见 {@link ClearSwitchesOptions}。
* @returns 被删除的绝对路径列表。
*/
async function clearSwitches(projectRoot, switchesDir, options = {}) {
	const base = switchesPath(projectRoot, switchesDir);
	const removed = [];
	if (options.includeMode === true) {
		const modePath = join(base, "mode");
		if (await removeIfPresent(modePath)) removed.push(modePath);
	}
	for (const collection of ["off", "on"]) {
		const dir = join(base, collection);
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const target = join(dir, entry.name);
			try {
				await rm(target, {
					recursive: entry.isDirectory(),
					force: false
				});
				removed.push(target);
			} catch {}
		}
		try {
			await rm(dir, {
				recursive: true,
				force: true
			});
		} catch {}
	}
	try {
		if ((await readdir(base)).length === 0) await rm(base, {
			recursive: true,
			force: true
		});
	} catch {}
	return removed;
}
/** 存在则删除，返回是否真的删掉了。 */
async function removeIfPresent(path) {
	try {
		await rm(path, {
			recursive: true,
			force: false
		});
		return true;
	} catch {
		return false;
	}
}
async function pathExists$2(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}
//#endregion
//#region src/skill-scan.ts
/**
* 文件系统 skill 发现层（容错版）。
*
* 为什么不用 `ctx.skills.snapshot()` 直接当数据源：
* 官方的 `@deepseek-ai/dsh-skill-filesystem` 会把 frontmatter 缺 `name` 或
* `description`、YAML 解析失败、名字不合法的 skill **整条丢掉**（只留一条
* warn 日志）。结果就是它们在 dsh-skills-manager 一类的面板里完全不可见，
* 用户既看不到、也修不了——这正是本项目要优化的一点。
*
* 本模块按与官方 provider **相同的根与 rank** 扫描磁盘，但对每条候选做
* 容错解析：
* - 名字：优先 frontmatter `name`，缺失时回退到目录名 / 文件名（kebab-case 时）
* - 描述：优先 frontmatter `description`，缺失时回退到正文第一段有意义的文字
* - 任何导致官方 provider 忽略该条目的原因都记进 `issues`，面板据此展示
*   面板里作为「错误」的解释，并提供「补齐 frontmatter」修复入口
*
* 根与 rank（数字越小优先级越高），对齐 dsh-skill-filesystem 的 roots()：
*   project .dsh/skills (100) → project .agents/skills (200) → custom (300)
*   → ~/.dsh/skills (400) → ~/.agents/skills (500) → bundled (600)
* 另外把 <$DSH_HOME>/skill-library 作为**非 runtime** 根列出（rank 1000），
* 这样「全局删除」能一次清干净 dsh-skills-manager 留下的规范副本。
*/
/**
* 按官方 provider 的口径构建 skill 根列表，外加非 runtime 的库根。
* @param options - 已解析的路径配置。
* @returns 根列表（含 rank / live / deletable 元数据）。
*/
function skillRoots(options) {
	const roots = [];
	if (options.projectRoot !== void 0) roots.push({
		path: join(options.projectRoot, ".dsh", "skills"),
		source: "project-dsh",
		rank: 100,
		live: true,
		deletable: true
	}, {
		path: join(options.projectRoot, ".agents", "skills"),
		source: "project-agents",
		rank: 200,
		live: true,
		deletable: true
	});
	for (const dir of options.customSkillDirs ?? []) roots.push({
		path: resolve(dir),
		source: "custom",
		rank: 300,
		live: true,
		deletable: true
	});
	roots.push({
		path: join(options.dshHome, "skills"),
		source: "user-dsh",
		rank: 400,
		live: true,
		deletable: true,
		skipSystem: true
	});
	roots.push({
		path: join(options.agentsHome, "skills"),
		source: "user-agents",
		rank: 500,
		live: true,
		deletable: options.allowSharedRootWrites !== false
	});
	if (options.bundledSkillDir !== void 0 && options.bundledSkillDir !== "") roots.push({
		path: resolve(options.bundledSkillDir),
		source: "bundled",
		rank: 600,
		live: true,
		deletable: false
	});
	roots.push({
		path: join(options.dshHome, "skill-library"),
		source: "library",
		rank: 1e3,
		live: false,
		deletable: true,
		skipSystem: true
	});
	return roots;
}
/** 默认共享 agent 家目录。 */
function defaultAgentsHome() {
	const fromEnv = process.env.DSH_AGENTS_HOME;
	return fromEnv !== void 0 && fromEnv !== "" ? resolve(fromEnv) : join(homedir(), ".agents");
}
/**
* 扫描一个根下的全部候选（容错，不丢弃"官方会忽略"的条目）。
* 根不存在或不可读时返回空数组；单个条目读失败只跳过该条目。
* @param root - 根规格。
* @returns 按条目名排序的候选数组。
*/
async function scanSkillRoot(root) {
	let entries;
	try {
		entries = await readdir(root.path, { withFileTypes: true });
	} catch {
		return [];
	}
	const names = entries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
	const skills = [];
	for (const name of names) {
		if (root.skipSystem === true && name === ".system") continue;
		const full = join(root.path, name);
		let kind;
		try {
			const info = await stat(full);
			kind = info.isDirectory() ? "directory" : info.isFile() ? "file" : void 0;
		} catch {
			continue;
		}
		const isBundle = kind === "directory";
		if (!isBundle && !(kind === "file" && name.endsWith(".md"))) continue;
		const path = isBundle ? join(full, "SKILL.md") : full;
		try {
			await access(path);
		} catch {
			continue;
		}
		const entryName = isBundle ? name : name.slice(0, -3);
		skills.push(await readCandidate(path, entryName, isBundle ? "bundle" : "flat", isBundle ? full : root.path, root));
	}
	return skills;
}
/** 扫描一批根，按 rank 升序返回（同 rank 按根路径稳定排序）。 */
async function scanSkillRoots(roots) {
	const ordered = [...roots].sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
	const out = [];
	for (const root of ordered) out.push(...await scanSkillRoot(root));
	return out;
}
/** 读取并容错解析一个候选 skill 文件。 */
async function readCandidate(path, entryName, form, directory, root) {
	let raw = "";
	let readFailed = false;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		readFailed = true;
	}
	const parts = readFailed ? {
		kind: "absent",
		body: ""
	} : documentParts(raw);
	const data = parts.kind === "ok" ? parts.data : void 0;
	const issues = [];
	if (parts.kind === "invalid") issues.push("invalid-frontmatter");
	else if (parts.kind === "absent") issues.push("missing-frontmatter");
	if (data !== void 0 && invocationPolicyInvalid(data)) issues.push("invalid-invocation");
	const declaredName = data === void 0 ? void 0 : stringField(data, "name");
	let name;
	let nameSource;
	if (declaredName !== void 0 && isSkillName(declaredName)) {
		name = declaredName;
		nameSource = "frontmatter";
	} else if (declaredName !== void 0) {
		name = declaredName;
		nameSource = "frontmatter";
		issues.push("invalid-name");
	} else {
		name = entryName;
		nameSource = "entry";
		if (parts.kind === "ok") issues.push("missing-name");
		if (!SKILL_NAME.test(entryName)) issues.push("invalid-entry-name");
	}
	const declaredDescription = data === void 0 ? void 0 : stringField(data, "description");
	let description = "";
	let descriptionSource = "none";
	if (declaredDescription !== void 0) {
		description = declaredDescription;
		descriptionSource = "frontmatter";
	} else {
		if (parts.kind === "ok") issues.push("missing-description");
		const fallback = firstMeaningfulLine(parts.body);
		if (fallback !== "") {
			description = fallback;
			descriptionSource = "body";
		}
	}
	const whenToUse = data === void 0 ? void 0 : stringField(data, "whenToUse");
	return {
		name,
		entryName,
		...declaredName !== void 0 ? { declaredName } : {},
		nameSource,
		description,
		descriptionSource,
		...whenToUse !== void 0 ? { whenToUse } : {},
		path,
		directory,
		form,
		rootPath: root.path,
		source: root.source,
		rank: root.rank,
		live: root.live,
		deletable: root.deletable,
		issues: [...new Set(issues)],
		blockable: SKILL_NAME.test(name) || isSkillName(name)
	};
}
/**
* 一次读清 frontmatter 状态、字段与正文。
* 关键点：**frontmatter 解析失败时也把围栏之后的正文带出来**，这样面板对
* 会被官方丢弃的 skill 仍能给出可读描述（官方 provider 此时直接丢弃整条）。
* @param raw - 文件原始内容。
*/
function documentParts(raw) {
	const firstLineEnd = raw.indexOf("\n");
	if (firstLineEnd < 0) return {
		kind: "absent",
		body: raw
	};
	if (raw.slice(0, firstLineEnd).replace(/\r$/, "") !== "---") return {
		kind: "absent",
		body: raw
	};
	const closing = findClosingFence(raw, firstLineEnd + 1);
	if (closing === void 0) return {
		kind: "invalid",
		body: raw
	};
	const body = raw.slice(closing.bodyStart);
	let data;
	try {
		data = parse(raw.slice(firstLineEnd + 1, closing.start));
	} catch {
		return {
			kind: "invalid",
			body
		};
	}
	if (typeof data !== "object" || data === null || Array.isArray(data)) return {
		kind: "invalid",
		body
	};
	return {
		kind: "ok",
		data,
		body
	};
}
/** 解析 YAML frontmatter；没有 frontmatter 或解析失败都返回 undefined。 */
function parseFrontmatter(raw) {
	const parts = documentParts(raw);
	return parts.kind === "ok" ? {
		data: parts.data,
		body: parts.body
	} : void 0;
}
/** 该文件的 frontmatter 是完整可解析的、缺失的、还是解析失败的。 */
function frontmatterKind(raw) {
	return documentParts(raw).kind;
}
/** 从正文里取第一段有意义的文字，作为缺失描述时的回退。 */
function firstMeaningfulLine(body) {
	let inFence = false;
	for (const line of body.split(/\r?\n/)) {
		const text = line.trim();
		if (text.startsWith("```")) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		if (text === "") continue;
		if (/^[-=_*~]{3,}$/.test(text)) continue;
		const stripped = text.replace(/^#{1,6}\s*/, "").replace(/^[-*>]\s*/, "").trim();
		if (stripped === "") continue;
		return stripped.length > 160 ? `${stripped.slice(0, 157)}…` : stripped;
	}
	return "";
}
/**
* 把一个派生的 frontmatter 写回文件，让官方 provider 重新接受它：
* 文件已有 frontmatter 时补齐缺失字段，没有 frontmatter 时在文首插入一段。
* 只改 frontmatter，正文一字不动。
*
* @param raw - 文件原始内容。
* @param fields - 要写入的 name / description（调用方保证非空且合法）。
* @returns 修复后的完整文件内容。
*/
function repairFrontmatter(raw, fields) {
	if (!isSkillName(fields.name)) throw new Error(`invalid skill name "${fields.name}"`);
	const description = fields.description.trim().replace(/\r?\n+/g, " ");
	if (description === "") throw new Error("description must not be empty");
	const lines = [
		"---",
		`name: ${yamlQuote(fields.name)}`,
		`description: ${yamlQuote(description)}`,
		...fields.whenToUse !== void 0 && fields.whenToUse !== "" ? [`whenToUse: ${yamlQuote(fields.whenToUse)}`] : [],
		"---",
		""
	];
	const parts = documentParts(raw);
	if (parts.kind === "ok") {
		const next = {
			...parts.data,
			name: fields.name,
			description
		};
		if (fields.whenToUse !== void 0 && fields.whenToUse !== "") next.whenToUse = fields.whenToUse;
		return `---\n${Object.keys(next).map((key) => `${key}: ${yamlScalar(next[key])}`).join("\n")}\n---\n${parts.body}`;
	}
	if (parts.kind === "invalid") return `${lines.join("\n")}${parts.body}`;
	return `${lines.join("\n")}${raw.replace(/^\uFEFF/, "")}`;
}
/** 读取一个候选文件当前的原始内容（修复动作需要）。 */
async function readSkillRaw(path) {
	return await readFile(path, "utf8");
}
/**
* 与官方 provider 的 `stringField` **逐字对齐**：只有非空 string 才算字段存在，
* 不做 trim、不把数字转字符串。
*
* 之前这里做了 trim + number→string，会把官方**丢弃**的条目（`name: 123`、
* `description: 123`）显示成完全正常，也会把官方**接受**的 `description: "  "`
* 误报成"缺 description"——两种都会让用户对"是否真的生效"判断错误。
*/
function stringField(data, key) {
	const value = data[key];
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
/** 官方会因 invocation 字段非法而丢弃整条；这里复刻它的判定并只回报结果。 */
function invocationPolicyInvalid(data) {
	for (const [key] of [
		["disableModelInvocation", "disable-model-invocation"],
		["modelInvocable", "disable-model-invocation"],
		["userInvocable", "user-invocable"]
	]) if (Object.hasOwn(data, key)) return true;
	for (const key of ["disable-model-invocation", "user-invocable"]) {
		if (!Object.hasOwn(data, key)) continue;
		if (!isFrontmatterBoolean(data[key])) return true;
	}
	return false;
}
/** 官方 frontmatter 布尔的接受集合（boolean / 1 / 0 / 字符串枚举）。 */
function isFrontmatterBoolean(value) {
	if (typeof value === "boolean") return true;
	if (value === 1 || value === "1" || value === 0 || value === "0") return true;
	if (typeof value === "string") return [
		"true",
		"yes",
		"on",
		"false",
		"no",
		"off"
	].includes(value.toLowerCase());
	return false;
}
function findClosingFence(raw, start) {
	let lineStart = start;
	while (lineStart <= raw.length) {
		const nextNewline = raw.indexOf("\n", lineStart);
		const lineEnd = nextNewline < 0 ? raw.length : nextNewline;
		if (raw.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") return {
			start: lineStart,
			bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1
		};
		if (nextNewline < 0) return void 0;
		lineStart = nextNewline + 1;
	}
}
/** 单行 YAML 标量安全引号。 */
function yamlQuote(value) {
	return /^[A-Za-z0-9_\-./ ]+$/.test(value) && !value.startsWith("-") && !value.startsWith("!") ? value : JSON.stringify(value);
}
/** 任意 frontmatter 值的单行序列化（保留原有字段）。 */
function yamlScalar(value) {
	if (typeof value === "boolean" || typeof value === "number") return String(value);
	if (value === null || value === void 0) return "null";
	if (Array.isArray(value)) return `[${value.map((item) => yamlQuote(String(item))).join(", ")}]`;
	if (typeof value === "object") return JSON.stringify(value);
	return yamlQuote(String(value));
}
//#endregion
//#region src/skill-view.ts
/**
* 合成面板数据。
* @param options - 注册表、cwd、根列表、开关状态。
* @returns 面板表格 + runtime 目录完整性 + 根清单。
*/
async function listSkills(options) {
	const scanned = await scanSkillRoots(options.roots);
	let catalogSkills = [];
	let catalogComplete = false;
	let catalogError = false;
	try {
		const snapshot = await options.skills.snapshot({
			cwd: options.cwd,
			...options.scope !== void 0 ? { scope: options.scope } : {}
		});
		catalogSkills = snapshot.skills.map((skill) => ({
			name: skill.name,
			description: skill.description,
			source: skill.source,
			provider: skill.provider,
			...skill.path !== void 0 ? { path: skill.path } : {},
			...skill.invocation !== void 0 ? { invocation: {
				modelInvocable: skill.invocation.modelInvocable,
				userInvocable: skill.invocation.userInvocable
			} } : {}
		}));
		catalogComplete = snapshot.complete;
	} catch {
		catalogComplete = false;
		catalogError = true;
	}
	const catalogByName = new Map(catalogSkills.map((skill) => [skill.name, skill]));
	const verdictAvailable = options.scope !== void 0 && !catalogError;
	const views = [];
	const grouped = /* @__PURE__ */ new Map();
	for (const skill of scanned) {
		const bucket = grouped.get(skill.name);
		if (bucket === void 0) grouped.set(skill.name, [skill]);
		else bucket.push(skill);
	}
	for (const [name, copies] of grouped) {
		const winner = copies[0];
		const catalog = catalogByName.get(name);
		views.push({
			name,
			description: winner.description,
			descriptionSource: winner.descriptionSource,
			nameSource: winner.nameSource,
			source: winner.source,
			rank: winner.rank,
			live: copies.some((copy) => copy.live),
			blockable: winner.blockable,
			blocked: isHidden(options.state, name),
			inCatalog: catalog !== void 0,
			errors: verdictAvailable ? verdictErrors(catalog) : [],
			...catalog?.invocation !== void 0 ? { invocation: catalog.invocation } : {},
			issues: mergeIssues(copies),
			deletable: copies.some((copy) => copy.deletable),
			path: winner.path,
			form: winner.form,
			...catalog !== void 0 ? {
				provider: catalog.provider,
				catalogSource: catalog.source
			} : {},
			copies: copies.map((copy) => ({
				path: copy.path,
				directory: copy.directory,
				form: copy.form,
				entryName: copy.entryName,
				...copy.declaredName !== void 0 ? { declaredName: copy.declaredName } : {},
				rootPath: copy.rootPath,
				source: copy.source,
				rank: copy.rank,
				live: copy.live,
				deletable: copy.deletable,
				issues: copy.issues
			}))
		});
		catalogByName.delete(name);
	}
	for (const [name, catalog] of catalogByName) {
		if (catalog.path !== void 0 && !await options.pathExists(catalog.path)) continue;
		views.push({
			name,
			description: catalog.description,
			descriptionSource: "frontmatter",
			nameSource: "frontmatter",
			source: catalog.source,
			rank: 0,
			live: true,
			blockable: isSkillName(name),
			blocked: isHidden(options.state, name),
			inCatalog: true,
			errors: verdictAvailable ? verdictErrors(catalog) : [],
			...catalog.invocation !== void 0 ? { invocation: catalog.invocation } : {},
			issues: [],
			deletable: false,
			form: "virtual",
			provider: catalog.provider,
			catalogSource: catalog.source,
			copies: []
		});
	}
	views.sort((a, b) => a.name.localeCompare(b.name));
	const roots = [];
	for (const root of [...options.roots].sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path))) roots.push({
		path: root.path,
		source: root.source,
		rank: root.rank,
		live: root.live,
		deletable: root.deletable,
		exists: await options.pathExists(root.path)
	});
	return {
		skills: views,
		catalogComplete,
		catalogError,
		verdictAvailable,
		roots
	};
}
/**
* 三条件判定：A 在目录里、B 模型可调用、C 用户可调用。
*
* 目录缺失（`undefined`）→ A 失败。**"在目录里"就是 A 的全部含义**：provider 因为
* frontmatter 缺字段而丢弃该条时，它就表现为 A 失败，而磁盘侧的 `issues` 正好是
* 这一条的解释——面板把两者并排显示，而不是各自造一个徽标。
*
* invocation 缺失时**不**报 B/C 失败：官方的 SkillSummary 把它列为必填，缺失只会
* 出现在版本漂移的宿主上；把"没读到"当成"不能调用"会把每个 skill 都污蔑一遍。
*/
function verdictErrors(catalog) {
	if (catalog === void 0) return ["not-in-registry"];
	const errors = [];
	if (catalog.invocation?.modelInvocable === false) errors.push("model-not-invocable");
	if (catalog.invocation?.userInvocable === false) errors.push("user-not-invocable");
	return errors;
}
/** 同一名字多处副本的 issues 取并集（任一副本 frontmatter 正常就不算整行出错）。 */
function mergeIssues(copies) {
	if (copies.some((copy) => copy.issues.length === 0)) return [];
	const merged = /* @__PURE__ */ new Set();
	for (const copy of copies) for (const issue of copy.issues) merged.add(issue);
	return [...merged];
}
//#endregion
//#region src/skill-delete.ts
/**
* 全局删除的落盘层：把一次删除请求要动的每一处副本都当成不可信输入来校验。
*
* 三条硬约束：
* 1. 只删**已知根之内**的路径——任何解析后逃出所属根的路径都拒绝（403）。
* 2. 只删**声明可删**的根——内置（bundled）根永远拒绝；共享根是否可删由
*    配置决定（allowSharedRootWrites）。
* 3. 绝不删根目录本身。
*
* 删除是幂等的：某一处副本已经不在时记为 skipped('missing')，不算失败，
* 只要至少删掉一处就算成功。
*/
/**
* 断言 `candidate` 解析后严格位于 `root` 之内。
* @param root - 所属根（绝对路径）。
* @param candidate - 待校验路径。
* @returns candidate 的解析结果。
* @throws SwitchError('forbidden') 当目标是根本身或逃出根。
*/
function assertWithinRoot(root, candidate) {
	const rootResolved = resolve(root);
	const candidateResolved = resolve(candidate);
	if (candidateResolved === rootResolved) throw new SwitchError("forbidden", `path "${candidate}" is the root itself`, 403);
	if (!candidateResolved.startsWith(rootResolved + sep)) throw new SwitchError("forbidden", `path "${candidate}" escapes root "${root}"`, 403);
	return candidateResolved;
}
/** 删除一处副本（已通过根校验）。 */
async function removeOne(target) {
	const withinPath = assertWithinRoot(target.rootPath, target.path);
	if (target.form === "bundle") {
		const withinDir = assertWithinRoot(target.rootPath, target.directory);
		await rm(withinDir, {
			recursive: true,
			force: false
		});
		return withinDir;
	}
	await rm(withinPath, {
		recursive: false,
		force: false
	});
	return withinPath;
}
/**
* 逐个删除副本；单点失败不阻断其余副本，但至少要删掉一处。
* @param targets - 已由服务端扫描得到的副本清单（客户端不参与路径推导）。
* @returns 删除结果。
* @throws SwitchError('not-found') 当所有副本都不存在。
* @throws SwitchError('protected') 当所有存在的副本都属于受保护根。
*/
async function deleteSkillCopies(targets) {
	const outcome = {
		removed: [],
		skipped: []
	};
	for (const target of targets) {
		if (!target.deletable) {
			outcome.skipped.push({
				path: target.path,
				source: target.source,
				reason: "protected"
			});
			continue;
		}
		try {
			assertWithinRoot(target.rootPath, target.path);
			if (target.form === "bundle") assertWithinRoot(target.rootPath, target.directory);
		} catch (error) {
			outcome.skipped.push({
				path: target.path,
				source: target.source,
				reason: "outside-root",
				message: error instanceof Error ? error.message : String(error)
			});
			continue;
		}
		if (!await pathExists$1(target.form === "bundle" ? target.directory : target.path)) {
			outcome.skipped.push({
				path: target.path,
				source: target.source,
				reason: "missing"
			});
			continue;
		}
		try {
			outcome.removed.push(await removeOne(target));
		} catch (error) {
			outcome.skipped.push({
				path: target.path,
				source: target.source,
				reason: "error",
				message: error instanceof Error ? error.message : String(error)
			});
		}
	}
	if (outcome.removed.length === 0) {
		if (outcome.skipped.length > 0 && outcome.skipped.every((item) => item.reason === "protected")) throw new SwitchError("protected", "every copy of this skill lives in a protected root", 403);
		if (outcome.skipped.some((item) => item.reason === "outside-root")) throw new SwitchError("forbidden", "refused: a delete target resolves outside its skill root", 403);
		throw new SwitchError("not-found", "no copy of this skill exists on disk anymore", 404);
	}
	return outcome;
}
async function pathExists$1(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}
//#endregion
//#region src/index.ts
/**
* dsh-skill-switch — host 半体。
*
* 两件事，互相独立：
*
* 1. **项目级屏蔽**（沿用 v1 的机制，不改语义）：装饰 `ctx.skills`
*    （SkillRegistry）的三个消费入口 snapshot / list / get，按每次调用自带的
*    cwd 解析项目根，读 `<项目根>/.dsh/skill-switches/` 下的开关文件，过滤
*    目录并按名拦截加载。
*    - `dsh-tool-skill` 每轮 `agent/pre-step` 用 `{cwd: session.header.cwd}` 调
*      snapshot，digest 变化即重写系统提示里的 skill 目录——所以开关变化在
*      下一个模型轮次自动生效，无需重启。
*    - 同一 host 进程服务多个会话时，各会话按各自 cwd 解析项目根，互不影响。
*    - 卸载（fiber dispose）时摘掉包装，服务回到原始形态；开关目录不存在时
*      过滤器纯透传，行为与未安装本插件一致。
*
* 2. **面板 API**（新增，与 dsh-skills-manager 同风格但只做三件事）：
*    `/skill-switch/api/*` 上的 JSON 接口，供客户端会话视图标签调用：
*      - 列出本项目的 skill（磁盘容错扫描 × runtime 目录合成）
*      - 一键开/关某个 skill 在本项目的可见性
*      - 一键清空本项目全部开关
*      - 全局删除某个 skill（清掉所有落盘副本）
*      - 补齐 frontmatter（让缺 name/description 的 skill 重新生效）
*      - 每行的**有效/错误判定**：A 在目录里 ∧ B 模型可主动调用 ∧ C 用户可显式调用，
*        失败时回传是哪一条（`errors`），供面板写出原因
*    路由按与 /api 网关相同的浏览器信任规则设栅栏，且所有文件操作都被限制在
*    已知 skill 根之内。
*
*    判定的 A 必须按**会话的观察者作用域**读目录：`snapshot()` 的 `scope` 决定读哪些
*    layer，省略只读全局层，而桌面端把 provider 挂在 agent preset 的 standing scope
*    上（见 {@link agentOfSession}）。拿不到活跃 agent 时 wire 上
*    `verdictAvailable: false` 且不产出任何错误项。
*
* 与 dsh-skills-manager 的分工：那是「skill 生命周期管理」（库 + 分配 + 增删改），
* 这里是「生效范围控制 + 一次性清除」，不重复它的创建/编辑/分配/重命名能力。
*/
/** Cordis 插件名（loader entry id 与日志前缀）。 */
const name = "dsh-skill-switch";
/**
* 硬依赖只有 skill 注册表：屏蔽逻辑在无 Web 的部署（CLI / headless）里也必须
* 生效。webServer / sessions / loader 是面板需要的，用 `ctx.inject` 等待它们
* 出现后再挂路由——服务缺失时插件整体照常工作。
*/
const inject = ["skills"];
/** 宿主插件配置，加载时由 Loader 校验。 */
const Config = Schema.object({
	/** 相对项目根的开关目录。 */
	switchesDir: Schema.string().default(".dsh/skill-switches"),
	/** 无 mode 文件时的默认模式：deny=隐藏 off/ 点名的；allow=只放行 on/ 点名的。 */
	defaultMode: Schema.union([Schema.const("deny"), Schema.const("allow")]).default("deny"),
	/** 项目根开关状态的读取缓存时长（毫秒）。 */
	cacheTtlMs: Schema.natural().default(1e3),
	/** get() 调用时是否绕过缓存强制刷新（保证拦截路径的最大新鲜度）。 */
	forceRefreshOnGet: Schema.boolean().default(true),
	/** DSH 家目录覆盖（默认 resolveDshHome()，即 $DSH_HOME 或 ~/.dsh）。 */
	dshHome: Schema.string().default(""),
	/** 共享 agent 家目录覆盖（默认 $DSH_AGENTS_HOME 或 ~/.agents）。 */
	agentsHome: Schema.string().default(""),
	/** 额外 skill 根（对应官方 provider 的 customSkillDirs）。 */
	customSkillDirs: Schema.array(Schema.string()).default([]),
	/** 内置 skill 根覆盖（默认 $DSH_BUNDLED_SKILL_DIR；该根下的 skill 永远不可删）。 */
	bundledSkillDir: Schema.string().default(""),
	/**
	* 是否允许删除共享根 `~/.agents/skills` 里的副本。
	* 默认 true（本项目 v0.2 的显式选择）；团队里该根被 Claude Code 共用时，
	* 置 false 可把它变回只读。
	*/
	allowSharedRootWrites: Schema.boolean().default(true)
});
/** 把插件配置解析成内部形态（路径全部绝对化）。 */
function resolveConfig(config = {}) {
	const envBundled = process.env.DSH_BUNDLED_SKILL_DIR ?? "";
	const bundledRaw = config.bundledSkillDir !== void 0 && config.bundledSkillDir !== "" ? config.bundledSkillDir : envBundled;
	return {
		switchesDir: config.switchesDir !== void 0 && config.switchesDir !== "" ? config.switchesDir : ".dsh/skill-switches",
		defaultMode: config.defaultMode === "allow" ? "allow" : "deny",
		cacheTtlMs: typeof config.cacheTtlMs === "number" && config.cacheTtlMs >= 0 ? config.cacheTtlMs : 1e3,
		forceRefreshOnGet: config.forceRefreshOnGet !== false,
		dshHome: config.dshHome !== void 0 && config.dshHome !== "" ? resolve(config.dshHome) : resolveDshHome(),
		agentsHome: config.agentsHome !== void 0 && config.agentsHome !== "" ? resolve(config.agentsHome) : defaultAgentsHome(),
		customSkillDirs: (config.customSkillDirs ?? []).filter((dir) => typeof dir === "string" && dir !== "").map((dir) => resolve(dir)),
		bundledSkillDir: bundledRaw !== "" ? resolve(bundledRaw) : "",
		allowSharedRootWrites: config.allowSharedRootWrites !== false
	};
}
/** 按配置构建某个项目根下的 skill 根列表。 */
function rootsForProject(config, projectRoot) {
	return skillRoots({
		...projectRoot !== void 0 ? { projectRoot } : {},
		dshHome: config.dshHome,
		agentsHome: config.agentsHome,
		customSkillDirs: config.customSkillDirs,
		bundledSkillDir: config.bundledSkillDir,
		allowSharedRootWrites: config.allowSharedRootWrites
	});
}
/** 防止 HMR/重复加载造成双重包装的实例标记。 */
const WRAP_TAG = Symbol.for("dsh-skill-switch.wrapped");
/**
* 用**已捕获**的原始方法构造只读代理：面板必须看到未经过滤的目录事实
* （被屏蔽的 skill 仍然 `inCatalog: true`，虚拟 skill 屏蔽后也不会消失）。
*
* 关键：不能在代理体里读 `skills.snapshot` —— 那时它已经被换成包装版了，
* 面板就会拿到过滤后的结果。cordis 的服务属性每次读取还可能给出不同的绑定
* 代理，所以唯一可靠的做法是提前把函数值抓下来。
*/
function rawRegistry(skills, originals) {
	return {
		snapshot: (options) => originals.snapshot.call(skills, options),
		list: (options) => originals.list.call(skills, options),
		get: (skillName, options) => originals.get.call(skills, skillName, options)
	};
}
/**
* 应用项目级屏蔽：包装 ctx.skills 的 snapshot/list/get。
*
* 生命周期（cordis 的 `ctx.effect(execute)` 语义是"**立即执行** execute，
* 把它的**返回值**登记为 disposer"）：
* - 包装前先抓下原始方法，卸载时按捕获值**赋值还原**，不依赖身份比较
*   （cordis 的服务属性读取可能每次返回新的绑定代理，`===` 不可靠）；
* - `WRAP_TAG` 只在卸载时清掉，这样重复加载/HMR 的双重包装保护才真的生效。
*
* @param ctx - host 上下文。
* @param config - 已解析配置。
* @param logger - 日志出口。
* @returns 包装前捕获的原始方法（供面板构造未过滤代理）。
*/
function installSkillFilter(ctx, config, logger) {
	const skills = ctx.skills;
	if (skills[WRAP_TAG] === true) {
		logger.warn("skill-switch: ctx.skills already wrapped; skipping re-apply");
		return {
			snapshot: skills.snapshot,
			list: skills.list,
			get: skills.get
		};
	}
	const cache = /* @__PURE__ */ new Map();
	/**
	* 开关目录的 mtime 指纹：基目录、mode、off/、on/ 四个路径的修改时间。
	* 缓存命中要求指纹不变且 TTL 未过期——mtime 提供跨秒级文件系统的即时
	* 失效，TTL 兜底粗粒度 mtime（如 HFS+ 只有秒级）下的同秒变更窗口。
	*/
	async function dirFingerprint(root) {
		const base = switchesPath(root, config.switchesDir);
		const stamps = [];
		for (const path of [
			base,
			`${base}/mode`,
			`${base}/off`,
			`${base}/on`
		]) try {
			stamps.push((await stat(path)).mtimeMs);
		} catch {
			stamps.push(-1);
		}
		return stamps.join(",");
	}
	/**
	* 解析 cwd 对应项目的开关状态（mtime 指纹 + TTL 双条件缓存；
	* force 用于 get 拦截路径）。任何失败都降级为透传。
	*/
	async function resolveState(cwd, force = false) {
		if (typeof cwd !== "string" || cwd.length === 0) return void 0;
		let root;
		try {
			root = await findProjectRoot(cwd);
		} catch (error) {
			logger.warn(`skill-switch: project-root resolution failed for ${cwd}: ${String(error)}`);
			return;
		}
		const now = Date.now();
		const hit = cache.get(root);
		if (!force && hit !== void 0) {
			if (await dirFingerprint(root) === hit.dirFingerprint && now - hit.readAt < config.cacheTtlMs) return hit.state;
		}
		let state;
		try {
			state = await readSwitchState(root, config.switchesDir, config.defaultMode);
		} catch (error) {
			logger.warn(`skill-switch: reading switches under ${root} failed: ${String(error)}`);
			return;
		}
		const fingerprint = stateFingerprint(state);
		if (hit === void 0 || hit.fingerprint !== fingerprint) {
			if (state.present) logger.info(`skill-switch: project ${root} -> mode=${state.mode} off=[${[...state.off].sort().join(", ")}] on=[${[...state.on].sort().join(", ")}]` + (state.ignored.length > 0 ? ` (ignored: ${state.ignored.join(", ")})` : ""));
			else if (hit !== void 0) logger.info(`skill-switch: project ${root} -> switches removed; catalog restored`);
		}
		cache.set(root, {
			state,
			fingerprint,
			dirFingerprint: await dirFingerprint(root),
			readAt: now
		});
		return state;
	}
	const originalSnapshot = skills.snapshot;
	const originalList = skills.list;
	const originalGet = skills.get;
	/** 包装 snapshot：过滤摘要数组，其余字段（complete 等）原样保留。 */
	const wrappedSnapshot = async (options = {}) => {
		const result = await originalSnapshot.call(skills, options);
		const state = await resolveState(options?.cwd);
		if (state === void 0 || state.present !== true) return result;
		return {
			...result,
			skills: filterSkills(state, result.skills)
		};
	};
	/**
	* 包装 list：与 SkillRegistry.list 同语义（snapshot 的 skills 字段），
	* 直接委托包装后的 snapshot，避免双重过滤逻辑漂移。
	*/
	const wrappedList = async (options = {}) => {
		return (await wrappedSnapshot(options)).skills;
	};
	/** 包装 get：被隐藏的 skill 直接返回 undefined，不进入加载路径。 */
	const wrappedGet = async (skillName, options = {}) => {
		const state = await resolveState(options?.cwd, config.forceRefreshOnGet);
		if (state !== void 0 && isHidden(state, skillName)) {
			logger.info(`skill-switch: blocked load of "${skillName}" (project mode=${state.mode})`);
			return;
		}
		return originalGet.call(skills, skillName, options);
	};
	skills.snapshot = wrappedSnapshot;
	skills.list = wrappedList;
	skills.get = wrappedGet;
	skills[WRAP_TAG] = true;
	/**
	* 插件卸载时摘除包装，恢复原始方法。
	*
	* 注意 cordis 的 `ctx.effect(execute)` 语义：execute **立即执行**，它的
	* **返回值**才被登记为 disposer。teardown 必须写在返回的函数里；写成
	* effect body 会在安装的瞬间就"卸载"，而真正卸载时什么都不发生。
	*/
	ctx.effect(() => () => {
		skills.snapshot = originalSnapshot;
		skills.list = originalList;
		skills.get = originalGet;
		delete skills[WRAP_TAG];
		cache.clear();
		logger.info("skill-switch: unwrapped ctx.skills; original service restored");
	}, "dsh-skill-switch: ctx.skills filter");
	return {
		snapshot: originalSnapshot,
		list: originalList,
		get: originalGet
	};
}
/**
* 解析会话的权威 cwd（绝不抛错）。
*
* 优先级刻意排成三段，把"客户端传来的路径不可信"落到结构上：
* 1. 会话 header 里的 cwd —— 唯一权威来源；
* 2. **只有**当宿主确实认识这个会话、但它还没 hydrate 出 cwd 时，才接受客户端
*    的绝对路径兜底（面板刚打开时会话可能还在加载）；
* 3. 其余情况（含 sessionId 根本不认识）一律用宿主进程 cwd。
*
* 第 2 条的限定条件很关键：否则任何调用方都能拿一个不存在的 sessionId 加任意
* 绝对路径，让开关写入与删除发生在别处。
*/
function sessionCwdOf(ctx, sessionId, clientCwd) {
	const session = ctx.sessions.get(sessionId);
	if (session === void 0) return process.cwd();
	const headerCwd = session.header.cwd;
	if (headerCwd !== void 0 && headerCwd !== "") return headerCwd;
	if (clientCwd !== void 0 && clientCwd !== "" && isAbsolute(clientCwd)) return clientCwd;
	return process.cwd();
}
/** 从 payload 解析请求作用域（sessionId 必填；cwd 只在会话已知但未 hydrate 时兜底）。 */
async function projectScopeOf(scope, payload) {
	const sessionId = requireString(payload, "sessionId");
	const cwd = sessionCwdOf(scope.ctx, sessionId, optionalString(payload, "cwd"));
	const projectRoot = await findProjectRoot(cwd);
	const state = await readSwitchState(projectRoot, scope.config.switchesDir, scope.config.defaultMode);
	const agent = agentOfSession(scope.ctx, sessionId);
	return {
		sessionId,
		cwd,
		projectRoot,
		state,
		...agent !== void 0 ? { agent } : {}
	};
}
/**
* 取一个可选服务（`ctx.get(name)` 优先，退回属性读取；两者都不稳时不抛）。
*
* cordis 里访问未注册的服务在不同版本上可能抛错，所以两种读法都包了 try。
*/
function optionalService(ctx, serviceName) {
	try {
		if (typeof ctx.get === "function") {
			const value = ctx.get(serviceName);
			if (value !== void 0 && value !== null) return value;
		}
	} catch {}
	try {
		return ctx[serviceName];
	} catch {
		return;
	}
}
/** 一个对象是否是 agent 注册表（结构判定）。 */
function isAgentRegistry(value) {
	return typeof value === "object" && value !== null && typeof value.get === "function";
}
/**
* 解析会话的**观察者作用域**（该会话的活跃 agent）。
*
* 为什么 agent 可以直接当 scope 用：`dsh-agent` 里 agent 的 carrier 是
* `scopeTarget(agent, agent)`（"the subject agent; also the scope-carrier key"），
* 即 **agent 对象本身就是它的 ScopeKey**；agent preset 的 standing scope 是
* 匿名对象、外部拿不到，但 agent 的 key 通过 `bindScopeParent` 挂在它下面，
* 注册表的 `snapshot({scope})` 会沿 layer 链上溯到那一层。
*
* 桌面 profile 里顶层 `skill-filesystem` 是 disabled 的，provider 只注册在
* preset 的 standing scope 中——所以**不带 scope 读到的目录几乎是空的**，
* 面板必须拿到这个作用域才能说"这个会话看到了什么"。
*
* @param ctx - host 上下文。
* @param sessionId - 会话 id。
* @returns 活跃 agent（= ScopeKey），会话没在跑时为 undefined。
*/
function agentOfSession(ctx, sessionId) {
	const registry = optionalService(ctx, "agents");
	if (!isAgentRegistry(registry)) return void 0;
	try {
		const agent = registry.get(sessionId);
		return typeof agent === "object" && agent !== null ? agent : void 0;
	} catch {
		return;
	}
}
/** 一次"作用域 + 面板列表"的完整读取（所有读写方法共用，避免多处漂移）。 */
async function loadPanel(scope, payload) {
	const project = await projectScopeOf(scope, payload);
	const list = await listSkills({
		skills: scope.raw,
		cwd: project.cwd,
		...project.agent !== void 0 ? { scope: project.agent } : {},
		roots: rootsForProject(scope.config, project.projectRoot),
		state: project.state,
		pathExists
	});
	return {
		...project,
		list
	};
}
/** 组装一次面板视图。 */
async function buildPanelView(scope, payload, lastAction = null) {
	const { cwd, projectRoot, state, list } = await loadPanel(scope, payload);
	return {
		cwd,
		projectRoot,
		switchesPath: switchesPath(projectRoot, scope.config.switchesDir),
		mode: state.mode,
		switchesPresent: state.present,
		off: [...state.off].sort(),
		on: [...state.on].sort(),
		ignored: state.ignored,
		roots: list.roots,
		skills: list.skills,
		catalogComplete: list.catalogComplete,
		catalogError: list.catalogError,
		verdictAvailable: list.verdictAvailable,
		lastAction
	};
}
/** 取出面板里某个名字的行（不存在则 not-found）。 */
async function findSkillRow(scope, payload, skillName) {
	const { list } = await loadPanel(scope, payload);
	const row = list.skills.find((candidate) => candidate.name === skillName);
	if (row === void 0) throw new SwitchError("not-found", `skill "${skillName}" is outside this plugin's scanned roots`, 404);
	return row;
}
/** 完整的 /skill-switch API 表面。 */
function api(scope) {
	return {
		/** 面板初始加载：作用域 + 根 + skill 表。 */
		async "panel.load"(payload) {
			return await buildPanelView(scope, payload);
		},
		/** 一键开/关某个 skill 在本项目的可见性。 */
		async "switches.set"(payload) {
			const skillName = requireString(payload, "name");
			const blocked = requireBoolean(payload, "blocked");
			if (!isSkillName(skillName)) throw new SwitchError("bad-request", `"${skillName}" is not a valid kebab-case skill name; cannot write a switch`);
			const { projectRoot, state } = await projectScopeOf(scope, payload);
			const touched = await writeSwitch(projectRoot, scope.config.switchesDir, skillName, blocked, state.mode);
			scope.logger.info(`skill-switch: project ${projectRoot} ${blocked ? "blocked" : "unblocked"} "${skillName}"`);
			return await buildPanelView(scope, payload, {
				kind: "toggle",
				name: skillName,
				touched
			});
		},
		/**
		* 清空本项目全部开关（一键恢复默认可见性）。
		*
		* 白名单模式（`mode: allow`）下必须连 mode 文件一起删：清空 `on/` 会让
		* 白名单变成空集，等于把整个 skill 目录清空——与"恢复默认可见性"相反。
		*/
		async "switches.reset"(payload) {
			const { projectRoot, state } = await projectScopeOf(scope, payload);
			const modeReset = state.mode === "allow";
			const removed = await clearSwitches(projectRoot, scope.config.switchesDir, { includeMode: modeReset });
			scope.logger.info(`skill-switch: project ${projectRoot} switches cleared (${removed.length} entries${modeReset ? ", mode file removed" : ""})`);
			return await buildPanelView(scope, payload, {
				kind: "reset",
				touched: removed,
				modeReset
			});
		},
		/**
		* 全局删除：把该 skill 在每一处已知根里的副本都删掉。
		* 路径全部由服务端扫描推导，客户端只能传名字。
		*/
		async "skills.delete"(payload) {
			const skillName = requireString(payload, "name");
			const row = await findSkillRow(scope, payload, skillName);
			if (row.copies.length === 0) throw new SwitchError("protected", `"${skillName}" has no on-disk copy (it comes from the runtime or another provider); nothing to delete`, 403);
			const outcome = await deleteSkillCopies(row.copies.map((copy) => ({
				path: copy.path,
				directory: copy.directory,
				form: copy.form,
				rootPath: copy.rootPath,
				source: copy.source,
				deletable: copy.deletable
			})));
			const { projectRoot } = await projectScopeOf(scope, payload);
			const touched = await removeSwitchFiles(projectRoot, scope.config.switchesDir, skillName).catch(() => []);
			if (touched.length > 0) scope.logger.info(`skill-switch: cleared ${touched.length} switch file(s) for "${skillName}"`);
			scope.logger.info(`skill-switch: deleted "${skillName}" from ${outcome.removed.length} location(s)`);
			return await buildPanelView(scope, payload, {
				kind: "delete",
				name: skillName,
				removed: outcome.removed,
				skipped: outcome.skipped,
				touched
			});
		},
		/**
		* 补齐 frontmatter：让缺 name/description 的 skill 重新被 runtime 加载。
		* 只写入可删根里的副本（内置根属于宿主应用，不碰）。
		*/
		async "skills.repair"(payload) {
			const skillName = requireString(payload, "name");
			const row = await findSkillRow(scope, payload, skillName);
			if (row.issues.length === 0) throw new SwitchError("bad-request", `"${skillName}" already has a complete frontmatter; nothing to repair`);
			const description = row.descriptionSource === "none" ? "" : row.description;
			if (description.trim() === "") throw new SwitchError("bad-request", `cannot derive a description for "${skillName}" (no usable text in frontmatter or body); please fill it in manually`);
			const repaired = [];
			const failures = [];
			for (const copy of row.copies) {
				if (!copy.deletable) {
					failures.push(`${copy.path} (protected root, skipped)`);
					continue;
				}
				const target = repairableName(copy.declaredName, copy.entryName, row.name);
				if (target === void 0) {
					failures.push(`${copy.path} (entry name is not valid kebab-case; cannot auto-name)`);
					continue;
				}
				try {
					const next = repairFrontmatter(await readSkillRaw(copy.path), {
						name: target,
						description
					});
					await writeFileAtomic(copy.path, next, { mode: 420 });
					repaired.push(copy.path);
				} catch (error) {
					failures.push(`${copy.path} (${error instanceof Error ? error.message : String(error)})`);
				}
			}
			if (repaired.length === 0) throw new SwitchError("fs-error", `no copy could be repaired: ${failures.join("; ")}`);
			scope.logger.info(`skill-switch: repaired frontmatter of "${skillName}" in ${repaired.length} location(s)`);
			return await buildPanelView(scope, payload, {
				kind: "repair",
				name: skillName,
				repaired,
				skipped: []
			});
		}
	};
}
/** 修复时选用的名字：有效声明名 > 合法条目名 > 当前展示名。 */
function repairableName(declared, entryName, current) {
	if (declared !== void 0 && isSkillName(declared)) return declared;
	if (isSkillName(entryName)) return entryName;
	if (isSkillName(current)) return current;
}
/** 读 connection 行的 trustedHosts（与 /api 网关同一份名单）。 */
function trustedHostsOf(ctx) {
	try {
		for (const entry of ctx.loader.entries()) if (entry.options.name === "connection") return entry.options.config?.trustedHosts ?? [];
	} catch {}
	return [];
}
/** 把一个 HTTP 请求分派到一个 API 方法。 */
function makeHandler(scope) {
	const methods = api(scope);
	return async (req, res) => {
		if (!isTrustedApiRequest(req, trustedHostsOf(scope.ctx))) {
			res.writeHead(403);
			res.end("forbidden");
			return;
		}
		if (req.method !== "POST") {
			res.writeHead(405);
			res.end();
			return;
		}
		const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
		const method = /^\/skill-switch\/api\/([A-Za-z0-9.]+)$/.exec(pathname)?.[1];
		if (method === void 0) {
			writeError(res, new SwitchError("not-found", "unknown skill-switch API path", 404));
			return;
		}
		const handler = Object.hasOwn(methods, method) ? methods[method] : void 0;
		if (handler === void 0) {
			writeError(res, new SwitchError("not-found", `unknown skill-switch API method "${method}"`, 404));
			return;
		}
		try {
			writeOk(res, await handler(await readJsonBody(req)));
		} catch (error) {
			writeError(res, error);
		}
	};
}
/**
* 插件主体：装过滤器，并在 Web 服务就绪后挂上面板路由。
* @param ctx - host 上下文。
* @param config - 宿主配置（由 Loader 校验）。
*/
function apply(ctx, config = {}) {
	const resolved = resolveConfig(config);
	const logger = ctx.logger ?? console;
	const originals = installSkillFilter(ctx, resolved, logger);
	const raw = rawRegistry(ctx.skills, originals);
	ctx.inject([
		"webServer",
		"sessions",
		"loader"
	], (scope) => {
		const apiScope = {
			ctx: scope,
			raw,
			config: resolved,
			logger
		};
		scope.effect(() => scope.webServer.register({
			kind: "prefix",
			path: "/skill-switch",
			handler: makeHandler(apiScope)
		}), "dsh-skill-switch: /skill-switch API routes");
	});
}
/** 路径存在性探测（根的 exists 标记用）。 */
async function pathExists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}
//#endregion
export { ABSENT_STATE, Config, SwitchError, api, apply, clearSwitches, collectionFor, defaultAgentsHome, deleteSkillCopies, documentParts, filterSkills, findProjectRoot, firstMeaningfulLine, frontmatterKind, inject, installSkillFilter, isHidden, isLoopbackHostname, isSkillName, isTrustedApiRequest, listSkills, name, normalizeSwitchName, parseFrontmatter, parseMode, rawRegistry, readNameSet, readSwitchState, removeSwitchFiles, repairFrontmatter, resolveConfig, rootsForProject, scanSkillRoot, scanSkillRoots, sessionCwdOf, skillRoots, stateFingerprint, switchesPath, writeSwitch };
