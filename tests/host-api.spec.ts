/**
 * 真实组合集成测试：启动一个真正的 cordis Context，装上官方的 SkillRegistry、
 * 官方 filesystem skill provider、官方 WebServer，再用桩服务补齐 sessions /
 * loader，然后把本插件的 host 半体挂上去，用真实 HTTP 驱动 /skill-switch API。
 *
 * 这是"真组合"关卡——不是手搓 ctx.plugin() 的空壳：屏蔽后的目录必须真的从
 * **官方注册表**的 snapshot 里消失，未生效的 skill 必须真的出现在面板里而
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

  it('"未生效"的 skill 也看得见（注意点 3）：官方注册表丢弃它，面板列出它并给出原因', async () => {
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

  it('补齐 frontmatter：文件被改写、面板当场不再标"未生效"、注册表随后认领它', async () => {
    const project = await useProject('repair')
    const path = await writeProjectSkill(project, 'fixme', '# 只有正文\n\n描述行\n')
    // 先读一次，让注册表把这个 cwd 的（不含 fixme 的）发现结果缓存下来。
    expect((await app.skills.list({ cwd: project })).map(s => s.name)).not.toContain('fixme')

    const view = await post<PanelView>(port, 'skills.repair', { sessionId: 'session-1', name: 'fixme' })
    expect(view.lastAction?.kind).toBe('repair')
    expect(view.lastAction?.repaired).toEqual([path])
    // 面板的"未生效"来自磁盘事实，所以当场就消失（不依赖目录缓存刷新）。
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
