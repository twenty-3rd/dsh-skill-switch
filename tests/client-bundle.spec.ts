/**
 * 构建产物级测试：把真正要装进 DSH 的 `lib/client.js` 当作浏览器来执行。
 *
 * 源码级测试证明不了"产物能被 Web 模块表加载"——那是 tsdown 配置的职责：
 * banner/footer 的 CJS 闭包形状、external 名单、CSS 内联。这个用例按 DSH 的
 * 加载契约搭一个假 `window.__ModuleLoader__`，执行产物、取出 factory、用只认
 * `react` / `react/jsx-runtime` 的 require 调用它，再把导出的 apply 挂到假
 * cordis 上下文上，断言「Skill 开关」标签确实注册了、并且组件能被渲染。
 *
 * 同时也守住"产物与源码同步"：src 比 lib 新就直接失败，提示先 `pnpm build`。
 */
import * as React from 'react'
import { createElement } from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const hostBundlePath = join(packageRoot, 'lib', 'index.js')
const clientBundlePath = join(packageRoot, 'lib', 'client.js')
const PLUGIN_ID = 'dsh-skill-switch'

/** 每次执行产物用一个新的模块 id，绕开 ESM 缓存。 */
let loadCount = 0

/** 递归收集 src 下所有文件的 mtime 最大值。 */
async function newestSourceMtime(dir: string): Promise<number> {
  let newest = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) newest = Math.max(newest, await newestSourceMtime(path))
    else newest = Math.max(newest, (await stat(path)).mtimeMs)
  }
  return newest
}

/** 产物只执行一次（模块表按 id 注册，重复执行是幂等的但没必要）。 */
let factoryPromise: Promise<(require: (id: string) => unknown) => Record<string, unknown>> | undefined

/** 记忆化的加载入口：让多个用例共用同一次产物执行。 */
function getBundleFactory(): Promise<(require: (id: string) => unknown) => Record<string, unknown>> {
  factoryPromise ??= loadBundleFactory()
  return factoryPromise
}

/**
 * 按 DSH 的契约执行产物，返回它注册进模块表的 factory。
 * @returns 产物的 CJS 闭包工厂。
 */
async function loadBundleFactory(): Promise<(require: (id: string) => unknown) => Record<string, unknown>> {
  const registered = new Map<string, (require: (id: string) => unknown) => Record<string, unknown>>()
  const globalWindow = globalThis as unknown as {
    window?: { __ModuleLoader__?: { load(row: { id: string; factory: never }): void } }
  }
  const savedWindow = globalWindow.window
  globalWindow.window = {
    __ModuleLoader__: {
      load(row: { id: string; factory: never }) {
        registered.set(row.id, row.factory)
      },
    },
  }
  try {
    // 动态 import 让 banner 在 window 就位之后执行；产物顶层只有一次 load() 调用。
    // 查询串绕开 ESM 模块缓存（每次调用都是新的 id）。
    await import(`${clientBundlePath}?load=${loadCount++}`)
  } finally {
    if (savedWindow === undefined) delete globalWindow.window
    else globalWindow.window = savedWindow
  }
  const factory = registered.get(PLUGIN_ID)
  if (factory === undefined) {
    throw new Error(`bundle did not register "${PLUGIN_ID}" (saw: ${[...registered.keys()].join(', ') || 'nothing'})`)
  }
  return factory
}

/** 只允许平台模块的 require：任何其它 specifier 都说明产物漏了 external。 */
function platformRequire(id: string): unknown {
  if (id === 'react') return React
  if (id === 'react/jsx-runtime') return jsxRuntime
  if (id === 'react-dom') return ReactDom
  if (id === 'react-dom/client') return { createRoot: () => ({ render: () => {}, unmount: () => {} }) }
  throw new Error(`client bundle required a non-platform module: "${id}"`)
}

describe('lib/client.js 作为真实产物', () => {
  it('两个半体的产物都比 src 新（改了源码必须先 pnpm build）', async () => {
    const newestSource = await newestSourceMtime(join(packageRoot, 'src'))
    for (const [label, path] of [['lib/index.js', hostBundlePath], ['lib/client.js', clientBundlePath]] as const) {
      const bundle = await stat(path)
      expect(bundle.mtimeMs, `${label} 比 src 旧：请先运行 \`pnpm build\` 再跑测试`).toBeGreaterThanOrEqual(newestSource)
    }
  })

  it('按 window.__ModuleLoader__ 契约注册，factory 只用平台模块', async () => {
    const factory = await getBundleFactory()
    const exported = factory(platformRequire)
    expect(typeof exported.apply).toBe('function')
    expect(exported.inject).toEqual(['slots', 'locale', 'sessions'])
    expect(exported.SKILL_SWITCH_VIEW_ID).toBe('skill-switch')
    expect(exported.SKILL_SWITCH_VIEW_ORDER).toBe(30)
  })

  it('把 apply 挂到假 cordis 上下文上，标签注册出来并可渲染', async () => {
    const factory = await getBundleFactory()
    const exported = factory(platformRequire) as {
      inject: string[]
      apply(ctx: unknown): void
    }

    const registers: Array<Record<string, unknown>> = []
    const components: unknown[] = []
    const localeRegisters: string[] = []
    const ctx = {
      slots: {
        register(options: Record<string, unknown>, component: unknown) {
          registers.push(options)
          components.push(component)
          return () => {}
        },
        inject(_key: string, callback: () => () => void) {
          const dispose = callback()
          return () => { dispose?.() }
        },
      },
      locale: {
        getSnapshot: () => ({ active: 'zh' }),
        subscribe: () => () => {},
        register: (_ns: string, language: string) => {
          localeRegisters.push(language)
          return () => {}
        },
      },
      sessions: { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
      effect(fn: () => void | (() => void)) {
        const off = fn()
        void off
      },
    }
    exported.apply(ctx)

    expect(registers).toHaveLength(1)
    expect(registers[0]?.name).toBe('conversation.view')
    expect(registers[0]?.id).toBe('skill-switch')
    expect(localeRegisters.sort()).toEqual(['en', 'zh'])

    // 座位工厂交出 SessionId + store，组件能真的渲染出面板骨架。
    const injected = (registers[0]?.inject as (sessionId: string) => Record<string, unknown>)('session-bundle')
    expect(injected.sessionId).toBe('session-bundle')
    expect(injected.store).toBeDefined()

    // 用产物自己的组件（+ 同一个平台 React 实例）渲染一次。
    const View = components[0] as (props: unknown) => unknown
    const markup = renderToStaticMarkup(createElement(View as never, injected as never))
    expect(markup).toContain('全部')
    expect(markup).toContain('已屏蔽')
    expect(markup).not.toContain('未生效')
    expect(markup).toContain('恢复本项全部')
  })

  it('产物里的 CSS 被内联为一段 style 注入逻辑（不依赖外部 .css 文件）', async () => {
    const code = await readFile(clientBundlePath, 'utf8')
    expect(code).toContain('data-plugin-css')
    expect(code).toContain('dsh-skill-switch/SkillSwitchPanel.module.css')
    // 产物顶层不出现 require(...)（CJS 包裹形状只在 factory 参数里）。
    expect(code).not.toMatch(/^require\(/m)
  })

  it('未注册任何非平台模块（external 名单正确）', async () => {
    const code = await readFile(clientBundlePath, 'utf8')
    const requires = [...code.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1])
    expect([...new Set(requires)].sort()).toEqual(['react', 'react/jsx-runtime'])
  })
})
