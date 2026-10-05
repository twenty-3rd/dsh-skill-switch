/**
 * client 接线测试：启动真正的 cordis Context，提供桩的 locale / slots /
 * sessions，挂上 client 半体，验证会话视图座位的接线：
 *
 * 1. 注册进 ui-conversation 的 `conversation.view` 列表座位，用自己独有的 id，
 *    排在 对话（chat, 0）/ 轨迹（trajectory, 10）/ Skills 管理器（skills, 20）之后；
 * 2. 注册项带会话作用域的 `inject` 工厂，交出本实例所属的 SessionId；
 * 3. 只注册这一个面（没有侧边栏、没有独立主页面、没有旧式浮层）；
 * 4. fiber 卸载时释放 locale 字典。
 *
 * 这里不做 React 渲染：被测的是"挂了哪些面、用什么选项"，渲染结果由
 * client-view.spec.ts 覆盖。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject, SKILL_SWITCH_VIEW_ID, SKILL_SWITCH_VIEW_ORDER } from '../src/client/index.tsx'

/** 让 cordis fiber 落定（inject 回调、通知刷新）。 */
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

interface Hooks {
  injectedKeys: string[]
  registers: Array<Record<string, unknown>>
  localeRegisters: number
  localeDisposals: number
  sidebarCalls: number
}

function makeSlotsStub(hooks: Hooks) {
  return {
    register(options: Record<string, unknown>): () => void {
      hooks.registers.push(options)
      return () => {}
    },
    inject(key: string, callback: () => () => void): () => void {
      if (!hooks.injectedKeys.includes(key)) hooks.injectedKeys.push(key)
      const dispose = callback()
      return () => { dispose?.() }
    },
  }
}

function makeLocaleStub(hooks: Hooks, active: { value: string }) {
  return {
    getSnapshot: () => ({ active: active.value }),
    subscribe: () => () => {},
    register: () => {
      hooks.localeRegisters += 1
      return () => { hooks.localeDisposals += 1 }
    },
  }
}

function makeHooks(): Hooks {
  return { injectedKeys: [], registers: [], localeRegisters: 0, localeDisposals: 0, sidebarCalls: 0 }
}

/** 在桩服务上挂起 client 半体。 */
async function mount(
  hooks: Hooks,
  active: { value: string },
  extra: Record<string, unknown> = {},
): Promise<{ pluginFiber: { dispose(): Promise<void> } }> {
  const app = new Context()
  app.provide('locale', makeLocaleStub(hooks, active))
  app.provide('sessions', { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } })
  app.provide('slots', makeSlotsStub(hooks))
  for (const [serviceName, value] of Object.entries(extra)) app.provide(serviceName, value)
  const pluginObject: unknown = { inject, apply }
  const pluginFiber = app.plugin(pluginObject as Parameters<typeof app.plugin>[0], {})
  await pluginFiber
  return { pluginFiber }
}

describe('client 接线（会话视图标签）', () => {
  it('只注册一个 conversation.view 标签，id / 顺序 / 文案都正确', async () => {
    const hooks = makeHooks()
    const { pluginFiber } = await mount(hooks, { value: 'zh' })

    expect(hooks.injectedKeys).toContain('conversation.view')
    expect(hooks.registers).toHaveLength(1)

    const tab = hooks.registers[0]
    expect(tab?.name).toBe('conversation.view')
    expect(tab?.id).toBe(SKILL_SWITCH_VIEW_ID)
    expect(tab?.id).not.toBe('chat')
    expect(tab?.id).not.toBe('trajectory')
    expect(tab?.id).not.toBe('skills')
    expect(tab?.order).toBe(SKILL_SWITCH_VIEW_ORDER)
    expect(tab?.order).toBeGreaterThan(20)
    expect(typeof tab?.label).toBe('function')
    expect((tab?.label as () => string)()).toBe('Skill 开关')

    await pluginFiber.dispose()
  })

  it('inject 工厂交出所属 SessionId（请求作用域骑在座位上）', async () => {
    const hooks = makeHooks()
    const { pluginFiber } = await mount(hooks, { value: 'zh' })
    const injected = (hooks.registers[0]?.inject as (sessionId: string) => Record<string, unknown>)('session-42')
    expect(injected.sessionId).toBe('session-42')
    expect(injected.ctx).toBeDefined()
    expect(injected.store).toBeDefined()
    await pluginFiber.dispose()
  })

  it('切换语言时标签文案跟着变，不重新注册', async () => {
    const hooks = makeHooks()
    const active = { value: 'zh' }
    const { pluginFiber } = await mount(hooks, active)
    expect((hooks.registers[0]?.label as () => string)()).toBe('Skill 开关')
    active.value = 'en'
    expect((hooks.registers[0]?.label as () => string)()).toBe('Skill Switches')
    expect(hooks.registers).toHaveLength(1)
    await pluginFiber.dispose()
  })

  it('不再注册任何其它面（侧边栏等旧通道一律忽略）', async () => {
    const hooks = makeHooks()
    const { pluginFiber } = await mount(hooks, { value: 'zh' }, {
      betterSidebar: {
        registerTab: () => {
          hooks.sidebarCalls += 1
          return () => {}
        },
      },
    })
    await tick()
    expect(hooks.sidebarCalls).toBe(0)
    expect(hooks.injectedKeys).toEqual(['conversation.view'])
    expect(hooks.registers.map(options => options.name)).toEqual(['conversation.view'])
    await pluginFiber.dispose()
  })

  it('注册 zh/en 字典并在 fiber 卸载时释放', async () => {
    const hooks = makeHooks()
    const { pluginFiber } = await mount(hooks, { value: 'zh' })
    expect(hooks.localeRegisters).toBe(2)
    expect(hooks.localeDisposals).toBe(0)
    await pluginFiber.dispose()
    expect(hooks.localeDisposals).toBe(2)
  })
})
