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

  it('副本只要有一处有效，整行就不算未生效（issues 取并集但有效优先）', async () => {
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
