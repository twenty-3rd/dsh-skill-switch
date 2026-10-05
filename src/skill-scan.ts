/**
 * 文件系统 skill 发现层（容错版）。
 *
 * 为什么不用 `ctx.skills.snapshot()` 直接当数据源：
 * 官方的 `@deepseek-ai/dsh-skill-filesystem` 会把 frontmatter 缺 `name` 或
 * `description`、YAML 解析失败、名字不合法的 skill **整条丢掉**（只留一条
 * warn 日志）。结果就是它们在 dsh-skills-manager 一类的面板里完全不可见，
 * 用户既看不到、也修不了——这正是本项目要优化的一点。
 *
 * 本模块按与官方 provider **相同的根与 rank** 扫描磁盘，但对每条候选做
 * 容错解析：
 * - 名字：优先 frontmatter `name`，缺失时回退到目录名 / 文件名（kebab-case 时）
 * - 描述：优先 frontmatter `description`，缺失时回退到正文第一段有意义的文字
 * - 任何导致官方 provider 忽略该条目的原因都记进 `issues`，面板据此展示
 *   「未生效」徽标与原因，并提供「补齐 frontmatter」修复入口
 *
 * 根与 rank（数字越小优先级越高），对齐 dsh-skill-filesystem 的 roots()：
 *   project .dsh/skills (100) → project .agents/skills (200) → custom (300)
 *   → ~/.dsh/skills (400) → ~/.agents/skills (500) → bundled (600)
 * 另外把 <$DSH_HOME>/skill-library 作为**非 runtime** 根列出（rank 1000），
 * 这样「全局删除」能一次清干净 dsh-skills-manager 留下的规范副本。
 */

