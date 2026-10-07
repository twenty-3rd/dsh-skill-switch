/**
 * 全局删除的落盘层：把一次删除请求要动的每一处副本都当成不可信输入来校验。
 *
 * 三条硬约束：
 * 1. 只删**已知根之内**的路径——任何解析后逃出所属根的路径都拒绝（403）。
 * 2. 只删**声明可删**的根——内置（bundled）根永远拒绝；共享根是否可删由
 *    配置决定（allowSharedRootWrites）。
 * 3. 绝不删根目录本身。
 *
 * 删除是幂等的：某一处副本已经不在时记为 skipped('missing')，不算失败，
 * 只要至少删掉一处就算成功。
 */
import { realpath, rm, stat } from 'node:fs/promises'
import { dirname, resolve as resolvePath, sep } from 'node:path'
import type { SkillForm, SkillRootSource } from './skill-scan.ts'
import { SwitchError } from './wire.ts'

/** 一处待删除的副本。 */
export interface DeleteTarget {
  /** SKILL.md（bundle）或 <name>.md（flat）的绝对路径。 */
  path: string
  /** bundle 的目录；flat 忽略。 */
  directory: string
  form: SkillForm
  /** 所属根的绝对路径。 */
  rootPath: string
  source: SkillRootSource
  /** 该根是否允许删除。 */
  deletable: boolean
}

/** 单处副本的处理结果原因。 */
export type SkipReason = 'protected' | 'outside-root' | 'missing' | 'error'

/** 一次全局删除的结果。 */
export interface DeleteOutcome {
  /** 真正被删除的路径（bundle 为目录，flat 为文件）。 */
  removed: string[]
  /** 未删除的副本及其原因。 */
  skipped: Array<{ path: string; source: SkillRootSource; reason: SkipReason; message?: string }>
}

/**
 * 断言 `candidate` 解析后严格位于 `root` 之内。
 * @param root - 所属根（绝对路径）。
 * @param candidate - 待校验路径。
 * @returns candidate 的解析结果。
 * @throws SwitchError('forbidden') 当目标是根本身或逃出根。
 */
export function assertWithinRoot(root: string, candidate: string): string {
  const rootResolved = resolvePath(root)
  const candidateResolved = resolvePath(candidate)
  if (candidateResolved === rootResolved) {
    throw new SwitchError('forbidden', `path "${candidate}" is the root itself`, 403)
  }
  if (!candidateResolved.startsWith(rootResolved + sep)) {
    throw new SwitchError('forbidden', `path "${candidate}" escapes root "${root}"`, 403)
  }
  return candidateResolved
}

/**
 * 断言 `candidate` 的**真实路径**（解析符号链接之后）仍位于 `root` 的真实路径之内。
 *
 * `assertWithinRoot` 只做字符串前缀比较：`<root>/linked/SKILL.md` 在字面上位于根内，
 * 但 `linked` 若是指向根外目录的符号链接，**写入**就会穿透到根外（删除不受影响，
 * `fs.rm` 只摘链接本身）。扫描层用 `stat`（会跟随链接）发现条目，所以写路径
 * （补齐 frontmatter）必须再做一次 realpath 校验。
 *
 * 只校验父目录的真实路径：文件本身是符号链接时，`writeFileAtomic` 的
 * 「同目录临时文件 + rename」替换的是链接本身，不会写进链接目标。
 *
 * @param root - 所属根（绝对路径，必须已存在）。
 * @param candidate - 待写入的文件路径。
 * @returns 父目录的真实路径。
 * @throws SwitchError('forbidden') 当父目录的真实路径逃出根。
 */
export async function assertRealPathWithinRoot(root: string, candidate: string): Promise<string> {
  const realRoot = await realpath(resolvePath(root))
  const realDir = await realpath(dirname(resolvePath(candidate)))
  if (realDir !== realRoot && !realDir.startsWith(realRoot + sep)) {
    throw new SwitchError('forbidden', `path "${candidate}" resolves outside root "${root}" (symlinked directory?)`, 403)
  }
  return realDir
}

/** 删除一处副本（已通过根校验）。 */
async function removeOne(target: DeleteTarget): Promise<string> {
  const withinPath = assertWithinRoot(target.rootPath, target.path)
  if (target.form === 'bundle') {
    const withinDir = assertWithinRoot(target.rootPath, target.directory)
    await rm(withinDir, { recursive: true, force: false })
    return withinDir
  }
  await rm(withinPath, { recursive: false, force: false })
  return withinPath
}

/**
 * 逐个删除副本；单点失败不阻断其余副本，但至少要删掉一处。
 * @param targets - 已由服务端扫描得到的副本清单（客户端不参与路径推导）。
 * @returns 删除结果。
 * @throws SwitchError('not-found') 当所有副本都不存在。
 * @throws SwitchError('protected') 当所有存在的副本都属于受保护根。
 */
export async function deleteSkillCopies(targets: DeleteTarget[]): Promise<DeleteOutcome> {
  const outcome: DeleteOutcome = { removed: [], skipped: [] }
  for (const target of targets) {
    if (!target.deletable) {
      outcome.skipped.push({ path: target.path, source: target.source, reason: 'protected' })
      continue
    }
    try {
      assertWithinRoot(target.rootPath, target.path)
      if (target.form === 'bundle') assertWithinRoot(target.rootPath, target.directory)
    } catch (error) {
      outcome.skipped.push({
        path: target.path,
        source: target.source,
        reason: 'outside-root',
        message: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    if (!(await pathExists(target.form === 'bundle' ? target.directory : target.path))) {
      outcome.skipped.push({ path: target.path, source: target.source, reason: 'missing' })
      continue
    }
    try {
      outcome.removed.push(await removeOne(target))
    } catch (error) {
      outcome.skipped.push({
        path: target.path,
        source: target.source,
        reason: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (outcome.removed.length === 0) {
    const protectedOnly = outcome.skipped.length > 0 && outcome.skipped.every(item => item.reason === 'protected')
    if (protectedOnly) {
      throw new SwitchError('protected', 'every copy of this skill lives in a protected root', 403)
    }
    // 只要有一处是越界目标就按 forbidden 报，别把安全拒绝伪装成"没找到"。
    if (outcome.skipped.some(item => item.reason === 'outside-root')) {
      throw new SwitchError('forbidden', 'refused: a delete target resolves outside its skill root', 403)
    }
    throw new SwitchError('not-found', 'no copy of this skill exists on disk anymore', 404)
  }
  return outcome
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
