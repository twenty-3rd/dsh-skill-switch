/**
 * Skill 开关作为会话视图标签——与 对话（chat）/ 轨迹（trajectory）/
 * Skills 管理器（skills）占同一个座位：会话头部的标签条选中它，中间栏
 * 用它替换对话记录。
 *
 * 座位是会话作用域的：`inject` 工厂把本实例所属的 SessionId 交给组件，
 * 请求作用域从不依赖全局"当前会话"字段（DSH 0.2 已移除该字段）。
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { ClientContext } from '../context-types.ts'
import type { PanelStore } from './state.ts'
import type { PanelScope } from './api.ts'
import { SkillSwitchBody } from './SkillSwitchPanel.tsx'
import css from './SkillSwitchPanel.module.css'

/** 座位注入在框架 props 之外额外提供的字段。 */
export interface SkillSwitchViewProps {
  /** client 上下文（会话列表 feed + locale）。 */
  ctx: ClientContext
  /** 每次激活一份的面板 store。 */
  store: PanelStore
  /** 本视图实例所属的会话（来自座位注入）。 */
  sessionId: string
}

/**
 * 一个会话的 Skill 开关视图。
 * @param props - 注入的上下文、store 与所属会话。
 * @returns 铺满会话视图区域的面板主体。
 */
export function SkillSwitchView(props: SkillSwitchViewProps): ReactNode {
  const { ctx, store, sessionId } = props
  const [, force] = useState(0)

  // 会话摘要变化（host 会话尚未 hydrate 时 API 回退用的 cwd）或 locale 变化时
  // 重渲染；面板主体自己订阅 store，所以这里只带两个外部事实。
  useEffect(() => {
    const offSessions = ctx.sessions.list.subscribe(() => force(v => v + 1))
    const offLocale = ctx.locale.subscribe(() => force(v => v + 1))
    return () => {
      offSessions()
      offLocale()
    }
  }, [ctx])

  const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
  const scope: PanelScope = cwd !== undefined && cwd !== '' ? { sessionId, cwd } : { sessionId }
  return (
    <div className={css.viewRoot}>
      <div className={css.viewInner}>
        <SkillSwitchBody store={store} scope={scope} />
      </div>
    </div>
  )
}