import { access, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'
import { parse as parseYaml } from 'yaml'
import { isSkillName, SKILL_NAME } from './switches.ts'

/** 磁盘上的 skill 来源，取值与官方 SkillSource 一致（外加库与非 runtime 语义）。 */
export type SkillRootSource =
  | 'project-dsh'
  | 'project-agents'
  | 'custom'
  | 'user-dsh'
  | 'user-agents'
  | 'bundled'
  | 'library'

/** skill 的落盘形态：目录 bundle（含 SKILL.md）或单文件 <name>.md。 */
export type SkillForm = 'bundle' | 'flat'

/** 一个候选条目被官方 provider 忽略的原因（面板据此解释「未生效」）。 */
export type SkillIssue =
  | 'missing-frontmatter'
  | 'invalid-frontmatter'
  | 'missing-name'
  | 'invalid-name'
  | 'missing-description'
  | 'invalid-entry-name'

/** 一个被扫描的 skill 根。 */
export interface SkillRootSpec {
  /** 根的绝对路径。 */
  path: string
  source: SkillRootSource
  /** 数字越小优先级越高（与官方 provider 一致）。 */
  rank: number
  /** 是否属于 runtime 目录（官方 provider 会扫描并注入的根）。 */
  live: boolean
  /** 面板是否允许在该根下删除 skill。 */
  deletable: boolean
  /** 是否跳过 `.system` 目录（只有 DSH 用户根这么做）。 */
  skipSystem?: boolean
}

/** 构建根列表的输入（全部为已解析的绝对路径）。 */
export interface SkillRootOptions {
  /** 会话 cwd 对应的项目根；省略则不包含项目级根。 */
  projectRoot?: string
  /** DSH 家目录（默认 resolveDshHome()）。 */
  dshHome: string
  /** 共享 agent 家目录（默认 $DSH_AGENTS_HOME 或 ~/.agents）。 */
  agentsHome: string
  /** 额外根（config.customSkillDirs）。 */
  customSkillDirs?: string[]
  /** 内置 skill 根（config.bundledSkillDir，通常是 $DSH_BUNDLED_SKILL_DIR）。 */
  bundledSkillDir?: string
  /** 是否把共享根 (~/.agents/skills) 也视为可删。默认 true（用户已确认）。 */
  allowSharedRootWrites?: boolean
}

/**
 * 按官方 provider 的口径构建 skill 根列表，外加非 runtime 的库根。
 * @param options - 已解析的路径配置。
 * @returns 根列表（含 rank / live / deletable 元数据）。
 */
export function skillRoots(options: SkillRootOptions): SkillRootSpec[] {
  const roots: SkillRootSpec[] = []
  if (options.projectRoot !== undefined) {
    roots.push(
      { path: join(options.projectRoot, '.dsh', 'skills'), source: 'project-dsh', rank: 100, live: true, deletable: true },
      { path: join(options.projectRoot, '.agents', 'skills'), source: 'project-agents', rank: 200, live: true, deletable: true },
    )
  }
  for (const dir of options.customSkillDirs ?? []) {
    roots.push({ path: resolvePath(dir), source: 'custom', rank: 300, live: true, deletable: true })
  }
  roots.push({ path: join(options.dshHome, 'skills'), source: 'user-dsh', rank: 400, live: true, deletable: true, skipSystem: true })
  roots.push({
    path: join(options.agentsHome, 'skills'),
    source: 'user-agents',
    rank: 500,
    live: true,
    // 共享根默认也可删（本插件 v0.2 的显式选择）；把 allowSharedRootWrites
    // 置 false 即可把它变回只读，兼容"共享根禁止修改"的团队约定。
    deletable: options.allowSharedRootWrites !== false,
  })
  if (options.bundledSkillDir !== undefined && options.bundledSkillDir !== '') {
    // 内置 skill 随宿主应用分发，删了会破坏安装本身——永远不可删。
    roots.push({ path: resolvePath(options.bundledSkillDir), source: 'bundled', rank: 600, live: true, deletable: false })
  }
  roots.push({ path: join(options.dshHome, 'skill-library'), source: 'library', rank: 1000, live: false, deletable: true, skipSystem: true })
  return roots
}

/** 默认共享 agent 家目录。 */
export function defaultAgentsHome(): string {
  const fromEnv = process.env.DSH_AGENTS_HOME
  return fromEnv !== undefined && fromEnv !== '' ? resolvePath(fromEnv) : join(homedir(), '.agents')
}

/** 一个扫描出来的 skill 候选（容错解析结果）。 */
export interface ScannedSkill {
  /** 有效名字：frontmatter name 优先，否则回退到条目名。 */
  name: string
  /** frontmatter 里声明的原始名字（若有）。 */
  declaredName?: string
  /** 条目名：bundle 的目录名或 flat 文件名去掉 .md（「补齐 frontmatter」时的候选名）。 */
  entryName: string
  /** 名字的来源，面板用来说明「名字取自目录名」。 */
  nameSource: 'frontmatter' | 'entry'
  /** 展示用描述：frontmatter > 正文首段 > 空串。 */
  description: string
  /** 描述的来源：空串时为 'none'。 */
  descriptionSource: 'frontmatter' | 'body' | 'none'
  whenToUse?: string
  /** SKILL.md（bundle）或 <name>.md（flat）的绝对路径。 */
  path: string
  /** bundle 的目录；flat 为该根目录。 */
  directory: string
  form: SkillForm
  /** 所属根的绝对路径。 */
  rootPath: string
  source: SkillRootSource
  rank: number
  /** 是否属于 runtime 目录。 */
  live: boolean
  /** 是否允许删除。 */
  deletable: boolean
  /** 让官方 provider 忽略该条目的原因；空数组表示会被正常加载。 */
  issues: SkillIssue[]
  /** 名字是否为合法 kebab-case（决定能否写开关文件 / 按名删除）。 */
  blockable: boolean
}

/** frontmatter 解析结果。 */
interface FrontmatterParse {
  data: Record<string, unknown>
  body: string
}

/**
 * 扫描一个根下的全部候选（容错，不丢弃"官方会忽略"的条目）。
 * 根不存在或不可读时返回空数组；单个条目读失败只跳过该条目。
 * @param root - 根规格。
 * @returns 按条目名排序的候选数组。
 */
export async function scanSkillRoot(root: SkillRootSpec): Promise<ScannedSkill[]> {
  let entries
  try {
    entries = await readdir(root.path, { withFileTypes: true })
  } catch {
    return []
  }
  const names = entries.map(entry => entry.name).sort((a, b) => a.localeCompare(b))
  const skills: ScannedSkill[] = []
  for (const name of names) {
    if (root.skipSystem === true && name === '.system') continue
    const full = join(root.path, name)
    let kind: 'directory' | 'file' | undefined
    try {
      const info = await stat(full)
      kind = info.isDirectory() ? 'directory' : info.isFile() ? 'file' : undefined
    } catch {
      continue
    }
    const isBundle = kind === 'directory'
    if (!isBundle && !(kind === 'file' && name.endsWith('.md'))) continue
    const path = isBundle ? join(full, 'SKILL.md') : full
    try {
      await access(path)
    } catch {
      // 目录下没有 SKILL.md：不是 skill 条目（官方 provider 同样跳过）。
      continue
    }
    const entryName = isBundle ? name : name.slice(0, -'.md'.length)
    skills.push(await readCandidate(path, entryName, isBundle ? 'bundle' : 'flat', isBundle ? full : root.path, root))
  }
  return skills
}

/** 扫描一批根，按 rank 升序返回（同 rank 按根路径稳定排序）。 */
export async function scanSkillRoots(roots: SkillRootSpec[]): Promise<ScannedSkill[]> {
  const ordered = [...roots].sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path))
  const out: ScannedSkill[] = []
  for (const root of ordered) out.push(...await scanSkillRoot(root))
  return out
}

