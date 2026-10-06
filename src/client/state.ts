/**
 * 面板状态：一个每次激活一份的小 store（官方 createXXXStore() 工厂约定——
 * 生产代码只在 apply() 里创建，交给挂载的组件，不做模块级单例）。
 *
 * 只放浏览状态（筛选 + 搜索词 + 当前视图）。请求作用域（sessionId / cwd）不进 store：
 * 会话作用域的 `conversation.view` 座位会把 SessionId 通过 props 交给视图，
 * 所以切换会话不会留下过期作用域。
 */

/** 列表筛选：全部 / 本项目已屏蔽。判定（有效/错误）是行内徽标，不做筛选页。 */
export type PanelFilter = 'all' | 'blocked'

/**
 * 面板当前视图：skill 列表 / 单个 skill 的详情。
 *
 * 用**同一面板内切视图**而不是弹层或路由：详情承载的是"这个 skill 的每一处
 * 落盘副本"，与列表是同一份数据的两种读法，不是新页面；也因此不需要在
 * 会话视图座位里再挂一层路由。
 */
export type PanelView = 'list' | 'detail'

/** store 的快照形状。 */
export interface PanelState {
  filter: PanelFilter
  /** 名字/描述搜索词（空串 = 不过滤）。 */
  query: string
  /** 当前视图。 */
  view: PanelView
  /** 详情视图正在看的 skill 名；`list` 下为空串。 */
  selectedName: string
}

/** 写动作。 */
export interface PanelActions {
  setFilter(filter: PanelFilter): void
  setQuery(query: string): void
  /** 进入 `name` 的详情。 */
  showDetail(name: string): void
  /** 回到列表（保留筛选与搜索词）。 */
  backToList(): void
}

/** store 产物：不可变快照 + 订阅 + 绑定的动作。 */
export interface PanelStore {
  getSnapshot(): PanelState
  subscribe(fn: () => void): () => void
  actions: PanelActions
}

/** 工厂：每次插件激活一份 store。 */
export function createSkillSwitchStore(): PanelStore {
  let state: PanelState = { filter: 'all', query: '', view: 'list', selectedName: '' }
  const listeners = new Set<() => void>()
  const emit = (): void => {
    for (const listener of listeners) listener()
  }
  const set = (patch: Partial<PanelState>): void => {
    state = { ...state, ...patch }
    emit()
  }
  return {
    getSnapshot: () => state,
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    actions: {
      setFilter(filter) {
        set({ filter })
      },
      setQuery(query) {
        set({ query })
      },
      showDetail(name) {
        set({ view: 'detail', selectedName: name })
      },
      backToList() {
        set({ view: 'list', selectedName: '' })
      },
    },
  }
}
