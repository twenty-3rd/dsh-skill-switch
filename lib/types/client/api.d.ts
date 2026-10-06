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
import type { ActionReport, PanelView } from '../index.ts';
import type { SkillForm, SkillIssue } from '../skill-scan.ts';
import type { SkillCopyView, SkillVerdictError, SkillView } from '../skill-view.ts';
export type { ActionReport, SkillForm, SkillIssue, SkillVerdictError };
/** 一处磁盘副本（= host 的 SkillCopyView）。 */
export type SkillCopy = SkillCopyView;
/** 面板里的一行（= host 的 SkillView）。 */
export type SkillRow = SkillView;
/** 一个被扫描的 skill 根（= PanelView["roots"] 的元素）。 */
export type SkillRootRow = PanelView['roots'][number];
/** 面板一次加载的完整数据（= host 的 PanelView）。 */
export type PanelData = PanelView;
/** 请求作用域：会话 id + （会话尚未 hydrate 时才有意义的）cwd。 */
export interface PanelScope {
    sessionId: string;
    cwd?: string;
}
/** 面板 API 表面（每个调用都带会话作用域）。 */
export declare const api: {
    /** 加载面板：作用域 + 根 + 合并后的 skill 表。 */
    load: (scope: PanelScope, signal?: AbortSignal) => Promise<PanelView>;
    /** 一键开/关某个 skill 在本项目的可见性。 */
    setSwitch: (scope: PanelScope, name: string, blocked: boolean) => Promise<PanelView>;
    /** 清空本项目全部开关。 */
    resetSwitches: (scope: PanelScope) => Promise<PanelView>;
    /** 全局删除该 skill 的所有落盘副本。 */
    deleteSkill: (scope: PanelScope, name: string) => Promise<PanelView>;
    /** 补齐 frontmatter，让判定条件 A（在目录里）重新成立。 */
    repairSkill: (scope: PanelScope, name: string) => Promise<PanelView>;
};
