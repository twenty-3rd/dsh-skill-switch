/**
 * /skill-switch API 的类型化 fetch 封装。每次调用都是 POST
 * `/skill-switch/api/<method>`，带上 sessionId 与（已知时）会话 cwd；
 * 失败抛出带 wire code 的 {@link SkillSwitchApiError}。
 */

/** wire 层失败。 */
export class SkillSwitchApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SkillSwitchApiError'
  }
}

// wire 形状**只有一份定义**：host 侧的 View 类型。这里用 `import type` 复用，
// 编译期擦除、运行时不产生任何依赖（tsdown 的纯度闸门也只看值导入），
// 于是 host 改了字段而客户端忘记改这种事在 `tsc --noEmit` 就会直接报错。
import type { ActionReport, PanelView } from '../index.ts'
import type { SkillForm, SkillIssue } from '../skill-scan.ts'
import type { SkillCopyView, SkillVerdictError, SkillView } from '../skill-view.ts'

export type { ActionReport, SkillForm, SkillIssue, SkillVerdictError }

/** 一处磁盘副本（= host 的 SkillCopyView）。 */
export type SkillCopy = SkillCopyView

/** 面板里的一行（= host 的 SkillView）。 */
export type SkillRow = SkillView

/** 一个被扫描的 skill 根（= PanelView["roots"] 的元素）。 */
export type SkillRootRow = PanelView['roots'][number]

/** 面板一次加载的完整数据（= host 的 PanelView）。 */
export type PanelData = PanelView

/** 请求作用域：会话 id + （会话尚未 hydrate 时才有意义的）cwd。 */
export interface PanelScope {
  sessionId: string
  cwd?: string
}

/** 把作用域折进 JSON payload（cwd 只在已知时带上）。 */
function scopePayload(scope: PanelScope, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    sessionId: scope.sessionId,
    ...(scope.cwd !== undefined && scope.cwd !== '' ? { cwd: scope.cwd } : {}),
    ...extra,
  }
}

async function call<T>(method: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/skill-switch/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      ...(signal !== undefined ? { signal } : {}),
    })
  } catch (error) {
    throw new SkillSwitchApiError('network', error instanceof Error ? error.message : String(error))
  }
  const parsed: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } | null
    = await response.json().catch(() => null)
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new SkillSwitchApiError(
      parsed?.error?.code ?? 'http',
      parsed?.error?.message ?? `HTTP ${response.status}`,
    )
  }
  return parsed.value as T
}

/** 面板 API 表面（每个调用都带会话作用域）。 */
export const api = {
  /** 加载面板：作用域 + 根 + 合并后的 skill 表。 */
  load: (scope: PanelScope, signal?: AbortSignal) =>
    call<PanelData>('panel.load', scopePayload(scope, {}), signal),

  /** 一键开/关某个 skill 在本项目的可见性。 */
  setSwitch: (scope: PanelScope, name: string, blocked: boolean) =>
    call<PanelData>('switches.set', scopePayload(scope, { name, blocked })),

  /** 清空本项目全部开关。 */
  resetSwitches: (scope: PanelScope) =>
    call<PanelData>('switches.reset', scopePayload(scope, {})),

  /** 全局删除该 skill 的所有落盘副本。 */
  deleteSkill: (scope: PanelScope, name: string) =>
    call<PanelData>('skills.delete', scopePayload(scope, { name })),

  /** 补齐 frontmatter，让判定条件 A（在目录里）重新成立。 */
  repairSkill: (scope: PanelScope, name: string) =>
    call<PanelData>('skills.repair', scopePayload(scope, { name })),
}
