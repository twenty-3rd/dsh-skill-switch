/**
 * switches.ts 纯逻辑单测：项目根解析、mode 解析、名字归一化、开关目录读写、
 * 目录过滤。全部跑在临时目录上，不留状态。
 *
 * 这一组是从 v1（test/switches.test.mjs）逐条搬过来的回归网：屏蔽语义必须
 * 一字不改，v1 手写出来的开关目录在新面板下要表现完全一致。
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SKILL_NAME,
  clearSwitches,
  collectionFor,
  filterSkills,
  findProjectRoot,
  isHidden,
  normalizeSwitchName,
  parseMode,
  readNameSet,
  readSwitchState,
  stateFingerprint,
  switchesPath,
  writeSwitch,
  type SwitchState,
} from '../src/switches.ts'

/** 造一个临时目录，测试结束后删掉。 */
async function scratch(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

const SWITCHES = '.dsh/skill-switches'

describe('SKILL_NAME 语法与 dsh 一致', () => {
  it('接受 kebab-case，拒绝其它一切', () => {
    expect(SKILL_NAME.test('review')).toBe(true)
    expect(SKILL_NAME.test('ai-supply-chain-bottleneck-hunter')).toBe(true)
    expect(SKILL_NAME.test('opencli-usage')).toBe(true)
    expect(SKILL_NAME.test('Review')).toBe(false)
    expect(SKILL_NAME.test('bad_name')).toBe(false)
    expect(SKILL_NAME.test('has space')).toBe(false)
    expect(SKILL_NAME.test('')).toBe(false)
    expect(SKILL_NAME.test('-leading')).toBe(false)
    expect(SKILL_NAME.test('trailing-')).toBe(false)
  })
})

describe('parseMode', () => {
  it('取第一行、去空白、大小写不敏感', () => {
    expect(parseMode('deny')).toBe('deny')
    expect(parseMode('ALLOW')).toBe('allow')
    expect(parseMode('  allow  \n第二行是备注\n')).toBe('allow')
    expect(parseMode('deny\n因为太吵')).toBe('deny')
    expect(parseMode('garbage')).toBeUndefined()
    expect(parseMode('')).toBeUndefined()
    expect(parseMode(undefined)).toBeUndefined()
    expect(parseMode(42 as unknown as string)).toBeUndefined()
  })
})

describe('normalizeSwitchName', () => {
  it('剥 .md 后缀并做语法校验', () => {
    expect(normalizeSwitchName('review')).toBe('review')
    expect(normalizeSwitchName('api-design.md')).toBe('api-design')
    expect(normalizeSwitchName('modlens.MD')).toBeUndefined()
    expect(normalizeSwitchName('Bad_Name')).toBeUndefined()
    expect(normalizeSwitchName('notes.txt')).toBeUndefined()
    expect(normalizeSwitchName('.DS_Store')).toBeUndefined()
    expect(normalizeSwitchName('.md')).toBeUndefined()
  })
})

describe('findProjectRoot', () => {
  it('向上找 .git，找不到回退 cwd 自身', async () => {
    const base = await scratch('ss-root-')
    const project = join(base, 'proj')
    const nested = join(project, 'a', 'b')
    await mkdir(nested, { recursive: true })
    await mkdir(join(project, '.git'))
    expect(await findProjectRoot(nested)).toBe(project)
    expect(await findProjectRoot(join(project, 'a'))).toBe(project)
    const lone = await scratch('ss-lone-')
    expect(await findProjectRoot(lone)).toBe(lone)
    await rm(base, { recursive: true, force: true })
    await rm(lone, { recursive: true, force: true })
  })
})

describe('readNameSet', () => {
  it('分类合法、非法与子目录，缺目录为空集合', async () => {
    const base = await scratch('ss-set-')
    const dir = join(base, 'off')
    await mkdir(dir)
    await writeFile(join(dir, 'review'), '')
    await writeFile(join(dir, 'api-design.md'), '')
    await writeFile(join(dir, 'Bad_Name'), '')
    await mkdir(join(dir, 'subdir'))
    const { names, ignored } = await readNameSet(dir)
    expect(names.size).toBe(2)
    expect(names.has('review')).toBe(true)
    expect(names.has('api-design')).toBe(true)
    expect(ignored.sort()).toEqual(['Bad_Name', 'subdir/'])
    const empty = await readNameSet(join(base, 'missing'))
    expect(empty.names.size).toBe(0)
    expect(empty.ignored.length).toBe(0)
    await rm(base, { recursive: true, force: true })
  })
})

describe('readSwitchState', () => {
  it('目录不存在 -> present:false（透传契约）', async () => {
    const base = await scratch('ss-absent-')
    const state = await readSwitchState(base, SWITCHES, 'deny')
    expect(state.present).toBe(false)
    expect(state.mode).toBe('deny')
    await rm(base, { recursive: true, force: true })
  })

  it('deny 默认、mode 文件优先、非法 mode 回退 defaultMode', async () => {
    const base = await scratch('ss-state-')
    const sw = join(base, SWITCHES)
    await mkdir(join(sw, 'off'), { recursive: true })
    await mkdir(join(sw, 'on'), { recursive: true })
    await writeFile(join(sw, 'off', 'review'), '太吵')
    await writeFile(join(sw, 'on', 'api-design'), '')

    const denyDefault = await readSwitchState(base, SWITCHES, 'deny')
    expect(denyDefault.present).toBe(true)
    expect(denyDefault.mode).toBe('deny')
    expect(denyDefault.off.has('review')).toBe(true)
    expect(denyDefault.on.has('api-design')).toBe(true)
    expect(denyDefault.ignored).toEqual([])

    await writeFile(join(sw, 'mode'), 'ALLOW\n只放行白名单')
    expect((await readSwitchState(base, SWITCHES, 'deny')).mode).toBe('allow')

    await writeFile(join(sw, 'mode'), '看不懂的内容')
    expect((await readSwitchState(base, SWITCHES, 'allow')).mode).toBe('allow')
    await rm(base, { recursive: true, force: true })
  })
})

describe('filterSkills / isHidden', () => {
  const catalog = [{ name: 'review' }, { name: 'api-design' }, { name: 'modlens' }]

  it('deny 隐藏点名项，allow 只留点名项，absent 透传', () => {
    const deny: SwitchState = { present: true, mode: 'deny', off: new Set(['review']), on: new Set(), ignored: [] }
    expect(filterSkills(deny, catalog).map(s => s.name)).toEqual(['api-design', 'modlens'])
    const allow: SwitchState = { present: true, mode: 'allow', off: new Set(), on: new Set(['api-design']), ignored: [] }
    expect(filterSkills(allow, catalog).map(s => s.name)).toEqual(['api-design'])
    const allowEmpty: SwitchState = { present: true, mode: 'allow', off: new Set(), on: new Set(), ignored: [] }
    expect(filterSkills(allowEmpty, catalog)).toEqual([])
    const absent: SwitchState = { present: false, mode: 'deny', off: new Set(), on: new Set(), ignored: [] }
    expect(filterSkills(absent, catalog)).toBe(catalog)
    expect(filterSkills(undefined, catalog)).toBe(catalog)
  })

  it('isHidden 与 filterSkills 口径一致', () => {
    const deny: SwitchState = { present: true, mode: 'deny', off: new Set(['review']), on: new Set(), ignored: [] }
    expect(isHidden(deny, 'review')).toBe(true)
    expect(isHidden(deny, 'modlens')).toBe(false)
    const allow: SwitchState = { present: true, mode: 'allow', off: new Set(), on: new Set(['review']), ignored: [] }
    expect(isHidden(allow, 'review')).toBe(false)
    expect(isHidden(allow, 'modlens')).toBe(true)
    expect(isHidden({ present: false, mode: 'deny', off: new Set(), on: new Set(), ignored: [] }, 'review')).toBe(false)
    expect(isHidden(undefined, 'review')).toBe(false)
  })

  it('过滤幂等', () => {
    const deny: SwitchState = { present: true, mode: 'deny', off: new Set(['a']), on: new Set(), ignored: [] }
    const once = filterSkills(deny, [{ name: 'a' }, { name: 'b' }])
    expect(filterSkills(deny, once).map(s => s.name)).toEqual(['b'])
  })

  it('stateFingerprint 能检测变化且与集合顺序无关', () => {
    const a: SwitchState = { present: true, mode: 'deny', off: new Set(['x', 'y']), on: new Set(), ignored: [] }
    const b: SwitchState = { present: true, mode: 'deny', off: new Set(['y', 'x']), on: new Set(), ignored: [] }
    const c: SwitchState = { present: true, mode: 'deny', off: new Set(['x']), on: new Set(), ignored: [] }
    expect(stateFingerprint(a)).toBe(stateFingerprint(b))
    expect(stateFingerprint(a)).not.toBe(stateFingerprint(c))
    expect(stateFingerprint({ present: false, mode: 'deny', off: new Set(), on: new Set(), ignored: [] })).toBe('absent')
  })
})

describe('writeSwitch / clearSwitches（面板一键开关的落盘实现）', () => {
  it('deny 模式：屏蔽写 off/，恢复删 off/ 且顺手清掉 off/ 的 .md 变体', async () => {
    const base = await scratch('ss-write-')
    expect(collectionFor('deny')).toBe('off')
    expect(collectionFor('allow')).toBe('on')
    expect(switchesPath(base, SWITCHES)).toBe(join(base, SWITCHES))

    const touched = await writeSwitch(base, SWITCHES, 'review', true, 'deny')
    expect(touched).toEqual([join(base, SWITCHES, 'off', 'review')])
    expect((await readSwitchState(base, SWITCHES, 'deny')).off.has('review')).toBe(true)
    // 开关文件正文是给人的备注，过滤只看文件名。
    const notes = await readdir(join(base, SWITCHES, 'off'))
    expect(notes).toEqual(['review'])

    // 手工放一个 .md 变体，恢复时应一并清掉。
    await writeFile(join(base, SWITCHES, 'off', 'review.md'), '')
    const cleared = await writeSwitch(base, SWITCHES, 'review', false, 'deny')
    expect(cleared.length).toBe(2)
    const state = await readSwitchState(base, SWITCHES, 'deny')
    expect(state.off.has('review')).toBe(false)
    await rm(base, { recursive: true, force: true })
  })

  it('allow 模式：屏蔽 = 从 on/ 移除，恢复 = 写回 on/（语义仍是"是否隐藏"）', async () => {
    const base = await scratch('ss-allow-')
    const sw = join(base, SWITCHES)
    await mkdir(join(sw, 'on'), { recursive: true })
    await writeFile(join(sw, 'on', 'review'), '')
    await writeFile(join(sw, 'mode'), 'allow\n')

    // 白名单模式下 review 在名单里 -> 可见；屏蔽它 = 从 on/ 移除。
    expect(isHidden(await readSwitchState(base, SWITCHES, 'deny'), 'review')).toBe(false)
    await writeSwitch(base, SWITCHES, 'review', true, 'allow')
    expect(isHidden(await readSwitchState(base, SWITCHES, 'deny'), 'review')).toBe(true)

    // 恢复 = 写回 on/。
    await writeSwitch(base, SWITCHES, 'review', false, 'allow')
    expect(isHidden(await readSwitchState(base, SWITCHES, 'deny'), 'review')).toBe(false)
    await rm(base, { recursive: true, force: true })
  })

  it('切换模式后不留同名残留：另一侧集合总被清干净', async () => {
    const base = await scratch('ss-stale-')
    await writeSwitch(base, SWITCHES, 'review', true, 'deny')
    expect((await readSwitchState(base, SWITCHES, 'deny')).off.has('review')).toBe(true)
    // 同一名字在 allow 模式下改为"放行"：off/ 残留必须被清掉。
    await writeSwitch(base, SWITCHES, 'review', false, 'allow')
    const state = await readSwitchState(base, SWITCHES, 'deny')
    expect(state.off.has('review')).toBe(false)
    expect(state.on.has('review')).toBe(true)
    await rm(base, { recursive: true, force: true })
  })

  it('非法名字拒绝写入', async () => {
    const base = await scratch('ss-bad-')
    await expect(writeSwitch(base, SWITCHES, 'Bad_Name', true, 'deny')).rejects.toThrow(/kebab-case/)
    await rm(base, { recursive: true, force: true })
  })

  it('clearSwitches 清空两侧集合并删除空目录，缺目录时是 no-op', async () => {
    const base = await scratch('ss-clear-')
    expect(await clearSwitches(base, SWITCHES)).toEqual([])
    await writeSwitch(base, SWITCHES, 'review', true, 'deny')
    await writeSwitch(base, SWITCHES, 'api-design', true, 'deny')
    const removed = await clearSwitches(base, SWITCHES)
    expect(removed.length).toBe(2)
    const state = await readSwitchState(base, SWITCHES, 'deny')
    expect(state.present).toBe(true)
    expect(state.off.size).toBe(0)
    await rm(base, { recursive: true, force: true })
  })
})
