/**
 * 标签主体的渲染测试：给定座位注入的会话，视图渲染出真正的面板骨架，并且
 * 作用域取自**座位**而不是会话 feed 的某个"当前会话"字段。
 *
 * 渲染刻意走服务端：视图的 effect（以及随之而来的全部 API 调用）不会执行，
 * 所以断言只覆盖作用域决策与渲染结果。
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClientContext } from '../src/context-types.ts'
import { SkillSwitchView } from '../src/client/SkillSwitchView.tsx'
import { createSkillSwitchStore } from '../src/client/state.ts'
import { attachLocale } from '../src/client/locales.ts'
import { sourceLabel, issueLabel } from '../src/client/SkillSwitchPanel.tsx'

afterEach(() => { attachLocale(undefined) })

/** 一个只带会话 feed 的 client 上下文。 */
function makeCtx(byId: Record<string, { id: string; cwd?: string }>): ClientContext {
  return {
    sessions: {
      list: {
        getSnapshot: () => ({ byId }),
        subscribe: () => () => {},
      },
    },
    locale: {
      getSnapshot: () => ({ active: 'zh' }),
      subscribe: () => () => {},
    },
  } as unknown as ClientContext
}

/** 渲染一个标签实例并返回其 HTML。 */
function render(sessionId: string, byId: Record<string, { id: string; cwd?: string }> = {}): string {
  attachLocale({ getSnapshot: () => ({ active: 'zh' }) })
  return renderToStaticMarkup(createElement(SkillSwitchView, {
    ctx: makeCtx(byId),
    store: createSkillSwitchStore(),
    sessionId,
  }))
}

describe('会话视图标签 body', () => {
  it('渲染面板骨架：三个筛选 chip + 搜索框，而不是"暂无会话"', () => {
    const markup = render('session-2', { 'session-2': { id: 'session-2', cwd: '/tmp/project' } })
    expect(markup).toContain('全部')
    expect(markup).toContain('已屏蔽')
    expect(markup).toContain('未生效')
    expect(markup).toContain('搜索名字或描述')
    expect(markup).toContain('恢复本项全部')
    expect(markup).not.toContain('暂无会话')
  })

  it('会话 feed 没有对应行时照常渲染（只是丢了 cwd 兜底）', () => {
    const markup = render('session-9', {})
    expect(markup).toContain('全部')
    expect(markup).not.toContain('暂无会话')
  })

  it('每个会话渲染独立实例（不共享作用域）', () => {
    expect(render('session-a', { 'session-a': { id: 'session-a', cwd: '/tmp/a' } })).toContain('全部')
    expect(render('session-b', { 'session-b': { id: 'session-b', cwd: '/tmp/b' } })).toContain('全部')
  })

  it('英文 locale 下渲染英文骨架', () => {
    attachLocale({ getSnapshot: () => ({ active: 'en' }) })
    const markup = renderToStaticMarkup(createElement(SkillSwitchView, {
      ctx: makeCtx({}),
      store: createSkillSwitchStore(),
      sessionId: 'session-en',
    }))
    expect(markup).toContain('Restore all')
    expect(markup).toContain('Blocked')
  })
})

describe('来源与原因的本地化映射', () => {
  it('已知来源 id 有中文标签，未知来源原样透出', () => {
    attachLocale({ getSnapshot: () => ({ active: 'zh' }) })
    expect(sourceLabel('project-dsh')).toBe('项目 .dsh')
    expect(sourceLabel('user-agents')).toBe('共享')
    expect(sourceLabel('library')).toBe('Skill 库')
    expect(sourceLabel('bundled')).toBe('内置')
    expect(sourceLabel('some-provider')).toBe('some-provider')
  })

  it('六种"未生效"原因都有可读文案', () => {
    attachLocale({ getSnapshot: () => ({ active: 'zh' }) })
    expect(issueLabel('missing-frontmatter')).toContain('frontmatter')
    expect(issueLabel('invalid-frontmatter')).toContain('解析失败')
    expect(issueLabel('missing-name')).toContain('name')
    expect(issueLabel('invalid-name')).toContain('kebab-case')
    expect(issueLabel('missing-description')).toContain('description')
    expect(issueLabel('invalid-entry-name')).toContain('kebab-case')
  })
})
