/**
 * 面板状态：一个每次激活一份的小 store（官方 createXXXStore() 工厂约定——
 * 生产代码只在 apply() 里创建，交给挂载的组件，不做模块级单例）。
 *
 * 只放浏览状态（筛选 + 搜索词）。请求作用域（sessionId / cwd）不进 store：
 * 会话作用域的 `conversation.view` 座位会把 SessionId 通过 props 交给视图，
 * 所以切换会话不会留下过期作用域。
 */
/** 列表筛选：全部 / 本项目已屏蔽。判定（有效/错误）是行内徽标，不做筛选页。 */
export type PanelFilter = 'all' | 'blocked';
/** store 的快照形状。 */
export interface PanelState {
    filter: PanelFilter;
    /** 名字/描述搜索词（空串 = 不过滤）。 */
    query: string;
}
/** 写动作。 */
export interface PanelActions {
    setFilter(filter: PanelFilter): void;
    setQuery(query: string): void;
}
/** store 产物：不可变快照 + 订阅 + 绑定的动作。 */
export interface PanelStore {
    getSnapshot(): PanelState;
    subscribe(fn: () => void): () => void;
    actions: PanelActions;
}
/** 工厂：每次插件激活一份 store。 */
export declare function createSkillSwitchStore(): PanelStore;
