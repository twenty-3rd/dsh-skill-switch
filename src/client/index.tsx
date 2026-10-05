/**
 * dsh-skill-switch 的 client 半体：一个入口——会话视图标签。
 *
 * 本插件往会话的视图标签条里加一个标签（对话 = ui-chat 的 `chat`，
 * 轨迹 = ui-trajectory 的 `trajectory`，Skills 管理器 = 20），注册进
 * ui-conversation 的 `conversation.view` 列表座位；选中它就在中间栏渲染
 * 开关面板，和内置标签完全一样。
 *
 * 座位是**会话作用域**的：注册的 `inject` 工厂会收到该标签所属的 SessionId，
 * 面板的请求作用域就骑在它上面，因此从不读全局"当前会话"字段。
 *
 * 注册通过 `ctx.slots.inject` 等待 ui-conversation 的声明，激活顺序无关；
 * fiber 卸载时标签一并移除，不留悬挂条目。
 *
 * 所有文案走 DSH locale 系统；store 每次激活一份（切换标签保留浏览状态）。
 */
import type { ClientContext } from '../context-types.ts'
import { createSkillSwitchStore } from './state.ts'
import { SkillSwitchView } from './SkillSwitchView.tsx'
import { LOCALE_NS, attachLocale, en, t, zh } from './locales.ts'

/** 客户端挂载前需要的服务（由 client runtime 提供）。 */
export const inject = ['slots', 'locale', 'sessions']

/** 视图标签 id：与本会话其它视图（chat / trajectory / skills）不冲突。 */
export const SKILL_SWITCH_VIEW_ID = 'skill-switch'

/** 标签条内的顺序：chat 0、trajectory 10、skills 20、skill-switch 30。 */
export const SKILL_SWITCH_VIEW_ORDER = 30

/**
 * client 插件主体。
 * @param ctx - client cordis 上下文（slots / locale / sessions）。
 */
export function apply(ctx: ClientContext): void {
  attachLocale(ctx.locale)
  ctx.effect(() => {
    const offZh = ctx.locale.register(LOCALE_NS, 'zh', zh)
    const offEn = ctx.locale.register(LOCALE_NS, 'en', en)
    return () => {
      offZh()
      offEn()
      attachLocale(undefined)
    }
  }, 'dsh-skill-switch: dictionaries')

  const store = createSkillSwitchStore()

  // 视图标签。`conversation.view` 由 ui-conversation 声明；inject 会等它出现，
  // 并随本 fiber 卸载。标签文案走本插件自己的 locale-aware `t()`，标签函数
  // 每次切换语言都会被重新读取，所以用函数形式。
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    {
      name: 'conversation.view',
      id: SKILL_SWITCH_VIEW_ID,
      order: SKILL_SWITCH_VIEW_ORDER,
      label: () => t('panelTitle'),
      // 会话作用域座位：工厂的第一个参数是当前实例渲染的 SessionId。
      inject: (sessionId: string) => ({ ctx, store, sessionId }),
    },
    SkillSwitchView,
  ))
}
