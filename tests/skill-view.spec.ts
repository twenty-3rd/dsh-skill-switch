/**
 * skill-view.ts 单测：把「磁盘上有什么」与「runtime 认了什么」两路事实合成
 * 一张面板表。
 *
 * 关键回归点：面板必须拿**未过滤**的 runtime 目录做对照——否则被屏蔽的
 * skill 会被标成 inCatalog:false，"已屏蔽"和"根本不存在"就分不出来了。
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SwitchSkillRegistry, SwitchSkillSummary } from '../src/context-types.ts'
import { listSkills } from '../src/skill-view.ts'
import type { SkillRootSpec } from '../src/skill-scan.ts'
import type { SwitchState } from '../src/switches.ts'

/** 造一个临时 skill 根。 */
async function makeRoot(files: Record<string, string>, prefix = 'ss-view-'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content)
  }
  return root
}

/** 骨架 skill 注册表：只实现 snapshot（面板唯一读的入口）。 */
function fakeRegistry(skills: SwitchSkillSummary[], complete = true): SwitchSkillRegistry {
  return {
    snapshot: async () => ({ skills, complete }),
    list: async () => skills,
    get: async () => undefined,
  }
}

/** 会抛错的注册表：验证降级路径。 */
function brokenRegistry(): SwitchSkillRegistry {
  return {
    snapshot: async () => { throw new Error('registry exploded') },
    list: async () => [],
    get: async () => undefined,
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const DENY_REVIEW: SwitchState = {
  present: true,
  mode: 'deny',
  off: new Set(['review']),
  on: new Set(),
  ignored: [],
}

describe('listSkills：磁盘 × runtime 合成', () => {
  it('磁盘有、runtime 也认：inCatalog 为 true，来源/描述取磁盘', async () => {
    const root = await makeRoot({ 'review/SKILL.md': '---\nname: review\ndescription: 磁盘描述\n---\n' })
    const view = await listSkills({
      skills: fakeRegistry([
        { name: 'review', description: 'runtime 描述', source: 'user-dsh', provider: 'filesystem', path: join(root, 'review', 'SKILL.md') },
      ]),
      cwd: root,
      roots: [{ path: root, source: 'user-dsh', rank: 400, live: true, deletable: true }],
      state: undefined,
      pathExists,
    })
    const row = view.skills.find(s => s.name === 'review')
    expect(row?.inCatalog).toBe(true)
    expect(row?.provider).toBe('filesystem')
    expect(row?.catalogSource).toBe('user-dsh')
    expect(row?.form).toBe('bundle')
    expect(row?.copies).toHaveLength(1)
    expect(view.catalogComplete).toBe(true)
    await rm(root, { recursive: true, force: true })
  })

  it('被屏蔽的 skill 仍然在表里，并且 inCatalog 仍为 true（面板看到的是完整事实）', async () => {
    const root = await makeRoot({ 'review/SKILL.md': '---\nname: review\ndescription: d\n---\n' })
    const view = await listSkills({
      skills: fakeRegistry([{ name: 'review', description: 'd', source: 'user-dsh', provider: 'filesystem' }]),
      cwd: root,
      roots: [{ path: root, source: 'user-dsh', rank: 400, live: true, deletable: true }],
      state: DENY_REVIEW,
      pathExists,
    })
    const row = view.skills.find(s => s.name === 'review')
    expect(row?.blocked).toBe(true)
    expect(row?.inCatalog).toBe(true)
    await rm(root, { recursive: true, force: true })
  })

  it('磁盘有、runtime 不认（缺 name/description）：inCatalog false 且带 issues', async () => {
    const root = await makeRoot({ 'ghost/SKILL.md': '# 没有 frontmatter\n\n描述行\n' })
    const view = await listSkills({
      skills: fakeRegistry([]),
      cwd: root,
      roots: [{ path: root, source: 'user-dsh', rank: 400, live: true, deletable: true }],
      state: undefined,
      pathExists,
    })
    const row = view.skills.find(s => s.name === 'ghost')
    expect(row?.inCatalog).toBe(false)
    expect(row?.issues).toEqual(['missing-frontmatter'])
    expect(row?.description).toBe('没有 frontmatter')
    await rm(root, { recursive: true, force: true })
  })

  it('目录缓存残留：注册表还记着、文件已被删除的条目不再展示（"删掉就看不见"）', async () => {
    const root = await makeRoot({})
    const view = await listSkills({
      skills: fakeRegistry([
        {
          name: 'just-deleted',
          description: '已经不在磁盘上',
          source: 'user-dsh',
          provider: 'filesystem',
          path: join(root, 'just-deleted', 'SKILL.md'),
        },
      ]),
      cwd: root,
      roots: [{ path: root, source: 'user-dsh', rank: 400, live: true, deletable: true }],
      state: undefined,
      pathExists,
    })
    expect(view.skills.some(s => s.name === 'just-deleted')).toBe(false)
    await rm(root, { recursive: true, force: true })
  })

  it('虚拟 skill 没有 path 时不做存在性校验（照常展示）', async () => {
    const root = await makeRoot({})
    const view = await listSkills({
      skills: fakeRegistry([
        { name: 'pure-virtual', description: '没有 path', source: 'runtime', provider: 'runtime-provider' },
      ]),
      cwd: root,
      roots: [{ path: root, source: 'user-dsh', rank: 400, live: true, deletable: true }],
      state: undefined,
      pathExists,
    })
    expect(view.skills.some(s => s.name === 'pure-virtual')).toBe(true)
    await rm(root, { recursive: true, force: true })
  })

  it('只在 runtime 里存在的虚拟 skill：可屏蔽、不可删、无副本', async () => {
    const root = await makeRoot({})
    const view = await listSkills({
      skills: fakeRegistry([
        { name: 'virtual-skill', description: '由别的 provider 注册', source: 'runtime', provider: 'runtime-provider' },
      ]),
      cwd: root,
      roots: [{ path: root, source: 'user-dsh', rank: 400, live: true, deletable: true }],
      state: undefined,
      pathExists,
    })
    const row = view.skills.find(s => s.name === 'virtual-skill')
    expect(row?.form).toBe('virtual')
    expect(row?.deletable).toBe(false)
    expect(row?.copies).toEqual([])
    expect(row?.blockable).toBe(true)
    expect(row?.path).toBeUndefined()
    await rm(root, { recursive: true, force: true })
  })

  it('同名多处副本合成一行：低 rank 胜出，copies 全量保留', async () => {
    const project = await makeRoot({ 'dup/SKILL.md': '---\nname: dup\ndescription: 项目版\n---\n' }, 'ss-vp-')
    const user = await makeRoot({ 'dup/SKILL.md': '---\nname: dup\ndescription: 用户版\n---\n' }, 'ss-vu-')
    const roots: SkillRootSpec[] = [
      { path: user, source: 'user-dsh', rank: 400, live: true, deletable: true },
      { path: project, source: 'project-dsh', rank: 100, live: true, deletable: true },
    ]
    const view = await listSkills({ skills: fakeRegistry([]), cwd: project, roots, state: undefined, pathExists })
    const rows = view.skills.filter(s => s.name === 'dup')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.source).toBe('project-dsh')
    expect(rows[0]?.description).toBe('项目版')
    expect(rows[0]?.copies.map(c => c.source)).toEqual(['project-dsh', 'user-dsh'])
    expect(view.roots.map(r => r.source)).toEqual(['project-dsh', 'user-dsh'])
    await rm(project, { recursive: true, force: true })
    await rm(user, { recursive: true, force: true })
  })

  it('副本只要有一处 frontmatter 正常，整行就不算出错（issues 取并集但正常优先）', async () => {
    const good = await makeRoot({ 'dup/SKILL.md': '---\nname: dup\ndescription: d\n---\n' }, 'ss-vg-')
    const bad = await makeRoot({ 'dup/SKILL.md': '# 坏的\n' }, 'ss-vb-')
    const roots: SkillRootSpec[] = [
      { path: bad, source: 'user-dsh', rank: 400, live: true, deletable: true },
      { path: good, source: 'project-dsh', rank: 100, live: true, deletable: true },
    ]
    const view = await listSkills({ skills: fakeRegistry([]), cwd: good, roots, state: undefined, pathExists })
    const row = view.skills.find(s => s.name === 'dup')
    expect(row?.issues).toEqual([])
    expect(row?.copies).toHaveLength(2)
    expect(row?.copies.find(c => c.source === 'user-dsh')?.issues).toEqual(['missing-frontmatter'])
    await rm(good, { recursive: true, force: true })
    await rm(bad, { recursive: true, force: true })
  })

  it('runtime 目录不可用时降级为"只有磁盘事实"，不整体抛错', async () => {
    const root = await makeRoot({ 'solo/SKILL.md': '---\nname: solo\ndescription: d\n---\n' })
    const view = await listSkills({
      skills: brokenRegistry(),
      cwd: root,
      roots: [{ path: root, source: 'user-dsh', rank: 400, live: true, deletable: true }],
      state: undefined,
      pathExists,
    })
    expect(view.catalogComplete).toBe(false)
    expect(view.skills.map(s => s.name)).toEqual(['solo'])
    expect(view.skills[0]?.inCatalog).toBe(false)
    await rm(root, { recursive: true, force: true })
  })

  it('根的 exists 标记如实反映磁盘', async () => {
    const root = await makeRoot({})
    const view = await listSkills({
      skills: fakeRegistry([]),
      cwd: root,
      roots: [
        { path: root, source: 'user-dsh', rank: 400, live: true, deletable: true },
        { path: join(root, 'nope'), source: 'custom', rank: 300, live: true, deletable: true },
      ],
      state: undefined,
      pathExists,
    })
    expect(view.roots.find(r => r.source === 'user-dsh')?.exists).toBe(true)
    expect(view.roots.find(r => r.source === 'custom')?.exists).toBe(false)
    await rm(root, { recursive: true, force: true })
  })
})

describe('listSkills：有效/错误判定（A 在目录里 ∧ B 模型可调用 ∧ C 用户可调用）', () => {
  /** 一个记录调用参数的注册表：用来断言 scope 真的透传下去了。 */
  function recordingRegistry(skills: SwitchSkillSummary[]): {
    registry: SwitchSkillRegistry
    seen: Array<{ cwd?: string; scope?: object }>
  } {
    const seen: Array<{ cwd?: string; scope?: object }> = []
    return {
      seen,
      registry: {
        snapshot: async (options) => {
          seen.push(options ?? {})
          return { skills, complete: true }
        },
        list: async () => skills,
        get: async () => undefined,
      },
    }
  }

  const scopeKey = { fakeScope: true }

  it('带 scope、目录里有它、B/C 都允许 -> 有效（errors 为空）', async () => {
    const root = await makeRoot({ 'review/SKILL.md': '---\nname: review\ndescription: d\n---\n' })
    const view = await listSkills({
      skills: fakeRegistry([
        { name: 'review', description: 'd', source: 'user-dsh', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: true } },
      ]),
      cwd: root,
      scope: scopeKey,
      roots: [{ path: root, source: 'user-dsh', rank: 400, live: true, deletable: true }],
      state: undefined,
      pathExists,
    })
    const row = view.skills.find(s => s.name === 'review')
    expect(view.verdictAvailable).toBe(true)
    expect(row?.errors).toEqual([])
    expect(row?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    await rm(root, { recursive: true, force: true })
  })

  it('带 scope 但目录里没有 -> 错误：not-in-registry（A 不成立）', async () => {
    const root = await makeRoot({ 'ghost/SKILL.md': '---\nname: ghost\ndescription: d\n---\n' })
    const view = await listSkills({
      skills: fakeRegistry([]),
      cwd: root,
      scope: scopeKey,
      roots: [{ path: root, source: 'user-dsh', rank: 400, live: true, deletable: true }],
      state: undefined,
      pathExists,
    })
    const row = view.skills.find(s => s.name === 'ghost')
    expect(view.verdictAvailable).toBe(true)
    expect(row?.errors).toEqual(['not-in-registry'])
    await rm(root, { recursive: true, force: true })
  })

  it('目录里有但模型不可调用 -> model-not-invocable（B 不成立）', async () => {
    const root = await makeRoot({ 'review/SKILL.md': '---\nname: review\ndescription: d\n---\n' })
    const view = await listSkills({
      skills: fakeRegistry([
        { name: 'review', description: 'd', source: 'user-dsh', provider: 'filesystem', invocation: { modelInvocable: false, userInvocable: true } },
      ]),
      cwd: root,
      scope: scopeKey,
      roots: [{ path: root, source: 'user-dsh', rank: 400, live: true, deletable: true }],
      state: undefined,
      pathExists,
    })
    expect(view.skills.find(s => s.name === 'review')?.errors).toEqual(['model-not-invocable'])
    await rm(root, { recursive: true, force: true })
  })

  it('目录里有但用户不可调用 -> user-not-invocable（C 不成立）', async () => {
    const root = await makeRoot({ 'review/SKILL.md': '---\nname: review\ndescription: d\n---\n' })
    const view = await listSkills({
      skills: fakeRegistry([
        { name: 'review', description: 'd', source: 'user-dsh', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: false } },
      ]),
      cwd: root,
      scope: scopeKey,
      roots: [{ path: root, source: 'user-dsh', rank: 400, live: true, deletable: true }],
      state: undefined,
      pathExists,
    })
    expect(view.skills.find(s => s.name === 'review')?.errors).toEqual(['user-not-invocable'])
    await rm(root, { recursive: true, force: true })
  })

  it('目录里没带 invocation（版本漂移）-> 不报 B/C：不把"没读到"当成"不能调用"', async () => {
    const root = await makeRoot({ 'review/SKILL.md': '---\nname: review\ndescription: d\n---\n' })
    const view = await listSkills({
      skills: fakeRegistry([{ name: 'review', description: 'd', source: 'user-dsh', provider: 'filesystem' }]),
      cwd: root,
      scope: scopeKey,
      roots: [{ path: root, source: 'user-dsh', rank: 400, live: true, deletable: true }],
      state: undefined,
      pathExists,
    })
    const row = view.skills.find(s => s.name === 'review')
    expect(row?.errors).toEqual([])
    expect(row?.invocation).toBeUndefined()
    await rm(root, { recursive: true, force: true })
  })

  it('不带 scope -> verdictAvailable=false，且不把"读不到目录"当成错误', async () => {
    const root = await makeRoot({ 'review/SKILL.md': '---\nname: review\ndescription: d\n---\n' })
    const view = await listSkills({
      // 没有 scope 时注册表只给全局层（真实桌面端里几乎是空的）。
      skills: fakeRegistry([]),
      cwd: root,
      roots: [{ path: root, source: 'user-dsh', rank: 400, live: true, deletable: true }],
      state: undefined,
      pathExists,
    })
    expect(view.verdictAvailable).toBe(false)
    expect(view.skills.find(s => s.name === 'review')?.errors).toEqual([])
    await rm(root, { recursive: true, force: true })
  })

  it('scope 原样透传给注册表：面板读的必须是这个会话的目录', async () => {
    const root = await makeRoot({ 'review/SKILL.md': '---\nname: review\ndescription: d\n---\n' })
    const { registry, seen } = recordingRegistry([])
    await listSkills({
      skills: registry,
      cwd: root,
      scope: scopeKey,
      roots: [{ path: root, source: 'user-dsh', rank: 400, live: true, deletable: true }],
      state: undefined,
      pathExists,
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.scope).toBe(scopeKey)
    await rm(root, { recursive: true, force: true })
  })

  it('目录读取抛错 -> catalogError 且判定不可用（宁可不判定，也不全标错误）', async () => {
    const root = await makeRoot({ 'review/SKILL.md': '---\nname: review\ndescription: d\n---\n' })
    const view = await listSkills({
      skills: brokenRegistry(),
      cwd: root,
      scope: scopeKey,
      roots: [{ path: root, source: 'user-dsh', rank: 400, live: true, deletable: true }],
      state: undefined,
      pathExists,
    })
    expect(view.catalogError).toBe(true)
    expect(view.verdictAvailable).toBe(false)
    expect(view.skills[0]?.errors).toEqual([])
    await rm(root, { recursive: true, force: true })
  })

  it('虚拟条目（只在 runtime 里）也带判定：A 天然成立', async () => {
    const root = await makeRoot({})
    const view = await listSkills({
      skills: fakeRegistry([
        { name: 'virtual-skill', description: 'v', source: 'runtime', provider: 'p', invocation: { modelInvocable: true, userInvocable: false } },
      ]),
      cwd: root,
      scope: scopeKey,
      roots: [{ path: root, source: 'user-dsh', rank: 400, live: true, deletable: true }],
      state: undefined,
      pathExists,
    })
    const row = view.skills.find(s => s.name === 'virtual-skill')
    expect(row?.errors).toEqual(['user-not-invocable'])
    await rm(root, { recursive: true, force: true })
  })
})
