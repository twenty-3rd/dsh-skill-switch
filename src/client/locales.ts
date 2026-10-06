/**
 * zh/en 文案。走 DSH 的 i18n 系统：client apply 时挂上 `ctx.locale`，
 * `t()` 从活动 locale 解析文案；两份字典同时注册进 DSH 的 locale registry。
 *
 * 判定词只有两个：**有效**（A 在目录里 ∧ B 模型可调用 ∧ C 用户可调用）与
 * **错误**（任一条不成立）。不给"未生效"留文案：那个词同时指过四件不同的事，
 * 是上一版误报的根源。
 */
export const LOCALE_NS = 'dsh-skill-switch'

/** zh 字典（同时注册进 DSH locale registry）。 */
export const zh = {
  panelTitle: 'Skill 开关',
  filterAll: '全部',
  filterBlocked: '已屏蔽',
  searchPlaceholder: '搜索名字或描述…',
  resetAll: '恢复本项全部',
  resetConfirm: '清空本项目所有开关文件？所有 skill 恢复默认可见性。',
  resetConfirmAllow: '本项目是白名单模式（mode=allow）：只清空 on/ 会让白名单变成空集、所有 skill 全部消失。确认会同时移除 mode 文件，让项目回到默认可见性。',
  loading: '加载中…',
  loadFailed: '加载失败',
  emptyAll: '这个项目里还没有发现任何 skill',
  emptyFiltered: '没有符合条件的 skill',
  emptyBlocked: '本项目当前没有屏蔽任何 skill',
  block: '屏蔽',
  unblock: '启用',
  ops: '操作',
  delete: '删除（全部副本）',
  repair: '补齐 frontmatter',
  cancel: '取消',
  confirm: '确认',
  summary: '共 {total} 个 · 已屏蔽 {blocked} · 错误 {error}',
  rootProjectDsh: '项目 .dsh',
  rootProjectAgents: '项目 .agents',
  rootCustom: '自定义',
  rootUserDsh: '用户',
  rootUserAgents: '共享',
  rootBundled: '内置',
  rootLibrary: 'Skill 库',
  badgeBlocked: '已屏蔽',
  badgeValid: '有效',
  badgeError: '错误',
  badgeUnassigned: '未分配',
  badgeBundled: '只读',
  badgeVirtual: '运行时',
  copiesOf: '{count} 处副本',
  // 详情视图：点开一行后的只读页（名称 / 描述 / 每一处盘上副本）。
  openDetail: '查看详情',
  backToList: '返回列表',
  detailDescription: '描述',
  detailRoots: '存在的根位置',
  detailNoCopies: '由运行时提供，磁盘上没有副本。',
  detailCopyCurrent: '当前生效',
  detailCopyLive: '会被 DSH 加载',
  detailCopyNotLive: 'DSH 不读它',
  detailCopyRank: '优先级 {rank}',
  detailCopyProtected: '受保护，不会删除',
  detailFormBundle: '目录 bundle',
  detailFormFlat: '单文件 .md',
  detailRootLabel: '根',
  detailFileLabel: '文件',
  detailEntryName: '条目名 {name}',
  detailVerdict: '判定依据',
  // 三条件与用户口径一一对应（见 skill-view.ts 的 SkillVerdictError）。
  detailInRegistry: '在 skill 注册表里（条件 A）',
  detailModelInvocable: '模型可主动调用（条件 B）',
  detailUserInvocable: '用户可显式调用（条件 C）',
  yes: '是',
  no: '否',
  // 「错误」的三个原因：分别对应 A / B / C 三条件。
  verdictNotInRegistry: '不在 skill 注册表里（DSH 不会加载它）',
  verdictModelBlocked: '模型不能主动调用（disable-model-invocation）',
  verdictUserBlocked: '用户不能显式调用（user-invocable: false）',
  verdictUnavailable: '当前会话没有活跃的 agent，本次不显示有效/错误判定。',
  // 磁盘侧的 frontmatter 事实：解释"为什么它不在注册表里"。
  issueMissingFrontmatter: '缺少 YAML frontmatter，DSH 会忽略它',
  issueInvalidFrontmatter: 'YAML frontmatter 解析失败，DSH 会忽略它',
  issueMissingName: 'frontmatter 缺少 name',
  issueInvalidName: 'name 不是合法 kebab-case',
  issueMissingDescription: 'frontmatter 缺少 description',
  issueInvalidEntryName: '目录/文件名不是合法 kebab-case',
  issueInvalidInvocation: 'invocation 字段非法（含遗留键），DSH 会忽略它',
  descFromBody: '描述取自正文首段',
  nameFromEntry: '名字取自目录名',
  notBlockable: '名字不合法，无法按名写开关',
  deleteConfirm: '将在下列位置永久删除该 skill（不可恢复）。其他项目自己的 .dsh/skills 不在本面板扫描范围内：',
  protectedCopy: '受保护，将跳过',
  skippedOf: '有 {count} 处副本被跳过（受保护或删除失败）',
  catalogUnavailable: 'runtime skill 目录读取失败，本次不显示有效/错误判定。',
  errBadRequest: '请求不合法（名字或参数有问题）',
  errNotFound: '找不到该 skill 的落盘副本',
  errProtected: '它由运行时提供，磁盘上没有可删除的副本',
  errForbidden: '出于安全考虑拒绝了这次操作',
  errNetwork: '无法连接到 DSH 服务',
  deleteProtected: '该 skill 由运行时提供，磁盘上没有可删除的副本',
  repairConfirm: '给下列文件补上 frontmatter（只改 frontmatter，正文不动）：',
  resetDone: '已清空本项目全部开关',
  toggleDone: '已更新',
  deleteDone: '已删除',
  repairDone: '已补齐 frontmatter',
  wireError: '请求失败',
} as const

