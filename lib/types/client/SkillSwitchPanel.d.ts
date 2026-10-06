import type { PanelStore } from './state.ts';
import type { PanelScope, SkillIssue, SkillRow, SkillVerdictError } from './api.ts';
/** 来源根 id → 本地化徽标文案。 */
export declare function sourceLabel(source: string): string;
/** frontmatter 事实 → 本地化文案（作为「错误」的解释：为什么它不在目录里）。 */
export declare function issueLabel(issue: SkillIssue): string;
/**
 * 判定失败项 → 本地化文案。
 *
 * 「错误」必须说清是 A/B/C 哪一条不成立：只写"错误"用户无法行动，而"原因未知"
 * 那种兜底说法（上一版）是把"我没读到"当成了结论。
 */
export declare function verdictLabel(error: SkillVerdictError): string;
/** 打开的卡片菜单：哪一行 + 哪一步。 */
type CardMenu = {
    name: string;
    mode: 'actions';
} | {
    name: string;
    mode: 'confirm-delete';
} | {
    name: string;
    mode: 'confirm-repair';
} | null;
/**
 * 面板主体：筛选栏 + 作用域行 + skill 列表。
 * `scope` 由挂载它的会话视图提供（座位作用域，不读全局"当前会话"）。
 */
export declare function SkillSwitchBody(props: {
    store: PanelStore;
    scope: PanelScope;
}): import("react").JSX.Element;
/** 打开的卡片菜单状态（`SkillCard` 也导出给渲染测试用）。 */
export type SkillCardMenu = CardMenu;
/** `SkillCard` 的 props（导出以便单独做渲染测试）。 */
export interface SkillCardProps {
    row: SkillRow;
    /** 面板是否拿到了该会话的观察者作用域（false = 不渲染有效/错误，也不列原因）。 */
    showVerdict: boolean;
    busy: boolean;
    menu: CardMenu;
    onToggle: () => void;
    onOpenMenu: () => void;
    onAskDelete: () => void;
    onAskRepair: () => void;
    onConfirmDelete: () => void;
    onConfirmRepair: () => void;
    onCloseMenu: () => void;
}
/**
 * 一张 skill 卡片：左事实（名字 / 来源 / 描述 / 判定与原因），右操作
 * （一键开关键与「操作」菜单）。导出是为了能在不启动 effect 的服务端渲染里
 * 覆盖每条分支。
 */
export declare function SkillCard(props: SkillCardProps): import("react").JSX.Element;
export {};
