/**
 * skill-scan.ts 单测：容错发现层。
 *
 * 核心回归点（对应"注意点 3"）：官方 provider 会把缺 name / 缺 description /
 * YAML 坏掉的条目整条丢掉，本层必须仍然把它们扫出来，并如实记录 issues，
 * 让面板能显示被官方丢弃的条目（判定的 A 失败）以及原因，而不是像 dsh-skills-manager 那样看不见。
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  documentParts,
  firstMeaningfulLine,
  frontmatterKind,
  parseFrontmatter,
  repairFrontmatter,
  scanSkillRoot,
  scanSkillRoots,
  skillRoots,
  type SkillRootSpec,
} from '../src/skill-scan.ts'

/** 造一个临时 skill 根，写入给定文件后返回根路径。 */
async function makeRoot(files: Record<string, string>, prefix = 'ss-scan-'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content)
  }
  return root
}

/** 一个最小根规格。 */
function rootSpec(path: string, overrides: Partial<SkillRootSpec> = {}): SkillRootSpec {
  return { path, source: 'user-dsh', rank: 400, live: true, deletable: true, ...overrides }
}

describe('scanSkillRoot：容错发现', () => {
  it('完整 frontmatter 的 bundle/flat 都正常识别', async () => {
    const root = await makeRoot({
      'good/SKILL.md': '---\nname: good\ndescription: 一个正常的 skill\nwhenToUse: 需要时\n---\n\n正文\n',
      'flat-good.md': '---\nname: flat-good\ndescription: 扁平形态\n---\n\n正文\n',
    })
    const skills = await scanSkillRoot(rootSpec(root))
    expect(skills.map(s => s.name).sort()).toEqual(['flat-good', 'good'])
    const good = skills.find(s => s.name === 'good')
    expect(good?.form).toBe('bundle')
    expect(good?.directory).toBe(join(root, 'good'))
    expect(good?.path).toBe(join(root, 'good', 'SKILL.md'))
    expect(good?.issues).toEqual([])
    expect(good?.nameSource).toBe('frontmatter')
    expect(good?.descriptionSource).toBe('frontmatter')
    expect(good?.whenToUse).toBe('需要时')
    expect(good?.blockable).toBe(true)

    const flat = skills.find(s => s.name === 'flat-good')
    expect(flat?.form).toBe('flat')
    expect(flat?.entryName).toBe('flat-good')
    expect(flat?.directory).toBe(root)
    await rm(root, { recursive: true, force: true })
  })

  it('缺 description：仍可见，描述回退到正文首行', async () => {
    const root = await makeRoot({
      'no-desc/SKILL.md': '---\nname: no-desc\n---\n\n# 标题\n\n这段文字会被当成描述。\n',
    })
    const [skill] = await scanSkillRoot(rootSpec(root))
    expect(skill?.name).toBe('no-desc')
    expect(skill?.issues).toEqual(['missing-description'])
    expect(skill?.description).toBe('标题')
    expect(skill?.descriptionSource).toBe('body')
    await rm(root, { recursive: true, force: true })
  })

  it('缺 name：名字回退到目录名，并标记 missing-name', async () => {
    const root = await makeRoot({
      'fallback-name/SKILL.md': '---\ndescription: 只有描述\n---\n正文\n',
    })
    const [skill] = await scanSkillRoot(rootSpec(root))
    expect(skill?.name).toBe('fallback-name')
    expect(skill?.nameSource).toBe('entry')
    expect(skill?.entryName).toBe('fallback-name')
    expect(skill?.issues).toEqual(['missing-name'])
    expect(skill?.blockable).toBe(true)
    await rm(root, { recursive: true, force: true })
  })

  it('目录名不是 kebab-case 且没声明 name：依旧列出，但不可按名开关', async () => {
    const root = await makeRoot({
      'Bad Dir/SKILL.md': '---\ndescription: 目录名不合法\n---\n正文\n',
    })
    const [skill] = await scanSkillRoot(rootSpec(root))
    expect(skill?.name).toBe('Bad Dir')
    expect(skill?.issues).toEqual(expect.arrayContaining(['missing-name', 'invalid-entry-name']))
    expect(skill?.blockable).toBe(false)
    await rm(root, { recursive: true, force: true })
  })

  it('name 声明了但不是 kebab-case：照原样展示并标记 invalid-name', async () => {
    const root = await makeRoot({
      'weird/SKILL.md': '---\nname: Not_Kebab\ndescription: 描述\n---\n正文\n',
    })
    const [skill] = await scanSkillRoot(rootSpec(root))
    expect(skill?.name).toBe('Not_Kebab')
    expect(skill?.issues).toEqual(['invalid-name'])
    expect(skill?.blockable).toBe(false)
    await rm(root, { recursive: true, force: true })
  })

  it('完全没有 frontmatter：仍然列出，描述取自正文', async () => {
    const root = await makeRoot({
      'bare/SKILL.md': '# 一个没有 frontmatter 的 skill\n\n正文内容。\n',
    })
    const [skill] = await scanSkillRoot(rootSpec(root))
    expect(skill?.name).toBe('bare')
    expect(skill?.issues).toEqual(['missing-frontmatter'])
    expect(skill?.description).toBe('一个没有 frontmatter 的 skill')
    expect(skill?.descriptionSource).toBe('body')
    await rm(root, { recursive: true, force: true })
  })

  it('YAML 坏掉：标记 invalid-frontmatter，且仍能从围栏之后取描述', async () => {
    const root = await makeRoot({
      'broken/SKILL.md': '---\nname: [unclosed\ndescription: x\n---\n\n这段来自正文。\n',
    })
    const [skill] = await scanSkillRoot(rootSpec(root))
    expect(skill?.issues).toEqual(['invalid-frontmatter'])
    expect(skill?.description).toBe('这段来自正文。')
    expect(skill?.descriptionSource).toBe('body')
    await rm(root, { recursive: true, force: true })
  })

  it('跳过非 skill 条目：无 SKILL.md 的目录、非 .md 文件', async () => {
    const root = await makeRoot({
      'not-a-skill/README.md': 'x',
      'notes.txt': 'x',
      'real/SKILL.md': '---\nname: real\ndescription: d\n---\n',
    })
    const skills = await scanSkillRoot(rootSpec(root))
    expect(skills.map(s => s.name)).toEqual(['real'])
    await rm(root, { recursive: true, force: true })
  })

  it('.system 只在 skipSystem 的根里跳过（与官方 provider 一致）', async () => {
    const files = { '.system/SKILL.md': '---\nname: system\ndescription: d\n---\n' }
    const root = await makeRoot(files)
    expect((await scanSkillRoot(rootSpec(root, { skipSystem: true }))).length).toBe(0)
    expect((await scanSkillRoot(rootSpec(root))).length).toBe(1)
    await rm(root, { recursive: true, force: true })
  })

  it('根不存在时返回空数组，不抛错', async () => {
    expect(await scanSkillRoot(rootSpec(join(tmpdir(), 'definitely-missing-ss-root')))).toEqual([])
  })
})

