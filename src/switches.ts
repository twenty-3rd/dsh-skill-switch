/**
 * dsh-skill-switch 的纯逻辑半体：项目根解析、开关目录读写、目录过滤。
 *
 * 本模块不依赖 cordis / dsh 任何运行时服务，只依赖 node:fs / node:path，
 * 因此可以独立单测（见 tests/switches.spec.ts）。宿主接线在 src/index.ts。
 *
 * 开关文件协议（相对项目根）——与 v1 完全兼容，v1 手写的开关目录无需迁移：
 *
 *   <projectRoot>/.dsh/skill-switches/
 *   ├── mode           # 可选：内容第一行为 "deny"（默认）或 "allow"
 *   ├── off/<name>     # deny 模式：隐藏该 skill（文件名 <name> 或 <name>.md）
 *   └── on/<name>      # allow 模式：仅这些 skill 可见
 *
 * - 项目根 = 自 cwd 向上找到第一个含 .git 的目录；找不到则用 cwd 本身
 *   （与 @deepseek-ai/dsh-skill-filesystem 的 findProjectRoot 语义一致）。
 * - 开关文件内容是自由文本（写给人和日志看），过滤只看文件名。
 * - 非法名字（非 kebab-case）与子目录会被忽略并上报，绝不抛错。
 *
 * "屏蔽 / 不屏蔽" 与集合的映射（让面板的开关在两种模式下都语义一致）：
 * - deny 模式：屏蔽 = 在 off/ 建文件；恢复 = 删掉 off/ 里的同名文件
 * - allow 模式：屏蔽 = 删掉 on/ 里的同名文件；恢复 = 在 on/ 建文件
 * 两种情况下都会顺手清掉另一侧的同名文件，避免模式切换后语义漂移。
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** 公开 skill 名语法（与 dsh-skill 的 SKILL_NAME / isSkillName 一致）。 */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 开关模式：deny = 黑名单（隐藏 off/ 点名的），allow = 白名单（只放行 on/ 点名的）。 */
export type SwitchMode = 'deny' | 'allow'

/** 一个 skill 名是否符合公开 kebab-case 语法。 */
export function isSkillName(name: string): boolean {
  return SKILL_NAME.test(name)
}

/** 一个项目的开关状态。 */
export interface SwitchState {
  /** 开关目录是否存在。false 表示调用方应纯透传。 */
  present: boolean
  mode: SwitchMode
  /** deny 模式：这些 skill 被隐藏。 */
  off: Set<string>
  /** allow 模式：只有这些 skill 可见。 */
  on: Set<string>
  /** 目录里被忽略的条目（子目录、非法文件名），用于诊断展示。 */
  ignored: string[]
}

/** 开关目录不存在或不可读时返回的空状态：过滤器看到它就纯透传。 */
export const ABSENT_STATE: Readonly<SwitchState> = Object.freeze({
  present: false,
  mode: 'deny' as SwitchMode,
  off: Object.freeze(new Set<string>()) as Set<string>,
  on: Object.freeze(new Set<string>()) as Set<string>,
  ignored: Object.freeze([]) as unknown as string[],
})

/**
 * 自 cwd 向上找项目根：第一个包含 .git 的目录；到文件系统顶还没找到
 * 就回退为 cwd 自身。与 dsh-skill-filesystem 的同名函数语义保持一致，
 * 保证开关目录和 .dsh/skills 解析到同一个根。
 * @param cwd - 会话工作目录（session.header.cwd）。
 * @returns 项目根的绝对路径。
 */
