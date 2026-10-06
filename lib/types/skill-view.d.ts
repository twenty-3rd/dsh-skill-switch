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
 * - 用 catalog 按名字判定「有效/错误」，并补上**只在 runtime 里存在**的条目
 *   （别的 provider 注册的虚拟 skill：能屏蔽、不能删）。
 *
 * catalog 必须带**观察者作用域**读（见 {@link ListSkillsOptions.scope}）：注册表按
 * scope 选层，省略 = 只读全局层，而桌面端把 provider 挂在 agent preset 的
 * standing scope 上——不带 scope 读到的目录几乎是空的，会把每个用户 skill 都判成
 * `not-in-registry`。
 */
import type { SwitchSkillRegistry } from './context-types.ts';
import type { SkillForm, SkillIssue, SkillRootSpec, SkillRootSource } from './skill-scan.ts';
import { type SwitchState } from './switches.ts';
/**
 * 一个 skill 是否"有效"的失败项。
 *
 * 「有效」的定义（用户口径，三条件必须同时成立）：
 *   A. 在目录里 —— runtime 注册表的 `snapshot({ cwd, scope })` 里有它；
 *   B. 模型可主动调用 —— `invocation.modelInvocable`；
 *   C. 用户可显式调用 —— `invocation.userInvocable`。
 * 任一条不成立就是「错误」，面板把**具体是哪一条**显示出来（否则"错误"不可行动）。
 *
 * 为什么不把 A 和 B/C 揉成一个笼统的"未生效"：注册表返回的是 invocation-neutral
 * 摘要（官方注释原话），`disable-model-invocation: true` 的 skill 是 A 成立、
 * B 不成立——这是**按设计**的用户专用 skill，和"文件写坏了所以没被加载"完全是
 * 两回事，混在一起说就是误导。
 */
export type SkillVerdictError = 'not-in-registry' | 'model-not-invocable' | 'user-not-invocable';
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
    /** runtime 目录里是否真有它（判定条件 A）。 */
    inCatalog: boolean;
    /** 判定：空数组 = 有效；否则是失败的三条件（A/B/C）。 */
    errors: SkillVerdictError[];
    /** 注册表给出的调用开关（判定条件 B/C 的原始事实；虚拟条目也有）。 */
    invocation?: {
        modelInvocable: boolean;
        userInvocable: boolean;
    };
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
    /** runtime 目录是否**读取失败**（skill 服务抛错）：此时判定列不可用。 */
    catalogError: boolean;
    /**
     * 判定列是否可用：只有拿到观察者作用域（活跃 agent）且目录读取成功时才为 true。
     * 为 false 时面板**不显示**有效/错误——把"我不知道"渲染成"它是错的"是欺骗。
     */
    verdictAvailable: boolean;
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
    /**
     * 观察者作用域（该会话的 agent）。省略 = 只读全局层，此时判定列不可用：
     * 桌面端 provider 挂在 agent preset 的 standing scope 上，全局层里几乎什么都没有，
     * 拿它当"目录"会把每个用户 skill 都判成 not-in-registry。
     */
    scope?: object;
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
