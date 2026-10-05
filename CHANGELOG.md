# Changelog

## 0.2.0

从"纯文件协议、无界面"的 0.1.x 升级为 **host + client 双半体**的面板插件。
**开关文件协议与屏蔽语义完全向后兼容**：已有的 `.dsh/skill-switches/` 目录
不需要迁移，`off/`、`on/`、`mode` 的读取口径一字未改。

### 新增

- **会话视图标签「Skill 开关」**：注册进 ui-conversation 的 `conversation.view`
  座位（order 30，排在 chat 0 / trajectory 10 / skills 20 之后），会话作用域注入
  SessionId——请求作用域从不依赖全局"当前会话"字段。
- **一键开关**：卡片上的纯 CSS 开关键直接写/删开关文件；面板给出
  「已屏蔽 / 未生效」双徽标、来源徽标、诊断行与搜索/筛选 chip。
- **全局删除**：一次清掉该 skill 在所有已知根里的副本（项目 `.dsh/skills`、
  项目 `.agents/skills`、custom、`~/.dsh/skills`、`~/.agents/skills`、
  `~/.dsh/skill-library`）。路径全部由服务端扫描推导 + 根内校验；
  `bundled` 与 runtime 虚拟 skill 一律拒绝；删除后顺手清掉该名字的开关文件。
- **「未生效」可见 + 一键补齐 frontmatter**：官方 provider 会丢弃缺
  `name`/`description`、YAML 坏掉、名字不合法的 skill；本插件按相同的根与 rank
  扫描磁盘并容错解析，把它们列出来、标出原因，并能只改 frontmatter 地把它们修好。
- **`switches.reset`**：一键清空本项目全部开关；白名单（`allow`）模式下会
  同时移除 `mode` 文件，否则"清空 `on/`"等于把整个 skill 目录清空。
- 新的 host API：`/skill-switch/api/{panel.load,switches.set,switches.reset,skills.delete,skills.repair}`，
  与 `/api` 网关同规则的浏览器信任栅栏。

### 变更

- 源码从纯 JS（JSDoc）改为 TypeScript；构建产物 `lib/index.js`（ESM node）+
  `lib/client.js`（浏览器 CJS 闭包工厂）+ `lib/types/**/*.d.ts`。
- 测试从 `node --test` 迁到 vitest，并从 19 个单测扩展到 **135 项**（含真实 cordis
  组合集成测试与客户端接线/SSR 渲染测试）。v1 的每一条开关语义都有对应回归用例。
- 新的配置项：`dshHome`、`agentsHome`、`customSkillDirs`、`bundledSkillDir`、
  `allowSharedRootWrites`（默认 `true`；置 `false` 可保持 `~/.agents/skills` 只读）。

### 修复 / 加固（含一轮对抗性评审后的整改）

**生命周期（严重）**

- `ctx.effect` 的 teardown 写在了 effect body 里：cordis 的语义是"execute 立即执行、
  它的**返回值**才是 disposer"，于是安装瞬间就把 `WRAP_TAG` 删了（双包装保护失效）
  且真正的卸载什么都不做——包装永久泄漏，卸载后 `off/<name>` 仍然隐藏该 skill，
  而 `/skill-switch` 路由已经注销，用户既看不到面板也没有入口恢复。
  现在改为 `ctx.effect(() => () => {…})`，并按包装前捕获的函数值赋值还原
  （不依赖 `===`：cordis 每次读取服务属性可能给出不同的绑定代理）。
- 对应的假 ctx 骨架把 `effect` 语义写反了（只在 dispose 时调用 fn），把上面这个
  bug 完全遮住；测试骨架已按真实 cordis 语义重写，并新增"dispose 之后磁盘上的
  `off/<name>` 不再隐藏该 skill"的回归用例（对着旧实现跑会红 9 条）。

**正确性**

- `rawRegistry` 在包装**之后**读取 `ctx.skills.snapshot`，拿到的是过滤后的版本：
  只存在于 runtime 的虚拟 skill 一旦被屏蔽就从面板消失、再也无法用面板恢复。
  现在原始方法在包装前捕获并显式传入（`installSkillFilter` 的返回值）。
- `clearSwitches` 用 `rm(dir, { recursive: false })` 删空目录，对目录必然抛
  `EISDIR` 且被吞掉 → 空 `off/`/`on/` 永远留着、`present` 永远为 true。改为
  `recursive: true`，并在三个开关文件都清干净后连开关根一起删，让项目回到
  `present:false` 的纯透传状态；`defaultMode: 'allow'` + 无 `mode` 文件时
  "清空 = 全隐藏"的陷阱（白名单空集）随之消失。
- 扫描判定与官方 `parseSkillFile()` 对齐：`stringField` 只认非空 string（不 trim、
  不把数字转字符串），并建模 invocation 字段非法/遗留键（新增 issue
  `invalid-invocation`）。此前 `name: 123` 会被显示成完全正常的 skill，而官方的
  行为是整条丢弃。
- 面板新增「未生效 · 原因未知」状态与 `catalogError` 横幅：磁盘有、注册表没有、
  frontmatter 又没问题时不再假装正常。
- 删除后清理开关文件改用 `removeSwitchFiles`（两侧都删且不新建）：此前走
  `writeSwitch(name, false)`，在 allow 模式下等于往 `on/` 写一个"预授权可见"的
  幽灵条目。
- 请求里的 `cwd` 只有在宿主**认识该 session** 且其 cwd 未 hydrate 时才作兜底；
  此前一个不存在的 sessionId 加任意绝对路径就能改变写入/删除的目标目录。
- 方法派发改用 `Object.hasOwn`：`constructor` / `toString` 等原型成员此前会被
  当成合法方法（200/500），而不是"未知方法 404"。
- `repairFrontmatter` 对"有 `---` 开头但没有收尾围栏"的文件不再吞掉正文：这种情况
  下 body 回退成整个原文，只把新 frontmatter 插到最前面。

**诚实性 / 可用性**

- 「删除（全局）」改名为「删除（全部副本）」，确认框标明"其他项目自己的
  `.dsh/skills` 不在扫描范围内"，并对 `deletable === false` 的副本逐条标注
  「受保护，将跳过」；变更后如实地把跳过的副本数量显示出来。
- host/client 的 wire 类型不再手抄两份：客户端 `import type` 复用 host 的
  `PanelView` / `SkillView` / `SkillCopyView` / `SkillIssue`（类型擦除，不进入产物），
  字段漂移会在 `tsc --noEmit` 直接报错。
- 面板错误文案按 wire code 本地化，不再把 host 的机器面英文/中文细节直接塞进 UI。
- 清理无引用的文案 key；`lib/index.js` 也纳入"产物比 src 新"的构建新鲜度闸门。

### 其他加固

- 面板数据同时使用「磁盘容错扫描」与「runtime 目录」两路事实：被屏蔽的 skill 仍然
  带 `inCatalog: true` 显示，"已屏蔽"与"根本不存在"不再混为一谈。
- 目录缓存残留（注册表还记着、文件已被删除的条目）不再出现在面板里，
  「删掉就看不见」在 provider 刷新之前就成立。
- 删除路径增加"严格位于所属根之内、且不是根本身"的校验，越界直接 403。
- `firstMeaningfulLine()` 跳过代码围栏，不再把示例代码当成描述。

## 0.1.0

- 首个版本：`<项目根>/.dsh/skill-switches/{mode,off/,on/}` 文件协议，
  装饰 `ctx.skills` 的 `snapshot`/`list`/`get` 实现项目级屏蔽。
