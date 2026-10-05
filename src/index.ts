/**
 * dsh-skill-switch — host 半体。
 *
 * 两件事，互相独立：
 *
 * 1. **项目级屏蔽**（沿用 v1 的机制，不改语义）：装饰 `ctx.skills`
 *    （SkillRegistry）的三个消费入口 snapshot / list / get，按每次调用自带的
 *    cwd 解析项目根，读 `<项目根>/.dsh/skill-switches/` 下的开关文件，过滤
 *    目录并按名拦截加载。
 *    - `dsh-tool-skill` 每轮 `agent/pre-step` 用 `{cwd: session.header.cwd}` 调
 *      snapshot，digest 变化即重写系统提示里的 skill 目录——所以开关变化在
 *      下一个模型轮次自动生效，无需重启。
 *    - 同一 host 进程服务多个会话时，各会话按各自 cwd 解析项目根，互不影响。
 *    - 卸载（fiber dispose）时摘掉包装，服务回到原始形态；开关目录不存在时
 *      过滤器纯透传，行为与未安装本插件一致。
 *
 * 2. **面板 API**（新增，与 dsh-skills-manager 同风格但只做两件事）：
 *    `/skill-switch/api/*` 上的 JSON 接口，供客户端会话视图标签调用：
 *      - 列出本项目的 skill（磁盘容错扫描 × runtime 目录合成）
 *      - 一键开/关某个 skill 在本项目的可见性
 *      - 一键清空本项目全部开关
 *      - 全局删除某个 skill（清掉所有落盘副本）
 *      - 补齐 frontmatter（让缺 name/description 的 skill 重新生效）
 *    路由按与 /api 网关相同的浏览器信任规则设栅栏，且所有文件操作都被限制在
 *    已知 skill 根之内。
 *
 * 与 dsh-skills-manager 的分工：那是「skill 生命周期管理」（库 + 分配 + 增删改），
 * 这里是「生效范围控制 + 一次性清除」，不重复它的创建/编辑/分配/重命名能力。
 */
import Schema from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import type { HostContext, SwitchLogger, SwitchSkillRegistry, SwitchWebRoute } from './context-types.ts'
import {
  SwitchError,
  optionalString,
  readJsonBody,
  requireBoolean,
  requireString,
  writeError,
  writeOk,
} from './wire.ts'
import { isTrustedApiRequest } from './trust-fence.ts'
import {
  clearSwitches,
  filterSkills,
  findProjectRoot,
  isHidden,
  isSkillName,
  readSwitchState,
  stateFingerprint,
  switchesPath,
  writeSwitch,
  type SwitchMode,
  type SwitchState,
} from './switches.ts'
import {
  defaultAgentsHome,
  readSkillRaw,
  repairFrontmatter,
  skillRoots,
  type SkillRootSpec,
} from './skill-scan.ts'
import { listSkills, type SkillView } from './skill-view.ts'
import { deleteSkillCopies, type DeleteTarget, type DeleteOutcome } from './skill-delete.ts'

/** Cordis 插件名（loader entry id 与日志前缀）。 */
export const name = 'dsh-skill-switch'

/**
 * 硬依赖只有 skill 注册表：屏蔽逻辑在无 Web 的部署（CLI / headless）里也必须
 * 生效。webServer / sessions / loader 是面板需要的，用 `ctx.inject` 等待它们
 * 出现后再挂路由——服务缺失时插件整体照常工作。
 */
export const inject = ['skills']

