/**
 * 卡片与详情渲染测试：把 SkillCard / SkillDetail 单独做服务端渲染，覆盖列表里
 * 每条会分支的路径 —— 判定徽标（有效/错误）、错误原因、一键开关键的可用性、
 * 两个二次确认菜单、以及"点开详情 → 每一处盘上副本"。
 *
 * 服务端渲染意味着 effect（以及随后的 API 调用）不会执行，断言只针对渲染结果；
 * 这也让它能顺带守住"组件里不写死中文/不崩在空字段上"。
 *
 * 判定语义（见 src/skill-view.ts 的 SkillVerdictError）：有效 = A 在目录里 ∧
 * B 模型可调用 ∧ C 用户可调用；任一条不成立 = 错误，且必须写出是哪一条。
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillCard, SkillDetail, selectedRow } from '../src/client/SkillSwitchPanel.tsx'
import type { SkillCardMenu } from '../src/client/SkillSwitchPanel.tsx'
import type { PanelData, SkillCopy, SkillRow, SkillVerdictError } from '../src/client/api.ts'
import { createSkillSwitchStore } from '../src/client/state.ts'
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

/** 与 host 的 `verdictErrors()` 同构：夹具自己推 errors，夹具与产品语义不会漂移。 */
function errorsFor(
  inCatalog: boolean,
  invocation: { modelInvocable: boolean; userInvocable: boolean },
): SkillVerdictError[] {
  if (!inCatalog) return ['not-in-registry']
  const errors: SkillVerdictError[] = []
  if (!invocation.modelInvocable) errors.push('model-not-invocable')
  if (!invocation.userInvocable) errors.push('user-not-invocable')
  return errors
}

/** 一行 skill 夹具。 */
function row(overrides: Partial<SkillRow> = {}): SkillRow {
  const inCatalog = overrides.inCatalog ?? true
  const invocation = overrides.invocation ?? { modelInvocable: true, userInvocable: true }
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
    inCatalog,
    invocation,
    errors: overrides.errors ?? errorsFor(inCatalog, invocation),
    issues: [],
    deletable: true,
    path: '/proj/.dsh/skills/demo/SKILL.md',
    form: 'bundle',
    copies: [copy()],
    ...overrides,
  }
}

/** 渲染一张卡片（`showVerdict` 默认 true = 面板拿到了该会话的观察者作用域）。 */
function renderCard(
  overrides: Partial<SkillRow> = {},
  menu: SkillCardMenu = null,
  busy = false,
  showVerdict = true,
): string {
  attachLocale({ getSnapshot: () => ({ active: 'zh' }) })
  return renderToStaticMarkup(createElement(SkillCard, {
    row: row(overrides),
    showVerdict,
    busy,
    menu,
    onOpen: vi.fn(),
    onToggle: vi.fn(),
    onOpenMenu: vi.fn(),
    onAskDelete: vi.fn(),
    onAskRepair: vi.fn(),
    onConfirmDelete: vi.fn(),
    onConfirmRepair: vi.fn(),
    onCloseMenu: vi.fn(),
  }))
}

/** 渲染详情页。 */
function renderDetail(overrides: Partial<SkillRow> = {}, showVerdict = true): string {
  attachLocale({ getSnapshot: () => ({ active: 'zh' }) })
  return renderToStaticMarkup(createElement(SkillDetail, {
    row: row(overrides),
    showVerdict,
    onBack: vi.fn(),
  }))
}

/** 一份最小可用的面板数据（只填详情分支用得到的字段）。 */
function panel(skills: SkillRow[]): PanelData {
  return {
    cwd: '/proj',
    projectRoot: '/proj',
    switchesPath: '/proj/.dsh/skill-switches',
    mode: 'deny',
    switchesPresent: false,
    off: [],
    on: [],
    ignored: [],
    roots: [],
    skills,
    catalogComplete: true,
    catalogError: false,
    verdictAvailable: true,
    lastAction: null,
  }
}