/** 读取并容错解析一个候选 skill 文件。 */
export async function readCandidate(
  path: string,
  entryName: string,
  form: SkillForm,
  directory: string,
  root: SkillRootSpec,
): Promise<ScannedSkill> {
  let raw = ''
  let readFailed = false
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    readFailed = true
  }
  // 容错解析：frontmatter 解析失败时仍然把围栏之后的正文取出来，这样
  // 「未生效」的 skill 至少还能给出一个可读的描述，而不是一行空白。
  const parts = readFailed ? { kind: 'absent' as const, body: '' } : documentParts(raw)
  const data = parts.kind === 'ok' ? parts.data : undefined
  const issues: SkillIssue[] = []
  if (parts.kind === 'invalid') issues.push('invalid-frontmatter')
  else if (parts.kind === 'absent') issues.push('missing-frontmatter')

  const declaredName = data === undefined ? undefined : stringField(data, 'name')
  let name: string
  let nameSource: 'frontmatter' | 'entry'
  if (declaredName !== undefined && isSkillName(declaredName)) {
    name = declaredName
    nameSource = 'frontmatter'
  } else if (declaredName !== undefined) {
    // 声明了名字但不合法：仍展示，名字用声明值，标记 invalid-name。
    name = declaredName
    nameSource = 'frontmatter'
    issues.push('invalid-name')
  } else {
    name = entryName
    nameSource = 'entry'
    if (parts.kind === 'ok') issues.push('missing-name')
    if (!SKILL_NAME.test(entryName)) issues.push('invalid-entry-name')
  }

  const declaredDescription = data === undefined ? undefined : stringField(data, 'description')
  let description = ''
  let descriptionSource: 'frontmatter' | 'body' | 'none' = 'none'
  if (declaredDescription !== undefined) {
    description = declaredDescription
    descriptionSource = 'frontmatter'
  } else {
    if (parts.kind === 'ok') issues.push('missing-description')
    const fallback = firstMeaningfulLine(parts.body)
    if (fallback !== '') {
      description = fallback
      descriptionSource = 'body'
    }
  }

  const whenToUse = data === undefined ? undefined : stringField(data, 'whenToUse')
  return {
    name,
    entryName,
    ...(declaredName !== undefined ? { declaredName } : {}),
    nameSource,
    description,
    descriptionSource,
    ...(whenToUse !== undefined ? { whenToUse } : {}),
    path,
    directory,
    form,
    rootPath: root.path,
    source: root.source,
    rank: root.rank,
    live: root.live,
    deletable: root.deletable,
    issues: [...new Set(issues)],
    blockable: SKILL_NAME.test(name) || isSkillName(name),
  }
}

/** 一个 skill 文件的三段式阅读结果：frontmatter 状态 + 解析出的字段 + 正文。 */
export type DocumentParts =
  | { kind: 'ok'; data: Record<string, unknown>; body: string }
  | { kind: 'absent'; body: string }
  | { kind: 'invalid'; body: string }

/**
 * 一次读清 frontmatter 状态、字段与正文。
 * 关键点：**frontmatter 解析失败时也把围栏之后的正文带出来**，这样面板对
 * 「未生效」的 skill 仍能给出可读描述（官方 provider 此时直接丢弃整条）。
 * @param raw - 文件原始内容。
 */
