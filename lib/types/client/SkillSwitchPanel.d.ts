import type { PanelStore } from './state.ts';
import type { PanelScope, SkillIssue } from './api.ts';
/** 来源根 id → 本地化徽标文案。 */
export declare function sourceLabel(source: string): string;
/** 「未生效」原因 → 本地化文案。 */
export declare function issueLabel(issue: SkillIssue): string;
/**
 * 面板主体：筛选栏 + 作用域行 + skill 列表。
 * `scope` 由挂载它的会话视图提供（座位作用域，不读全局"当前会话"）。
 */
export declare function SkillSwitchBody(props: {
    store: PanelStore;
    scope: PanelScope;
}): import("react").JSX.Element;
