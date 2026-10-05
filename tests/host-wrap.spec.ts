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
import { installSkillFilter, rawRegistry, resolveConfig } from '../src/index.ts'

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

/**
 * 假 ctx：skills 服务 + 日志 + effect 收集器。
 *
 * `effect` 刻意**复刻真实 cordis 的语义**（已核对 @deepseek-ai/cordis 的
 * fiber.ts：`execute` 立即执行，它**返回**的函数才是 disposer）。早期版本把
 * 这个骨架写反了（只在 dispose 时调用 fn），结果把"teardown 写在 effect body
 * 里"这个真 bug 完全遮住 —— 假骨架与被测语义不一致就是假绿。
 */
function fakeCtx(): { ctx: HostContext; runDisposers: () => void; effectRuns: number } {
  const disposers: Array<() => void> = []
  const stats = { effectRuns: 0 }
  const ctx = {
    skills: new FakeSkills(),
    logger: { info() {}, warn() {} },
    effect(fn: () => void | (() => void)) {
      stats.effectRuns += 1
      const off = fn()
      if (typeof off === 'function') disposers.push(off)
    },
    inject() { return undefined },
  } as unknown as HostContext
  return {
    ctx,
    effectRuns: () => stats.effectRuns,
    runDisposers: () => { for (const dispose of disposers.splice(0)) dispose() },
  } as unknown as { ctx: HostContext; runDisposers: () => void; effectRuns: number }
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

describe('installSkillFilter：生命周期与原样目录（回归）', () => {
  it('teardown 是登记为 disposer，而不是在安装时立刻执行', async () => {
    const { ctx, runDisposers } = fakeCtx()
    const before = ctx.skills.snapshot
    installSkillFilter(ctx, CONFIG(), ctx.logger ?? console)
    // 安装后包装必须在位：如果 teardown 被当成 effect body 跑掉了，
    // 这里会看到原型方法原样返回（早期 bug 的形状）。
    expect(ctx.skills.snapshot).not.toBe(before)
    const wrapped = ctx.skills.snapshot
    runDisposers()
    expect(ctx.skills.snapshot).toBe(before)
    expect(ctx.skills.snapshot).not.toBe(wrapped)
  })

  it('dispose 之后磁盘上的 off/<name> 不再隐藏该 skill（包装真的被摘掉了）', async () => {
    const project = await withProject({ '.dsh/skill-switches/off/review': '' })
    const { ctx, runDisposers } = fakeCtx()
    installSkillFilter(ctx, CONFIG(), ctx.logger ?? console)
    expect((await ctx.skills.list({ cwd: project })).map(s => s.name)).toEqual(['api-design', 'modlens'])
    expect(await ctx.skills.get('review', { cwd: project })).toBeUndefined()

    runDisposers()
    // 开关文件还在磁盘上，但包装已摘除 -> 目录恢复原样、get 重新可加载。
    expect((await ctx.skills.list({ cwd: project })).map(s => s.name)).toEqual(['review', 'api-design', 'modlens'])
    const loaded = await ctx.skills.get('review', { cwd: project }) as { name: string }
    expect(loaded.name).toBe('review')
    await rm(project, { recursive: true, force: true })
  })

  it('返回的原始方法即使在本插件包装之后也读得到未过滤目录', async () => {
    const project = await withProject({ '.dsh/skill-switches/off/review': '' })
    const { ctx } = fakeCtx()
    const originals = installSkillFilter(ctx, CONFIG(), ctx.logger ?? console)
    // 包装后的 ctx.skills 会把 review 过滤掉……
    expect((await ctx.skills.list({ cwd: project })).map(s => s.name)).toEqual(['api-design', 'modlens'])
    // ……但捕获下来的原始方法是"原样"的，面板就靠它区分"已屏蔽"和"不存在"。
    const raw = rawRegistry(ctx.skills, originals)
    expect((await raw.list({ cwd: project })).map(s => s.name)).toEqual(['review', 'api-design', 'modlens'])
    expect((await raw.snapshot({ cwd: project })).complete).toBe(true)
    await rm(project, { recursive: true, force: true })
  })
})
