/**
 * 卡片渲染测试：把 SkillCard 单独做服务端渲染，覆盖列表里每条会分支的路径
 * ——状态徽标、诊断行、一键开关键的可用性、以及两个二次确认菜单的内容。
 *
 * 服务端渲染意味着 effect（以及随后的 API 调用）不会执行，断言只针对渲染结果；
 * 这也让它能顺带守住"组件里不写死中文/不崩在空字段上"。
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillCard } from '../src/client/SkillSwitchPanel.tsx'
import type { SkillCardMenu } from '../src/client/SkillSwitchPanel.tsx'
import type { SkillCopy, SkillRow } from '../src/client/api.ts'
import { attachLocale } from '../src/client/locales.ts'

afterEach(() => { attachLocale(undefined) })

/** 一份磁盘副本夹具。 */
function copy(overrides: Partial<SkillCopy> = {}): SkillCopy {
  return {
    path: '/proj/.dsh/skills/demo/SKILL.md',
    directory: '/proj/.dsh/skills/demo',
    form: 'bundle',
    entryName: 'demo',
    rootPath: '/proj/.dsh/skills',
    source: 'project-dsh',
    rank: 100,
    live: true,
    deletable: true,
    issues: [],
    ...overrides,
  }
}

/** 一行 skill 夹具。 */
function row(overrides: Partial<SkillRow> = {}): SkillRow {
  return {
    name: 'demo',
    description: '示例描述',
    descriptionSource: 'frontmatter',
    nameSource: 'frontmatter',
    source: 'project-dsh',
    rank: 100,
    live: true,
    blockable: true,
    blocked: false,
    inCatalog: true,
    issues: [],
    deletable: true,
    path: '/proj/.dsh/skills/demo/SKILL.md',
    form: 'bundle',
    copies: [copy()],
    ...overrides,
  }
}

/** 渲染一张卡片。 */
function renderCard(overrides: Partial<SkillRow> = {}, menu: SkillCardMenu = null, busy = false): string {
  attachLocale({ getSnapshot: () => ({ active: 'zh' }) })
  return renderToStaticMarkup(createElement(SkillCard, {
    row: row(overrides),
    busy,
    menu,
    onToggle: vi.fn(),
    onOpenMenu: vi.fn(),
    onAskDelete: vi.fn(),
    onAskRepair: vi.fn(),
    onConfirmDelete: vi.fn(),
    onConfirmRepair: vi.fn(),
    onCloseMenu: vi.fn(),
  }))
}

describe('SkillCard：事实区', () => {
  it('正常项：名字、来源徽标、描述、开关文案是「屏蔽」', () => {
    const markup = renderCard()
    expect(markup).toContain('demo')
    expect(markup).toContain('项目 .dsh')
    expect(markup).toContain('示例描述')
    expect(markup).toContain('屏蔽')
    expect(markup).not.toContain('已屏蔽')
    expect(markup).not.toContain('未生效')
  })

  it('已屏蔽项：打上「已屏蔽」徽标，开关文案变成「启用」', () => {
    const markup = renderCard({ blocked: true })
    expect(markup).toContain('已屏蔽')
    expect(markup).toContain('启用')
  })

  it('未生效项：打上「未生效」徽标并写出具体原因', () => {
    const markup = renderCard({
      inCatalog: false,
      issues: ['missing-frontmatter'],
      descriptionSource: 'body',
      nameSource: 'entry',
    })
    expect(markup).toContain('未生效')
    expect(markup).toContain('缺少 YAML frontmatter')
    expect(markup).toContain('描述取自正文首段')
    expect(markup).toContain('名字取自目录名')
  })

  it('名字不合法：禁用一键开关键并给出原因', () => {
    const markup = renderCard({ blockable: false, name: 'Bad_Name' })
    expect(markup).toContain('名字不合法，无法按名写开关')
    expect(markup).toContain('disabled')
  })

  it('多处副本：显示副本数量', () => {
    const markup = renderCard({
      copies: [copy(), copy({ source: 'user-dsh', rootPath: '/home/me/.dsh/skills', path: '/home/me/.dsh/skills/demo/SKILL.md', rank: 400 })],
    })
    expect(markup).toContain('2 处副本')
  })

  it('库里的副本（未分配）：显示「未分配」徽标', () => {
    const markup = renderCard({
      source: 'library',
      inCatalog: false,
      copies: [copy({ source: 'library', live: false, rootPath: '/home/me/.dsh/skill-library' })],
    })
    expect(markup).toContain('未分配')
    expect(markup).toContain('Skill 库')
  })

  it('内置项：显示只读徽标', () => {
    const markup = renderCard({
      source: 'bundled',
      copies: [copy({ source: 'bundled', deletable: false, rootPath: '/app/bundled' })],
    })
    expect(markup).toContain('只读')
  })

  it('虚拟项（runtime 注册、磁盘上没有）：显示运行时徽标', () => {
    const markup = renderCard({ form: 'virtual', source: 'runtime', copies: [], deletable: false })
    expect(markup).toContain('运行时')
  })

  it('描述为空时不崩，显示占位破折号', () => {
    const markup = renderCard({ description: '', descriptionSource: 'none' })
    expect(markup).toContain('—')
  })

  it('忙碌态：开关文案变成省略号', () => {
    expect(renderCard({}, null, true)).toContain('…')
  })
})