/** 宿主插件配置，加载时由 Loader 校验。 */
export const Config = Schema.object({
  /** 相对项目根的开关目录。 */
  switchesDir: Schema.string().default('.dsh/skill-switches'),
  /** 无 mode 文件时的默认模式：deny=隐藏 off/ 点名的；allow=只放行 on/ 点名的。 */
  defaultMode: Schema.union([Schema.const('deny'), Schema.const('allow')]).default('deny'),
  /** 项目根开关状态的读取缓存时长（毫秒）。 */
  cacheTtlMs: Schema.natural().default(1000),
  /** get() 调用时是否绕过缓存强制刷新（保证拦截路径的最大新鲜度）。 */
  forceRefreshOnGet: Schema.boolean().default(true),
  /** DSH 家目录覆盖（默认 resolveDshHome()，即 $DSH_HOME 或 ~/.dsh）。 */
  dshHome: Schema.string().default(''),
  /** 共享 agent 家目录覆盖（默认 $DSH_AGENTS_HOME 或 ~/.agents）。 */
  agentsHome: Schema.string().default(''),
  /** 额外 skill 根（对应官方 provider 的 customSkillDirs）。 */
  customSkillDirs: Schema.array(Schema.string()).default([]),
  /** 内置 skill 根覆盖（默认 $DSH_BUNDLED_SKILL_DIR；该根下的 skill 永远不可删）。 */
  bundledSkillDir: Schema.string().default(''),
  /**
   * 是否允许删除共享根 `~/.agents/skills` 里的副本。
   * 默认 true（本项目 v0.2 的显式选择）；团队里该根被 Claude Code 共用时，
   * 置 false 可把它变回只读。
   */
  allowSharedRootWrites: Schema.boolean().default(true),
})

/** 配置的推断类型（schemastery 的全局命名空间提供 TypeT）。 */
export type PluginConfig = Schemastery.TypeT<typeof Config>

/** 配置 + 预解析的路径（一次算好，避免每个请求重复解析环境变量）。 */
interface ResolvedConfig {
  switchesDir: string
  defaultMode: SwitchMode
  cacheTtlMs: number
  forceRefreshOnGet: boolean
  dshHome: string
  agentsHome: string
  customSkillDirs: string[]
  bundledSkillDir: string
  allowSharedRootWrites: boolean
}

/** 把插件配置解析成内部形态（路径全部绝对化）。 */
export function resolveConfig(config: Partial<PluginConfig> = {}): ResolvedConfig {
  const envBundled = process.env.DSH_BUNDLED_SKILL_DIR ?? ''
  const bundledRaw = config.bundledSkillDir !== undefined && config.bundledSkillDir !== '' ? config.bundledSkillDir : envBundled
  return {
    switchesDir: config.switchesDir !== undefined && config.switchesDir !== '' ? config.switchesDir : '.dsh/skill-switches',
    defaultMode: config.defaultMode === 'allow' ? 'allow' : 'deny',
    cacheTtlMs: typeof config.cacheTtlMs === 'number' && config.cacheTtlMs >= 0 ? config.cacheTtlMs : 1000,
    forceRefreshOnGet: config.forceRefreshOnGet !== false,
    dshHome: config.dshHome !== undefined && config.dshHome !== '' ? resolvePath(config.dshHome) : resolveDshHome(),
    agentsHome: config.agentsHome !== undefined && config.agentsHome !== '' ? resolvePath(config.agentsHome) : defaultAgentsHome(),
    customSkillDirs: (config.customSkillDirs ?? []).filter(dir => typeof dir === 'string' && dir !== '').map(dir => resolvePath(dir)),
    bundledSkillDir: bundledRaw !== '' ? resolvePath(bundledRaw) : '',
    allowSharedRootWrites: config.allowSharedRootWrites !== false,
  }
}

/** 按配置构建某个项目根下的 skill 根列表。 */
export function rootsForProject(config: ResolvedConfig, projectRoot: string | undefined): SkillRootSpec[] {
  return skillRoots({
    ...(projectRoot !== undefined ? { projectRoot } : {}),
    dshHome: config.dshHome,
    agentsHome: config.agentsHome,
    customSkillDirs: config.customSkillDirs,
    bundledSkillDir: config.bundledSkillDir,
    allowSharedRootWrites: config.allowSharedRootWrites,
  })
}

// ── 1. 项目级屏蔽：包装 ctx.skills ──────────────────────────────────────────

/** 防止 HMR/重复加载造成双重包装的实例标记。 */
const WRAP_TAG = Symbol.for('dsh-skill-switch.wrapped')

