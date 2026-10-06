/**
 * Skill 开关面板：本项目 skill 的一键屏蔽/恢复 + 全局删除。
 *
 * 刻意只做这两件事（外加「缺 name/description 的 skill 也要看得见」这一点
 * 优化）。dsh-skills-manager 的创建 / 编辑 / 库分配 / 重命名 / 同步等能力
 * 一律不在这里重复。
 *
 * 视觉与交互沿用同一个会话视图座位的语言（同款工具栏、卡片、徽标、
 * 「操作」下拉菜单与二次确认），所以两个面板切换时手感一致。
 *
 * 数据全部来自 host 半体的 /skill-switch API；每次变更都用服务端回传的完整
 * 面板数据替换本地状态，避免第二次请求引入的竞态。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PanelStore } from './state.ts'
import type { PanelData, PanelScope, SkillIssue, SkillRow, SkillVerdictError } from './api.ts'
import { api, SkillSwitchApiError } from './api.ts'
import { t } from './locales.ts'
import css from './SkillSwitchPanel.module.css'

/**
 * 把 wire 失败折成一行**本地化**消息。
 *
 * host 侧的 error.message 是机器/开发者面的（英文细节），直接显示会让中文界面
 * 冒出英文、英文界面冒出中文。这里按 wire code 出本地化文案，只有未知 code
 * 才退回原始消息。
 */
function messageOf(error: unknown): string {
  if (error instanceof SkillSwitchApiError) {
    switch (error.code) {
      case 'bad-request': return t('errBadRequest')
      case 'not-found': return t('errNotFound')
      case 'protected': return t('errProtected')
      case 'forbidden': return t('errForbidden')
      case 'network': return t('errNetwork')
      default: return `${t('wireError')}: ${error.message}`
    }
  }
  return error instanceof Error ? error.message : String(error)
}

/** 来源根 id → 本地化徽标文案。 */
export function sourceLabel(source: string): string {
  switch (source) {
    case 'project-dsh': return t('rootProjectDsh')
    case 'project-agents': return t('rootProjectAgents')
    case 'custom': return t('rootCustom')
    case 'user-dsh': return t('rootUserDsh')
    case 'user-agents': return t('rootUserAgents')
    case 'bundled': return t('rootBundled')
    case 'library': return t('rootLibrary')
    default: return source
  }
}

/** frontmatter 事实 → 本地化文案（作为「错误」的解释：为什么它不在目录里）。 */
export function issueLabel(issue: SkillIssue): string {
  switch (issue) {
    case 'missing-frontmatter': return t('issueMissingFrontmatter')
    case 'invalid-frontmatter': return t('issueInvalidFrontmatter')
    case 'missing-name': return t('issueMissingName')
    case 'invalid-name': return t('issueInvalidName')
    case 'missing-description': return t('issueMissingDescription')
    case 'invalid-entry-name': return t('issueInvalidEntryName')
    case 'invalid-invocation': return t('issueInvalidInvocation')
    default: return issue
  }
}

/**
 * 判定失败项 → 本地化文案。
 *
 * 「错误」必须说清是 A/B/C 哪一条不成立：只写"错误"用户无法行动，而"原因未知"
 * 那种兜底说法（上一版）是把"我没读到"当成了结论。
 */
export function verdictLabel(error: SkillVerdictError): string {
  switch (error) {
    case 'not-in-registry': return t('verdictNotInRegistry')
    case 'model-not-invocable': return t('verdictModelBlocked')
    case 'user-not-invocable': return t('verdictUserBlocked')
    default: return error
  }
}

/** 打开的卡片菜单：哪一行 + 哪一步。 */
type CardMenu =
  | { name: string; mode: 'actions' }
  | { name: string; mode: 'confirm-delete' }
  | { name: string; mode: 'confirm-repair' }
  | null

/**
 * 面板主体：筛选栏 + 作用域行 + skill 列表。
 * `scope` 由挂载它的会话视图提供（座位作用域，不读全局"当前会话"）。
 */
