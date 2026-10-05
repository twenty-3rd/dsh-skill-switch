# dsh-skill-switch

DSH（DeepSeek Harness）的**项目级 skill 开关 + 全局删除**插件。在会话里多出一个
「Skill 开关」标签页，用一张表把当前项目的 skill 列清楚，然后：

- **一键开关**：某条 skill 在本项目里是否可见，点一下就生效（写/删
  `<项目根>/.dsh/skill-switches/` 下的开关文件）。
- **全局删除**：把一条 skill 在所有已知根里的副本一次删干净，删完面板与
  runtime 目录里都不再出现。
- **看得见"未生效"的 skill**：缺 `name`/`description`、YAML 坏掉的 skill 在
  官方 provider 眼里会被整条丢弃（只留一条 warn 日志）；本插件仍然把它们列出来、
  标出原因，并能一键补齐 frontmatter 让它们重新生效。

> 这是 v1（`dsh-skill-switch` 0.1.x，纯文件协议、无界面）的 v0.2。v1 的
> **开关文件协议与屏蔽语义一字不改**，升级不需要迁移任何已存在的开关目录。

## 为什么需要它

DSH 的 skill 是全局发现 + 会话注入的：装了的 skill 对所有会话可见。SKILL.md 的
`category`/`paths` 之类"限定范围"的元数据并不存在，所以"这个项目用不到 A 股
分析器"只能靠外部开关表达。本插件补上这一层，并把它做成可以在页面里操作的东西。

## 界面

会话视图标签条里多出第三个标签（对话 / 轨迹 / **Skill 开关**；若装了
dsh-skills-manager，它排在 Skills 管理器之后）。面板由三部分组成：

```
┌ 全部 12   已屏蔽 2   未生效 1 ┐        [ 搜索… ]  [ 恢复本项全部 ]
项目：/Users/me/proj
开关目录：/Users/me/proj/.dsh/skill-switches · mode=deny
──────────────────────────────────────────────────────────────
 已屏蔽  [取消屏蔽 ▣] [操作]  review                        项目 .dsh
        代码审查流程
 未生效  [屏蔽    ▢] [操作]  my-broken-skill                项目 .dsh
        frontmatter 缺少 description · 描述取自正文首段
```

- **左侧筛选 chip**：全部 / 已屏蔽 / 未生效（各自带计数），外加名字+描述搜索。
- **卡片左侧**：名字、来源徽标、状态徽标、描述，以及一行诊断
  （未生效原因、名字取自目录名、副本数量、名字不合法无法开关等）。
- **卡片右侧**：一个纯 CSS 开关键（点一下就是一次切换）+ 「操作」下拉菜单。
- **操作菜单**：「补齐 frontmatter」（仅未生效项）与「删除（全局）」；两者都有
  二次确认，且会把将受影响的文件路径一条条列出来。

## 安装

```sh
# 本地路径（开发/自用）
dsh plugin --profile desktop add /absolute/path/to/dsh-skill-switch

# 发布到 npm 后
dsh plugin --profile desktop add dsh-skill-switch
```

> pnpm 9 遇到 `ERR_PNPM_ADDING_TO_ROOT` 就加 `-w`。

装完后**重启 DSH**（新增 bundle 影响 host 侧组合，仅客户端热加载不够）。

## 功能一：项目级屏蔽

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

仍然可以完全不用界面，直接建文件（与 v1 完全一致）：

```sh
cd <你的项目>
mkdir -p .dsh/skill-switches/off
echo "这个项目用不到" > .dsh/skill-switches/off/ai-supply-chain-bottleneck-hunter
touch .dsh/skill-switches/off/api-design.md    # .md 后缀也认
rm -rf .dsh/skill-switches                     # 全部恢复
```

## 功能二：全局删除

「删除（全局）」会把该名字在**每一处已知根**里的副本都删掉：

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

安全边界：

- 路径**全部由服务端扫描推导**，客户端只能传名字；每个待删路径都要通过
  "严格位于所属根之内、且不是根本身"的校验，越界直接 `403 forbidden`。
- 一次删除里单点失败不会拖垮其它副本；全部副本都不存在时报 `404`。
- 删除成功后会顺手清掉本项目里该名字的开关文件，避免"删了再装回来还带着旧屏蔽"。

## 注意点：让"未生效"的 skill 可见

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

面板把这些问题显示成「未生效」徽标 + 具体原因，并提供「补齐 frontmatter」：
只改 frontmatter（没有就插到文首，坏的整段替换），正文一字不动。修复后
`issues` 当场清空、徽标消失，provider 下一次目录刷新就会重新认领它。

## 配置

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
- 所有文件系统错误降级为透传 + warn 日志，绝不影响 skill 系统本身；插件卸载
  （fiber dispose）自动摘除包装，恢复服务原型方法；HMR 重复加载有防双包装保护。
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
pnpm test        # vitest：110 项（纯逻辑 + 真实 cordis 组合 + 客户端接线/渲染）
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
  「未生效」徽标与列表当场就正确；如果部署里把 `watch` 关掉了，runtime 目录要等到
  下一次目录重建才跟上。
- `skill-library` 根**不参与** runtime 目录（官方 provider 不扫它），所以库里的
  skill 会以「未分配」出现；它仍然会被"全局删除"一并清掉，这正是"删干净"的一部分。
- 需要 host 重启后插件才初次加载；之后的开关变化无需再重启。

## License

MIT
