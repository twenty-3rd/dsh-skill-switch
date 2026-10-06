/**
 * verify-installed.mjs — 验证「已安装进 profile 的插件产物」在 DSH 运行时里真的能用。
 *
 * 为什么需要它：新增 bundle 要重启 DSH 才生效，而重启会中断当前会话。这个脚本
 * 用 **App 同版本**的 DSH 包（cordis / SkillRegistry / skill-filesystem /
 * WebServer）把 profile 里那份已安装产物挂起来跑一遍真实 HTTP 调用，
 * 于是「结构装对了」「代码能跑」两件事可以在不重启的情况下验完。
 *
 * 它验什么（对本插件而言）：
 *   - 产物能被挂载、路由能注册；
 *   - 一键屏蔽写盘 + 官方注册表里确实消失 + get() 被拦截；
 *   - 缺 frontmatter 的 skill 仍可见、补齐后标记消失、删除后磁盘上真没了；
 *   - 客户端产物按 window.__ModuleLoader__ 契约注册且只依赖平台模块；
 *   - fiber dispose 之后包装真的摘掉（不是泄漏）。
 *
 * 用法：
 *   node scripts/verify-installed.mjs
 *
 * 环境变量：
 *   DSH_PROFILE_DIR       profile 目录，默认 ~/.dsh/profiles/desktop
 *   DSH_PLUGIN_NAME       包名，默认 dsh-skill-switch
 *   DSH_RUNTIME_MODULES   提供运行时包的 node_modules 目录（里面应有 @deepseek-ai/*）；
 *                         不给则在候选位置里自动探测
 *
 * 退出码：0 = 全通过；1 = 有失败项。
 */
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { homedir } from 'node:os'

const HOME = homedir()
const PROFILE_DIR = process.env.DSH_PROFILE_DIR ?? join(HOME, '.dsh', 'profiles', 'desktop')
const PLUGIN_NAME = process.env.DSH_PLUGIN_NAME ?? 'dsh-skill-switch'

/** 脚本要用的运行时包（缺任何一个的候选目录都会被跳过）。 */
const REQUIRED_RUNTIME_PACKAGES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-skill',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-host-webserver',
]

/** 该目录是否提供全部需要的运行时包。 */
async function hasRuntimePackages(dir) {
  for (const pkg of REQUIRED_RUNTIME_PACKAGES) {
    try {
      await access(join(dir, pkg, 'package.json'))
    } catch {
      return false
    }
  }
  return true
}

/** 在候选位置里找一份提供全部运行时包的 node_modules 目录。 */
async function findRuntimeModules() {
  const explicit = process.env.DSH_RUNTIME_MODULES
  if (explicit !== undefined && explicit !== '') {
    if (!(await hasRuntimePackages(explicit))) {
      throw new Error(`DSH_RUNTIME_MODULES=${explicit} 里缺少所需的运行时包（应为 node_modules 目录）`)
    }
    return explicit
  }
  const candidates = []
  // npx / pnpm 的临时安装树（本机实测有完整的一套 0.2.0-rc.2）
  for (const base of [join(HOME, '.npm-cache-new', '_npx'), join(HOME, '.npm', '_npx'), join(HOME, '.cache', 'pnpm', 'dlx')]) {
    try {
      for (const entry of await readdir(base)) {
        candidates.push(join(base, entry, 'node_modules'))
      }
    } catch {
      /* 该缓存不存在 */
    }
  }
  // 全局安装的 DSH（版本可能比 App 旧，放在最后兜底）
  candidates.push('/usr/local/lib/node_modules')
  for (const candidate of candidates) {
    if (await hasRuntimePackages(candidate)) return candidate
  }
  throw new Error(
    '找不到提供运行时包的安装树：请用 DSH_RUNTIME_MODULES 指向一个含 @deepseek-ai/* 的 node_modules 目录',
  )
}

