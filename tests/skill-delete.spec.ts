/**
 * skill-delete.ts 单测：全局删除的落盘层。
 *
 * 这一层是"删除"唯一的执行点，所以测试重点在**安全边界**而不是 happy path：
 * 越界路径必须拒绝、受保护根必须跳过、单点失败不能拖垮其它副本，而"删干净"
 * 这件事本身要真的发生（目录/文件都不再存在）。
 */
import { describe, expect, it } from 'vitest'
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertWithinRoot, deleteSkillCopies, type DeleteTarget } from '../src/skill-delete.ts'
import { SwitchError } from '../src/wire.ts'

/** 造一个临时根。 */
async function makeRoot(prefix = 'ss-del-'): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

/** 该路径是否还存在。 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe('assertWithinRoot', () => {
  it('拒绝根本身与逃出根的路径，放行根内路径', () => {
    expect(() => assertWithinRoot('/a/b', '/a/b')).toThrow(SwitchError)
    expect(() => assertWithinRoot('/a/b', '/a/bc/x')).toThrow(SwitchError)
    expect(() => assertWithinRoot('/a/b', '/a')).toThrow(SwitchError)
    expect(assertWithinRoot('/a/b', '/a/b/c')).toBe('/a/b/c')
  })

  it('越界抛的是 forbidden', () => {
    try {
      assertWithinRoot('/a/b', '/etc/passwd')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SwitchError)
      expect((error as SwitchError).code).toBe('forbidden')
      expect((error as SwitchError).status).toBe(403)
    }
  })
})

describe('deleteSkillCopies', () => {
  it('bundle 删目录、flat 删文件，多处副本一次清干净', async () => {
    const user = await makeRoot()
    const project = await makeRoot()
    await mkdir(join(user, 'doomed'), { recursive: true })
    await writeFile(join(user, 'doomed', 'SKILL.md'), '---\nname: doomed\ndescription: d\n---\n')
    await writeFile(join(project, 'doomed.md'), '---\nname: doomed\ndescription: d\n---\n')

    const targets: DeleteTarget[] = [
      { path: join(user, 'doomed', 'SKILL.md'), directory: join(user, 'doomed'), form: 'bundle', rootPath: user, source: 'user-dsh', deletable: true },
      { path: join(project, 'doomed.md'), directory: project, form: 'flat', rootPath: project, source: 'project-dsh', deletable: true },
    ]
    const outcome = await deleteSkillCopies(targets)
    expect(outcome.removed).toEqual([join(user, 'doomed'), join(project, 'doomed.md')])
    expect(outcome.skipped).toEqual([])
    expect(await exists(join(user, 'doomed'))).toBe(false)
    expect(await exists(join(project, 'doomed.md'))).toBe(false)
    await rm(user, { recursive: true, force: true })
    await rm(project, { recursive: true, force: true })
  })

  it('受保护根只跳过，不阻断其它可删副本', async () => {
    const user = await makeRoot()
    const bundled = await makeRoot()
    await mkdir(join(user, 'mixed'), { recursive: true })
    await writeFile(join(user, 'mixed', 'SKILL.md'), '---\nname: mixed\ndescription: d\n---\n')
    await mkdir(join(bundled, 'mixed'), { recursive: true })
    await writeFile(join(bundled, 'mixed', 'SKILL.md'), '---\nname: mixed\ndescription: d\n---\n')

    const outcome = await deleteSkillCopies([
      { path: join(user, 'mixed', 'SKILL.md'), directory: join(user, 'mixed'), form: 'bundle', rootPath: user, source: 'user-dsh', deletable: true },
      { path: join(bundled, 'mixed', 'SKILL.md'), directory: join(bundled, 'mixed'), form: 'bundle', rootPath: bundled, source: 'bundled', deletable: false },
    ])
    expect(outcome.removed).toEqual([join(user, 'mixed')])
    expect(outcome.skipped).toEqual([
      { path: join(bundled, 'mixed', 'SKILL.md'), source: 'bundled', reason: 'protected' },
    ])
    expect(await exists(join(bundled, 'mixed'))).toBe(true)
    await rm(user, { recursive: true, force: true })
    await rm(bundled, { recursive: true, force: true })
  })

  it('全部副本受保护 -> protected 403', async () => {
    const bundled = await makeRoot()
    await mkdir(join(bundled, 'ro'), { recursive: true })
    await writeFile(join(bundled, 'ro', 'SKILL.md'), 'x')
    await expect(deleteSkillCopies([
      { path: join(bundled, 'ro', 'SKILL.md'), directory: join(bundled, 'ro'), form: 'bundle', rootPath: bundled, source: 'bundled', deletable: false },
    ])).rejects.toMatchObject({ code: 'protected', status: 403 })
    await rm(bundled, { recursive: true, force: true })
  })

  it('副本都已不存在 -> not-found 404', async () => {
    const user = await makeRoot()
    await expect(deleteSkillCopies([
      { path: join(user, 'gone', 'SKILL.md'), directory: join(user, 'gone'), form: 'bundle', rootPath: user, source: 'user-dsh', deletable: true },
    ])).rejects.toMatchObject({ code: 'not-found', status: 404 })
    await rm(user, { recursive: true, force: true })
  })

  it('目标逃出所属根 -> 拒绝（forbidden），绝不误删', async () => {
    const user = await makeRoot()
    const outside = await makeRoot()
    await mkdir(join(outside, 'keep'), { recursive: true })
    await writeFile(join(outside, 'keep', 'SKILL.md'), 'x')
    await expect(deleteSkillCopies([
      {
        path: join('..', '..', 'etc', 'passwd'),
        directory: join(outside, 'keep'),
        form: 'bundle',
        rootPath: user,
        source: 'user-dsh',
        deletable: true,
      },
    ])).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    expect(await exists(join(outside, 'keep'))).toBe(true)
    await rm(user, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('重复删除是幂等的：第二次报 not-found 而不是抛别的错', async () => {
    const user = await makeRoot()
    await mkdir(join(user, 'twice'), { recursive: true })
    await writeFile(join(user, 'twice', 'SKILL.md'), 'x')
    const target: DeleteTarget = {
      path: join(user, 'twice', 'SKILL.md'),
      directory: join(user, 'twice'),
      form: 'bundle',
      rootPath: user,
      source: 'user-dsh',
      deletable: true,
    }
    expect((await deleteSkillCopies([target])).removed).toHaveLength(1)
    await expect(deleteSkillCopies([target])).rejects.toMatchObject({ code: 'not-found' })
    await rm(user, { recursive: true, force: true })
  })
})
