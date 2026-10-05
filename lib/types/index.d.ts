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
 * 2. **面板 API**（新增，与 dsh-skills-manager 同风格但只做两件事）：
 *    `/skill-switch/api/*` 上的 JSON 接口，供客户端会话视图标签调用：
 *      - 列出本项目的 skill（磁盘容错扫描 × runtime 目录合成）
 *      - 一键开/关某个 skill 在本项目的可见性
 *      - 一键清空本项目全部开关
 *      - 全局删除某个 skill（清掉所有落盘副本）
 *      - 补齐 frontmatter（让缺 name/description 的 skill 重新生效）
 *    路由按与 /api 网关相同的浏览器信任规则设栅栏，且所有文件操作都被限制在
 *    已知 skill 根之内。
 *
 * 与 dsh-skills-manager 的分工：那是「skill 生命周期管理」（库 + 分配 + 增删改），
 * 这里是「生效范围控制 + 一次性清除」，不重复它的创建/编辑/分配/重命名能力。
 */
import Schema from '@deepseek-ai/schemastery';
import type { HostContext, SwitchLogger, SwitchSkillRegistry } from './context-types.ts';
import { type SwitchMode } from './switches.ts';
import { type SkillRootSpec } from './skill-scan.ts';
import { type SkillView } from './skill-view.ts';
/** Cordis 插件名（loader entry id 与日志前缀）。 */
export declare const name = "dsh-skill-switch";
/**
 * 硬依赖只有 skill 注册表：屏蔽逻辑在无 Web 的部署（CLI / headless）里也必须
 * 生效。webServer / sessions / loader 是面板需要的，用 `ctx.inject` 等待它们
 * 出现后再挂路由——服务缺失时插件整体照常工作。
 */
export declare const inject: string[];
/** 宿主插件配置，加载时由 Loader 校验。 */
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
    /** 相对项目根的开关目录。 */
    switchesDir: Schema<string, string, "defined">;
    /** 无 mode 文件时的默认模式：deny=隐藏 off/ 点名的；allow=只放行 on/ 点名的。 */
    defaultMode: Schema<"deny" | "allow", "deny" | "allow", "defined">;
    /** 项目根开关状态的读取缓存时长（毫秒）。 */
    cacheTtlMs: Schema<number, number, "defined">;
    /** get() 调用时是否绕过缓存强制刷新（保证拦截路径的最大新鲜度）。 */
    forceRefreshOnGet: Schema<boolean, boolean, "defined">;
    /** DSH 家目录覆盖（默认 resolveDshHome()，即 $DSH_HOME 或 ~/.dsh）。 */
    dshHome: Schema<string, string, "defined">;
    /** 共享 agent 家目录覆盖（默认 $DSH_AGENTS_HOME 或 ~/.agents）。 */
    agentsHome: Schema<string, string, "defined">;
    /** 额外 skill 根（对应官方 provider 的 customSkillDirs）。 */
    customSkillDirs: Schema<string[], string[], "defined">;
    /** 内置 skill 根覆盖（默认 $DSH_BUNDLED_SKILL_DIR；该根下的 skill 永远不可删）。 */
    bundledSkillDir: Schema<string, string, "defined">;
    /**
     * 是否允许删除共享根 `~/.agents/skills` 里的副本。
     * 默认 true（本项目 v0.2 的显式选择）；团队里该根被 Claude Code 共用时，
     * 置 false 可把它变回只读。
     */
    allowSharedRootWrites: Schema<boolean, boolean, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /** 相对项目根的开关目录。 */
    switchesDir: Schema<string, string, "defined">;
    /** 无 mode 文件时的默认模式：deny=隐藏 off/ 点名的；allow=只放行 on/ 点名的。 */
    defaultMode: Schema<"deny" | "allow", "deny" | "allow", "defined">;
    /** 项目根开关状态的读取缓存时长（毫秒）。 */
    cacheTtlMs: Schema<number, number, "defined">;
    /** get() 调用时是否绕过缓存强制刷新（保证拦截路径的最大新鲜度）。 */
    forceRefreshOnGet: Schema<boolean, boolean, "defined">;
    /** DSH 家目录覆盖（默认 resolveDshHome()，即 $DSH_HOME 或 ~/.dsh）。 */
    dshHome: Schema<string, string, "defined">;
    /** 共享 agent 家目录覆盖（默认 $DSH_AGENTS_HOME 或 ~/.agents）。 */
    agentsHome: Schema<string, string, "defined">;
    /** 额外 skill 根（对应官方 provider 的 customSkillDirs）。 */
    customSkillDirs: Schema<string[], string[], "defined">;
    /** 内置 skill 根覆盖（默认 $DSH_BUNDLED_SKILL_DIR；该根下的 skill 永远不可删）。 */
    bundledSkillDir: Schema<string, string, "defined">;
    /**
     * 是否允许删除共享根 `~/.agents/skills` 里的副本。
     * 默认 true（本项目 v0.2 的显式选择）；团队里该根被 Claude Code 共用时，
     * 置 false 可把它变回只读。
     */
    allowSharedRootWrites: Schema<boolean, boolean, "defined">;
}>>, "plain">;
/** 配置的推断类型（schemastery 的全局命名空间提供 TypeT）。 */
export type PluginConfig = Schemastery.TypeT<typeof Config>;
/** 配置 + 预解析的路径（一次算好，避免每个请求重复解析环境变量）。 */
interface ResolvedConfig {
    switchesDir: string;
    defaultMode: SwitchMode;
    cacheTtlMs: number;
    forceRefreshOnGet: boolean;
    dshHome: string;
    agentsHome: string;
    customSkillDirs: string[];
    bundledSkillDir: string;
    allowSharedRootWrites: boolean;
}
/** 把插件配置解析成内部形态（路径全部绝对化）。 */
export declare function resolveConfig(config?: Partial<PluginConfig>): ResolvedConfig;
/** 按配置构建某个项目根下的 skill 根列表。 */
export declare function rootsForProject(config: ResolvedConfig, projectRoot: string | undefined): SkillRootSpec[];
/**
 * 应用项目级屏蔽：包装 ctx.skills 的 snapshot/list/get。
 * @param ctx - host 上下文。
 * @param config - 已解析配置。
 * @param logger - 日志出口。
 */