/** 只读原始注册表三个入口的代理（面板要未经过滤的目录事实）。 */
function rawRegistry(skills: SwitchSkillRegistry): SwitchSkillRegistry {
  return {
    snapshot: options => skills.snapshot.call(skills, options),
    list: options => skills.list.call(skills, options),
    get: (skillName, options) => skills.get.call(skills, skillName, options),
  }
}

/**
 * 应用项目级屏蔽：包装 ctx.skills 的 snapshot/list/get。
 * @param ctx - host 上下文。
 * @param config - 已解析配置。
 * @param logger - 日志出口。
 */
export function installSkillFilter(ctx: HostContext, config: ResolvedConfig, logger: SwitchLogger): void {
  const skills = ctx.skills as SwitchSkillRegistry & { [WRAP_TAG]?: boolean }
  if (skills[WRAP_TAG] === true) {
    logger.warn('skill-switch: ctx.skills already wrapped; skipping re-apply')
    return
  }
  const cache = new Map<string, { state: SwitchState; fingerprint: string; dirFingerprint: string; readAt: number }>()

  /**
   * 开关目录的 mtime 指纹：基目录、mode、off/、on/ 四个路径的修改时间。
   * 缓存命中要求指纹不变且 TTL 未过期——mtime 提供跨秒级文件系统的即时
   * 失效，TTL 兜底粗粒度 mtime（如 HFS+ 只有秒级）下的同秒变更窗口。
   */
  async function dirFingerprint(root: string): Promise<string> {
    const base = switchesPath(root, config.switchesDir)
    const stamps: number[] = []
    for (const path of [base, `${base}/mode`, `${base}/off`, `${base}/on`]) {
      try {
        stamps.push((await stat(path)).mtimeMs)
      } catch {
        stamps.push(-1)
      }
    }
    return stamps.join(',')
  }

  /**
   * 解析 cwd 对应项目的开关状态（mtime 指纹 + TTL 双条件缓存；
   * force 用于 get 拦截路径）。任何失败都降级为透传。
   */
  async function resolveState(cwd: unknown, force = false): Promise<SwitchState | undefined> {
    if (typeof cwd !== 'string' || cwd.length === 0) return undefined
    let root: string
    try {
      root = await findProjectRoot(cwd)
    } catch (error) {
      logger.warn(`skill-switch: project-root resolution failed for ${cwd}: ${String(error)}`)
      return undefined
    }
    const now = Date.now()
    const hit = cache.get(root)
    if (!force && hit !== undefined) {
      const stamps = await dirFingerprint(root)
      if (stamps === hit.dirFingerprint && now - hit.readAt < config.cacheTtlMs) return hit.state
    }
    let state: SwitchState
    try {
      state = await readSwitchState(root, config.switchesDir, config.defaultMode)
    } catch (error) {
      logger.warn(`skill-switch: reading switches under ${root} failed: ${String(error)}`)
      return undefined
    }
    const fingerprint = stateFingerprint(state)
    if (hit === undefined || hit.fingerprint !== fingerprint) {
      if (state.present) {
        logger.info(
          `skill-switch: project ${root} -> mode=${state.mode} off=[${[...state.off].sort().join(', ')}] on=[${[...state.on].sort().join(', ')}]`
          + (state.ignored.length > 0 ? ` (ignored: ${state.ignored.join(', ')})` : ''),
        )
      } else if (hit !== undefined) {
        logger.info(`skill-switch: project ${root} -> switches removed; catalog restored`)
      }
    }
    cache.set(root, { state, fingerprint, dirFingerprint: await dirFingerprint(root), readAt: now })
    return state
  }

  const originalSnapshot = skills.snapshot
  const originalGet = skills.get

  /** 包装 snapshot：过滤摘要数组，其余字段（complete 等）原样保留。 */
  const wrappedSnapshot = async (options: { cwd?: string } = {}) => {
    const result = await originalSnapshot.call(skills, options)
    const state = await resolveState(options?.cwd)
    if (state === undefined || state.present !== true) return result
    return { ...result, skills: filterSkills(state, result.skills) }
  }

  /**
   * 包装 list：与 SkillRegistry.list 同语义（snapshot 的 skills 字段），
   * 直接委托包装后的 snapshot，避免双重过滤逻辑漂移。
   */
  const wrappedList = async (options: { cwd?: string } = {}) => {
    return (await wrappedSnapshot(options)).skills
  }

  /** 包装 get：被隐藏的 skill 直接返回 undefined，不进入加载路径。 */
  const wrappedGet = async (skillName: string, options: { cwd?: string } = {}) => {
    const state = await resolveState(options?.cwd, config.forceRefreshOnGet)
    if (state !== undefined && isHidden(state, skillName)) {
      logger.info(`skill-switch: blocked load of "${skillName}" (project mode=${state.mode})`)
      return undefined
    }
    return originalGet.call(skills, skillName, options)
  }

  skills.snapshot = wrappedSnapshot as SwitchSkillRegistry['snapshot']
  skills.list = wrappedList as SwitchSkillRegistry['list']
  skills.get = wrappedGet as SwitchSkillRegistry['get']
  skills[WRAP_TAG] = true

  /** 插件卸载时摘除包装，恢复原型方法。 */
  ctx.effect(() => {
    delete skills[WRAP_TAG]
    if (skills.snapshot === wrappedSnapshot) delete (skills as Partial<SwitchSkillRegistry>).snapshot
    if (skills.list === wrappedList) delete (skills as Partial<SwitchSkillRegistry>).list
    if (skills.get === wrappedGet) delete (skills as Partial<SwitchSkillRegistry>).get
    cache.clear()
    logger.info('skill-switch: unwrapped ctx.skills; original service restored')
  }, 'dsh-skill-switch: ctx.skills filter')
}

