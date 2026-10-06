/**
 * 真实组合集成测试：启动一个真正的 cordis Context，装上官方的 SkillRegistry、
 * 官方 filesystem skill provider、官方 WebServer，再用桩服务补齐 sessions /
 * loader，然后把本插件的 host 半体挂上去，用真实 HTTP 驱动 /skill-switch API。
 *
 * 这是"真组合"关卡——不是手搓 ctx.plugin() 的空壳：屏蔽后的目录必须真的从
 * **官方注册表**的 snapshot 里消失，被官方丢弃的 skill 必须真的出现在面板里而
 * 不在注册表里，修复后必须真的被注册表重新认领。
 *
 * 一个真实的工程事实：SkillRegistry 会**按 cwd 缓存** provider 的发现结果，
 * 缓存失效由 provider 的文件监视器触发（生产默认 watch: true）。测试里把
 * watch 关掉以保证确定性，因此：
 * - 每个用例用自己的项目目录（新的 cwd = 新的缓存条目），夹具在第一次读取
 *   *之前* 就位；
 * - 需要在写入后立刻让注册表重新发现的用例，显式调用 {@link bustCatalog}，
 *   它用公共 API（注册并立刻注销一个 runtime skill）触发一次缓存失效——
 *   这正是"目录变了"的语义，生产环境由 watcher 负责。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as skillFs from '@deepseek-ai/dsh-skill-filesystem'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { apply, inject, name } from '../src/index.ts'
import type { PanelView } from '../src/index.ts'
import type { SkillRow } from '../src/client/api.ts'

/** 一个 POST 请求；失败时抛出带 wire code 的错误。 */
async function post<T>(port: number, method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}/skill-switch/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json() as { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } }
  if (!response.ok || body.ok !== true || body.value === undefined) {
    throw new Error(`${method} failed: ${body.error?.code ?? 'http'} ${body.error?.message ?? response.status}`)
  }
  return body.value as T
}

/** 一个裸请求，返回状态码与解析后的 body。 */
async function raw(
  port: number,
  method: string,
  path: string,
  payload?: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: { ok?: boolean; error?: { code?: string } } | null }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  })
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

/** 一个 skill 行按名字查找（找不到直接失败，错误里带上现有名字）。 */
function rowOf(view: PanelView, skillName: string): SkillRow {
  const row = view.skills.find(candidate => candidate.name === skillName)
  if (row === undefined) throw new Error(`row "${skillName}" not in panel (have: ${view.skills.map(s => s.name).join(', ')})`)
  return row
}

