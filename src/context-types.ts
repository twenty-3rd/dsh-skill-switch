/**
 * 本插件两个半体各自消费的 cordis 服务面（结构化类型）。
 *
 * 为什么不用 `cordis` 的 `declare module` 增强：第三方插件解析到的 cordis
 * 实例与 DSH monorepo 内的那个不是同一个，上游的类型增强传不到这里；把
 * 依赖面收敛成结构接口，既让类型检查可跑，也让测试可以直接提供骨架对象。
 * 一旦 DSH 上游漂移，只需改这一个文件。
 */

// ── host 半体 ───────────────────────────────────────────────────────────────

/**
 * 官方 SkillInvocationPolicy（@deepseek-ai/dsh-skill）。
 *
 * 目录返回的是 **invocation-neutral** 的摘要：注册表**不**按这两个开关过滤，
 * 由消费方（`skill` 工具、命令目录、模型提示）自己过滤。所以"在目录里"与
 * "能调用"是两件事，面板必须分别判定。
 */
export interface SwitchSkillInvocation {
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
}

/** 官方 SkillSummary 里本插件用到的字段（@deepseek-ai/dsh-skill）。 */
export interface SwitchSkillSummary {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation?: SwitchSkillInvocation
  /** 'project-dsh' | 'user-dsh' | 'bundled' | 'runtime' | … */
  readonly source: string
  readonly provider: string
  readonly path?: string
  readonly rank?: number
}

/** 一次目录观察是否完整。 */
export interface SwitchCatalogSnapshot {
  readonly skills: SwitchSkillSummary[]
  readonly complete: boolean
}

/** `ctx.skills` 里本插件读取（并包装）的入口。 */
export interface SwitchSkillRegistry {
  snapshot(options?: SkillViewOptions): Promise<SwitchCatalogSnapshot>
  list(options?: SkillViewOptions): Promise<SwitchSkillSummary[]>
  get(name: string, options?: SkillViewOptions): Promise<unknown>
}

/**
 * 读取目录时的选择项。
 *
 * `scope` 是**观察者作用域**（`@deepseek-ai/dsh-scope` 的 ScopeKey）：注册表按它
 * 选择层（layers），省略 = **只读全局层**。桌面端把 skill provider 挂在 agent
 * preset 的 standing scope 上（profile 里顶层 `skill-filesystem` 是 disabled 的），
 * 所以不带 scope 读到的目录几乎为空——面板要的是"这个会话看到的目录"，必须带上
 * 该会话 agent 的作用域。ScopeKey 的官方类型就是 `object`（键即身份），这里
 * 按本仓约定用结构化类型，避免依赖 `@deepseek-ai/dsh-scope` 内部实现。
 */
export interface SkillViewOptions {
  cwd?: string
  scope?: object
  signal?: AbortSignal
}

/** 官方 `ctx.agents`（@deepseek-ai/dsh-agent）里本插件用到的部分。 */
export interface SwitchAgentRegistry {
  /**
   * 取一个活跃 agent；**agent 对象本身就是它的 ScopeKey**
   * （`dsh-agent` 里 `scopeTarget(agent, agent)`），所以它可以直接传给
   * `snapshot({scope})`。会话不在跑（归档/未 hydrate）时返回 undefined。
   */
  get(id: string): object | undefined
}

/** 一条 webserver 路由（@deepseek-ai/dsh-host-webserver 的 WebRoute 子集）。 */
export interface SwitchWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>
}

/** 宿主 logger 里本插件使用的部分。 */
export interface SwitchLogger {
  info(message: string): void
  warn(message: string): void
}

/** host 半体的 cordis 上下文面。 */
export interface HostContext {
  /** skill 注册表（@deepseek-ai/dsh-skill 的 SkillRegistry）。 */
  readonly skills: SwitchSkillRegistry
  /** HTTP 路由注册表（@deepseek-ai/dsh-host-webserver 的 WebServer）。 */
  readonly webServer: { register(route: SwitchWebRoute): () => void }
  /** 会话存储（读会话权威 cwd）。 */
  readonly sessions: { get(id: string): { header: { cwd?: string } } | undefined }
  /**
   * 活跃 agent 注册表（可选服务）：面板用它拿"这个会话在看到什么目录"的
   * 观察者作用域。缺它时面板不显示判定列，而不是降级成"全局层"——那会把
   * 每个 skill 都误判成错误。
   */
  readonly agents?: SwitchAgentRegistry
  /** cordis 的可选服务读取（`ctx.get(name)`）；服务缺失时返回 undefined。 */
  get?(name: string): unknown
  /** 插件加载器（读 connection 行的 trustedHosts）。 */
  readonly loader: { entries(): Iterable<{ options: { name: string; config?: unknown } }> }
  /** 宿主日志（可选）。 */
  readonly logger?: SwitchLogger
  /** DSH 版 cordis 的生命周期登记：返回的清理函数在 fiber 卸载时执行。 */
  effect(fn: () => void | (() => void), label?: string): void
  /**
   * 等服务就绪后再跑一段插件体（cordis 的 `ctx.inject(deps, callback)`）：
   * 依赖齐全时立刻执行，缺失时挂起、之后补齐再执行；随本 fiber 一起卸载。
   */
  inject(deps: string[], callback: (scope: HostContext) => void): unknown
}

// ── client 半体 ─────────────────────────────────────────────────────────────

/** 会话列表里本插件只读的一行。 */
export interface ClientSessionSummary {
  id: string
  cwd?: string
}

/** client 侧 sessions 服务的列表订阅面（只用于拿 cwd 兜底）。 */
export interface ClientSessionsService {
  list: {
    getSnapshot(): { byId: Record<string, ClientSessionSummary> }
    subscribe(fn: () => void): () => void
  }
}

/** `ctx.slots` 的注册/声明等待面。 */
export interface ClientSlotsService {
  register(options: ClientSlotRegisterOptions, component: unknown): () => void
  inject(key: string, callback: () => () => void): () => void
}

/** `ctx.slots.register` 的选项子集。 */
export interface ClientSlotRegisterOptions {
  name: string
  id?: string
  order?: number
  label?: string | (() => string)
  /** 会话作用域座位的工厂：第一个参数是该实例所属的 SessionId。 */
  inject?: (sessionId: string) => Record<string, unknown>
}

/** `ctx.locale` 的本地化注册面（@deepseek-ai/dsh-client-locale）。 */
export interface ClientLocaleService {
  getSnapshot(): { active: string }
  subscribe(fn: () => void): () => void
  register(namespace: string, language: string, dictionary: Record<string, string>): () => void
}

/** client 半体的 cordis 上下文面。 */
export interface ClientContext {
  readonly slots: ClientSlotsService
  readonly locale: ClientLocaleService
  readonly sessions: ClientSessionsService
  effect(fn: () => void | (() => void), label?: string): void
}