export async function findProjectRoot(cwd: string): Promise<string> {
  let current = resolve(cwd)
  for (;;) {
    if (await pathExists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

/**
 * 解析 mode 文件内容：取第一行、去空白、转小写；只认 "deny" / "allow"。
 * @param text - mode 文件的原始内容。
 * @returns 识别出的模式，无法识别返回 undefined。
 */
export function parseMode(text: string | undefined): SwitchMode | undefined {
  if (typeof text !== 'string') return undefined
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim().toLowerCase() ?? ''
  if (firstLine === 'deny') return 'deny'
  if (firstLine === 'allow') return 'allow'
  return undefined
}

/**
 * 把一个开关文件名归一化为 skill 名：剥掉可选的 .md 后缀并做语法校验。
 * @param fileName - 目录项名字（如 "review"、"api-design.md"）。
 * @returns 合法 skill 名；非法（大写、空格、.txt 等）返回 undefined。
 */
export function normalizeSwitchName(fileName: string): string | undefined {
  const base = fileName.endsWith('.md') ? fileName.slice(0, -3) : fileName
  if (!SKILL_NAME.test(base)) return undefined
  return base
}

/**
 * 读取一个开关集合目录（off/ 或 on/），返回合法 skill 名集合与被忽略项。
 * 目录不存在或不可读都视为空集合，绝不抛错。
 * @param dir - 集合目录的绝对路径。
 */
export async function readNameSet(dir: string): Promise<{ names: Set<string>; ignored: string[] }> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return { names: new Set(), ignored: [] }
  }
  const names = new Set<string>()
  const ignored: string[] = []
  for (const entry of entries) {
    if (!entry.isFile()) {
      ignored.push(`${entry.name}/`)
      continue
    }
    const normalized = normalizeSwitchName(entry.name)
    if (normalized === undefined) ignored.push(entry.name)
    else names.add(normalized)
  }
  return { names, ignored }
}

/**
 * 读取项目根下开关目录的完整状态。
 * @param projectRoot - 项目根（来自 findProjectRoot）。
 * @param switchesDir - 相对项目根的开关目录（配置项 switchesDir）。
 * @param defaultMode - 无 mode 文件（或内容无法识别）时的默认模式。
 * @returns 状态；present 为 false 表示目录不存在，调用方应纯透传。
 */
export async function readSwitchState(
  projectRoot: string,
  switchesDir: string,
  defaultMode: SwitchMode,
): Promise<SwitchState> {
  const base = join(projectRoot, switchesDir)
  try {
    await readdir(base)
  } catch {
    return { present: false, mode: defaultMode === 'allow' ? 'allow' : 'deny', off: new Set(), on: new Set(), ignored: [] }
  }
  let mode: SwitchMode | undefined
  try {
    mode = parseMode(await readFile(join(base, 'mode'), 'utf8'))
  } catch {
    /* mode 文件不存在 */
  }
  if (mode !== 'deny' && mode !== 'allow') mode = defaultMode === 'allow' ? 'allow' : 'deny'
  const off = await readNameSet(join(base, 'off'))
  const on = await readNameSet(join(base, 'on'))
  return {
    present: true,
    mode,
    off: off.names,
    on: on.names,
    ignored: [...off.ignored.map(name => `off/${name}`), ...on.ignored.map(name => `on/${name}`)],
  }
}

/**
 * 判定一个 skill 名在给定状态下是否应被隐藏。
 * @param state - readSwitchState 的结果。
 * @param name - skill 名。
 * @returns true 表示应从目录与 get() 中隐藏。
 */
export function isHidden(state: SwitchState | undefined, name: string): boolean {
  if (state === undefined || state.present !== true) return false
  if (state.mode === 'allow') return !state.on.has(name)
  return state.off.has(name)
}

/**
 * 按状态过滤 skill 摘要数组（过滤是幂等的，重复应用同一状态无害）。
 * @param state - readSwitchState 的结果。
 * @param skills - skill 摘要（含 name 字段）数组。
 * @returns 过滤后的新数组；状态不生效时原样返回。
 */
export function filterSkills<T extends { name: string }>(state: SwitchState | undefined, skills: T[]): T[] {
  if (state === undefined || state.present !== true) return skills
  if (state.mode === 'allow') return skills.filter(skill => state.on.has(skill.name))
  return skills.filter(skill => !state.off.has(skill.name))
}

/**
 * 计算状态的比较指纹，用于变更日志的差量检测。
 * @param state - readSwitchState 的结果。
 */
export function stateFingerprint(state: SwitchState | undefined): string {
  if (state === undefined || state.present !== true) return 'absent'
  return JSON.stringify({
    mode: state.mode,
    off: [...state.off].sort(),
    on: [...state.on].sort(),
  })
}

/** 表达 "屏蔽" 的集合目录（deny → off/，allow → on/）。 */
export function collectionFor(mode: SwitchMode): 'off' | 'on' {
  return mode === 'allow' ? 'on' : 'off'
}

/** 开关目录的绝对路径。 */
export function switchesPath(projectRoot: string, switchesDir: string): string {
  return join(resolve(projectRoot), switchesDir)
}

/** 一个人工可读的开关文件正文（过滤只看文件名，内容是给人看的）。 */
function switchNote(blocked: boolean, projectRoot: string, mode: SwitchMode): string {
  const at = new Date().toISOString()
  return [
    `# dsh-skill-switch ${blocked ? 'blocked' : 'allowed'} this skill for the project`,
    `# project: ${resolve(projectRoot)}`,
    `# mode: ${mode} (the file NAME is the switch; this note is free-form)`,
    `${blocked ? 'blockedAt' : 'allowedAt'}: ${at}`,
    '',
  ].join('\n')
}

/**
 * 写入一个开关：`blocked=true` 屏蔽该 skill，`false` 恢复可见。
 *
 * 同一个 `blocked` 在两种模式下的落盘动作不同，因为两个集合的**成员含义**
 * 相反：
 * - deny 模式（off/ = 被隐藏）：屏蔽 = 建 off/<name>，恢复 = 删 off/<name>
 * - allow 模式（on/ = 被放行）：屏蔽 = 删 on/<name>，恢复 = 建 on/<name>
 * 无论哪种，另一侧的同名残留都会被清掉，避免模式切换后语义漂移。
 *
 * 目录按需创建；不写 mode 文件（缺省即 defaultMode，默认 deny）。
 *
 * @param projectRoot - 项目根。
 * @param switchesDir - 相对项目根的开关目录。
 * @param name - 合法 kebab-case skill 名。
 * @param blocked - true = 本项目隐藏该 skill；false = 本项目可见。
 * @param mode - 当前生效的模式。
 * @returns 写入/删除的绝对路径列表，供调用方回报。
 */
export async function writeSwitch(
  projectRoot: string,
  switchesDir: string,
  name: string,
  blocked: boolean,
  mode: SwitchMode,
): Promise<string[]> {
  if (!isSkillName(name)) throw new Error(`invalid skill name "${name}" (expected kebab-case)`)
  const base = switchesPath(projectRoot, switchesDir)
  // 本模式下"表达可见性开关"的那个集合：deny -> off/（隐藏名单），allow -> on/（放行名单）。
  const activeDir = collectionFor(mode)
  const otherDir: 'off' | 'on' = activeDir === 'off' ? 'on' : 'off'
  // deny 里"隐藏"是写文件；allow 里"隐藏"是删文件——两者都落在 activeDir 上。
  const shouldCreate = mode === 'deny' ? blocked : !blocked
  const touched: string[] = []
  await mkdir(join(base, activeDir), { recursive: true })
  const target = join(base, activeDir, name)
  if (shouldCreate) {
    await writeFile(target, switchNote(blocked, projectRoot, mode), 'utf8')
    touched.push(target)
  } else {
    for (const candidate of [target, join(base, activeDir, `${name}.md`)]) {
      if (await removeIfPresent(candidate)) touched.push(candidate)
    }
  }
  // 另一侧的集合与本模式的语义无关，留着只会让后来切换模式的人困惑。
  const staleDir = join(base, otherDir)
  for (const candidate of [join(staleDir, name), join(staleDir, `${name}.md`)]) {
    if (await removeIfPresent(candidate)) touched.push(candidate)
  }
  return touched
}

/** `clearSwitches` 的选项。 */
export interface ClearSwitchesOptions {
  /**
   * 是否连 `mode` 文件一起删掉。
   *
   * 这是 allow（白名单）模式的必要动作：清空 `on/` 之后白名单变成空集，
   * `mode: allow` 的含义就是"什么都不放行"，会把整个 skill 目录清空——
   * 与"恢复默认可见性"完全相反。所以面板在白名单模式下恢复全部时，
   * 必须把 `mode` 文件一起移除，让项目回到 defaultMode（默认 deny）。
   */
  includeMode?: boolean
}

/**
 * 清空一个项目的全部开关：删除 off/ 与 on/ 两个集合目录里的所有条目，
 * 并把两侧空目录一并移除；`includeMode` 为真时连 mode 文件一起删。
 * 项目没有开关目录时是 no-op。
 * @param projectRoot - 项目根。
 * @param switchesDir - 相对项目根的开关目录。
 * @param options - 见 {@link ClearSwitchesOptions}。
 * @returns 被删除的绝对路径列表。
 */
export async function clearSwitches(
  projectRoot: string,
  switchesDir: string,
  options: ClearSwitchesOptions = {},
): Promise<string[]> {
  const base = switchesPath(projectRoot, switchesDir)
  const removed: string[] = []
  if (options.includeMode === true) {
    const modePath = join(base, 'mode')
    if (await removeIfPresent(modePath)) removed.push(modePath)
  }
  for (const collection of ['off', 'on'] as const) {
    const dir = join(base, collection)
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const target = join(dir, entry.name)
      try {
        await rm(target, { recursive: entry.isDirectory(), force: false })
        removed.push(target)
      } catch {
        /* 单个条目删不掉不影响整体恢复 */
      }
    }
    try {
      await rm(dir, { recursive: false, force: false })
    } catch {
      /* 目录非空或已消失：保持原样 */
    }
  }
  return removed
}

/** 存在则删除，返回是否真的删掉了。 */
async function removeIfPresent(path: string): Promise<boolean> {
  try {
    await rm(path, { recursive: true, force: false })
    return true
  } catch {
    return false
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