/** 某段文字在 markup 里出现的次数（断言"只标一处"时用）。 */
function countOf(markup: string, text: string): number {
  return markup.split(text).length - 1
}

describe('SkillCard：事实区', () => {
  it('有效项：名字、来源徽标、描述、「有效」徽标，开关文案是「屏蔽」', () => {
    const markup = renderCard()
    expect(markup).toContain('demo')
    expect(markup).toContain('项目 .dsh')
    expect(markup).toContain('示例描述')
    expect(markup).toContain('有效')
    expect(markup).toContain('屏蔽')
    expect(markup).not.toContain('已屏蔽')
    expect(markup).not.toContain('错误')
  })

  it('已屏蔽项：打上「已屏蔽」徽标，开关文案变成「启用」，判定仍是「有效」', () => {
    const markup = renderCard({ blocked: true })
    expect(markup).toContain('已屏蔽')
    expect(markup).toContain('启用')
    // 屏蔽是"本项目不可见"，不是"skill 坏了"：判定不能因此变成错误。
    expect(markup).toContain('有效')
    expect(markup).not.toContain('错误')
  })

  it('错误项（不在注册表）：打上「错误」徽标，并写出 A 条不成立', () => {
    const markup = renderCard({ inCatalog: false })
    expect(markup).toContain('错误')
    expect(markup).toContain('不在 skill 注册表里')
    expect(markup).not.toContain('有效')
  })

  it('错误项（不在注册表 + frontmatter 缺字段）：判定原因与磁盘解释同时给出', () => {
    const markup = renderCard({
      inCatalog: false,
      issues: ['missing-frontmatter'],
      descriptionSource: 'body',
      nameSource: 'entry',
    })
    expect(markup).toContain('错误')
    expect(markup).toContain('不在 skill 注册表里')
    expect(markup).toContain('缺少 YAML frontmatter')
    expect(markup).toContain('描述取自正文首段')
    expect(markup).toContain('名字取自目录名')
  })

  it('错误项（模型不可调用）：写出 B 条不成立', () => {
    const markup = renderCard({ invocation: { modelInvocable: false, userInvocable: true } })
    expect(markup).toContain('错误')
    expect(markup).toContain('模型不能主动调用')
    expect(markup).not.toContain('不在 skill 注册表里')
  })

  it('错误项（用户不可调用）：写出 C 条不成立', () => {
    const markup = renderCard({ invocation: { modelInvocable: true, userInvocable: false } })
    expect(markup).toContain('错误')
    expect(markup).toContain('用户不能显式调用')
  })

  it('B/C 同时不成立：两条原因都列出来', () => {
    const markup = renderCard({ invocation: { modelInvocable: false, userInvocable: false } })
    expect(markup).toContain('模型不能主动调用')
    expect(markup).toContain('用户不能显式调用')
  })

  it('拿不到观察者作用域（showVerdict=false）：不显示判定，也不列判定原因', () => {
    const markup = renderCard({ inCatalog: false }, null, false, false)
    expect(markup).not.toContain('有效')
    expect(markup).not.toContain('错误')
    expect(markup).not.toContain('不在 skill 注册表里')
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

  it('库里的副本（未分配）：显示「未分配」徽标；不在注册表就是错误', () => {
    const markup = renderCard({
      source: 'library',
      inCatalog: false,
      copies: [copy({ source: 'library', live: false, rootPath: '/home/me/.dsh/skill-library' })],
    })
    expect(markup).toContain('未分配')
    expect(markup).toContain('Skill 库')
    expect(markup).toContain('不在 skill 注册表里')
  })

  it('内置项：显示只读徽标', () => {
    const markup = renderCard({
      source: 'bundled',
      copies: [copy({ source: 'bundled', deletable: false, rootPath: '/app/bundled' })],
    })
    expect(markup).toContain('只读')
  })

  it('虚拟项（runtime 注册、磁盘上没有）：显示运行时徽标，且有判定', () => {
    const markup = renderCard({ form: 'virtual', source: 'runtime', copies: [], deletable: false })
    expect(markup).toContain('运行时')
    expect(markup).toContain('有效')
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
  it('默认菜单：有问题项出现「补齐 frontmatter」与「删除（全部副本）」', () => {
    const markup = renderCard({ inCatalog: false, issues: ['missing-description'], descriptionSource: 'body' }, { name: 'demo', mode: 'actions' })
    expect(markup).toContain('补齐 frontmatter')
    expect(markup).toContain('删除（全部副本）')
  })

  it('默认菜单：frontmatter 完整时不给「补齐 frontmatter」', () => {
    const markup = renderCard({}, { name: 'demo', mode: 'actions' })
    expect(markup).not.toContain('补齐 frontmatter')
    expect(markup).toContain('删除（全部副本）')
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
    expect(markup).toContain('删除（全部副本）')
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
  it('整卡切到英文文案（含判定与错误原因）', () => {
    attachLocale({ getSnapshot: () => ({ active: 'en' }) })
    const markup = renderToStaticMarkup(createElement(SkillCard, {
      row: row({ blocked: true, inCatalog: false, issues: ['missing-name'] }),
      showVerdict: true,
      busy: false,
      menu: { name: 'demo', mode: 'actions' },
      onOpen: vi.fn(),
      onToggle: vi.fn(),
      onOpenMenu: vi.fn(),
      onAskDelete: vi.fn(),
      onAskRepair: vi.fn(),
      onConfirmDelete: vi.fn(),
      onConfirmRepair: vi.fn(),
      onCloseMenu: vi.fn(),
    }))
    expect(markup).toContain('Blocked')
    expect(markup).toContain('Error')
    expect(markup).toContain('not in the skill registry')
    expect(markup).toContain('Actions')
    expect(markup).toContain('Delete (all copies)')
    expect(markup).not.toContain('已屏蔽')
    expect(markup).not.toContain('错误')
  })
})

describe('SkillCard：诚实性（回归）', () => {
  it('删除确认里把受保护副本标出来，用户不会误以为删干净了', () => {
    const markup = renderCard({
      copies: [
        copy(),
        copy({ source: 'bundled', deletable: false, path: '/app/bundled/demo/SKILL.md', directory: '/app/bundled/demo' }),
      ],
    }, { name: 'demo', mode: 'confirm-delete' })
    expect(markup).toContain('受保护，将跳过')
    expect(markup).toContain('/app/bundled/demo')
  })

  it('「未生效」与「原因未知」是保留词：任何渲染分支都不再出现', () => {
    const valid = renderCard()
    const invalid = renderCard({ inCatalog: false, issues: [] })
    const hidden = renderCard({ inCatalog: false }, null, false, false)
    for (const markup of [valid, invalid, hidden]) {
      expect(markup).not.toContain('未生效')
      expect(markup).not.toContain('原因未知')
    }
  })

  it('拿不到作用域时宁可不说，也不把"我不知道"渲染成"它是错的"', () => {
    const markup = renderCard({ inCatalog: false }, null, false, false)
    expect(markup).not.toContain('错误')
    expect(markup).not.toContain('不在 skill 注册表里')
  })

  it('详情页同样不出现保留词', () => {
    for (const markup of [renderDetail(), renderDetail({ inCatalog: false }, false)]) {
      expect(markup).not.toContain('未生效')
      expect(markup).not.toContain('原因未知')
    }
  })
})

describe('SkillCard：进入详情的入口', () => {
  it('事实区带「查看详情」的可见名（开关键与操作按钮不在事实区里）', () => {
    const markup = renderCard()
    expect(markup).toContain('demo · 查看详情')
  })

  it('名字不合法时也能进详情（进详情不是写开关，不受 blockable 限制）', () => {
    const markup = renderCard({ blockable: false, name: 'Bad_Name' })
    expect(markup).toContain('Bad_Name · 查看详情')
  })
})

describe('SkillDetail：详情页', () => {
  it('名称、描述与「存在的根位置」都在', () => {
    const markup = renderDetail()
    expect(markup).toContain('demo')
    expect(markup).toContain('示例描述')
    expect(markup).toContain('存在的根位置')
    expect(markup).toContain('返回列表')
    expect(markup).toContain('有效')
  })

  it('每一处副本的根目录与具体文件都列出来，胜出副本标「当前生效」', () => {
    const markup = renderDetail({
      copies: [
        copy(),
        copy({
          source: 'user-dsh',
          rank: 400,
          rootPath: '/home/me/.dsh/skills',
          directory: '/home/me/.dsh/skills/demo',
          path: '/home/me/.dsh/skills/demo/SKILL.md',
        }),
      ],
    })
    expect(markup).toContain('2 处副本')
    expect(markup).toContain('/proj/.dsh/skills')
    expect(markup).toContain('/proj/.dsh/skills/demo/SKILL.md')
    expect(markup).toContain('/home/me/.dsh/skills')
    expect(markup).toContain('/home/me/.dsh/skills/demo/SKILL.md')
    // 胜出副本只有一个（rank 最小）："当前生效"必须只标一处，否则用户无法判断
    // 列表里的名字/描述/来源到底取自哪里。
    expect(countOf(markup, '当前生效')).toBe(1)
  })

  it('「返回列表」排在标题与徽标之后（DOM 顺序 = 右端位置，Tab 顺序也是先标题后返回）', () => {
    const markup = renderDetail()
    const back = markup.indexOf('返回列表')
    expect(back).toBeGreaterThan(markup.indexOf('<h3'))
    expect(back).toBeGreaterThan(markup.indexOf('有效'))
    expect(back).toBeGreaterThan(markup.indexOf('项目 .dsh'))
    // 贴右端本身由 `.detailBack { margin-left: auto }` 负责——服务端渲染看不到样式，
    // 所以这里只能钉住 DOM 顺序（布局的其余部分靠人工在页面上确认）。
    expect(back).toBeGreaterThan(markup.indexOf('</h3>'))
  })

  it('非 runtime 副本与受保护副本各自标注', () => {
    const markup = renderDetail({
      copies: [
        copy(),
        copy({ source: 'library', rank: 1000, live: false, rootPath: '/home/me/.dsh/skill-library', directory: '/home/me/.dsh/skill-library/demo', path: '/home/me/.dsh/skill-library/demo/SKILL.md' }),
        copy({ source: 'bundled', rank: 600, deletable: false, rootPath: '/app/bundled', directory: '/app/bundled/demo', path: '/app/bundled/demo/SKILL.md' }),
      ],
    })
    expect(markup).toContain('会被 DSH 加载')
    expect(markup).toContain('DSH 不读它')
    expect(markup).toContain('受保护，不会删除')
    expect(markup).toContain('优先级 1000')
    expect(markup).toContain('Skill 库')
  })

  it('单文件副本标「单文件 .md」，目录副本标「目录 bundle」', () => {
    const markup = renderDetail({
      copies: [copy({ form: 'flat', path: '/proj/.dsh/skills/demo.md', directory: '/proj/.dsh/skills' })],
    })
    expect(markup).toContain('单文件 .md')
    expect(markup).toContain('/proj/.dsh/skills/demo.md')
  })

  it('每处副本自己的 frontmatter 问题分别列出（同一个名字在不同根里状态可能不同）', () => {
    const markup = renderDetail({
      copies: [
        copy(),
        copy({ source: 'user-dsh', rank: 400, rootPath: '/home/me/.dsh/skills', path: '/home/me/.dsh/skills/demo/SKILL.md', issues: ['missing-description'] }),
      ],
    })
    expect(markup).toContain('frontmatter 缺少 description')
  })

  it('条目名与名字不同时说明条目名（「补齐 frontmatter」的候选名）', () => {
    const markup = renderDetail({
      nameSource: 'entry',
      copies: [copy({ entryName: 'demo-dir' })],
    })
    expect(markup).toContain('条目名 demo-dir')
    expect(markup).toContain('名字取自目录名')
  })

  it('磁盘上没有副本（运行时提供）：说明清楚并给出 provider', () => {
    const markup = renderDetail({
      form: 'virtual',
      source: 'bundled',
      provider: 'dsh-office',
      copies: [],
      deletable: false,
    })
    expect(markup).toContain('由运行时提供，磁盘上没有副本')
    expect(markup).toContain('dsh-office')
    expect(markup).toContain('运行时')
  })

  it('判定依据列出 A/B/C 三条原始事实', () => {
    const markup = renderDetail({
      inCatalog: false,
      invocation: { modelInvocable: false, userInvocable: true },
    })
    expect(markup).toContain('在 skill 注册表里（条件 A）')
    expect(markup).toContain('模型可主动调用（条件 B）')
    expect(markup).toContain('用户可显式调用（条件 C）')
  })

  it('拿不到观察者作用域时不显示判定依据（否则会把"没读到"说成"不在注册表里"）', () => {
    const markup = renderDetail({ inCatalog: false }, false)
    expect(markup).not.toContain('判定依据')
    expect(markup).not.toContain('条件 A')
    expect(markup).not.toContain('错误')
    // 但"存在的根位置"是磁盘事实，与判定无关，必须照常显示。
    expect(markup).toContain('存在的根位置')
    expect(markup).toContain('/proj/.dsh/skills')
  })

  it('英文 locale 下整页切到英文', () => {
    attachLocale({ getSnapshot: () => ({ active: 'en' }) })
    const markup = renderToStaticMarkup(createElement(SkillDetail, {
      row: row(),
      showVerdict: true,
      onBack: vi.fn(),
    }))
    expect(markup).toContain('Back to list')
    expect(markup).toContain('Existing root locations')
    expect(markup).toContain('Description')
    expect(markup).not.toContain('存在的根位置')
  })
})

describe('selectedRow：详情分支（列表筛选不该影响详情）', () => {
  const demo = row({ name: 'demo' })
  const other = row({ name: 'other' })

  it('list 视图不选任何行', () => {
    expect(selectedRow(panel([demo]), 'list', 'demo')).toBeUndefined()
  })

  it('detail 视图命中时返回那一行', () => {
    expect(selectedRow(panel([demo, other]), 'detail', 'other')?.name).toBe('other')
  })

  it('detail 视图但数据里没有这个名字：回落列表（不渲染空壳详情）', () => {
    expect(selectedRow(panel([demo]), 'detail', 'gone')).toBeUndefined()
  })

  it('数据还没加载：不选任何行', () => {
    expect(selectedRow(null, 'detail', 'demo')).toBeUndefined()
  })
})

describe('面板 store：列表 / 详情切换', () => {
  it('showDetail 设视图与选中名，backToList 复位', () => {
    const store = createSkillSwitchStore()
    expect(store.getSnapshot()).toMatchObject({ view: 'list', selectedName: '' })
    store.actions.showDetail('demo')
    expect(store.getSnapshot()).toMatchObject({ view: 'detail', selectedName: 'demo' })
    store.actions.backToList()
    expect(store.getSnapshot()).toMatchObject({ view: 'list', selectedName: '' })
  })

  it('进出详情不丢筛选与搜索词（返回后列表还是刚才那一屏）', () => {
    const store = createSkillSwitchStore()
    store.actions.setFilter('blocked')
    store.actions.setQuery('demo')
    store.actions.showDetail('demo')
    store.actions.backToList()
    expect(store.getSnapshot()).toMatchObject({ filter: 'blocked', query: 'demo' })
  })

  it('订阅收到变化，退订后不再收到（视图切换会触发重渲染）', () => {
    const store = createSkillSwitchStore()
    const seen: string[] = []
    const off = store.subscribe(() => seen.push(store.getSnapshot().view))
    store.actions.showDetail('demo')
    store.actions.backToList()
    off()
    store.actions.showDetail('demo')
    expect(seen).toEqual(['detail', 'list'])
  })
})
