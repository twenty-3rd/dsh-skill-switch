/**
 * 包装器回归测试：用假的 skills 服务（复刻 SkillRegistry 的
 * snapshot/list/get 公共契约）验证 installSkillFilter() 的过滤接线、
 * get 拦截、透传契约、双重加载保护与卸载还原。
 *
 * 这一组与 v1（test/wrap.test.mjs）一一对应：优化后的插件换了形态（TS +
 * 客户端面板），但"项目级屏蔽"的对外行为必须一字不差。
 */
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HostContext, SwitchSkillRegistry, SwitchSkillSummary } from '../src/context-types.ts'
import { installSkillFilter, resolveConfig } from '../src/index.ts'

const CATALOG: SwitchSkillSummary[] = [
  { name: 'review', description: 'd1', source: 'user-dsh', provider: 'filesystem' },
  { name: 'api-design', description: 'd2', source: 'user-dsh', provider: 'filesystem' },
  { name: 'modlens', description: 'd3', source: 'user-dsh', provider: 'filesystem' },
]

/** 假的最小 skills 服务（方法在原型上，模拟 SkillRegistry）。 */
class FakeSkills implements SwitchSkillRegistry {
  async snapshot(): Promise<{ skills: SwitchSkillSummary[]; complete: boolean }> {
    return { skills: CATALOG.map(skill => ({ ...skill })), complete: true }
  }

  async list(): Promise<SwitchSkillSummary[]> {
    return (await this.snapshot()).skills
  }

  async get(name: string): Promise<{ name: string; content: string } | undefined> {
    const hit = CATALOG.find(skill => skill.name === name)
    return hit === undefined ? undefined : { name: hit.name, content: `# ${name}` }
  }
}

/** 假 ctx：skills 服务 + 日志 + effect 收集器。 */
function fakeCtx(): { ctx: HostContext; runDisposers: () => void } {
  const disposers: Array<() => void> = []
  const ctx = {
    skills: new FakeSkills(),
    logger: { info() {}, warn() {} },
    effect(fn: () => void | (() => void)) {
      disposers.push(() => { const off = fn(); if (typeof off === 'function') off() })
    },
    inject() { return undefined },
  } as unknown as HostContext
  return { ctx, runDisposers: () => { for (const dispose of disposers.splice(0)) dispose() } }
}

/** 建一个含 .git 的临时项目，写入给定文件。 */
async function withProject(files: Record<string, string> = {}): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'ss-wrap-'))
  await mkdir(join(base, '.git'), { recursive: true })
  for (const [relative, content] of Object.entries(files)) {
    const target = join(base, relative)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content)
  }
  return base
}

const CONFIG = () => resolveConfig({ cacheTtlMs: 0 })

