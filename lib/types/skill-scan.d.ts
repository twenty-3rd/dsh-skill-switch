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
 *   「未生效」徽标与原因，并提供「补齐 frontmatter」修复入口
 *
 * 根与 rank（数字越小优先级越高），对齐 dsh-skill-filesystem 的 roots()：
 *   project .dsh/skills (100) → project .agents/skills (200) → custom (300)
 *   → ~/.dsh/skills (400) → ~/.agents/skills (500) → bundled (600)
 * 另外把 <$DSH_HOME>/skill-library 作为**非 runtime** 根列出（rank 1000），
 * 这样「全局删除」能一次清干净 dsh-skills-manager 留下的规范副本。
 */
/** 磁盘上的 skill 来源，取值与官方 SkillSource 一致（外加库与非 runtime 语义）。 */
export type SkillRootSource = 'project-dsh' | 'project-agents' | 'custom' | 'user-dsh' | 'user-agents' | 'bundled' | 'library';
/** skill 的落盘形态：目录 bundle（含 SKILL.md）或单文件 <name>.md。 */
export type SkillForm = 'bundle' | 'flat';
/**
 * 一个候选条目被官方 provider 忽略的原因（面板据此解释「未生效」）。
 *
 * 取值对齐 `@deepseek-ai/dsh-skill-filesystem` 的 `parseSkillFile()`：
 * 它会在 frontmatter 缺失/坏掉、缺 name、name 不合语法、缺 description、
 * 以及 invocation 字段非法（含遗留键）这几种情况下**整条丢弃**。
 */
export type SkillIssue = 'missing-frontmatter' | 'invalid-frontmatter' | 'missing-name' | 'invalid-name' | 'missing-description' | 'invalid-entry-name' | 'invalid-invocation';
/** 一个被扫描的 skill 根。 */
export interface SkillRootSpec {
    /** 根的绝对路径。 */
    path: string;
    source: SkillRootSource;
    /** 数字越小优先级越高（与官方 provider 一致）。 */
    rank: number;
    /** 是否属于 runtime 目录（官方 provider 会扫描并注入的根）。 */
    live: boolean;
    /** 面板是否允许在该根下删除 skill。 */
    deletable: boolean;
    /** 是否跳过 `.system` 目录（只有 DSH 用户根这么做）。 */
    skipSystem?: boolean;
}
/** 构建根列表的输入（全部为已解析的绝对路径）。 */
export interface SkillRootOptions {
    /** 会话 cwd 对应的项目根；省略则不包含项目级根。 */
    projectRoot?: string;
    /** DSH 家目录（默认 resolveDshHome()）。 */
    dshHome: string;
    /** 共享 agent 家目录（默认 $DSH_AGENTS_HOME 或 ~/.agents）。 */
    agentsHome: string;
    /** 额外根（config.customSkillDirs）。 */
    customSkillDirs?: string[];
    /** 内置 skill 根（config.bundledSkillDir，通常是 $DSH_BUNDLED_SKILL_DIR）。 */
    bundledSkillDir?: string;
    /** 是否把共享根 (~/.agents/skills) 也视为可删。默认 true（用户已确认）。 */
    allowSharedRootWrites?: boolean;
}
/**
 * 按官方 provider 的口径构建 skill 根列表，外加非 runtime 的库根。
 * @param options - 已解析的路径配置。
 * @returns 根列表（含 rank / live / deletable 元数据）。
 */