describe('真实组合：官方注册表 + WebServer + /skill-switch API', () => {
  let port: number
  let app: Context
  let pluginFiber: { dispose(): Promise<void> }
  let scratch: string
  /** sessions 桩返回的 cwd（每个用例换成自己的项目目录）。 */
  let currentProject = ''
  let cacheBuster = 0

  /** 该项目下的用户级 skill 根（全局共享，跨用例注意名字唯一）。 */
  const userSkills = (): string => join(scratch, 'skills')

  /** 切到一个全新的项目目录，保证注册表的 cwd 缓存是干净的。 */
  async function useProject(id: string): Promise<string> {
    const project = join(scratch, `proj-${id}`)
    await mkdir(join(project, '.git'), { recursive: true })
    currentProject = project
    return project
  }

  /** 在项目级根下写一个 skill；content 为完整 SKILL.md 内容。 */
  async function writeProjectSkill(project: string, skillName: string, content: string): Promise<string> {
    const dir = join(project, '.dsh', 'skills', skillName)
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'SKILL.md')
    await writeFile(path, content)
    return path
  }

  /** 写一个用户级 skill。 */
  async function writeUserSkill(skillName: string, content: string): Promise<string> {
    const dir = join(userSkills(), skillName)
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'SKILL.md')
    await writeFile(path, content)
    return path
  }

  /** 让注册表重新发现磁盘（测试专用缓存失效；生产由 provider watcher 负责）。 */
  function bustCatalog(): void {
    cacheBuster += 1
    const dispose = app.skills.register({
      name: `cache-buster-${cacheBuster}`,
      description: 'cache buster',
      source: 'runtime',
      content: '',
    })
    dispose()
  }

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'ss-api-'))

    app = new Context()
    // 本组合缺少的两个服务：会话存储（读权威 cwd）与 connection 行。
    app.provide('sessions', {
      get: (id: string) => (id === 'session-1' ? { header: { cwd: currentProject } } : undefined),
    })
    app.provide('loader', {
      entries: () => [{ options: { name: 'connection', config: { trustedHosts: [] } } }],
    })

    await app.plugin(SkillRegistry)
    await app.plugin(skillFs as unknown as Parameters<typeof app.plugin>[0], {
      includeDefaultRoots: true,
      dshHome: scratch,
      agentsHome: join(scratch, 'agents'),
      watch: false,
    })
    await app.plugin(WebServer, { host: '127.0.0.1', port: 0 })

    const pluginObject: unknown = { name, inject, apply }
    pluginFiber = app.plugin(pluginObject as Parameters<typeof app.plugin>[0], {
      dshHome: scratch,
      agentsHome: join(scratch, 'agents'),
      bundledSkillDir: join(scratch, 'bundled'),
      cacheTtlMs: 0,
    }) as unknown as { dispose(): Promise<void> }
    await pluginFiber
    port = app.webServer.port
  })

  afterAll(async () => {
    await pluginFiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  })

  it('模块身份：name / inject 与 cordis 行一致', () => {
    expect(name).toBe('dsh-skill-switch')
    expect(inject).toEqual(['skills'])
  })

  it('空项目：panel.load 返回作用域、根清单与空表', async () => {
    const project = await useProject('empty')
    const view = await post<PanelView>(port, 'panel.load', { sessionId: 'session-1' })
    expect(view.cwd).toBe(project)
    expect(view.projectRoot).toBe(project)
    expect(view.switchesPath).toBe(join(project, '.dsh', 'skill-switches'))
    expect(view.switchesPresent).toBe(false)
    expect(view.mode).toBe('deny')
    expect(view.skills).toEqual([])
    expect(view.roots.map(r => r.source)).toEqual([
      'project-dsh', 'project-agents', 'user-dsh', 'user-agents', 'bundled', 'library',
    ])
  })

  it('项目级与用户级 skill 都会被列出，且 runtime 确实认领了它们', async () => {
    const project = await useProject('catalog')
    await writeProjectSkill(project, 'proj-skill', '---\nname: proj-skill\ndescription: 项目级\n---\n正文\n')
    await writeUserSkill('user-skill', '---\nname: user-skill\ndescription: 用户级\n---\n正文\n')

    const view = await post<PanelView>(port, 'panel.load', { sessionId: 'session-1' })
    expect(view.catalogComplete).toBe(true)
    const projRow = rowOf(view, 'proj-skill')
    expect(projRow.source).toBe('project-dsh')
    expect(projRow.inCatalog).toBe(true)
    expect(projRow.issues).toEqual([])
    expect(projRow.deletable).toBe(true)
    expect(rowOf(view, 'user-skill').source).toBe('user-dsh')
    expect(rowOf(view, 'user-skill').inCatalog).toBe(true)
  })

  it('一键屏蔽：开关文件落盘、注册表目录立即少一项、get 被拦截、别的项目不受影响', async () => {
    // 先把"别的项目"建好，再切到本用例的项目（useProject 会设置 sessions 桩的 cwd）。
    const other = await useProject('toggle-other')
    const project = await useProject('toggle')
    // 放在用户级根里，两个项目都看得见——这样才能验证隔离粒度是"项目"而不是"全局"。
    await writeUserSkill('toggled', '---\nname: toggled\ndescription: d\n---\n')
    expect((await app.skills.list({ cwd: project })).map(s => s.name)).toContain('toggled')
    expect((await app.skills.list({ cwd: other })).map(s => s.name)).toContain('toggled')

    const view = await post<PanelView>(port, 'switches.set', { sessionId: 'session-1', name: 'toggled', blocked: true })
    expect(rowOf(view, 'toggled').blocked).toBe(true)
    expect(view.off).toEqual(['toggled'])
    expect(view.lastAction?.kind).toBe('toggle')

    // 开关文件真的写了（v1 协议：off/<name>）。
    await expect(readFile(join(project, '.dsh', 'skill-switches', 'off', 'toggled'), 'utf8'))
      .resolves.toContain('dsh-skill-switch')

    // 官方注册表的口径变了——整条链路上唯一有意义的验收点。
    expect((await app.skills.list({ cwd: project })).map(s => s.name)).not.toContain('toggled')
    expect(await app.skills.get('toggled', { cwd: project })).toBeUndefined()
    // 别的项目照常可见（隔离粒度 = 项目）。
    expect((await app.skills.list({ cwd: other })).map(s => s.name)).toContain('toggled')
  })

  it('一键恢复：开关文件被删、注册表目录回到原样', async () => {
    const project = await useProject('restore')
    await writeProjectSkill(project, 'restored', '---\nname: restored\ndescription: d\n---\n')
    await post<PanelView>(port, 'switches.set', { sessionId: 'session-1', name: 'restored', blocked: true })
    expect((await app.skills.list({ cwd: project })).map(s => s.name)).not.toContain('restored')

    const view = await post<PanelView>(port, 'switches.set', { sessionId: 'session-1', name: 'restored', blocked: false })
    expect(rowOf(view, 'restored').blocked).toBe(false)
    expect((await app.skills.list({ cwd: project })).map(s => s.name)).toContain('restored')
    await expect(readFile(join(project, '.dsh', 'skill-switches', 'off', 'restored'), 'utf8')).rejects.toThrow()
  })

  it('被官方丢弃的 skill 也看得见（注意点 3）：注册表里没有它，面板列出它并给出错误原因', async () => {
    const project = await useProject('ghost')
    await writeProjectSkill(project, 'ghost-skill', '# 没有 frontmatter 的 skill\n\n正文第一行会被当成描述。\n')

    // 官方注册表：不存在（这正是 dsh-skills-manager 的盲区）。
    expect((await app.skills.list({ cwd: project })).map(s => s.name)).not.toContain('ghost-skill')

    const view = await post<PanelView>(port, 'panel.load', { sessionId: 'session-1' })
    const ghost = rowOf(view, 'ghost-skill')
    expect(ghost.inCatalog).toBe(false)
    expect(ghost.issues).toEqual(['missing-frontmatter'])
    expect(ghost.nameSource).toBe('entry')
    expect(ghost.description).toBe('没有 frontmatter 的 skill')
    expect(ghost.descriptionSource).toBe('body')
    expect(ghost.blockable).toBe(true)
  })

  it('补齐 frontmatter：文件被改写、面板当场不再标「错误」、注册表随后认领它', async () => {
    const project = await useProject('repair')
    const path = await writeProjectSkill(project, 'fixme', '# 只有正文\n\n描述行\n')
    // 先读一次，让注册表把这个 cwd 的（不含 fixme 的）发现结果缓存下来。
    expect((await app.skills.list({ cwd: project })).map(s => s.name)).not.toContain('fixme')

    const view = await post<PanelView>(port, 'skills.repair', { sessionId: 'session-1', name: 'fixme' })
    expect(view.lastAction?.kind).toBe('repair')
    expect(view.lastAction?.repaired).toEqual([path])
    // 面板的「错误」来自注册表 + 磁盘事实的对照，所以当场就变（不依赖目录缓存刷新）。
    expect(rowOf(view, 'fixme').issues).toEqual([])
    expect(rowOf(view, 'fixme').blocked).toBe(false)

    const text = await readFile(path, 'utf8')
    expect(text.startsWith('---\n')).toBe(true)
    expect(text).toContain('name: fixme')
    expect(text).toContain('描述行')
    expect(text).toContain('# 只有正文')

    // 目录刷新后（生产由 watcher 触发）注册表认领它。
    bustCatalog()
    const catalog = await app.skills.list({ cwd: project })
    const entry = catalog.find(s => s.name === 'fixme')
    expect(entry).toBeDefined()
    expect(entry?.source).toBe('project-dsh')
  })

  it('补齐 frontmatter 对已经完整的条目不生效（bad-request）', async () => {
    const project = await useProject('repair-noop')
    await writeProjectSkill(project, 'already-ok', '---\nname: already-ok\ndescription: d\n---\n')
    const result = await raw(port, 'POST', '/skill-switch/api/skills.repair', { sessionId: 'session-1', name: 'already-ok' })
    expect(result.status).toBe(400)
    expect(result.body?.error?.code).toBe('bad-request')
  })

  it('全局删除：所有落盘副本被清掉，面板与注册表都不再可见', async () => {
    const project = await useProject('delete')
    const projectPath = await writeProjectSkill(project, 'doomed', '---\nname: doomed\ndescription: d\n---\n')
    const userPath = await writeUserSkill('doomed', '---\nname: doomed\ndescription: d\n---\n')

    const before = await post<PanelView>(port, 'panel.load', { sessionId: 'session-1' })
    expect(rowOf(before, 'doomed').copies).toHaveLength(2)

    const view = await post<PanelView>(port, 'skills.delete', { sessionId: 'session-1', name: 'doomed' })
    expect(view.lastAction?.kind).toBe('delete')
    expect(view.lastAction?.removed).toHaveLength(2)
    expect(view.skills.some(s => s.name === 'doomed')).toBe(false)
    await expect(readFile(projectPath, 'utf8')).rejects.toThrow()
    await expect(readFile(userPath, 'utf8')).rejects.toThrow()

    bustCatalog()
    expect((await app.skills.list({ cwd: project })).map(s => s.name)).not.toContain('doomed')
  })

  it('删除只存在于 runtime 的虚拟 skill -> protected 403', async () => {
    await useProject('virtual')
    const unregister = app.skills.register({
      name: 'runtime-only',
      description: '运行时注册的',
      source: 'runtime',
      content: '正文',
    })
    try {
      const view = await post<PanelView>(port, 'panel.load', { sessionId: 'session-1' })
      const row = rowOf(view, 'runtime-only')
      expect(row.form).toBe('virtual')
      expect(row.deletable).toBe(false)
      expect(row.inCatalog).toBe(true)
      const result = await raw(port, 'POST', '/skill-switch/api/skills.delete', { sessionId: 'session-1', name: 'runtime-only' })
      expect(result.status).toBe(403)
      expect(result.body?.error?.code).toBe('protected')
    } finally {
      unregister()
    }
  })

  it('删除不存在的名字 -> 404', async () => {
    await useProject('delete-missing')
    const result = await raw(port, 'POST', '/skill-switch/api/skills.delete', { sessionId: 'session-1', name: 'never-existed' })
    expect(result.status).toBe(404)
    expect(result.body?.error?.code).toBe('not-found')
  })

  it('switches.reset 清空本项目全部开关', async () => {
    const project = await useProject('reset')
    await writeProjectSkill(project, 'resetme', '---\nname: resetme\ndescription: d\n---\n')
    await post<PanelView>(port, 'switches.set', { sessionId: 'session-1', name: 'resetme', blocked: true })
    expect((await app.skills.list({ cwd: project })).map(s => s.name)).not.toContain('resetme')

    const view = await post<PanelView>(port, 'switches.reset', { sessionId: 'session-1' })
    expect(view.lastAction?.kind).toBe('reset')
    expect(view.off).toEqual([])
    expect(view.on).toEqual([])
    expect((await app.skills.list({ cwd: project })).map(s => s.name)).toContain('resetme')
  })

  it('allow（白名单）模式的项目：开关语义仍然是"是否隐藏"', async () => {
    const project = await useProject('allow')
    await writeProjectSkill(project, 'whitelisted', '---\nname: whitelisted\ndescription: d\n---\n')
    await writeProjectSkill(project, 'not-listed', '---\nname: not-listed\ndescription: d\n---\n')
    const switches = join(project, '.dsh', 'skill-switches')
    await mkdir(join(switches, 'on'), { recursive: true })
    await writeFile(join(switches, 'mode'), 'allow\n')
    await writeFile(join(switches, 'on', 'whitelisted'), '')

    const view = await post<PanelView>(port, 'panel.load', { sessionId: 'session-1' })
    expect(view.mode).toBe('allow')
    expect(rowOf(view, 'whitelisted').blocked).toBe(false)
    expect(rowOf(view, 'not-listed').blocked).toBe(true)

    // 屏蔽白名单里的那个 = 从 on/ 移除。
    const toggled = await post<PanelView>(port, 'switches.set', { sessionId: 'session-1', name: 'whitelisted', blocked: true })
    expect(rowOf(toggled, 'whitelisted').blocked).toBe(true)
    await expect(readFile(join(switches, 'on', 'whitelisted'), 'utf8')).rejects.toThrow()
  })

  it('白名单模式下"恢复全部"连 mode 一起清：不能让目录变成空集', async () => {
    const project = await useProject('allow-reset')
    await writeProjectSkill(project, 'keep-a', '---\nname: keep-a\ndescription: d\n---\n')
    await writeProjectSkill(project, 'keep-b', '---\nname: keep-b\ndescription: d\n---\n')
    const switches = join(project, '.dsh', 'skill-switches')
    await mkdir(join(switches, 'on'), { recursive: true })
    await writeFile(join(switches, 'mode'), 'allow\n')
    await writeFile(join(switches, 'on', 'keep-a'), '')

    // 白名单生效时只有 keep-a 可见。
    expect((await app.skills.list({ cwd: project })).map(s => s.name)).toEqual(['keep-a'])

    const view = await post<PanelView>(port, 'switches.reset', { sessionId: 'session-1' })
    expect(view.lastAction?.modeReset).toBe(true)
    expect(view.mode).toBe('deny')
    await expect(readFile(join(switches, 'mode'), 'utf8')).rejects.toThrow()

    // 关键回归：恢复后是"都回来"，不是"全没了"。
    const names = (await app.skills.list({ cwd: project })).map(s => s.name)
    expect(names).toContain('keep-a')
    expect(names).toContain('keep-b')
  })

  it('非法名字的开关请求 -> bad-request', async () => {
    await useProject('bad-name')
    const result = await raw(port, 'POST', '/skill-switch/api/switches.set', { sessionId: 'session-1', name: 'Not_Kebab', blocked: true })
    expect(result.status).toBe(400)
    expect(result.body?.error?.code).toBe('bad-request')
  })

  it('缺少 sessionId -> bad-request', async () => {
    const result = await raw(port, 'POST', '/skill-switch/api/panel.load', {})
    expect(result.status).toBe(400)
    expect(result.body?.error?.code).toBe('bad-request')
  })

  it('未知方法 -> 404，非 POST -> 405', async () => {
    expect((await raw(port, 'POST', '/skill-switch/api/nope', { sessionId: 'session-1' })).status).toBe(404)
    expect((await raw(port, 'GET', '/skill-switch/api/panel.load')).status).toBe(405)
  })

  it('原型链上的名字不算合法方法（constructor / toString / valueOf -> 404）', async () => {
    for (const probe of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const result = await raw(port, 'POST', `/skill-switch/api/${probe}`, { sessionId: 'session-1' })
      expect(result.status, `${probe} 必须被当成未知方法`).toBe(404)
      expect(result.body?.error?.code).toBe('not-found')
    }
  })

  it('未知会话：payload 里的 cwd 一律不参与路径推导', async () => {
    const injected = join(scratch, 'attacker-controlled')
    const view = await post<PanelView>(port, 'panel.load', { sessionId: 'not-a-real-session', cwd: injected })
    expect(view.cwd).toBe(process.cwd())
    expect(view.projectRoot).not.toContain('attacker-controlled')
  })

  it('被屏蔽的"虚拟 skill"仍然留在面板里（未过滤目录），否则用户再也无法恢复它', async () => {
    await useProject('virtual-blocked')
    const unregister = app.skills.register({
      name: 'rt-only',
      description: '运行时注册的',
      source: 'runtime',
      content: '正文',
    })
    try {
      const blocked = await post<PanelView>(port, 'switches.set', { sessionId: 'session-1', name: 'rt-only', blocked: true })
      expect(rowOf(blocked, 'rt-only').blocked).toBe(true)
      // 关键：它磁盘上没有任何副本，面板只能靠"未过滤的 runtime 目录"知道它还在。
      const reloaded = await post<PanelView>(port, 'panel.load', { sessionId: 'session-1' })
      const row = rowOf(reloaded, 'rt-only')
      expect(row.form).toBe('virtual')
      expect(row.inCatalog).toBe(true)
      expect(row.blocked).toBe(true)

      // 能恢复。
      const restored = await post<PanelView>(port, 'switches.set', { sessionId: 'session-1', name: 'rt-only', blocked: false })
      expect(rowOf(restored, 'rt-only').blocked).toBe(false)
    } finally {
      unregister()
    }
  })

  it('跨站请求被栅栏拦住 -> 403', async () => {
    const result = await raw(port, 'POST', '/skill-switch/api/panel.load', { sessionId: 'session-1' }, {
      'sec-fetch-site': 'cross-site',
      origin: 'https://evil.example',
    })
    expect(result.status).toBe(403)
  })

  it('未知会话回退到进程 cwd，不抛错', async () => {
    const view = await post<PanelView>(port, 'panel.load', { sessionId: 'someone-else' })
    expect(typeof view.cwd).toBe('string')
    expect(view.cwd.length).toBeGreaterThan(0)
  })
})