describe('installSkillFilter：项目级屏蔽', () => {
  it('无开关目录：snapshot/list/get 纯透传（但方法确实被包装）', async () => {
    const { ctx } = fakeCtx()
    const originalSnapshot = ctx.skills.snapshot
    installSkillFilter(ctx, CONFIG(), ctx.logger ?? console)
    const snap = await ctx.skills.snapshot({ cwd: '/tmp' })
    expect(snap.skills.length).toBe(CATALOG.length)
    expect(snap.complete).toBe(true)
    expect((await ctx.skills.list({ cwd: '/tmp' })).length).toBe(CATALOG.length)
    expect(ctx.skills.snapshot).not.toBe(originalSnapshot)
    const loaded = await ctx.skills.get('review', { cwd: '/tmp' }) as { name: string }
    expect(loaded.name).toBe('review')
  })

  it('deny 模式：off/ 点名的 skill 从目录消失且 get 被拦截', async () => {
    const project = await withProject({
      '.dsh/skill-switches/off/review': '太吵',
      '.dsh/skill-switches/off/modlens.md': '',
    })
    const { ctx } = fakeCtx()
    installSkillFilter(ctx, CONFIG(), ctx.logger ?? console)
    const snap = await ctx.skills.snapshot({ cwd: join(project, 'sub', 'dir') })
    expect(snap.skills.map(s => s.name)).toEqual(['api-design'])
    expect(await ctx.skills.get('review', { cwd: project })).toBeUndefined()
    const allowed = await ctx.skills.get('api-design', { cwd: project }) as { name: string }
    expect(allowed.name).toBe('api-design')
    await rm(project, { recursive: true, force: true })
  })

  it('allow 模式：只放行 on/ 点名的 skill', async () => {
    const project = await withProject({
      '.dsh/skill-switches/mode': 'ALLOW\n白名单模式',
      '.dsh/skill-switches/on/api-design': '',
    })
    const { ctx } = fakeCtx()
    installSkillFilter(ctx, CONFIG(), ctx.logger ?? console)
    const snap = await ctx.skills.snapshot({ cwd: project })
    expect(snap.skills.map(s => s.name)).toEqual(['api-design'])
    expect(await ctx.skills.get('review', { cwd: project })).toBeUndefined()
    await rm(project, { recursive: true, force: true })
  })

  it('开关即时性：运行中新建 off 文件，下一次 snapshot 立即生效', async () => {
    const project = await withProject()
    const { ctx } = fakeCtx()
    installSkillFilter(ctx, CONFIG(), ctx.logger ?? console)
    expect((await ctx.skills.snapshot({ cwd: project })).skills.length).toBe(3)
    const offDir = join(project, '.dsh', 'skill-switches', 'off')
    await mkdir(offDir, { recursive: true })
    await writeFile(join(offDir, 'review'), '')
    expect((await ctx.skills.snapshot({ cwd: project })).skills.map(s => s.name)).toEqual(['api-design', 'modlens'])
    await rm(project, { recursive: true, force: true })
  })

  it('项目隔离：另一个项目的会话不受影响', async () => {
    const projectA = await withProject({ '.dsh/skill-switches/off/review': '' })
    const projectB = await withProject()
    const { ctx } = fakeCtx()
    installSkillFilter(ctx, CONFIG(), ctx.logger ?? console)
    expect((await ctx.skills.snapshot({ cwd: projectA })).skills.length).toBe(2)
    expect((await ctx.skills.snapshot({ cwd: projectB })).skills.length).toBe(3)
    await rm(projectA, { recursive: true, force: true })
    await rm(projectB, { recursive: true, force: true })
  })

  it('卸载还原：dispose 后恢复原型方法', async () => {
    const { ctx, runDisposers } = fakeCtx()
    const before = { snapshot: ctx.skills.snapshot, list: ctx.skills.list, get: ctx.skills.get }
    installSkillFilter(ctx, CONFIG(), ctx.logger ?? console)
    expect(ctx.skills.snapshot).not.toBe(before.snapshot)
    runDisposers()
    expect(ctx.skills.snapshot).toBe(before.snapshot)
    expect(ctx.skills.list).toBe(before.list)
    expect(ctx.skills.get).toBe(before.get)
    expect((await ctx.skills.snapshot({ cwd: '/tmp' })).skills.length).toBe(CATALOG.length)
  })

  it('双重加载保护：重复安装拒绝二次包装', async () => {
    const { ctx, runDisposers } = fakeCtx()
    installSkillFilter(ctx, CONFIG(), ctx.logger ?? console)
    const wrappedSnapshot = ctx.skills.snapshot
    installSkillFilter(ctx, CONFIG(), ctx.logger ?? console)
    expect(ctx.skills.snapshot).toBe(wrappedSnapshot)
    runDisposers()
    expect(ctx.skills.snapshot).toBe(FakeSkills.prototype.snapshot)
  })

  it('无 cwd 的调用：透传（解析不出项目就不过滤）', async () => {
    const project = await withProject({ '.dsh/skill-switches/off/review': '' })
    const { ctx } = fakeCtx()
    installSkillFilter(ctx, CONFIG(), ctx.logger ?? console)
    expect((await ctx.skills.snapshot({})).skills.length).toBe(3)
    expect((await ctx.skills.snapshot()).skills.length).toBe(3)
    const unblocked = await ctx.skills.get('review', {}) as { name: string }
    expect(unblocked.name).toBe('review')
    await rm(project, { recursive: true, force: true })
  })
})