export function SkillSwitchBody(props: { store: PanelStore; scope: PanelScope }) {
  const { store, scope } = props
  const state = store.getSnapshot()
  const [, force] = useState(0)
  useEffect(() => store.subscribe(() => force(v => v + 1)), [store])

  // 挂载页每次重渲染都会重建 scope 对象；只依赖原始字段，避免无谓的重新加载。
  const sessionId = scope.sessionId
  const cwd = scope.cwd

  const [data, setData] = useState<PanelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyName, setBusyName] = useState<string | null>(null)
  const [busyGlobal, setBusyGlobal] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [menu, setMenu] = useState<CardMenu>(null)
  const requestSeq = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const next = await api.load(cwd !== undefined && cwd !== '' ? { sessionId, cwd } : { sessionId })
      if (seq !== requestSeq.current) return
      setData(next)
      setLoading(false)
    } catch (cause) {
      if (seq !== requestSeq.current) return
      setError(messageOf(cause))
      setLoading(false)
    }
  }, [sessionId, cwd])

  useEffect(() => { void load() }, [load])

  /** 菜单外点击 / Esc 关闭。 */
  useEffect(() => {
    if (menu === null) return
    const onPointerDown = (event: PointerEvent): void => {
      const el = event.target as Element | null
      if (el !== null && el.closest('[data-skill-card]')) return
      setMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])

  const scopeOf = useCallback(
    (): PanelScope => (cwd !== undefined && cwd !== '' ? { sessionId, cwd } : { sessionId }),
    [sessionId, cwd],
  )

  /** 所有变更共用的执行壳：忙态、错误、用服务端回传的数据整体替换、成功提示。 */
  const run = useCallback(async (
    key: string,
    action: () => Promise<PanelData>,
    done: (next: PanelData) => string,
  ): Promise<void> => {
    setBusyName(key)
    setError(null)
    setNotice(null)
    try {
      const next = await action()
      setData(next)
      // 部分副本被跳过（受保护根 / 删除失败）时必须说出来，否则用户会以为
      // "删干净了"而其实 bundled 等位置的副本还在。
      const skipped = next.lastAction?.skipped?.length ?? 0
      setNotice(skipped > 0 ? `${done(next)} · ${t('skippedOf', { count: skipped })}` : done(next))
      setMenu(null)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusyName(null)
    }
  }, [])

  const toggle = useCallback(async (row: SkillRow): Promise<void> => {
    await run(row.name, () => api.setSwitch(scopeOf(), row.name, !row.blocked), () => t('toggleDone'))
  }, [run, scopeOf])

  const removeSkill = useCallback(async (row: SkillRow): Promise<void> => {
    await run(row.name, () => api.deleteSkill(scopeOf(), row.name), () => t('deleteDone'))
  }, [run, scopeOf])

  const repairSkill = useCallback(async (row: SkillRow): Promise<void> => {
    await run(row.name, () => api.repairSkill(scopeOf(), row.name), () => t('repairDone'))
  }, [run, scopeOf])

  const resetAll = useCallback(async (): Promise<void> => {
    setBusyGlobal(true)
    setError(null)
    setNotice(null)
    try {
      const next = await api.resetSwitches(scopeOf())
      setData(next)
      setNotice(t('resetDone'))
      setConfirmReset(false)
    } catch (cause) {
      setError(messageOf(cause))
      setConfirmReset(false)
    } finally {
      setBusyGlobal(false)
    }
  }, [scopeOf])

  const query = state.query.trim().toLowerCase()
  const rows = (data?.skills ?? []).filter((row) => {
    if (state.filter === 'blocked' && !row.blocked) return false
    if (query !== '') {
      const haystack = `${row.name} ${row.description}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })

  const total = data?.skills.length ?? 0
  const blockedCount = (data?.skills ?? []).filter(row => row.blocked).length
  // `?? []` 是**过渡期防线**：宿主半体仍是被重启前的旧版本时 wire 上没有 errors，
  // 新客户端刷新后不该整页崩掉（重启宿主后行为一致）。
  const errorCount = (data?.skills ?? []).filter(row => (row.errors ?? []).length > 0).length
  const switchCount = (data?.off.length ?? 0) + (data?.on.length ?? 0)

  return (
    <>
      <div className={css.toolbar}>
        <div className={css.filters}>
          <FilterChip
            label={t('filterAll')}
            count={total}
            active={state.filter === 'all'}
            onClick={() => store.actions.setFilter('all')}
          />
          <FilterChip
            label={t('filterBlocked')}
            count={blockedCount}
            active={state.filter === 'blocked'}
            onClick={() => store.actions.setFilter('blocked')}
          />
        </div>
        <div className={css.actions}>
          <input
            className={css.searchInput}
            value={state.query}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            onChange={(event) => store.actions.setQuery(event.target.value)}
          />
          <button
            type="button"
            className={css.ghostButton}
            disabled={busyGlobal || data === null || switchCount === 0}
            title={t('resetAll')}
            onClick={() => setConfirmReset(true)}
          >
            {t('resetAll')}
          </button>
        </div>
      </div>

      {confirmReset && (
        <div className={css.notice}>
          {data?.mode === 'allow' ? t('resetConfirmAllow') : t('resetConfirm')}
          <div className={css.menuActions}>
            <button type="button" className={`${css.ghostButton} ${css.dangerButton}`} disabled={busyGlobal} onClick={() => { void resetAll() }}>
              {busyGlobal ? '…' : t('confirm')}
            </button>
            <button type="button" className={css.ghostButton} disabled={busyGlobal} onClick={() => setConfirmReset(false)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {error !== null && <div className={css.error}>{error}</div>}
      {notice !== null && <div className={css.notice}>{notice}</div>}
      {data?.catalogError === true && <div className={css.error}>{t('catalogUnavailable')}</div>}
      {data !== null && data.verdictAvailable === false && data.catalogError !== true && (
        <div className={css.notice}>{t('verdictUnavailable')}</div>
      )}

      <div className={css.body}>
        {loading && data === null && <p className={css.status}>{t('loading')}</p>}
        {!loading && data === null && <p className={css.status}>{t('loadFailed')}</p>}
        {data !== null && (
          <>
            <div className={css.summary}>{t('summary', { total, blocked: blockedCount, error: errorCount })}</div>
            {rows.length === 0
              ? <p className={css.status}>{emptyLabel(state.filter, query !== '', total)}</p>
              : (
                <div className={css.skillList}>
                  {rows.map(row => (
                    <SkillCard
                      key={row.name}
                      row={row}
                      showVerdict={data.verdictAvailable}
                      busy={busyName === row.name}
                      menu={menu !== null && menu.name === row.name ? menu : null}
                      onToggle={() => { void toggle(row) }}
                      onOpenMenu={() => {
                        setMenu(prev => (prev !== null && prev.name === row.name && prev.mode === 'actions' ? null : { name: row.name, mode: 'actions' }))
                      }}
                      onAskDelete={() => setMenu({ name: row.name, mode: 'confirm-delete' })}
                      onAskRepair={() => setMenu({ name: row.name, mode: 'confirm-repair' })}
                      onConfirmDelete={() => { void removeSkill(row) }}
                      onConfirmRepair={() => { void repairSkill(row) }}
                      onCloseMenu={() => setMenu(null)}
                    />
                  ))}
                </div>
              )}
          </>
        )}
      </div>
    </>
  )
}

/** 一个筛选 chip。 */
function FilterChip(props: { label: string; count: number; active: boolean; onClick: () => void }) {
  const { label, count, active, onClick } = props
  return (
    <button type="button" className={`${css.chip} ${active ? css.chipActive : ''}`} onClick={onClick}>
      {label}
      <span className={css.chipCount}>{count}</span>
    </button>
  )
}

/** 空列表文案：区分"本来就没有"和"被筛选掉了"。 */
function emptyLabel(filter: string, searching: boolean, total: number): string {
  if (total === 0) return t('emptyAll')
  if (searching) return t('emptyFiltered')
  if (filter === 'blocked') return t('emptyBlocked')
  return t('emptyFiltered')
}

/** 打开的卡片菜单状态（`SkillCard` 也导出给渲染测试用）。 */
export type SkillCardMenu = CardMenu

/** `SkillCard` 的 props（导出以便单独做渲染测试）。 */
export interface SkillCardProps {
  row: SkillRow
  /** 面板是否拿到了该会话的观察者作用域（false = 不渲染有效/错误，也不列原因）。 */
  showVerdict: boolean
  busy: boolean
  menu: CardMenu
  onToggle: () => void
  onOpenMenu: () => void
  onAskDelete: () => void
  onAskRepair: () => void
  onConfirmDelete: () => void
  onConfirmRepair: () => void
  onCloseMenu: () => void
}

/**
 * 一张 skill 卡片：左事实（名字 / 来源 / 描述 / 判定与原因），右操作
 * （一键开关键与「操作」菜单）。导出是为了能在不启动 effect 的服务端渲染里
 * 覆盖每条分支。
 */
export function SkillCard(props: SkillCardProps) {
  const { row, showVerdict, busy, menu } = props
  const hasIssues = row.issues.length > 0
  const canRepair = hasIssues && row.descriptionSource !== 'none' && row.copies.some(copy => copy.deletable)
  const libraryOnly = row.copies.length > 0 && row.copies.every(copy => !copy.live)
  // 判定：A 在目录里 ∧ B 模型可调用 ∧ C 用户可调用。errors 为空 = 有效。
  // `?? []` 同 panel：宿主还是旧版本时 wire 上没有 errors，不能让它把页面打崩。
  const errors = showVerdict ? (row.errors ?? []) : []
  const valid = errors.length === 0
  const showMeta = errors.length > 0 || hasIssues || row.nameSource === 'entry'
    || row.descriptionSource === 'body' || row.copies.length > 1 || !row.blockable

  return (
    <div
      className={`${css.skillCard} ${row.blocked ? css.skillCardBlocked : ''} ${menu !== null ? css.skillCardActive : ''}`}
      data-skill-card
    >
      <div className={css.skillMain}>
        <span className={css.skillNameRow}>
          <span className={css.skillName} title={row.name}>{row.name}</span>
          <span className={`${css.badge} ${css.badgeSource}`}>{sourceLabel(row.source)}</span>
          {showVerdict && (
            <span className={`${css.badge} ${valid ? css.badgeValid : css.badgeError}`}>
              {valid ? t('badgeValid') : t('badgeError')}
            </span>
          )}
          {row.blocked && <span className={`${css.badge} ${css.badgeBlocked}`}>{t('badgeBlocked')}</span>}
          {libraryOnly && <span className={css.badge}>{t('badgeUnassigned')}</span>}
          {row.source === 'bundled' && <span className={css.badge}>{t('badgeBundled')}</span>}
          {row.form === 'virtual' && <span className={css.badge}>{t('badgeVirtual')}</span>}
        </span>
        <span className={css.skillDesc} title={row.description}>
          {row.description !== '' ? row.description : '—'}
        </span>
        {showMeta && (
          <span className={css.skillMeta}>
            {errors.length > 0 && <span className={css.metaWarn}>{errors.map(verdictLabel).join(' · ')}</span>}
            {hasIssues && <span className={css.metaWarn}>{row.issues.map(issueLabel).join(' · ')}</span>}
            {row.nameSource === 'entry' && <span>{t('nameFromEntry')}</span>}
            {row.descriptionSource === 'body' && <span>{t('descFromBody')}</span>}
            {row.copies.length > 1 && <span>{t('copiesOf', { count: row.copies.length })}</span>}
            {!row.blockable && <span className={css.metaWarn}>{t('notBlockable')}</span>}
          </span>
        )}
      </div>

      <div className={css.controls}>
        <button
          type="button"
          className={css.switchButton}
          disabled={busy || !row.blockable}
          title={row.blockable ? `${row.blocked ? t('unblock') : t('block')} · ${row.name}` : t('notBlockable')}
          onClick={props.onToggle}
        >
          <span className={`${css.switchTrack} ${row.blocked ? css.switchTrackOn : ''}`}>
            <span className={css.switchKnob} />
          </span>
          {busy ? '…' : row.blocked ? t('unblock') : t('block')}
        </button>
        <button
          type="button"
          className={`${css.opsButton} ${menu !== null ? css.opsButtonActive : ''}`}
          aria-label={t('ops')}
          onClick={props.onOpenMenu}
        >
          {t('ops')}
        </button>
      </div>

      {menu !== null && (
        <div className={css.cardMenu} onClick={(event) => event.stopPropagation()}>
          {menu.mode === 'confirm-delete' ? (
            <>
              <p className={css.menuText}>{t('deleteConfirm')}</p>
              <ul className={css.menuList}>
                {row.copies.map(copy => (
                  <li key={copy.path}>
                    {copy.form === 'bundle' ? copy.directory : copy.path}
                    {copy.deletable ? '' : ` — ${t('protectedCopy')}`}
                  </li>
                ))}
              </ul>
              <div className={css.menuActions}>
                <button type="button" className={`${css.ghostButton} ${css.dangerButton}`} disabled={busy} onClick={props.onConfirmDelete}>
                  {busy ? '…' : t('delete')}
                </button>
                <button type="button" className={css.ghostButton} disabled={busy} onClick={props.onCloseMenu}>
                  {t('cancel')}
                </button>
              </div>
            </>
          ) : menu.mode === 'confirm-repair' ? (
            <>
              <p className={css.menuText}>{t('repairConfirm')}</p>
              <ul className={css.menuList}>
                {row.copies.filter(copy => copy.deletable).map(copy => <li key={copy.path}>{copy.path}</li>)}
              </ul>
              <div className={css.menuActions}>
                <button type="button" className={css.ghostButton} disabled={busy} onClick={props.onConfirmRepair}>
                  {busy ? '…' : t('repair')}
                </button>
                <button type="button" className={css.ghostButton} disabled={busy} onClick={props.onCloseMenu}>
                  {t('cancel')}
                </button>
              </div>
            </>
          ) : (
            <>
              {canRepair && (
                <button type="button" className={css.menuItem} disabled={busy} onClick={props.onAskRepair}>
                  {t('repair')}
                </button>
              )}
              <button
                type="button"
                className={`${css.menuItem} ${css.menuDanger}`}
                disabled={busy || row.copies.length === 0}
                title={row.copies.length === 0 ? t('deleteProtected') : undefined}
                onClick={props.onAskDelete}
              >
                {t('delete')}
              </button>
              {row.copies.length === 0 && <p className={css.menuError}>{t('deleteProtected')}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