/**
 * 包装的生命周期验收：用一个独立的真实 cordis Context（真实 SkillRegistry +
 * 本插件）说明 "fiber dispose 之后包装确实被摘掉"。
 *
 * 单独开一个 describe 是因为这里要把插件卸载掉，不能污染上面的共享实例。
 */
describe('真实 cordis：fiber dispose 之后 ctx.skills 恢复原样', () => {
  it('卸载后 off/<name> 不再隐藏，get 也重新可加载；双包装保护在整个生命周期内有效', async () => {
    const scratchDir = await mkdtemp(join(tmpdir(), 'ss-dispose-'))
    const project = join(scratchDir, 'proj')
    await mkdir(join(project, '.git'), { recursive: true })
    const dir = join(project, '.dsh', 'skills', 'leaky')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), '---\nname: leaky\ndescription: d\n---\n')
    await mkdir(join(project, '.dsh', 'skill-switches', 'off'), { recursive: true })
    await writeFile(join(project, '.dsh', 'skill-switches', 'off', 'leaky'), '')

    const app2 = new Context()
    app2.provide('sessions', { get: (id: string) => (id === 's1' ? { header: { cwd: project } } : undefined) })
    app2.provide('loader', { entries: () => [] })
    await app2.plugin(SkillRegistry)
    await app2.plugin(skillFs as unknown as Parameters<typeof app2.plugin>[0], {
      includeDefaultRoots: true,
      dshHome: scratchDir,
      agentsHome: join(scratchDir, 'agents'),
      watch: false,
    })

    const pluginObject: unknown = { name, inject, apply }
    const fiber = app2.plugin(pluginObject as Parameters<typeof app2.plugin>[0], {
      dshHome: scratchDir,
      agentsHome: join(scratchDir, 'agents'),
      bundledSkillDir: join(scratchDir, 'bundled'),
      cacheTtlMs: 0,
    }) as unknown as { dispose(): Promise<void> }
    await fiber

    // 包装期间：开关生效。
    expect((await app2.skills.list({ cwd: project })).map(s => s.name)).toEqual([])
    expect(await app2.skills.get('leaky', { cwd: project })).toBeUndefined()

    // 重复 apply 被拒绝（WRAP_TAG 在生命周期内必须保持为真）。
    const tag = Symbol.for('dsh-skill-switch.wrapped') as unknown as string
    expect((app2.skills as unknown as Record<string | symbol, unknown>)[tag]).toBe(true)
    const second = app2.plugin(pluginObject as Parameters<typeof app2.plugin>[0], {}) as unknown as { dispose(): Promise<void> }
    await second
    expect((app2.skills as unknown as Record<string | symbol, unknown>)[tag]).toBe(true)

    // 卸载：开关文件还在磁盘上，但包装必须被摘掉。
    await fiber.dispose()
    await second.dispose()
    expect((app2.skills as unknown as Record<string | symbol, unknown>)[tag]).toBeUndefined()
    expect((await app2.skills.list({ cwd: project })).map(s => s.name)).toEqual(['leaky'])
    const loaded = await app2.skills.get('leaky', { cwd: project }) as { name: string } | undefined
    expect(loaded?.name).toBe('leaky')

    await rm(scratchDir, { recursive: true, force: true })
  })
})