// ── 2. 面板 API ────────────────────────────────────────────────────────────

/** 面板一次加载的完整视图（所有变更方法都返回它，避免二次请求与竞态）。 */
export interface PanelView {
  /** 请求解析出的会话工作目录。 */
  cwd: string
  /** 该 cwd 的项目根。 */
  projectRoot: string
  /** 开关目录的绝对路径。 */
  switchesPath: string
  /** 当前生效的开关模式。 */
  mode: SwitchMode
  /** 开关目录是否已存在。 */
  switchesPresent: boolean
  /** deny 模式下被隐藏的名字（原样回传，便于诊断）。 */
  off: string[]
  /** allow 模式下被放行的名字（原样回传，便于诊断）。 */
  on: string[]
  /** 开关目录里被忽略的条目。 */
  ignored: string[]
  /** 扫描覆盖的 skill 根。 */
  roots: Array<{ path: string; source: string; rank: number; live: boolean; deletable: boolean; exists: boolean }>
  /** 合并后的 skill 行。 */
  skills: SkillView[]
  /** runtime 目录观察是否完整。 */
  catalogComplete: boolean
  /** 本次变更动作的报告（只读调用时为 null）。 */
  lastAction: ActionReport | null
}

/** 一次变更动作的报告。 */
export interface ActionReport {
  kind: 'toggle' | 'reset' | 'delete' | 'repair'
  name?: string
  /** 写/删掉的开关文件路径。 */
  touched?: string[]
  /** 删除结果。 */
  removed?: string[]
  skipped?: Array<{ path: string; source: string; reason: string; message?: string }>
  /** 修复过的 skill 文件路径。 */
  repaired?: string[]
  /** reset 是否顺带移除了 mode 文件（白名单模式下的必要动作）。 */
  modeReset?: boolean
}

/** 面板 API 的上下文。 */
interface ApiScope {
  ctx: HostContext
  /** 未经过滤的注册表（面板必须看到被屏蔽的 skill）。 */
  raw: SwitchSkillRegistry
  config: ResolvedConfig
  logger: SwitchLogger
}

/** 解析会话的权威 cwd（绝不抛错）。 */
export function sessionCwdOf(ctx: HostContext, sessionId: string, clientCwd?: string): string {
  const session = ctx.sessions.get(sessionId)
  const headerCwd = session?.header.cwd
  if (headerCwd !== undefined && headerCwd !== '') return headerCwd
  if (clientCwd !== undefined && clientCwd !== '' && isAbsolute(clientCwd)) return clientCwd
  return process.cwd()
}

