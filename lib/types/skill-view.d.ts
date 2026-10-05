/**
 * 面板数据源：把「磁盘上有什么」和「runtime 真正认了什么」两路事实合成一张表。
 *
 * 为什么要两路：
 * - 只听 runtime（`ctx.skills.snapshot()`）：缺 name/description 的 skill
 *   根本不在返回里，面板就复现了 dsh-skills-manager 的盲区。
 * - 只听磁盘：会把 DSH 实际忽略的条目当成"生效中"，误导用户。
 *
 * 合成规则：
 * - 以磁盘扫描结果为主，按 rank 升序取「胜出副本」作为展示字段；
 * - 同一个名字的每一处副本都收进 `copies`，删除时一目了然；
 * - 用 catalog 按名字标注 `inCatalog`，并补上**只在 runtime 里存在**的条目
 *   （别的 provider 注册的虚拟 skill：能屏蔽、不能删）。
 */
import type { SwitchSkillRegistry } from './context-types.ts';
import type { SkillForm, SkillIssue, SkillRootSpec, SkillRootSource } from './skill-scan.ts';
import { type SwitchState } from './switches.ts';
/** 一处磁盘副本的线上表示。 */
export interface SkillCopyView {
    path: string;
    directory: string;
    form: SkillForm;
    /** 条目名（目录名 / 去掉 .md 的文件名）：「补齐 frontmatter」的候选名。 */
    entryName: string;
    /** frontmatter 里声明的原始名字（若有，可能不合法）。 */
    declaredName?: string;
    rootPath: string;
    source: SkillRootSource;
    rank: number;
    live: boolean;
    deletable: boolean;
    issues: SkillIssue[];
}
/** 面板里的一行。 */
export interface SkillView {
    name: string;
    description: string;
    descriptionSource: 'frontmatter' | 'body' | 'none';
    nameSource: 'frontmatter' | 'entry';
    /** 胜出副本的来源根；虚拟条目为 runtime 的 source。 */
    source: string;
    rank: number;
    /** 是否属于 runtime 目录（会真的影响模型看到的目录）。 */
    live: boolean;
    /** 名字是否合法 kebab-case（决定能否写开关文件）。 */
    blockable: boolean;
    /** 本项目当前是否屏蔽。 */
    blocked: boolean;
    /** runtime 目录里是否真有它。 */
    inCatalog: boolean;
    /** 让 runtime 忽略它的原因；空数组 = 会被正常加载。 */
    issues: SkillIssue[];
    /** 是否存在任何一处可删副本。 */
    deletable: boolean;
    /** 胜出副本的 SKILL.md / <name>.md 路径（虚拟条目没有）。 */
    path?: string;
    form: SkillForm | 'virtual';
    /** catalog 里的 provider 标签。 */
    provider?: string;
    /** catalog 里的 source 标签（与磁盘来源可能不同）。 */
    catalogSource?: string;
    /** 全部磁盘副本。 */
    copies: SkillCopyView[];
}
/** listSkills 的返回。 */
export interface SkillListView {
    skills: SkillView[];
    /** runtime 目录观察是否完整（provider 报 incomplete 时为 false）。 */
    catalogComplete: boolean;
    /** 磁盘扫描覆盖的根（面板用来解释"为什么某个 skill 不在列表里"）。 */
    roots: Array<{
        path: string;
        source: SkillRootSource;
        rank: number;
        live: boolean;
        deletable: boolean;
        exists: boolean;
    }>;
}
/** 一次 listSkills 的输入。 */
export interface ListSkillsOptions {
    /** skill 注册表（host 侧 ctx.skills）。 */
    skills: SwitchSkillRegistry;
    /** 会话 cwd（决定项目级根）。 */
    cwd: string;
    /** 已构建的根列表（含项目根）。 */
    roots: SkillRootSpec[];
    /** 当前项目的开关状态。 */
    state: SwitchState | undefined;
    /** 路径存在性探测（根清单的 exists 标记 + 目录残留校验；便于测试注入）。 */
    pathExists: (path: string) => Promise<boolean>;
}
/**
 * 合成面板数据。
 * @param options - 注册表、cwd、根列表、开关状态。
 * @returns 面板表格 + runtime 目录完整性 + 根清单。
 */
export declare function listSkills(options: ListSkillsOptions): Promise<SkillListView>;