/**
 * 判定接线：面板的"有效/错误"必须建立在**该会话的观察者作用域**上。
 *
 * 这一组同时说明两件容易搞错的事：
 * - 拿不到活跃 agent 时，wire 上 `verdictAvailable=false` 且**行里没有任何错误项**
 *   ——"我不知道"绝不能渲染成"它是错的"；
 * - 拿到 agent 后判定生效，健康的 skill 是「有效」（A 在目录里 ∧ B/C 由注册表
 *   返回的 invocation 决定）。
 *
 * 本 harness 把 filesystem provider 挂在**全局层**（真实桌面端挂在 agent preset 的
 * standing scope 上），所以任何 scope 都能读到它；子作用域的分层行为由
 * `scripts/verify-scope-layers.mjs` 用真实 `@deepseek-ai/dsh-scope` 复现。
 */
describe('判定接线：ctx.agents 决定 verdictAvailable（真实注册表 + 真实 HTTP）', () => {
  it('没有 agents -> 不判定且无错误项；给出 agent -> 判定生效且健康 skill 是「有效」', async () => {
    const scratchDir = await mkdtemp(join(tmpdir(), 'ss-verdict-'))
    const project = join(scratchDir, 'proj')
    await mkdir(join(project, '.git'), { recursive: true })
    await mkdir(join(project, '.dsh', 'skills', 'healthy'), { recursive: true })
    await writeFile(join(project, '.dsh', 'skills', 'healthy', 'SKILL.md'), '---\nname: healthy\ndescription: d\n---\n')

    /** 活跃 agent（在真实 DSH 里 agent 对象本身就是它的 ScopeKey）。 */
    let agentValue: object | undefined

    const app3 = new Context()
    app3.provide('sessions', { get: (id: string) => (id === 's1' ? { header: { cwd: project } } : undefined) })
    app3.provide('loader', { entries: () => [] })
    app3.provide('agents', { get: (id: string) => (id === 's1' ? agentValue : undefined) })
    await app3.plugin(SkillRegistry)
    await app3.plugin(skillFs as unknown as Parameters<typeof app3.plugin>[0], {
      includeDefaultRoots: true,
      dshHome: scratchDir,
      agentsHome: join(scratchDir, 'agents'),
      watch: false,
    })
    await app3.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const pluginObject: unknown = { name, inject, apply }
    const fiber = app3.plugin(pluginObject as Parameters<typeof app3.plugin>[0], {
      dshHome: scratchDir,
      agentsHome: join(scratchDir, 'agents'),
      bundledSkillDir: join(scratchDir, 'bundled'),
      cacheTtlMs: 0,
    }) as unknown as { dispose(): Promise<void> }
    await fiber
    const verdictPort = app3.webServer.port

    // 1) 会话没有活跃 agent：判定列不可用，行上不带任何错误项。
    const before = await post<PanelView>(verdictPort, 'panel.load', { sessionId: 's1' })
    expect(before.verdictAvailable).toBe(false)
    expect(before.skills.map(s => s.name)).toContain('healthy')
    expect(before.skills.every(s => s.errors.length === 0)).toBe(true)

    // 2) 宿主给出该会话的 agent：判定生效，健康 skill = 有效（errors 为空）。
    agentValue = { fakeAgent: true }
    const after = await post<PanelView>(verdictPort, 'panel.load', { sessionId: 's1' })
    expect(after.verdictAvailable).toBe(true)
    const row = after.skills.find(s => s.name === 'healthy')
    expect(row?.errors).toEqual([])
    expect(row?.invocation).toEqual({ modelInvocable: true, userInvocable: true })

    await fiber.dispose()
    await rm(scratchDir, { recursive: true, force: true })
  })
})
