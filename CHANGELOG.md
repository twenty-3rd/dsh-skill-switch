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
- **`switches.reset`**：一键清空本项目全部开关。
- 新的 host API：`/skill-switch/api/{panel.load,switches.set,switches.reset,skills.delete,skills.repair}`，
  与 `/api` 网关同规则的浏览器信任栅栏。

### 变更

- 源码从纯 JS（JSDoc）改为 TypeScript；构建产物 `lib/index.js`（ESM node）+
  `lib/client.js`（浏览器 CJS 闭包工厂）+ `lib/types/**/*.d.ts`。
- 测试从 `node --test` 迁到 vitest，并从 19 个单测扩展到 **110 项**（含真实 cordis
  组合集成测试与客户端接线/SSR 渲染测试）。v1 的每一条开关语义都有对应回归用例。
- 新的配置项：`dshHome`、`agentsHome`、`customSkillDirs`、`bundledSkillDir`、
  `allowSharedRootWrites`（默认 `true`；置 `false` 可保持 `~/.agents/skills` 只读）。

### 修复 / 加固

- 面板数据同时使用「磁盘容错扫描」与「runtime 目录」两路事实：被屏蔽的 skill 仍然
  带 `inCatalog: true` 显示，"已屏蔽"与"根本不存在"不再混为一谈。
- 目录缓存残留（注册表还记着、文件已被删除的条目）不再出现在面板里，
  「删掉就看不见」在 provider 刷新之前就成立。
- 删除路径增加"严格位于所属根之内、且不是根本身"的校验，越界直接 403。
- `firstMeaningfulLine()` 跳过代码围栏，不再把示例代码当成描述。

## 0.1.0

- 首个版本：`<项目根>/.dsh/skill-switches/{mode,off/,on/}` 文件协议，
  装饰 `ctx.skills` 的 `snapshot`/`list`/`get` 实现项目级屏蔽。