describe('scanSkillRoots / skillRoots', () => {
  it('按 rank 升序汇总，低 rank 的副本排前面（胜出副本口径）', async () => {
    const project = await makeRoot({ 'dup/SKILL.md': '---\nname: dup\ndescription: 项目版\n---\n' }, 'ss-proj-')
    const user = await makeRoot({ 'dup/SKILL.md': '---\nname: dup\ndescription: 用户版\n---\n' }, 'ss-user-')
    const roots: SkillRootSpec[] = [
      { path: user, source: 'user-dsh', rank: 400, live: true, deletable: true },
      { path: project, source: 'project-dsh', rank: 100, live: true, deletable: true },
    ]
    const skills = await scanSkillRoots(roots)
    expect(skills.map(s => s.source)).toEqual(['project-dsh', 'user-dsh'])
    expect(skills[0]?.description).toBe('项目版')
    await rm(project, { recursive: true, force: true })
    await rm(user, { recursive: true, force: true })
  })

  it('根列表与官方 provider 的 rank/来源一致，内置根不可删', () => {
    const roots = skillRoots({
      projectRoot: '/proj',
      dshHome: '/home/.dsh',
      agentsHome: '/home/.agents',
      customSkillDirs: ['/custom'],
      bundledSkillDir: '/app/bundled',
    })
    expect(roots.map(r => [r.source, r.rank, r.live, r.deletable])).toEqual([
      ['project-dsh', 100, true, true],
      ['project-agents', 200, true, true],
      ['custom', 300, true, true],
      ['user-dsh', 400, true, true],
      ['user-agents', 500, true, true],
      ['bundled', 600, true, false],
      ['library', 1000, false, true],
    ])
    expect(roots[0]?.path).toBe(join('/proj', '.dsh', 'skills'))
    expect(roots[3]?.skipSystem).toBe(true)
    expect(roots[6]?.path).toBe(join('/home/.dsh', 'skill-library'))
  })

  it('allowSharedRootWrites=false 时共享根变只读（团队红线开关）', () => {
    const roots = skillRoots({
      dshHome: '/home/.dsh',
      agentsHome: '/home/.agents',
      allowSharedRootWrites: false,
    })
    expect(roots.find(r => r.source === 'user-agents')?.deletable).toBe(false)
    expect(roots.find(r => r.source === 'user-dsh')?.deletable).toBe(true)
  })
})

