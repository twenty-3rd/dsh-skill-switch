/**
 * zh/en 文案。走 DSH 的 i18n 系统：client apply 时挂上 `ctx.locale`，
 * `t()` 从活动 locale 解析文案；两份字典同时注册进 DSH 的 locale registry。
 */
export const LOCALE_NS = 'dsh-skill-switch'

/** zh 字典（同时注册进 DSH locale registry）。 */
export const zh = {
  panelTitle: 'Skill 开关',
  subtitle: '项目级屏蔽与全局删除',
  filterAll: '全部',
  filterBlocked: '已屏蔽',
  filterBroken: '未生效',
  searchPlaceholder: '搜索名字或描述…',
  resetAll: '恢复本项全部',
  resetConfirm: '清空本项目所有开关文件？所有 skill 恢复默认可见性。',
  loading: '加载中…',
  loadFailed: '加载失败',
  emptyAll: '这个项目里还没有发现任何 skill',
  emptyFiltered: '没有符合条件的 skill',
  emptyBlocked: '本项目当前没有屏蔽任何 skill',
  emptyBroken: '没有"未生效"的 skill：所有 skill 的 frontmatter 都完整',
  block: '屏蔽',
  unblock: '启用',
  ops: '操作',
  delete: '删除（全局）',
  repair: '补齐 frontmatter',
  cancel: '取消',
  confirm: '确认',
  close: '关闭',
  back: '返回',
  summary: '共 {total} 个 · 已屏蔽 {blocked} · 未生效 {broken}',
  projectOf: '项目',
  switchesOf: '开关目录',
  rootProjectDsh: '项目 .dsh',
  rootProjectAgents: '项目 .agents',
  rootCustom: '自定义',
  rootUserDsh: '用户',
  rootUserAgents: '共享',
  rootBundled: '内置',
  rootLibrary: 'Skill 库',
  badgeBlocked: '已屏蔽',
  badgeBroken: '未生效',
  badgeUnassigned: '未分配',
  badgeBundled: '只读',
  badgeVirtual: '运行时',
  copiesOf: '{count} 处副本',
  issueMissingFrontmatter: '缺少 YAML frontmatter，DSH 会忽略它',
  issueInvalidFrontmatter: 'YAML frontmatter 解析失败，DSH 会忽略它',
  issueMissingName: 'frontmatter 缺少 name',
  issueInvalidName: 'name 不是合法 kebab-case',
  issueMissingDescription: 'frontmatter 缺少 description',
  issueInvalidEntryName: '目录/文件名不是合法 kebab-case',
  descFromBody: '描述取自正文首段',
  nameFromEntry: '名字取自目录名',
  notBlockable: '名字不合法，无法按名写开关',
  deleteConfirm: '将在下列位置永久删除该 skill（不可恢复）：',
  deleteProtected: '该 skill 由运行时提供，磁盘上没有可删除的副本',
  repairConfirm: '给下列文件补上 frontmatter（只改 frontmatter，正文不动）：',
  resetDone: '已清空本项目全部开关',
  toggleDone: '已更新',
  deleteDone: '已删除',
  repairDone: '已补齐 frontmatter',
  wireError: '请求失败',
  rootMissing: '根不存在',
} as const

/** en 字典（keys 与 zh 完全一致）。 */
export const en: Record<keyof typeof zh, string> = {
  panelTitle: 'Skill Switches',
  subtitle: 'Project-level blocking and global deletion',
  filterAll: 'All',
  filterBlocked: 'Blocked',
  filterBroken: 'Inactive',
  searchPlaceholder: 'Filter by name or description…',
  resetAll: 'Restore all',
  resetConfirm: 'Clear every switch file of this project? All skills return to their default visibility.',
  loading: 'Loading…',
  loadFailed: 'Load failed',
  emptyAll: 'No skills discovered for this project',
  emptyFiltered: 'No skill matches the filter',
  emptyBlocked: 'Nothing is blocked in this project',
  emptyBroken: 'No inactive skills — every frontmatter is complete',
  block: 'Block',
  unblock: 'Allow',
  ops: 'Actions',
  delete: 'Delete (global)',
  repair: 'Fix frontmatter',
  cancel: 'Cancel',
  confirm: 'Confirm',
  close: 'Close',
  back: 'Back',
  summary: '{total} total · {blocked} blocked · {broken} inactive',
  projectOf: 'Project',
  switchesOf: 'Switch dir',
  rootProjectDsh: 'project .dsh',
  rootProjectAgents: 'project .agents',
  rootCustom: 'custom',
  rootUserDsh: 'user',
  rootUserAgents: 'shared',
  rootBundled: 'bundled',
  rootLibrary: 'library',
  badgeBlocked: 'Blocked',
  badgeBroken: 'Inactive',
  badgeUnassigned: 'Unassigned',
  badgeBundled: 'Read-only',
  badgeVirtual: 'Runtime',
  copiesOf: '{count} copies',
  issueMissingFrontmatter: 'No YAML frontmatter — DSH ignores it',
  issueInvalidFrontmatter: 'YAML frontmatter failed to parse — DSH ignores it',
  issueMissingName: 'frontmatter has no name',
  issueInvalidName: 'name is not kebab-case',
  issueMissingDescription: 'frontmatter has no description',
  issueInvalidEntryName: 'directory/file name is not kebab-case',
  descFromBody: 'description taken from the first body line',
  nameFromEntry: 'name taken from the directory name',
  notBlockable: 'invalid name — cannot write a switch file',
  deleteConfirm: 'Permanently delete this skill from every location below (cannot be undone):',
  deleteProtected: 'This skill is provided by the runtime; there is no on-disk copy to delete',
  repairConfirm: 'Add frontmatter to these files (frontmatter only; the body is untouched):',
  resetDone: 'All switches cleared for this project',
  toggleDone: 'Updated',
  deleteDone: 'Deleted',
  repairDone: 'Frontmatter fixed',
  wireError: 'Request failed',
  rootMissing: 'root missing',
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
