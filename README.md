# dsh-skill-switch

[![GitHub stars](https://img.shields.io/github/stars/twenty-3rd/dsh-skill-switch?style=social&label=Star)](https://github.com/twenty-3rd/dsh-skill-switch)

> ⭐ **如果它帮到了你，请点上面的 Star 收藏一下** →
> <https://github.com/twenty-3rd/dsh-skill-switch>
>
> 收藏之后，下次要装、要排查的时候一眼就能找回来；Star 数也是"这个插件还有人用"
> 的可见信号——它比 issue 更能决定一个开源插件还值不值得继续维护。

DSH（DeepSeek Harness）的**项目级 skill 开关 + 全局删除**插件。在会话里多出一个
「Skill 开关」标签页，用一张表把当前项目的 skill 列清楚，然后：

- **一键开关**：某条 skill 在本项目里是否可见，点一下就生效（写/删
  `<项目根>/.dsh/skill-switches/` 下的开关文件）。
- **删除全部副本**：把一条 skill 在所有已知根里的副本一次删干净，删完面板与
  runtime 目录里都不再出现。
- **有效 / 错误判定**：每条 skill 都标出它对这个会话是否"有效"——
  **有效 = A 在 skill 注册表里 ∧ B 模型可主动调用 ∧ C 用户可显式调用**；
  任一条不成立就是「错误」，并把**是哪一条**（以及缺哪个 frontmatter 字段）写在行内。
  官方 provider 会整条丢弃的 skill（缺 `name`/`description`、YAML 坏掉）因此
  仍然看得见、看得懂——这是相对 dsh-skills-manager 的可见性优化。
- **详情视图**：点开一行看这个名字在磁盘上到底有几处副本（根、文件、rank、
  会不会被加载、能不能删、每处各自的 frontmatter 问题）。

| | |
|---|---|
| **版本** | **0.4.0**（历史见 [CHANGELOG](CHANGELOG.md) 与[版本历史](#版本历史)） |
| 许可 | MIT（[LICENSE](LICENSE)） |
| 插件形态 | DSH 标准双半体：host `exports["."]` → `lib/index.js`（ESM）+ client `exports["./client"]` → `lib/client.js`（浏览器 CJS 闭包工厂），`dsh.bundle.patch` → `cordis.patch.yml` |
| 实测环境 | DSH Desktop `0.2.0-rc.2` · macOS arm64 · Node ≥ 20 |
| 测试 | `pnpm test` **172 项**；装进 profile 后 `pnpm verify:installed` **25 项** |

> 这是 v1（`dsh-skill-switch` 0.1.x，纯文件协议、无界面）的 **v0.4**。v1 的
> **开关文件协议与屏蔽语义一字不改**，升级不需要迁移任何已存在的开关目录。

## 为什么需要它

DSH 的 skill 是全局发现 + 会话注入的：装了的 skill 对所有会话可见。SKILL.md 的
`category`/`paths` 之类"限定范围"的元数据并不存在，所以"这个项目用不到 A 股
分析器"只能靠外部开关表达。本插件补上这一层，并把它做成可以在页面里操作的东西。

## 安装（DSH Desktop 标准安装支持）

本包就是**标准形态的 DSH 插件**：用官方 `dsh plugin` 装，不需要手工改 profile、
不需要注册任何全局路径。

### 标准安装用它自己的哪几个部位

| 标准安装要求 | 本包对应物 |
|---|---|
| `package.json` → `dsh.bundle.patch` 指向组合补丁 | ✅ `./cordis.patch.yml`（`insert` 一行 `skill-switch`） |
| host 半体 ESM 入口 | ✅ `exports["."]` → `lib/index.js` |
| client 半体声明 | ✅ `dsh.client{ inject, platform: "web" }` + `exports["./client"]` → `lib/client.js` |
| 安装时**不需要构建**（pnpm ≥ 10 默认不给 git 依赖跑构建脚本） | ✅ `lib/` 随仓库提交（`lib/index.js`、`lib/client.js`、`lib/types/**`） |
| 客户端只依赖平台模块 | ✅ 构建期纯度闸门强制（跨插件协作走 cordis 服务） |
| 卸载后 profile 干净 | ✅ 只往 `dsh.profile.bundles` 里加一项；dispose 时摘除 `ctx.skills` 包装 |

`dsh plugin --profile desktop add …` 做的三件事：初始化 profile → 在 profile 目录里
执行 `pnpm <你的参数>` → 成功后把 manifest 里带 `dsh.bundle.patch` 的依赖追加进
`dsh.profile.bundles`。

### 前置要求

| 项 | 要求 | 说明 |
|---|---|---|
| DSH Desktop | `0.2.0-rc.2` 实测 | 面板用到 `ctx.agents` / `snapshot({ scope })` / `conversation.view` 座位 / `WebServer`，在这个版本上端到端验证过 |
| Node | ≥ 20 | `engines.node` |
| pnpm | **与 profile 一致的大版本**（本机 App 声明 `11.7.0`） | `dsh plugin` 把参数转发给 **PATH 上的 pnpm**；大版本不一致会撞 `ERR_PNPM_UNEXPECTED_STORE`（见下面坑 2） |
| 平台 | macOS arm64 实测；代码无平台特定 | 路径只用 `node:path`，目录监视由官方 provider 负责 |

### 安装命令

```sh
# 1) 从 GitHub（公开仓库；lib/ 已随仓库提交，装完不用构建）
dsh plugin --profile desktop add -w github:twenty-3rd/dsh-skill-switch

# 2) 从本地 checkout（开发/自用）
dsh plugin --profile desktop add -w /absolute/path/to/dsh-skill-switch

# 3) 发布到 npm 之后
dsh plugin --profile desktop add -w dsh-skill-switch
```

`-w` 的意义见坑 1。装完**必须重启 DSH**（新增 bundle 改变 host 侧组合，只刷新页面不够），
重启后视图标签条里会出现「Skill 开关」。

### 本机实测会踩的两个坑

1. **`ERR_PNPM_ADDING_TO_ROOT`** —— profile 本身是一个 pnpm workspace 根
   （`pnpm-workspace.yaml` 里 `packages: ['.']`），因此 `add` / `remove` /
   `update` / `install` 必须带 `-w`。
2. **`ERR_PNPM_UNEXPECTED_STORE`** —— `dsh plugin` 用的是 **PATH 上的 pnpm**，
   而 profile 是用安装自带的 pnpm 装的。本机 App 是 0.2.0-rc.2，其
   `desktop-runtime.json` 声明 `pnpmVersion: 11.7.0`（store `v11`、
   `nodeLinker: hoisted`），但 PATH 上的 `/usr/local/bin/pnpm` 是 **9.6.0**
   （store `v3`），于是报
   `dependencies are currently linked from /…/store/v11, pnpm now wants to use /…/store/v3`。
   解决：让 `dsh plugin` 看到 11.7.0 的 pnpm。

两个坑可以一次绕开——用随本机装好的小包装脚本 `~/.dsh/plugin-src/dsh-plugin`：

```sh
~/.dsh/plugin-src/dsh-plugin add /absolute/path/to/dsh-skill-switch
~/.dsh/plugin-src/dsh-plugin ls
~/.dsh/plugin-src/dsh-plugin remove dsh-skill-switch
```

它从 profile 自己的 `node_modules/.modules.yaml` 读出 pnpm 版本（本机 11.7.0），
用 corepack 拉起同一版本，并对写操作自动补 `-w`。想手动复现等价于：

```sh
cd ~/.dsh/profiles/desktop
corepack pnpm@11.7.0 add -w /absolute/path/to/dsh-skill-switch
# 然后把 "dsh-skill-switch" 追加进 package.json 的 dsh.profile.bundles
```

> **`desktop` profile 不能由 CLI 启动/转储**：0.2 的 CLI 对
> `--profile desktop` 的 boot / `--dump-config` 会直接拒绝
> （`profile "desktop" is managed exclusively by the Electron application`），
> 基础 bundle 由 App 运行时提供。所以组合与启动校验只能在 App 里做；CLI 侧
> 只有 `plugin` 子命令被允许。

### 怎么确认装对了

```sh
# 结构面：profile 只应有两处变化
cat ~/.dsh/profiles/desktop/package.json
#   dependencies 里多一条 "dsh-skill-switch"
#   dsh.profile.bundles 里多一项 "dsh-skill-switch"
# cordis.patch.yml / pnpm-workspace.yaml / cordis.yml 不应有任何变化
```

```sh
# 运行面（源码 checkout 才有；npm 包的 files 里不带 scripts/）
cd /path/to/dsh-skill-switch
pnpm install && pnpm verify:installed      # 25 项：产物能挂载、屏蔽/删除/补齐走真实 HTTP、
                                           # 客户端产物符合 __ModuleLoader__ 契约、dispose 真摘包装
```

两条都过之后再重启 App，标签条里就会出现「Skill 开关」（不重启的话，结构面能确认，
面板不出现）。

### 卸载

```sh
dsh plugin --profile desktop remove -w dsh-skill-switch
# 重启 DSH
```

面板与 `/skill-switch/api/*` 路由随 fiber dispose 一起消失，`ctx.skills` 的包装会被
摘回原函数（有回归用例固定住"dispose 之后 `off/<name>` 不再隐藏"）。

## 使用说明

三步：**打开任一会话 → 点视图标签条里的「Skill 开关」→ 用行内开关切换**。
面板按会话 cwd 所属的**项目**生效；切换立刻写盘，变化在**下一个模型轮次**生效，
不需要重启。

### 界面

会话视图标签条里多出第三个标签（对话 / 轨迹 / **Skill 开关**；若装了
dsh-skills-manager，它排在 Skills 管理器之后）。面板由三部分组成：

```
┌ 全部 12   已屏蔽 2 ┐                   [ 搜索… ]  [ 恢复本项全部 ]
──────────────────────────────────────────────────────────────
 项目 .dsh  有效   [取消屏蔽 ▣] [操作]  review
            代码审查流程
 项目 .dsh  错误   [屏蔽    ▢] [操作]  my-broken-skill
            不在 skill 注册表里（DSH 不会加载它） · frontmatter 缺少 description
```

- **左侧筛选 chip**：全部 / 已屏蔽（各自带计数），外加名字+描述搜索。
- **卡片左侧**：名字、来源徽标、**有效/错误徽标**、描述，以及一行事实
  （判定失败的是 A/B/C 哪一条、frontmatter 缺什么、名字取自目录名、副本数量、
  名字不合法无法开关等）。
- **卡片右侧**：一个纯 CSS 开关键（点一下就是一次切换）+ 「操作」下拉菜单。
- **操作菜单**：「补齐 frontmatter」（仅 frontmatter 有问题的项）与
  「删除（全部副本）」；两者都有二次确认，且会把将受影响的文件路径一条条列出来。

### 点开一行 → 详情（只读）

点卡片左侧的事实区（名字 / 描述）进入详情页，「返回列表」回到列表（筛选与搜索词保留）。
开关键与「操作」按钮不在事实区里，点它们不会跳走（名字不合法、不能写开关的行也照样能看详情）。

```
┌ [返回列表]  demo  项目 .dsh  有效 ┐
描述
  代码审查流程
判定依据
  在 skill 注册表里（条件 A）    是
  模型可主动调用（条件 B）      是
  用户可显式调用（条件 C）      是
存在的根位置 · 2 处副本
  项目 .dsh  当前生效  目录 bundle  会被 DSH 加载  优先级 100
    根: /proj/.dsh/skills
    文件: /proj/.dsh/skills/demo/SKILL.md
  用户  目录 bundle  会被 DSH 加载  优先级 400
    根: /home/me/.dsh/skills
    文件: /home/me/.dsh/skills/demo/SKILL.md
```

详情只做"把列表里被折叠掉的事实摊开"：列表每行只显示**胜出副本**（rank 最小者），
同名 skill 散在共享根 / DSH 根 / 库根里时，详情是唯一能看到另外几处的地方——包括
每处副本**各自**的 frontmatter 问题（同一个名字在不同根里状态可能不同）、会不会被
DSH 实际加载、能不能删。它**不带任何写动作**（屏蔽 / 删除 / 补齐仍在列表里）。

顶部**不再显示**项目绝对路径、开关目录与 `mode`：那是内部实现细节，用户无法据此
行动（开关目录的语义仍在「恢复本项全部」的二次确认里说明）。

### 功能一：项目级屏蔽

开关放在项目自己的 `.dsh/skill-switches/` 里，随仓库走、随项目生效：

```
<项目根>/.dsh/skill-switches/
├── mode           # 可选：第一行 "deny"（默认）或 "allow"
├── off/<name>     # deny 模式：这些 skill 被隐藏
└── on/<name>      # allow 模式：只有这些 skill 可见
```

- **项目级**：同一个 host 进程里，A 项目关掉的 skill 在 B 项目照常可见。
- **会话内生效**：变化在会话的**下一个轮次**自动反映到 skill 目录——`dsh-tool-skill`
  每轮 `agent/pre-step` 用 `{cwd: session.header.cwd}` 调 `snapshot`，digest 变化
  即重写系统提示里的目录，无需重启。
- **彻底隐藏**：被关掉的 skill 不仅从目录消失，`skill` 工具按名加载也会被拦截。

面板里的"屏蔽/启用"在两种模式下语义一致（**是否隐藏**）：

| 模式 | 屏蔽 | 恢复 |
|------|------|------|
| `deny`（默认） | 建 `off/<name>` | 删 `off/<name>` |
| `allow` | 删 `on/<name>` | 建 `on/<name>` |

两种情况下都会顺手清掉另一侧的同名残留，避免手工切换模式后语义漂移。

面板右上角的「恢复本项全部」清空 `off/` 与 `on/`；如果项目当前是 `allow`
（白名单）模式，它会**同时移除 `mode` 文件**——只清 `on/` 会让白名单变成空集，
等于把整个 skill 目录清空，与"恢复默认可见性"正好相反。确认框里会写明这一点。

仍然可以完全不用界面，直接建文件（与 v1 完全一致）：

```sh
cd <你的项目>
mkdir -p .dsh/skill-switches/off
echo "这个项目用不到" > .dsh/skill-switches/off/ai-supply-chain-bottleneck-hunter
touch .dsh/skill-switches/off/api-design.md    # .md 后缀也认
rm -rf .dsh/skill-switches                     # 全部恢复
```

### 功能二：全局删除

「删除（全部副本）」会把该名字在**每一处已知根**里的副本都删掉：

| 根 | 来源 id | 是否可删 |
|----|---------|----------|
| `<项目根>/.dsh/skills` | `project-dsh` | ✅ |
| `<项目根>/.agents/skills` | `project-agents` | ✅ |
| `customSkillDirs` | `custom` | ✅ |
| `$DSH_HOME/skills`（`~/.dsh/skills`） | `user-dsh` | ✅ |
| `$DSH_AGENTS_HOME/skills`（`~/.agents/skills`） | `user-agents` | ✅（可用 `allowSharedRootWrites: false` 变只读） |
| `$DSH_BUNDLED_SKILL_DIR` | `bundled` | ❌ 随宿主应用分发，删了会破坏安装 |
| `$DSH_HOME/skill-library` | `library` | ✅（dsh-skills-manager 的规范副本） |
| 其它 provider 注册的虚拟 skill | `runtime` / 任意 | ❌ 磁盘上没有可删的东西 |

**范围要说清楚**：本插件扫描的根由"当前会话 cwd 的项目根 + 用户级/共享/内置/库"
组成，所以**别的项目的项目级副本（`<另一个项目>/.dsh/skills`）不在扫描范围内**——
面板上按的是「删除（全部副本）」而不是「删除（全局）」，确认框里也会写明这一点。
要在别的项目里也消失，去那个项目的会话里再删一次（或直接删那个目录）。

安全边界：

- 路径**全部由服务端扫描推导**，客户端只能传名字；每个待删路径都要通过
  "严格位于所属根之内、且不是根本身"的校验，越界直接 `403 forbidden`。
- 一次删除里单点失败不会拖垮其它副本；全部副本都不存在时报 `404`。
- **请求里的 `cwd` 只在宿主确实认识该 session、且它的 cwd 还没 hydrate 时**才被
  当作兜底；sessionId 不认识时一律用宿主进程 cwd。否则任何调用方都能拿一个不存在的
  sessionId 加任意绝对路径，让写入/删除发生在别处。
- 方法派发走 `Object.hasOwn`：`constructor` / `toString` 这类原型成员会被当成
  "未知方法"返回 404，不会命中原型链。
- `/skill-switch` 的 error.message 一律是**面向机器的英文**（wire 层）；面板按
  wire code 出本地化文案，所以中文界面不会混进英文细节、英文界面也不会混进中文。
- 删除成功后会顺手清掉本项目里该名字的开关文件，避免"删了再装回来还带着旧屏蔽"。

### 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: skill-switch
  config:
    switchesDir: .dsh/skill-switches   # 相对项目根的开关目录
    defaultMode: deny                  # deny | allow
    cacheTtlMs: 1000                   # 状态缓存兜底时长（mtime 指纹命中则即时失效）
    forceRefreshOnGet: true            # get() 拦截路径是否绕过缓存
    dshHome: ''                        # 默认 resolveDshHome()（$DSH_HOME 或 ~/.dsh）
    agentsHome: ''                     # 默认 $DSH_AGENTS_HOME 或 ~/.agents
    customSkillDirs: []                # 额外 skill 根（同官方 provider 的 custom 层）
    bundledSkillDir: ''                # 默认 $DSH_BUNDLED_SKILL_DIR
    allowSharedRootWrites: true        # false = ~/.agents/skills 只读（不动 Claude Code 的共享根）
```

## 注意点：判定「有效 / 错误」的口径

**有效 = A 在目录里 ∧ B 模型可主动调用 ∧ C 用户可显式调用**；任一条不成立 = 「错误」，
且面板会写出是哪一条：

| 失败项 | 含义 | 面板文案 |
|--------|------|----------|
| A `not-in-registry` | 这个会话的 skill 注册表里没有它 → DSH 不会加载 | 不在 skill 注册表里（DSH 不会加载它） |
| B `model-not-invocable` | `invocation.modelInvocable === false`（`disable-model-invocation: true`） | 模型不能主动调用（disable-model-invocation） |
| C `user-not-invocable` | `invocation.userInvocable === false`（`user-invocable: false`） | 用户不能显式调用（user-invocable: false） |

**A 必须按会话的观察者作用域读。** `SkillRegistry.snapshot()` 的 `scope` 决定它读哪些
layer（官方注释："omitted reads the global layer alone"）；桌面 profile 里顶层
`skill-filesystem` 是 `disabled` 的，真正的 provider 注册在 agent preset 的 standing
scope 上。所以面板用 `ctx.agents.get(sessionId)` 拿到该会话的 agent（在 DSH 里
**agent 对象本身就是它的 ScopeKey**：`scopeTarget(agent, agent)`），再以
`snapshot({ cwd, scope: agent })` 读取——否则只能读到全局层（实测 37 行里只剩 3 条
内置 skill），把每个用户 skill 都误判成「错误」。

拿不到活跃 agent（归档/未 hydrate 的会话）或目录读取失败时，面板**不显示判定列**，
wire 上也不产出任何错误项：把"我不知道"渲染成"它是错的"是欺骗。

### 为什么官方会丢弃某些 skill（A 失败的解释器）

`@deepseek-ai/dsh-skill-filesystem` 的 `parseSkillFile()` 要求 frontmatter 同时具有
合法的 kebab-case `name` 与非空 `description`，否则**整条丢弃**。后果是这类 skill
在任何只看 runtime 目录的面板里都是隐形的——用户既看不到，也无从修。

本插件按与官方 provider **相同的根与 rank** 扫描磁盘，但对每条候选做容错解析：

| 情况 | 官方 provider | 本插件 |
|------|---------------|--------|
| 缺 `name` | 丢弃 | 列出，名字回退到目录名/文件名 |
| 缺 `description` | 丢弃 | 列出，描述回退到正文第一段有意义的文字（跳过代码围栏） |
| 无 frontmatter | 丢弃 | 列出，正文照常作为描述来源 |
| YAML 解析失败 | 丢弃 | 列出，且仍能从围栏之后取正文 |
| 名字不是 kebab-case | 丢弃 | 列出，标 `invalid-name`，并禁用开关（写不了开关文件） |
| `name`/`description` 不是字符串（如数字） | 丢弃 | 列出，按官方口径报 `missing-name` / `missing-description` |
| invocation 字段非法或用了遗留键 | 丢弃 | 列出，标 `invalid-invocation` |

判定口径是**逐字对齐**官方 `parseSkillFile()` 的：只有非空 `string` 才算字段存在
（不 trim、不把数字转字符串），`disable-model-invocation` / `user-invocable` 只认
boolean / 1 / 0 / true / false / yes / no / on / off，出现 `disableModelInvocation`
一类的遗留键即视为整条非法。

这些 `issues` 不再是独立徽标，而是 **A 失败的证据**：一行显示成
`错误 · 不在 skill 注册表里（DSH 不会加载它） · frontmatter 缺少 description`。
一行只说"错误"、不说为什么，是不可行动的；而上一版在凭据不足时说的
「未生效 · 原因未知」，已经把"我没读到"当成了结论——两者都去掉了。

「补齐 frontmatter」仍然只改 frontmatter（没有就插到文首，坏的整段替换），正文
一字不动；修复后 `issues` 清空、判定转「有效」。

## 架构

```
host 半体 (lib/index.js)
├── installSkillFilter()   装饰 ctx.skills 的 snapshot/list/get
│     snapshot/list -> 原始收集 -> 按会话 cwd 解析项目根 -> 读开关目录 -> 过滤
│     get(name)     -> 先查开关状态 -> 隐藏项直接 undefined -> 否则穿透原 get
└── /skill-switch/api/*    面板 JSON 接口（POST，浏览器信任栅栏 + 根内路径约束）
      panel.load / switches.set / switches.reset / skills.delete / skills.repair

client 半体 (lib/client.js)
└── conversation.view 座位上的「Skill 开关」标签（会话作用域，请求作用域骑在座位上）
```

- 开关状态缓存采用 **mtime 指纹 + TTL 双条件**：通常即时失效（现代文件系统
  mtime 纳秒级），粗粒度 mtime 的文件系统由 TTL 兜底（默认 1 秒）。
- 所有文件系统错误降级为透传 + warn 日志，绝不影响 skill 系统本身。
- 卸载（fiber dispose）真的会摘除包装、恢复原始方法：teardown 是登记成 cordis
  的 disposer（`ctx.effect(() => () => {…})`），不是写在 effect body 里——后者会在
  安装瞬间就"卸载"并永远泄漏包装。恢复按包装前捕获的函数值赋值，不依赖
  `===` 比较（cordis 每次读取服务属性可能给出不同的绑定代理）。
  `WRAP_TAG` 只在卸载时清，所以 HMR/重复加载的双重包装保护在整个生命周期内有效。
  真实 cordis 的回归用例覆盖了"dispose 之后 off/<name> 不再隐藏"。
- 路由栅栏与 `/api` 网关同规则（Host loopback 或 connection 行的 trustedHosts，
  跨站标记拒绝），是 DNS-rebinding/CSRF 防御，不是认证。
- 面板请求走**未包装**的注册表，所以被屏蔽的 skill 仍然带着
  `inCatalog: true` 显示——"已屏蔽"和"根本不存在"不会被混为一谈。

## 与 dsh-skills-manager 的分工

刻意不重叠。dsh-skills-manager 管 **skill 生命周期**（Skill 库 + 用户级/项目级
**分配副本** + 新建 / 编辑 / 重命名 / 同步 / 回收）；本插件管 **生效范围控制与
一次性清除**，没有创建、没有编辑器、没有分配、没有重命名、没有同步、没有
「打开文件夹」。

## 测试

```sh
pnpm test              # 先 pnpm build 再 vitest：172 项（纯逻辑 + 真实 cordis 组合 + 客户端接线/渲染 + 产物加载）
pnpm test:unit         # 只跑测试（用现有 lib/，改过 src 请先 build）
pnpm verify:installed  # 装进 profile 之后：拿 App 同版本运行时验那份已安装产物（25 项，含按作用域判定与详情视图产物）
pnpm typecheck   # tsc --noEmit
pnpm build       # lib/index.js + lib/client.js + lib/types
```

真实组合那一组（`tests/host-api.spec.ts`）会启动真正的 `SkillRegistry` +
真正的 `dsh-skill-filesystem` provider + 真正的 `WebServer`，用真实 HTTP 验证：
屏蔽后**官方注册表**的目录里确实少了一项、`get()` 确实返回 undefined；缺
frontmatter 的 skill 确实在注册表里没有而在面板里有；删除后磁盘与两个视图都干净。

## 已知边界

- 过滤按 skill **名字**匹配，不区分来源（用户级、项目级、插件自带、runtime 注册的
  同名 skill 一视同仁）。
- 开关变化在**下一个模型轮次**生效（目录重渲染机制自身的语义），不追溯修改已注入
  的历史消息。
- 删除/补齐之后，`SkillRegistry` 的目录缓存由 provider 的**文件监视器**刷新
  （`dsh-skill-filesystem` 的 `watch` 默认开启）。面板自身的事实来自磁盘扫描，所以
  判定与 frontmatter 事实当场就正确；如果部署里把 `watch` 关掉了，判定里的 A
  （在不在注册表）要等到下一次目录重建才跟上。
- 判定里的 A 依赖**活跃 agent**：会话归档/未 hydrate 时面板不显示判定列，而不是把
  每一行都说成错误——宁可不说，也不说错。
- 升级到 0.3 需要**重启宿主**（host 半体是启动时加载的）。过渡期若只刷新页面而没
  重启，客户端对缺失的 `errors` 字段按空处理，不会白屏。
- `skill-library` 根**不参与** runtime 目录（官方 provider 不扫它），所以库里的
  skill 会以「未分配」出现；它仍然会被"全局删除"一并清掉，这正是"删干净"的一部分。
- 删除与补齐都走库语义：`fs.rm` 对符号链接只摘链接本身（不穿透删目标内容），
  `writeFileAtomic` 是同目录临时文件 + rename（替换链接本身）。根内的链接不会
  造成越界删除，这一点有专门的测试固定住。
- 「删除（全部副本）」不覆盖**其它项目**的项目级副本（见上文"范围要说清楚"）。
- 需要 host 重启后插件才初次加载；之后的开关变化无需再重启。

## 版本历史

| 版本 | 内容 |
|---|---|
| **0.4.0** | 详情视图（点一行看每处盘上副本的根/文件/rank/可删性）、「返回列表」移到行右端、`lib/` 与 README 面向发布整理 |
| 0.3.0 | 「有效 / 错误」判定（A ∧ B ∧ C）+ 按会话观察者作用域读注册表；删除「未生效」徽标与筛选面 |
| 0.2.0 | host + client 双半体面板：会话标签页、一键开关、全局删除、补齐 frontmatter；135 项测试 |
| 0.1.0 | 首个版本，纯文件协议：`.dsh/skill-switches/{mode,off/,on/}` 装饰 `ctx.skills` |

逐条变更见 [`CHANGELOG.md`](CHANGELOG.md)。

## 支持这个项目

- ⭐ **点 Star 收藏** ← 最省事也最有用的一步：<https://github.com/twenty-3rd/dsh-skill-switch>
  （页面右上角 `☆ Star` → `★ Starred`）。它让更多在做 DSH skill 管理的人搜到这个插件，
  也让我知道有人真的在用。
- 🐛 **报问题 / 提需求**：<https://github.com/twenty-3rd/dsh-skill-switch/issues>
  —— 安装踩的坑、判定口径的疑问、边界想放宽的地方，都欢迎开 issue。
- 发现 README 说法与代码不一致（判定口径、已知边界），直接指出即可；本项目的原则是
  "宁可不说，也不说错"，这类反馈优先级最高。

## License

MIT，见 [LICENSE](LICENSE)。