const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`)
}

const RUNTIME = await findRuntimeModules()
const INSTALLED = join(PROFILE_DIR, 'node_modules', PLUGIN_NAME)
console.log(`运行时包: ${RUNTIME}`)
console.log(`被测产物: ${INSTALLED}\n`)

const { Context } = await import(`${RUNTIME}/@deepseek-ai/cordis/lib/index.js`)
const { default: SkillRegistry } = await import(`${RUNTIME}/@deepseek-ai/dsh-skill/lib/index.js`)
const skillFs = await import(`${RUNTIME}/@deepseek-ai/dsh-skill-filesystem/lib/index.js`)
const { default: WebServer } = await import(`${RUNTIME}/@deepseek-ai/dsh-host-webserver/lib/index.js`)
const plugin = await import(join(INSTALLED, 'lib', 'index.js'))

const scratch = await mkdtemp(join(tmpdir(), 'ss-installed-'))
const project = join(scratch, 'proj')
await mkdir(join(project, '.git'), { recursive: true })

const app = new Context()
app.provide('sessions', { get: id => (id === 's1' ? { header: { cwd: project } } : undefined) })
app.provide('loader', { entries: () => [{ options: { name: 'connection', config: { trustedHosts: [] } } }] })
await app.plugin(SkillRegistry)
await app.plugin(skillFs, {
  includeDefaultRoots: true,
  dshHome: scratch,
  agentsHome: join(scratch, 'agents'),
  watch: false,
})
await app.plugin(WebServer, { host: '127.0.0.1', port: 0 })
const fiber = app.plugin({ name: plugin.name, inject: plugin.inject, apply: plugin.apply }, {
  dshHome: scratch,
  agentsHome: join(scratch, 'agents'),
  bundledSkillDir: join(scratch, 'bundled'),
  cacheTtlMs: 0,
})
await fiber
const port = app.webServer.port
check('已安装产物能挂载并注册路由', typeof port === 'number' && port > 0, `port=${port}`)

const post = async (method, payload) => {
  const response = await fetch(`http://127.0.0.1:${port}/skill-switch/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: response.status, body: await response.json() }
}