/** 请求作用域：cwd + 项目根 + 当前开关状态。 */
interface ProjectScope {
  cwd: string
  projectRoot: string
  state: SwitchState
}

/** 从 payload 解析请求作用域（sessionId 必填）。 */
async function projectScopeOf(scope: ApiScope, payload: unknown): Promise<ProjectScope> {
  const sessionId = requireString(payload, 'sessionId')
  const clientCwd = optionalString(payload, 'cwd')
  const cwd = sessionCwdOf(scope.ctx, sessionId, clientCwd)
  const projectRoot = await findProjectRoot(cwd)
  const state = await readSwitchState(projectRoot, scope.config.switchesDir, scope.config.defaultMode)
  return { cwd, projectRoot, state }
}

/** 组装一次面板视图。 */
async function buildPanelView(
  scope: ApiScope,
  payload: unknown,
  lastAction: ActionReport | null = null,
): Promise<PanelView> {
  const { cwd, projectRoot, state } = await projectScopeOf(scope, payload)
  const roots = rootsForProject(scope.config, projectRoot)
  const list = await listSkills({
    skills: scope.raw,
    cwd,
    roots,
    state,
    pathExists,
  })
  return {
    cwd,
    projectRoot,
    switchesPath: switchesPath(projectRoot, scope.config.switchesDir),
    mode: state.mode,
    switchesPresent: state.present,
    off: [...state.off].sort(),
    on: [...state.on].sort(),
    ignored: state.ignored,
    roots: list.roots,
    skills: list.skills,
    catalogComplete: list.catalogComplete,
    lastAction,
  }
}

/** 取出面板里某个名字的行（不存在则 not-found）。 */
async function findSkillRow(scope: ApiScope, payload: unknown, skillName: string): Promise<SkillView> {
  const { cwd, projectRoot, state } = await projectScopeOf(scope, payload)
  const list = await listSkills({
    skills: scope.raw,
    cwd,
    roots: rootsForProject(scope.config, projectRoot),
    state,
    pathExists,
  })
  const row = list.skills.find(candidate => candidate.name === skillName)
  if (row === undefined) {
    throw new SwitchError('not-found', `skill "${skillName}" 不在本插件的扫描范围内`, 404)
  }
  return row
}

/** 一个 API 方法。 */
type ApiMethod = (payload: unknown) => Promise<unknown>