describe('SkillCard：操作菜单', () => {
  it('默认菜单：未生效项出现「补齐 frontmatter」与「删除（全局）」', () => {
    const markup = renderCard({ inCatalog: false, issues: ['missing-description'], descriptionSource: 'body' }, { name: 'demo', mode: 'actions' })
    expect(markup).toContain('补齐 frontmatter')
    expect(markup).toContain('删除（全局）')
  })

  it('默认菜单：frontmatter 完整时不给「补齐 frontmatter」', () => {
    const markup = renderCard({}, { name: 'demo', mode: 'actions' })
    expect(markup).not.toContain('补齐 frontmatter')
    expect(markup).toContain('删除（全局）')
  })

  it('默认菜单：虚拟项禁用删除并说明原因', () => {
    const markup = renderCard({ form: 'virtual', source: 'runtime', copies: [], deletable: false }, { name: 'demo', mode: 'actions' })
    expect(markup).toContain('由运行时提供，磁盘上没有可删除的副本')
    expect(markup).toContain('disabled')
  })

  it('删除确认：逐条列出将被删除的副本路径', () => {
    const markup = renderCard({
      copies: [
        copy(),
        copy({ form: 'flat', path: '/home/me/.dsh/skills/demo.md', directory: '/home/me/.dsh/skills', source: 'user-dsh', rootPath: '/home/me/.dsh/skills' }),
      ],
    }, { name: 'demo', mode: 'confirm-delete' })
    expect(markup).toContain('将在下列位置永久删除')
    expect(markup).toContain('/proj/.dsh/skills')       // bundle 列目录
    expect(markup).toContain('/home/me/.dsh/skills/demo.md') // flat 列文件
    expect(markup).toContain('删除（全局）')
    expect(markup).toContain('取消')
  })

  it('补齐确认：只列出可删副本', () => {
    const markup = renderCard({
      copies: [
        copy(),
        copy({ source: 'bundled', deletable: false, path: '/app/bundled/demo/SKILL.md', directory: '/app/bundled/demo' }),
      ],
    }, { name: 'demo', mode: 'confirm-repair' })
    expect(markup).toContain('/proj/.dsh/skills/demo/SKILL.md')
    expect(markup).not.toContain('/app/bundled/demo/SKILL.md')
  })
})

describe('SkillCard：英文 locale', () => {
  it('整卡切到英文文案', () => {
    attachLocale({ getSnapshot: () => ({ active: 'en' }) })
    const markup = renderToStaticMarkup(createElement(SkillCard, {
      row: row({ blocked: true, issues: ['missing-name'] }),
      busy: false,
      menu: { name: 'demo', mode: 'actions' },
      onToggle: vi.fn(),
      onOpenMenu: vi.fn(),
      onAskDelete: vi.fn(),
      onAskRepair: vi.fn(),
      onConfirmDelete: vi.fn(),
      onConfirmRepair: vi.fn(),
      onCloseMenu: vi.fn(),
    }))
    expect(markup).toContain('Blocked')
    expect(markup).toContain('Inactive')
    expect(markup).toContain('Actions')
    expect(markup).toContain('Delete (global)')
    expect(markup).not.toContain('已屏蔽')
  })
})