/** en 字典（keys 与 zh 完全一致）。 */
export const en: Record<keyof typeof zh, string> = {
  panelTitle: 'Skill Switches',
  filterAll: 'All',
  filterBlocked: 'Blocked',
  searchPlaceholder: 'Filter by name or description…',
  resetAll: 'Restore all',
  resetConfirm: 'Clear every switch file of this project? All skills return to their default visibility.',
  resetConfirmAllow: 'This project is in whitelist mode (mode=allow): clearing on/ alone would empty the whitelist and hide every skill. Confirming also removes the mode file so the project returns to its default visibility.',
  loading: 'Loading…',
  loadFailed: 'Load failed',
  emptyAll: 'No skills discovered for this project',
  emptyFiltered: 'No skill matches the filter',
  emptyBlocked: 'Nothing is blocked in this project',
  block: 'Block',
  unblock: 'Allow',
  ops: 'Actions',
  delete: 'Delete (all copies)',
  repair: 'Fix frontmatter',
  cancel: 'Cancel',
  confirm: 'Confirm',
  summary: '{total} total · {blocked} blocked · {error} errors',
  rootProjectDsh: 'project .dsh',
  rootProjectAgents: 'project .agents',
  rootCustom: 'custom',
  rootUserDsh: 'user',
  rootUserAgents: 'shared',
  rootBundled: 'bundled',
  rootLibrary: 'library',
  badgeBlocked: 'Blocked',
  badgeValid: 'Valid',
  badgeError: 'Error',
  badgeUnassigned: 'Unassigned',
  badgeBundled: 'Read-only',
  badgeVirtual: 'Runtime',
  copiesOf: '{count} copies',
  openDetail: 'View details',
  backToList: 'Back to list',
  detailDescription: 'Description',
  detailRoots: 'Existing root locations',
  detailNoCopies: 'Provided by the runtime; there are no on-disk copies.',
  detailCopyCurrent: 'currently effective',
  detailCopyLive: 'loaded by DSH',
  detailCopyNotLive: 'not read by DSH',
  detailCopyRank: 'rank {rank}',
  detailCopyProtected: 'protected — never deleted',
  detailFormBundle: 'directory bundle',
  detailFormFlat: 'single .md file',
  detailRootLabel: 'root',
  detailFileLabel: 'file',
  detailEntryName: 'entry name {name}',
  detailVerdict: 'Verdict basis',
  detailInRegistry: 'in the skill registry (condition A)',
  detailModelInvocable: 'model can invoke it (condition B)',
  detailUserInvocable: 'user can invoke it (condition C)',
  yes: 'yes',
  no: 'no',
  verdictNotInRegistry: 'not in the skill registry (DSH will not load it)',
  verdictModelBlocked: 'the model cannot invoke it (disable-model-invocation)',
  verdictUserBlocked: 'the user cannot invoke it (user-invocable: false)',
  verdictUnavailable: 'No live agent for this session, so no valid/error verdict is shown.',
  issueMissingFrontmatter: 'No YAML frontmatter — DSH ignores it',
  issueInvalidFrontmatter: 'YAML frontmatter failed to parse — DSH ignores it',
  issueMissingName: 'frontmatter has no name',
  issueInvalidName: 'name is not kebab-case',
  issueMissingDescription: 'frontmatter has no description',
  issueInvalidEntryName: 'directory/file name is not kebab-case',
  issueInvalidInvocation: 'invalid invocation field (or a legacy key) — DSH ignores it',
  descFromBody: 'description taken from the first body line',
  nameFromEntry: 'name taken from the directory name',
  notBlockable: 'invalid name — cannot write a switch file',
  deleteConfirm: 'Permanently delete this skill from every location below (cannot be undone). Other projects\' own .dsh/skills are outside this panel\'s scan:',
  protectedCopy: 'protected — will be skipped',
  skippedOf: '{count} copy/copies were skipped (protected or failed)',
  catalogUnavailable: 'The runtime skill catalog could not be read, so no valid/error verdict is shown.',
  errBadRequest: 'Invalid request (bad name or argument)',
  errNotFound: 'No on-disk copy of that skill was found',
  errProtected: 'It is provided by the runtime; there is no on-disk copy to delete',
  errForbidden: 'Refused for safety reasons',
  errNetwork: 'Cannot reach the DSH service',
  deleteProtected: 'This skill is provided by the runtime; there is no on-disk copy to delete',
  repairConfirm: 'Add frontmatter to these files (frontmatter only; the body is untouched):',
  resetDone: 'All switches cleared for this project',
  toggleDone: 'Updated',
  deleteDone: 'Deleted',
  repairDone: 'Frontmatter fixed',
  wireError: 'Request failed',
}

/** zh/en 字典对。 */
export const dictionaries = { zh, en }

/** 文案 key。 */
export type CopyKey = keyof typeof zh

/** DSH locale 服务（未挂上时退回浏览器语言）。 */
let localeService: { getSnapshot(): { active: string } } | undefined

/**
 * 挂上（或传 undefined 摘掉）DSH locale 服务。组件继续调普通的 `t()`，
 * 面板订阅 locale 快照变化后自行重渲染。
 */
export function attachLocale(service: { getSnapshot(): { active: string } } | undefined): void {
  localeService = service
}

/** 活动 locale（'zh' | 'en' | …）。 */
function activeLocale(): string {
  return localeService?.getSnapshot().active
    ?? (typeof navigator !== 'undefined' ? navigator.language : '')
    ?? 'en'
}

/** 按活动 locale 取文案；`{name}` 占位符由 params 插值。 */
export function t(key: CopyKey, params?: Record<string, string | number>): string {
  const dict: Record<string, string> = activeLocale().toLowerCase().startsWith('zh') ? zh : en
  let text = dict[key] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

/** 活动 locale 是否为中文。 */
export function isZh(): boolean {
  return activeLocale().toLowerCase().startsWith('zh')
}