export function documentParts(raw: string): DocumentParts {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return { kind: 'absent', body: raw }
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return { kind: 'absent', body: raw }
  const closing = findClosingFence(raw, firstLineEnd + 1)
  if (closing === undefined) return { kind: 'invalid', body: '' }
  const body = raw.slice(closing.bodyStart)
  let data: unknown
  try {
    data = parseYaml(raw.slice(firstLineEnd + 1, closing.start))
  } catch {
    return { kind: 'invalid', body }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { kind: 'invalid', body }
  return { kind: 'ok', data: data as Record<string, unknown>, body }
}

/** 解析 YAML frontmatter；没有 frontmatter 或解析失败都返回 undefined。 */
export function parseFrontmatter(raw: string): FrontmatterParse | undefined {
  const parts = documentParts(raw)
  return parts.kind === 'ok' ? { data: parts.data, body: parts.body } : undefined
}

/** 该文件的 frontmatter 是完整可解析的、缺失的、还是解析失败的。 */
export function frontmatterKind(raw: string): 'ok' | 'absent' | 'invalid' {
  return documentParts(raw).kind
}

/** 从正文里取第一段有意义的文字，作为缺失描述时的回退。 */
export function firstMeaningfulLine(body: string): string {
  let inFence = false
  for (const line of body.split(/\r?\n/)) {
    const text = line.trim()
    // 代码围栏整体跳过：把示例代码当成描述比留空更糟。
    if (text.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (text === '') continue
    const stripped = text.replace(/^#{1,6}\s*/, '').replace(/^[-*>]\s*/, '').trim()
    if (stripped === '') continue
    return stripped.length > 160 ? `${stripped.slice(0, 157)}…` : stripped
  }
  return ''
}

/**
 * 把一个派生的 frontmatter 写回文件，让官方 provider 重新接受它：
 * 文件已有 frontmatter 时补齐缺失字段，没有 frontmatter 时在文首插入一段。
 * 只改 frontmatter，正文一字不动。
 *
 * @param raw - 文件原始内容。
 * @param fields - 要写入的 name / description（调用方保证非空且合法）。
 * @returns 修复后的完整文件内容。
 */
export function repairFrontmatter(raw: string, fields: { name: string; description: string; whenToUse?: string }): string {
  if (!isSkillName(fields.name)) throw new Error(`invalid skill name "${fields.name}"`)
  const description = fields.description.trim().replace(/\r?\n+/g, ' ')
  if (description === '') throw new Error('description must not be empty')
  const lines = [
    '---',
    `name: ${yamlQuote(fields.name)}`,
    `description: ${yamlQuote(description)}`,
    ...(fields.whenToUse !== undefined && fields.whenToUse !== '' ? [`whenToUse: ${yamlQuote(fields.whenToUse)}`] : []),
    '---',
    '',
  ]
  const parts = documentParts(raw)
  if (parts.kind === 'ok') {
    const next: Record<string, unknown> = { ...parts.data, name: fields.name, description }
    if (fields.whenToUse !== undefined && fields.whenToUse !== '') next.whenToUse = fields.whenToUse
    const block = Object.keys(next).map(key => `${key}: ${yamlScalar(next[key])}`).join('\n')
    return `---\n${block}\n---\n${parts.body}`
  }
  if (parts.kind === 'invalid') {
    // frontmatter 围栏在但 YAML 坏了：整段替换掉，别留下第二个围栏块。
    return `${lines.join('\n')}${parts.body}`
  }
  // 完全没有 frontmatter：整段插到最前面，正文原样保留。
  return `${lines.join('\n')}${raw.replace(/^\uFEFF/, '')}`
}

/** 读取一个候选文件当前的原始内容（修复动作需要）。 */
export async function readSkillRaw(path: string): Promise<string> {
  return await readFile(path, 'utf8')
}

/** 确保目录存在（写开关文件/修复文件前调用）。 */
export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'number') return String(value)
  return undefined
}

function findClosingFence(raw: string, start: number): { start: number; bodyStart: number } | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

/** 单行 YAML 标量安全引号。 */
function yamlQuote(value: string): string {
  return /^[A-Za-z0-9_\-./ ]+$/.test(value) && !value.startsWith('-') && !value.startsWith('!')
    ? value
    : JSON.stringify(value)
}

/** 任意 frontmatter 值的单行序列化（保留原有字段）。 */
function yamlScalar(value: unknown): string {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(item => yamlQuote(String(item))).join(', ')}]`
  if (typeof value === 'object') return JSON.stringify(value)
  return yamlQuote(String(value))
}

/** 供测试/日志使用：条目的短标签。 */
export function skillLabel(skill: Pick<ScannedSkill, 'name' | 'source'>): string {
  return `${skill.name} (${skill.source})`
}

/** 一个根的人类可读短名（英文，日志用；UI 文案在 client/locales.ts）。 */
export function rootBasename(rootPath: string): string {
  return basename(rootPath)
}