/** 完整的 /skill-switch API 表面。 */
export function api(scope: ApiScope): Record<string, ApiMethod> {
  return {
    /** 面板初始加载：作用域 + 根 + skill 表。 */
    async 'panel.load'(payload: unknown): Promise<PanelView> {
      return await buildPanelView(scope, payload)
    },

    /** 一键开/关某个 skill 在本项目的可见性。 */
    async 'switches.set'(payload: unknown): Promise<PanelView> {
      const skillName = requireString(payload, 'name')
      const blocked = requireBoolean(payload, 'blocked')
      if (!isSkillName(skillName)) {
        throw new SwitchError('bad-request', `"${skillName}" 不是合法的 kebab-case skill 名，无法写开关`)
      }
      const { projectRoot, state } = await projectScopeOf(scope, payload)
      const touched = await writeSwitch(projectRoot, scope.config.switchesDir, skillName, blocked, state.mode)
      scope.logger.info(`skill-switch: project ${projectRoot} ${blocked ? 'blocked' : 'unblocked'} "${skillName}"`)
      return await buildPanelView(scope, payload, { kind: 'toggle', name: skillName, touched })
    },

    /**
     * 清空本项目全部开关（一键恢复默认可见性）。
     *
     * 白名单模式（`mode: allow`）下必须连 mode 文件一起删：清空 `on/` 会让
     * 白名单变成空集，等于把整个 skill 目录清空——与"恢复默认可见性"相反。
     */
    async 'switches.reset'(payload: unknown): Promise<PanelView> {
      const { projectRoot, state } = await projectScopeOf(scope, payload)
      const modeReset = state.mode === 'allow'
      const removed = await clearSwitches(projectRoot, scope.config.switchesDir, { includeMode: modeReset })
      scope.logger.info(
        `skill-switch: project ${projectRoot} switches cleared (${removed.length} entries${modeReset ? ', mode file removed' : ''})`,
      )
      return await buildPanelView(scope, payload, { kind: 'reset', touched: removed, modeReset })
    },

    /**
     * 全局删除：把该 skill 在每一处已知根里的副本都删掉。
     * 路径全部由服务端扫描推导，客户端只能传名字。
     */
    async 'skills.delete'(payload: unknown): Promise<PanelView> {
      const skillName = requireString(payload, 'name')
      const row = await findSkillRow(scope, payload, skillName)
      if (row.copies.length === 0) {
        throw new SwitchError(
          'protected',
          `"${skillName}" 不是磁盘上的 skill（由运行时或其他 provider 提供），无法删除`,
          403,
        )
      }
      const targets: DeleteTarget[] = row.copies.map(copy => ({
        path: copy.path,
        directory: copy.directory,
        form: copy.form,
        rootPath: copy.rootPath,
        source: copy.source,
        deletable: copy.deletable,
      }))
      const outcome: DeleteOutcome = await deleteSkillCopies(targets)
      // 顺手清掉本项目的开关文件：删掉再装回来时不该带着旧屏蔽。
      const { projectRoot, state } = await projectScopeOf(scope, payload)
      if (isSkillName(skillName)) {
        await writeSwitch(projectRoot, scope.config.switchesDir, skillName, false, state.mode).catch(() => [])
      }
      scope.logger.info(`skill-switch: deleted "${skillName}" from ${outcome.removed.length} location(s)`)
      return await buildPanelView(scope, payload, {
        kind: 'delete',
        name: skillName,
        removed: outcome.removed,
        skipped: outcome.skipped,
      })
    },

    /**
     * 补齐 frontmatter：让缺 name/description 的 skill 重新被 runtime 加载。
     * 只写入可删根里的副本（内置根属于宿主应用，不碰）。
     */
    async 'skills.repair'(payload: unknown): Promise<PanelView> {
      const skillName = requireString(payload, 'name')
      const row = await findSkillRow(scope, payload, skillName)
      if (row.issues.length === 0) {
        throw new SwitchError('bad-request', `"${skillName}" 的 frontmatter 已经完整，无需补齐`)
      }
      const description = row.descriptionSource === 'none' ? '' : row.description
      if (description.trim() === '') {
        throw new SwitchError(
          'bad-request',
          `无法为 "${skillName}" 自动生成描述（frontmatter 与正文都没有可用文字），请手动补充`,
        )
      }
      const repaired: string[] = []
      const failures: string[] = []
      for (const copy of row.copies) {
        if (!copy.deletable) {
          failures.push(`${copy.path}（受保护根，跳过）`)
          continue
        }
        const target = repairableName(copy.declaredName, copy.entryName, row.name)
        if (target === undefined) {
          failures.push(`${copy.path}（目录名/文件名不是合法 kebab-case，无法自动命名）`)
          continue
        }
        try {
          const raw = await readSkillRaw(copy.path)
          const next = repairFrontmatter(raw, { name: target, description })
          await writeFileAtomic(copy.path, next, { mode: 0o644 })
          repaired.push(copy.path)
        } catch (error) {
          failures.push(`${copy.path}（${error instanceof Error ? error.message : String(error)}）`)
        }
      }
      if (repaired.length === 0) {
        throw new SwitchError('fs-error', `没有任何副本被修复：${failures.join('；')}`)
      }
      scope.logger.info(`skill-switch: repaired frontmatter of "${skillName}" in ${repaired.length} location(s)`)
      return await buildPanelView(scope, payload, { kind: 'repair', name: skillName, repaired, skipped: [] })
    },
  }
}