describe('documentParts / frontmatterKind / firstMeaningfulLine', () => {
  it('区分缺失、损坏与正常三种 frontmatter', () => {
    expect(frontmatterKind('# 没有围栏\n')).toBe('absent')
    expect(frontmatterKind('---\nname: [broken\n---\nbody')).toBe('invalid')
    expect(frontmatterKind('---\nname: ok\n---\nbody')).toBe('ok')
  })

  it('损坏时也能拿到围栏后的正文', () => {
    const parts = documentParts('---\nname: [broken\n---\n正文在这里\n')
    expect(parts.kind).toBe('invalid')
    expect(parts.body).toBe('正文在这里\n')
  })

  it('parseFrontmatter 只在正常时返回 data', () => {
    expect(parseFrontmatter('---\nname: ok\ndescription: d\n---\nbody')?.data.name).toBe('ok')
    expect(parseFrontmatter('---\nname: [broken\n---\nbody')).toBeUndefined()
    expect(parseFrontmatter('no fence')).toBeUndefined()
  })

  it('firstMeaningfulLine 跳过空行/代码围栏、剥掉 markdown 标记、超长截断', () => {
    expect(firstMeaningfulLine('\n\n```\ncode\n```\n\n## 真正的描述\n更多')).toBe('真正的描述')
    expect(firstMeaningfulLine('- 列表项')).toBe('列表项')
    expect(firstMeaningfulLine('   ')).toBe('')
    const long = firstMeaningfulLine('x'.repeat(300))
    expect(long.length).toBe(158)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('repairFrontmatter（"补齐 frontmatter"的落盘实现）', () => {
  it('没有 frontmatter：插到文首，正文一字不动', () => {
    const next = repairFrontmatter('# 标题\n\n正文\n', { name: 'bare', description: '补上的描述' })
    expect(frontmatterKind(next)).toBe('ok')
    const parsed = parseFrontmatter(next)
    expect(parsed?.data.name).toBe('bare')
    expect(parsed?.data.description).toBe('补上的描述')
    expect(parsed?.body).toBe('# 标题\n\n正文\n')
  })

  it('已有 frontmatter：补齐缺失字段并保留其它字段', () => {
    const next = repairFrontmatter('---\nlicense: MIT\nname: old\n---\n正文\n', { name: 'new-name', description: '新描述' })
    const parsed = parseFrontmatter(next)
    expect(parsed?.data.name).toBe('new-name')
    expect(parsed?.data.description).toBe('新描述')
    expect(parsed?.data.license).toBe('MIT')
    expect(parsed?.body).toBe('正文\n')
    // 只应有一段 frontmatter。
    expect(next.match(/^---$/gm)?.length).toBe(2)
  })

  it('frontmatter 坏掉：整段替换，不留下第二个围栏块', () => {
    const next = repairFrontmatter('---\nname: [broken\ndescription: x\n---\n正文\n', { name: 'fixed', description: 'd' })
    expect(frontmatterKind(next)).toBe('ok')
    expect(next.match(/^---$/gm)?.length).toBe(2)
    expect(parseFrontmatter(next)?.body).toBe('正文\n')
  })

  it('非法名字或空描述直接拒绝', () => {
    expect(() => repairFrontmatter('x', { name: 'Bad Name', description: 'd' })).toThrow(/invalid skill name/)
    expect(() => repairFrontmatter('x', { name: 'ok', description: '  ' })).toThrow(/description/)
  })

  it('多行描述折成单行，YAML 特殊字符会被引号包住', () => {
    const next = repairFrontmatter('body', { name: 'ok', description: 'a: b\nc' })
    expect(frontmatterKind(next)).toBe('ok')
    expect(parseFrontmatter(next)?.data.description).toBe('a: b c')
  })
})

describe('readSkillRaw 的读取口径', () => {
  it('读回的原文可被 scan 复用（回归：修复后应变为 ok）', async () => {
    const root = await makeRoot({ 'fixme/SKILL.md': '# 只有正文\n\n描述行\n' })
    const [skill] = await scanSkillRoot(rootSpec(root))
    expect(skill?.issues).toEqual(['missing-frontmatter'])
    const raw = await readFile(skill!.path, 'utf8')
    const next = repairFrontmatter(raw, { name: 'fixme', description: skill!.description })
    await writeFile(skill!.path, next)
    const [after] = await scanSkillRoot(rootSpec(root))
    expect(after?.issues).toEqual([])
    expect(after?.name).toBe('fixme')
    await rm(root, { recursive: true, force: true })
  })
})

describe('与官方 provider 的判定口径对齐（回归）', () => {
  it('数字型 name/description 官方不认：必须报 missing，而不是显示成正常', async () => {
    const root = await makeRoot({
      // 官方 stringField 只接受非空 string，数字会被当成"字段不存在"。
      'num-desc/SKILL.md': '---\nname: num-desc\ndescription: 123\n---\n正文\n',
      '123/SKILL.md': '---\nname: 123\ndescription: d\n---\n正文\n',
    })
    const skills = await scanSkillRoot(rootSpec(root))
    const numDesc = skills.find(s => s.name === 'num-desc')
    expect(numDesc?.issues).toEqual(['missing-description'])
    // 名字回退到目录名（目录名 123 恰好是合法 kebab-case），并报 missing-name。
    const numName = skills.find(s => s.entryName === '123')
    expect(numName?.issues).toEqual(['missing-name'])
    expect(numName?.nameSource).toBe('entry')
    await rm(root, { recursive: true, force: true })
  })

  it('纯空白的 description 官方**接受**：不能误报成出错', async () => {
    const root = await makeRoot({ 'blank-desc/SKILL.md': '---\nname: blank-desc\ndescription: "   "\n---\n正文\n' })
    const [skill] = await scanSkillRoot(rootSpec(root))
    expect(skill?.issues).toEqual([])
    expect(skill?.descriptionSource).toBe('frontmatter')
    await rm(root, { recursive: true, force: true })
  })

  it('invocation 字段非法（含遗留键）官方会丢掉整条：必须报 invalid-invocation', async () => {
    const root = await makeRoot({
      'legacy-key/SKILL.md': '---\nname: legacy-key\ndescription: d\ndisableModelInvocation: true\n---\n正文\n',
      'bad-bool/SKILL.md': '---\nname: bad-bool\ndescription: d\nuser-invocable: maybe\n---\n正文\n',
      'ok-bool/SKILL.md': '---\nname: ok-bool\ndescription: d\ndisable-model-invocation: true\nuser-invocable: "no"\n---\n正文\n',
    })
    const skills = await scanSkillRoot(rootSpec(root))
    expect(skills.find(s => s.name === 'legacy-key')?.issues).toEqual(['invalid-invocation'])
    expect(skills.find(s => s.name === 'bad-bool')?.issues).toEqual(['invalid-invocation'])
    // 合法的布尔形状（含 1/0、true/false/yes/no/on/off）不受影响。
    expect(skills.find(s => s.name === 'ok-bool')?.issues).toEqual([])
    await rm(root, { recursive: true, force: true })
  })
})

describe('repairFrontmatter：不吞正文（回归）', () => {
  it('开头是 --- 但没有收尾围栏：只把新 frontmatter 插到最前，原文一字不丢', () => {
    const raw = '---\nname: [broken\nimportant: 正文不能被吃掉\n'
    const next = repairFrontmatter(raw, { name: 'rescued', description: '补上的描述' })
    expect(next.startsWith('---\nname: rescued\n')).toBe(true)
    // 原文完整保留在后面。
    expect(next).toContain('important: 正文不能被吃掉')
    expect(next).toContain('name: [broken')
  })
})