export declare function installSkillFilter(ctx: HostContext, config: ResolvedConfig, logger: SwitchLogger): void;
/** 面板一次加载的完整视图（所有变更方法都返回它，避免二次请求与竞态）。 */
export interface PanelView {
    /** 请求解析出的会话工作目录。 */
    cwd: string;
    /** 该 cwd 的项目根。 */
    projectRoot: string;
    /** 开关目录的绝对路径。 */
    switchesPath: string;
    /** 当前生效的开关模式。 */
    mode: SwitchMode;
    /** 开关目录是否已存在。 */
    switchesPresent: boolean;
    /** deny 模式下被隐藏的名字（原样回传，便于诊断）。 */
    off: string[];
    /** allow 模式下被放行的名字（原样回传，便于诊断）。 */
    on: string[];
    /** 开关目录里被忽略的条目。 */
    ignored: string[];
    /** 扫描覆盖的 skill 根。 */
    roots: Array<{
        path: string;
        source: string;
        rank: number;
        live: boolean;
        deletable: boolean;
        exists: boolean;
    }>;
    /** 合并后的 skill 行。 */
    skills: SkillView[];
    /** runtime 目录观察是否完整。 */
    catalogComplete: boolean;
    /** 本次变更动作的报告（只读调用时为 null）。 */
    lastAction: ActionReport | null;
}
/** 一次变更动作的报告。 */
export interface ActionReport {
    kind: 'toggle' | 'reset' | 'delete' | 'repair';
    name?: string;
    /** 写/删掉的开关文件路径。 */
    touched?: string[];
    /** 删除结果。 */
    removed?: string[];
    skipped?: Array<{
        path: string;
        source: string;
        reason: string;
        message?: string;
    }>;
    /** 修复过的 skill 文件路径。 */
    repaired?: string[];
}
/** 面板 API 的上下文。 */
interface ApiScope {
    ctx: HostContext;
    /** 未经过滤的注册表（面板必须看到被屏蔽的 skill）。 */
    raw: SwitchSkillRegistry;
    config: ResolvedConfig;
    logger: SwitchLogger;
}
/** 解析会话的权威 cwd（绝不抛错）。 */
export declare function sessionCwdOf(ctx: HostContext, sessionId: string, clientCwd?: string): string;
/** 一个 API 方法。 */
type ApiMethod = (payload: unknown) => Promise<unknown>;
/** 完整的 /skill-switch API 表面。 */
export declare function api(scope: ApiScope): Record<string, ApiMethod>;
/**
 * 插件主体：装过滤器，并在 Web 服务就绪后挂上面板路由。
 * @param ctx - host 上下文。
 * @param config - 宿主配置（由 Loader 校验）。
 */
export declare function apply(ctx: HostContext, config?: Partial<PluginConfig>): void;
export { isTrustedApiRequest, isLoopbackHostname } from './trust-fence.ts';
export { SwitchError } from './wire.ts';
export type { SwitchErrorCode } from './wire.ts';
export { ABSENT_STATE, clearSwitches, collectionFor, filterSkills, findProjectRoot, isHidden, isSkillName, normalizeSwitchName, parseMode, readNameSet, readSwitchState, stateFingerprint, switchesPath, writeSwitch, } from './switches.ts';
export type { SwitchMode, SwitchState } from './switches.ts';
export { defaultAgentsHome, firstMeaningfulLine, parseFrontmatter, repairFrontmatter, scanSkillRoot, scanSkillRoots, skillRoots, } from './skill-scan.ts';
export { documentParts, frontmatterKind } from './skill-scan.ts';
export type { ScannedSkill, SkillForm, SkillIssue, SkillRootSource, SkillRootSpec } from './skill-scan.ts';
export { deleteSkillCopies } from './skill-delete.ts';
export type { DeleteOutcome, DeleteTarget } from './skill-delete.ts';
export { listSkills } from './skill-view.ts';
export type { SkillCopyView, SkillListView, SkillView } from './skill-view.ts';
