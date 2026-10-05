/**
 * /skill-switch API 的类型化 fetch 封装。每次调用都是 POST
 * `/skill-switch/api/<method>`，带上 sessionId 与（已知时）会话 cwd；
 * 失败抛出带 wire code 的 {@link SkillSwitchApiError}。
 */
/** wire 层失败。 */
export declare class SkillSwitchApiError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** 让 runtime 忽略该条目的原因。 */
export type SkillIssue = 'missing-frontmatter' | 'invalid-frontmatter' | 'missing-name' | 'invalid-name' | 'missing-description' | 'invalid-entry-name';
/** 一处磁盘副本。 */
export interface SkillCopy {
    path: string;
    directory: string;
    form: 'bundle' | 'flat';
    entryName: string;
    declaredName?: string;
    rootPath: string;
    source: string;
    rank: number;
    live: boolean;
    deletable: boolean;
    issues: SkillIssue[];
}
/** 面板里的一行。 */
export interface SkillRow {
    name: string;
    description: string;
    descriptionSource: 'frontmatter' | 'body' | 'none';
    nameSource: 'frontmatter' | 'entry';
    source: string;
    rank: number;
    live: boolean;
    blockable: boolean;
    blocked: boolean;
    inCatalog: boolean;
    issues: SkillIssue[];
    deletable: boolean;
    path?: string;
    form: 'bundle' | 'flat' | 'virtual';
    provider?: string;
    catalogSource?: string;
    copies: SkillCopy[];
}
/** 一个被扫描的 skill 根。 */
export interface SkillRootRow {
    path: string;
    source: string;
    rank: number;
    live: boolean;
    deletable: boolean;
    exists: boolean;
}
/** 一次变更动作的报告。 */
export interface ActionReport {
    kind: 'toggle' | 'reset' | 'delete' | 'repair';
    name?: string;
    touched?: string[];
    removed?: string[];
    skipped?: Array<{
        path: string;
        source: string;
        reason: string;
        message?: string;
    }>;
    repaired?: string[];
}
/** 面板一次加载的完整数据。 */
export interface PanelData {
    cwd: string;
    projectRoot: string;
    switchesPath: string;
    mode: 'deny' | 'allow';
    switchesPresent: boolean;
    off: string[];
    on: string[];
    ignored: string[];
    roots: SkillRootRow[];
    skills: SkillRow[];
    catalogComplete: boolean;
    lastAction: ActionReport | null;
}
/** 请求作用域：会话 id + （未知时省略的）cwd。 */
export interface PanelScope {
    sessionId: string;
    cwd?: string;
}
/** 面板 API 表面（每个调用都带会话作用域）。 */
export declare const api: {
    /** 加载面板：作用域 + 根 + 合并后的 skill 表。 */
    load: (scope: PanelScope, signal?: AbortSignal) => Promise<PanelData>;
    /** 一键开/关某个 skill 在本项目的可见性。 */
    setSwitch: (scope: PanelScope, name: string, blocked: boolean) => Promise<PanelData>;
    /** 清空本项目全部开关。 */
    resetSwitches: (scope: PanelScope) => Promise<PanelData>;
    /** 全局删除该 skill 的所有落盘副本。 */
    deleteSkill: (scope: PanelScope, name: string) => Promise<PanelData>;
    /** 补齐 frontmatter，让未生效的 skill 重新被加载。 */
    repairSkill: (scope: PanelScope, name: string) => Promise<PanelData>;
};