/** 修复时选用的名字：有效声明名 > 合法条目名 > 当前展示名。 */
function repairableName(declared: string | undefined, entryName: string, current: string): string | undefined {
  if (declared !== undefined && isSkillName(declared)) return declared
  if (isSkillName(entryName)) return entryName
  if (isSkillName(current)) return current
  return undefined
}

/** 读 connection 行的 trustedHosts（与 /api 网关同一份名单）。 */
function trustedHostsOf(ctx: HostContext): string[] {
  try {
    for (const entry of ctx.loader.entries()) {
      if (entry.options.name === 'connection') {
        const config = entry.options.config as { trustedHosts?: string[] } | undefined
        return config?.trustedHosts ?? []
      }
    }
  } catch {
    /* loader 不可读：退化为"只信任 loopback" */
  }
  return []
}

/** 把一个 HTTP 请求分派到一个 API 方法。 */
function makeHandler(scope: ApiScope): SwitchWebRoute['handler'] {
  const methods = api(scope)
  return async (req, res) => {
    if (!isTrustedApiRequest(req, trustedHostsOf(scope.ctx))) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
    const match = /^\/skill-switch\/api\/([A-Za-z0-9.]+)$/.exec(pathname)
    const method = match?.[1]
    if (method === undefined) {
      writeError(res, new SwitchError('not-found', 'unknown skill-switch API path', 404))
      return
    }
    const handler = methods[method]
    if (handler === undefined) {
      writeError(res, new SwitchError('not-found', `unknown skill-switch API method "${method}"`, 404))
      return
    }
    try {
      const payload = await readJsonBody(req)
      writeOk(res, await handler(payload))
    } catch (error) {
      writeError(res, error)
    }
  }
}

/**
 * 插件主体：装过滤器，并在 Web 服务就绪后挂上面板路由。
 * @param ctx - host 上下文。
 * @param config - 宿主配置（由 Loader 校验）。
 */
export function apply(ctx: HostContext, config: Partial<PluginConfig> = {}): void {
  const resolved = resolveConfig(config)
  const logger: SwitchLogger = ctx.logger ?? console
  const raw = rawRegistry(ctx.skills)
  installSkillFilter(ctx, resolved, logger)

  // webServer / sessions / loader 不是硬依赖：用 ctx.inject 等它们齐了再挂路由，
  // 这样无 Web 的部署（CLI / headless）里屏蔽逻辑照常生效。
  ctx.inject(['webServer', 'sessions', 'loader'], (scope: HostContext) => {
    const apiScope: ApiScope = { ctx: scope, raw, config: resolved, logger }
    scope.effect(
      () => scope.webServer.register({ kind: 'prefix', path: '/skill-switch', handler: makeHandler(apiScope) }),
      'dsh-skill-switch: /skill-switch API routes',
    )
  })
}

/** 路径存在性探测（根的 exists 标记用）。 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export { isTrustedApiRequest, isLoopbackHostname } from './trust-fence.ts'
export { SwitchError } from './wire.ts'
export type { SwitchErrorCode } from './wire.ts'
export {
  ABSENT_STATE,
  clearSwitches,
  collectionFor,
  filterSkills,
  findProjectRoot,
  isHidden,
  isSkillName,
  normalizeSwitchName,
  parseMode,
  readNameSet,
  readSwitchState,
  stateFingerprint,
  switchesPath,
  writeSwitch,
} from './switches.ts'
export type { SwitchMode, SwitchState } from './switches.ts'
export {
  defaultAgentsHome,
  firstMeaningfulLine,
  parseFrontmatter,
  repairFrontmatter,
  scanSkillRoot,
  scanSkillRoots,
  skillRoots,
} from './skill-scan.ts'
export { documentParts, frontmatterKind } from './skill-scan.ts'
export type { ScannedSkill, SkillForm, SkillIssue, SkillRootSource, SkillRootSpec } from './skill-scan.ts'
export { deleteSkillCopies } from './skill-delete.ts'
export type { DeleteOutcome, DeleteTarget } from './skill-delete.ts'
export { listSkills } from './skill-view.ts'
export type { SkillCopyView, SkillListView, SkillView } from './skill-view.ts'