export declare function skillRoots(options: SkillRootOptions): SkillRootSpec[];
/** 默认共享 agent 家目录。 */
export declare function defaultAgentsHome(): string;
/** 一个扫描出来的 skill 候选（容错解析结果）。 */
export interface ScannedSkill {
    /** 有效名字：frontmatter name 优先，否则回退到条目名。 */
    name: string;
    /** frontmatter 里声明的原始名字（若有）。 */
    declaredName?: string;
    /** 条目名：bundle 的目录名或 flat 文件名去掉 .md（「补齐 frontmatter」时的候选名）。 */
    entryName: string;
    /** 名字的来源，面板用来说明「名字取自目录名」。 */
    nameSource: 'frontmatter' | 'entry';
    /** 展示用描述：frontmatter > 正文首段 > 空串。 */
    description: string;
    /** 描述的来源：空串时为 'none'。 */
    descriptionSource: 'frontmatter' | 'body' | 'none';
    whenToUse?: string;
    /** SKILL.md（bundle）或 <name>.md（flat）的绝对路径。 */
    path: string;
    /** bundle 的目录；flat 为该根目录。 */
    directory: string;
    form: SkillForm;
    /** 所属根的绝对路径。 */
    rootPath: string;
    source: SkillRootSource;
    rank: number;
    /** 是否属于 runtime 目录。 */
    live: boolean;
    /** 是否允许删除。 */
    deletable: boolean;
    /** 让官方 provider 忽略该条目的原因；空数组表示会被正常加载。 */
    issues: SkillIssue[];
    /** 名字是否为合法 kebab-case（决定能否写开关文件 / 按名删除）。 */
    blockable: boolean;
}
/** frontmatter 解析结果。 */
interface FrontmatterParse {
    data: Record<string, unknown>;
    body: string;
}
/**
 * 扫描一个根下的全部候选（容错，不丢弃"官方会忽略"的条目）。
 * 根不存在或不可读时返回空数组；单个条目读失败只跳过该条目。
 * @param root - 根规格。
 * @returns 按条目名排序的候选数组。
 */
export declare function scanSkillRoot(root: SkillRootSpec): Promise<ScannedSkill[]>;
/** 扫描一批根，按 rank 升序返回（同 rank 按根路径稳定排序）。 */
export declare function scanSkillRoots(roots: SkillRootSpec[]): Promise<ScannedSkill[]>;
/** 读取并容错解析一个候选 skill 文件。 */
export declare function readCandidate(path: string, entryName: string, form: SkillForm, directory: string, root: SkillRootSpec): Promise<ScannedSkill>;
/** 一个 skill 文件的三段式阅读结果：frontmatter 状态 + 解析出的字段 + 正文。 */
export type DocumentParts = {
    kind: 'ok';
    data: Record<string, unknown>;
    body: string;
} | {
    kind: 'absent';
    body: string;
} | {
    kind: 'invalid';
    body: string;
};
/**
 * 一次读清 frontmatter 状态、字段与正文。
 * 关键点：**frontmatter 解析失败时也把围栏之后的正文带出来**，这样面板对
 * 「未生效」的 skill 仍能给出可读描述（官方 provider 此时直接丢弃整条）。
 * @param raw - 文件原始内容。
 */
export declare function documentParts(raw: string): DocumentParts;
/** 解析 YAML frontmatter；没有 frontmatter 或解析失败都返回 undefined。 */
export declare function parseFrontmatter(raw: string): FrontmatterParse | undefined;
/** 该文件的 frontmatter 是完整可解析的、缺失的、还是解析失败的。 */
export declare function frontmatterKind(raw: string): 'ok' | 'absent' | 'invalid';
/** 从正文里取第一段有意义的文字，作为缺失描述时的回退。 */
export declare function firstMeaningfulLine(body: string): string;
/**
 * 把一个派生的 frontmatter 写回文件，让官方 provider 重新接受它：
 * 文件已有 frontmatter 时补齐缺失字段，没有 frontmatter 时在文首插入一段。
 * 只改 frontmatter，正文一字不动。
 *
 * @param raw - 文件原始内容。
 * @param fields - 要写入的 name / description（调用方保证非空且合法）。
 * @returns 修复后的完整文件内容。
 */
export declare function repairFrontmatter(raw: string, fields: {
    name: string;
    description: string;
    whenToUse?: string;
}): string;
/** 读取一个候选文件当前的原始内容（修复动作需要）。 */
export declare function readSkillRaw(path: string): Promise<string>;
/** 确保目录存在（写开关文件/修复文件前调用）。 */
export declare function ensureDir(path: string): Promise<void>;
/** 供测试/日志使用：条目的短标签。 */
export declare function skillLabel(skill: Pick<ScannedSkill, 'name' | 'source'>): string;
/** 一个根的人类可读短名（英文，日志用；UI 文案在 client/locales.ts）。 */
export declare function rootBasename(rootPath: string): string;
export {};
