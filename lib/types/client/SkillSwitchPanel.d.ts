import type { PanelStore } from './state.ts';
import type { PanelData, PanelScope, SkillIssue, SkillRow, SkillVerdictError } from './api.ts';
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
/**
 * 详情当前要显示的那一行。
 *
 * 单独抽出来是因为这里有**两条容易写错的规则**，值得被测试盯住：
 * 1. 查的是完整表 `data.skills`（不是筛过的 rows）——筛选/搜索只作用于列表，
 *    详情不该因为列表筛选而变空；
 * 2. 名字在数据里找不到时返回 undefined，调用方回落**列表**。这覆盖"进详情后
 *    这次加载里那行没了"（换了会话、或 host 回传的新数据里已不存在），
 *    而不是渲染一个空壳详情页。
 */
export declare function selectedRow(data: PanelData | null, view: string, name: string): SkillRow | undefined;
/** 打开的卡片菜单状态（`SkillCard` 也导出给渲染测试用）。 */
export type SkillCardMenu = CardMenu;
/** `SkillCard` 的 props（导出以便单独做渲染测试）。 */
export interface SkillCardProps {
    row: SkillRow;
    /** 面板是否拿到了该会话的观察者作用域（false = 不渲染有效/错误，也不列原因）。 */
    showVerdict: boolean;
    busy: boolean;
    menu: CardMenu;
    /** 点事实区（名字/描述）进入详情。 */
    onOpen: () => void;
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
/** `SkillDetail` 的 props（导出以便单独做渲染测试）。 */
export interface SkillDetailProps {
    row: SkillRow;
    /** 同卡片：false = 不显示有效/错误判定（拿不到该会话的观察者作用域）。 */
    showVerdict: boolean;
    onBack: () => void;
}
/**
 * 一个 skill 的详情：名称、描述、判定依据（A/B/C），以及**这个名字在磁盘上
 * 存在的每一处根位置**。
 *
 * 为什么需要它：列表每行只显示"胜出副本"（rank 最小者），同名 skill 散在
 * 共享根 / DSH 根 / 库根里时，用户看不到另外几处，也就判断不了"删干净了没有"
 * 或"DSH 到底加载的是哪一份"。这里把每处副本的根目录、具体文件、优先级、
 * 是否会被 DSH 加载、能否删除、以及**它自己**的 frontmatter 问题一并摊开。
 *
 * 只读：不带任何写动作（屏蔽 / 删除 / 补齐仍在列表里），所以详情不会改变状态，
 * 也就不存在"详情里的数据过期"问题——它渲染的就是本次加载回来的那份。
 */
export declare function SkillDetail(props: SkillDetailProps): import("react").JSX.Element;
export {};