// 正常 skill：屏蔽 → 官方注册表里消失；按名加载被拦截
await mkdir(join(project, '.dsh', 'skills', 'demo'), { recursive: true })
await writeFile(join(project, '.dsh', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: d\n---\n')
let view = (await post('panel.load', { sessionId: 's1' })).body.value
check('panel.load 列出项目 skill', view.skills.some(s => s.name === 'demo'), `cwd=${view.cwd}`)
check('runtime 认领该 skill', view.skills.find(s => s.name === 'demo')?.inCatalog === true)
view = (await post('switches.set', { sessionId: 's1', name: 'demo', blocked: true })).body.value
check('一键屏蔽写盘并生效', view.skills.find(s => s.name === 'demo')?.blocked === true)
check('屏蔽后官方注册表里确实没有它', (await app.skills.list({ cwd: project })).every(s => s.name !== 'demo'))
check('屏蔽后按名加载被拦截', (await app.skills.get('demo', { cwd: project })) === undefined)
await readFile(join(project, '.dsh', 'skill-switches', 'off', 'demo'), 'utf8')
check('开关文件落在 <项目>/.dsh/skill-switches/off/demo', true)

// 缺 frontmatter：可见 → 补齐 → 删除
await mkdir(join(project, '.dsh', 'skills', 'ghost'), { recursive: true })
await writeFile(join(project, '.dsh', 'skills', 'ghost', 'SKILL.md'), '# 没有 frontmatter\n\n描述行\n')
view = (await post('panel.load', { sessionId: 's1' })).body.value
check('缺 frontmatter 的 skill 仍可见并带 frontmatter 事实', view.skills.find(s => s.name === 'ghost')?.issues.length === 1)
view = (await post('skills.repair', { sessionId: 's1', name: 'ghost' })).body.value
check('补齐后 frontmatter 事实消失', view.skills.find(s => s.name === 'ghost')?.issues.length === 0)
view = (await post('skills.delete', { sessionId: 's1', name: 'ghost' })).body.value
check('删除后从面板消失', view.skills.every(s => s.name !== 'ghost'))
check(
  '删除后磁盘上确实没了',
  await readFile(join(project, '.dsh', 'skills', 'ghost', 'SKILL.md'), 'utf8').then(() => false, () => true),
)

// 未知方法不走原型链
const probe = await post('constructor', { sessionId: 's1' })
check('原型链名字被当成未知方法（404）', probe.status === 404, `status=${probe.status}`)

// 客户端产物契约
const clientCode = await readFile(join(INSTALLED, 'lib', 'client.js'), 'utf8')
check(
  '客户端产物按 __ModuleLoader__ 契约注册',
  clientCode.includes('window.__ModuleLoader__.load({') && /id:\s*"dsh-skill-switch"/.test(clientCode),
)
const requires = [...new Set([...clientCode.matchAll(/require\("([^"]+)"\)/g)].map(m => m[1]))].sort()
check('客户端产物只依赖平台模块', requires.join(',') === 'react,react/jsx-runtime', requires.join(','))

// 详情视图（0.4.0）：确认 profile 里那份**已安装产物**就是这次构建，而不是上一次的
// 缓存产物。文案随 zh 字典进产物，所以这是对"装进去的客户端半体已包含新功能"的
// 直接证据；会话里的 host 半体与此无关（本功能是纯客户端的）。
check(
  '客户端产物含详情视图（点开一行 → 存在的根位置）',
  ['存在的根位置', '返回列表', '当前生效', 'DSH 不读它', '受保护，不会删除'].every(text => clientCode.includes(text)),
)
check(
  '详情视图的根标签文案在产物里（含非 runtime 的「Skill 库」）',
  ['项目 .dsh', '共享', 'Skill 库', '内置'].every(text => clientCode.includes(text)),
)

// ── 判定（有效/错误）：必须按**会话作用域**读目录 ─────────────────────────────
//
// 生产拓扑与这里的旧 setup 不同：桌面 profile 里顶层 skill-filesystem 是 disabled
// 的，provider 只注册在 agent preset 的 standing scope 里。所以本段复现该形状：
//   standing scope（匿名 key）里注册 provider → agent key 以 parent 指向它 →
//   面板用 agent（= ScopeKey）查询。不带 scope 只能读到全局层（= 空）。
let scopeUtils
try {
  scopeUtils = await import(`${RUNTIME}/@deepseek-ai/dsh-scope/lib/index.js`)
} catch {
  scopeUtils = undefined
}

if (scopeUtils === undefined) {
  console.log('SKIP  判定作用域检查：运行时树里没有 @deepseek-ai/dsh-scope')
} else {
  const { createScope } = scopeUtils
  const scratch2 = await mkdtemp(join(tmpdir(), 'ss-verdict-'))
  const dsh2 = join(scratch2, 'dsh')
  const agents2 = join(scratch2, 'agents')
  const project2 = join(scratch2, 'proj')
  await mkdir(join(project2, '.git'), { recursive: true })
  const userSkill = async (name, body) => {
    await mkdir(join(dsh2, 'skills', name), { recursive: true })
    await writeFile(join(dsh2, 'skills', name, 'SKILL.md'), body)
  }
  await userSkill('ok', '---\nname: ok\ndescription: d\n---\n')
  await userSkill('model-off', '---\nname: model-off\ndescription: d\ndisable-model-invocation: true\n---\n')
  await userSkill('user-off', '---\nname: user-off\ndescription: d\nuser-invocable: false\n---\n')
  await userSkill('broken', '# 没有 frontmatter\n\n描述行\n')

  const standingKey = {}
  const agentKey = {}
  const app2 = new Context()
  app2.provide('sessions', {
    get: id => (id === 'agent-session' ? { header: { cwd: project2 } }
      : id === 'idle-session' ? { header: { cwd: project2 } }
        : undefined),
  })
  app2.provide('loader', { entries: () => [{ options: { name: 'connection', config: { trustedHosts: [] } } }] })
  // agent 对象本身就是它的 ScopeKey（真实 DSH：scopeTarget(agent, agent)）。
  app2.provide('agents', { get: id => (id === 'agent-session' ? agentKey : undefined) })
  await app2.plugin(SkillRegistry)
  const standing = createScope(app2, standingKey)
  await standing.ctx.plugin(skillFs, {
    includeDefaultRoots: true,
    dshHome: dsh2,
    agentsHome: agents2,
    watch: false,
  })
  createScope(app2, agentKey, { parent: standingKey })
  await app2.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const fiber2 = app2.plugin({ name: plugin.name, inject: plugin.inject, apply: plugin.apply }, {
    dshHome: dsh2,
    agentsHome: agents2,
    bundledSkillDir: join(scratch2, 'bundled'),
    cacheTtlMs: 0,
  })
  await fiber2
  const port2 = app2.webServer.port
  const post2 = async (method, payload) => {
    const response = await fetch(`http://127.0.0.1:${port2}/skill-switch/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { status: response.status, body: await response.json() }
  }

  const globalOnly = (await app2.skills.snapshot({ cwd: project2 })).skills.map(s => s.name).sort()
  const scoped = (await app2.skills.snapshot({ cwd: project2, scope: agentKey })).skills.map(s => s.name).sort()
  check('不带 scope 只读到全局层（复现"面板看不见 skill"的成因）', globalOnly.length === 0, globalOnly.join(','))
  check('按 agent key 读得到 preset 层里的 skill（坏 frontmatter 的条目被 provider 丢弃）', scoped.join(',') === 'model-off,ok,user-off', scoped.join(','))

  const verdict = (await post2('panel.load', { sessionId: 'agent-session' })).body.value
  const errorsOf = n => verdict.skills.find(s => s.name === n)?.errors
  check('有活跃 agent -> 判定列可用', verdict.verdictAvailable === true)
  check('健康 skill = 有效（errors 为空）', JSON.stringify(errorsOf('ok')) === '[]', JSON.stringify(errorsOf('ok')))
  check(
    'disable-model-invocation -> 错误：model-not-invocable',
    JSON.stringify(errorsOf('model-off')) === '["model-not-invocable"]',
    JSON.stringify(errorsOf('model-off')),
  )
  check(
    'user-invocable: false -> 错误：user-not-invocable',
    JSON.stringify(errorsOf('user-off')) === '["user-not-invocable"]',
    JSON.stringify(errorsOf('user-off')),
  )
  check(
    '缺 frontmatter -> 错误：not-in-registry（并附磁盘解释）',
    JSON.stringify(errorsOf('broken')) === '["not-in-registry"]'
      && verdict.skills.find(s => s.name === 'broken')?.issues.length === 1,
    `${JSON.stringify(errorsOf('broken'))} issues=${JSON.stringify(verdict.skills.find(s => s.name === 'broken')?.issues)}`,
  )

  const idle = (await post2('panel.load', { sessionId: 'idle-session' })).body.value
  check('没有活跃 agent 的会话 -> 不判定，且行里没有错误项', idle.verdictAvailable === false
    && idle.skills.every(s => (s.errors ?? []).length === 0))

  await fiber2.dispose()
  await rm(scratch2, { recursive: true, force: true })
}

// 卸载必须真的摘掉包装
await fiber.dispose()
check('卸载后屏蔽失效（包装真的摘掉）', (await app.skills.list({ cwd: project })).some(s => s.name === 'demo'))

await rm(scratch, { recursive: true, force: true })
const passed = results.filter(r => r.ok).length
console.log(`\n结果: ${passed}/${results.length} 通过`)
process.exit(passed === results.length ? 0 : 1)
