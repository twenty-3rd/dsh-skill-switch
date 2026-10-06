/**
 * zh/en 文案。走 DSH 的 i18n 系统：client apply 时挂上 `ctx.locale`，
 * `t()` 从活动 locale 解析文案；两份字典同时注册进 DSH 的 locale registry。
 *
 * 判定词只有两个：**有效**（A 在目录里 ∧ B 模型可调用 ∧ C 用户可调用）与
 * **错误**（任一条不成立）。不给"未生效"留文案：那个词同时指过四件不同的事，
 * 是上一版误报的根源。
 */
export declare const LOCALE_NS = "dsh-skill-switch";
/** zh 字典（同时注册进 DSH locale registry）。 */
export declare const zh: {
    readonly panelTitle: "Skill 开关";
    readonly filterAll: "全部";
    readonly filterBlocked: "已屏蔽";
    readonly searchPlaceholder: "搜索名字或描述…";
    readonly resetAll: "恢复本项全部";
    readonly resetConfirm: "清空本项目所有开关文件？所有 skill 恢复默认可见性。";
    readonly resetConfirmAllow: "本项目是白名单模式（mode=allow）：只清空 on/ 会让白名单变成空集、所有 skill 全部消失。确认会同时移除 mode 文件，让项目回到默认可见性。";
    readonly loading: "加载中…";
    readonly loadFailed: "加载失败";
    readonly emptyAll: "这个项目里还没有发现任何 skill";
    readonly emptyFiltered: "没有符合条件的 skill";
    readonly emptyBlocked: "本项目当前没有屏蔽任何 skill";
    readonly block: "屏蔽";
    readonly unblock: "启用";
    readonly ops: "操作";
    readonly delete: "删除（全部副本）";
    readonly repair: "补齐 frontmatter";
    readonly cancel: "取消";
    readonly confirm: "确认";
    readonly summary: "共 {total} 个 · 已屏蔽 {blocked} · 错误 {error}";
    readonly rootProjectDsh: "项目 .dsh";
    readonly rootProjectAgents: "项目 .agents";
    readonly rootCustom: "自定义";
    readonly rootUserDsh: "用户";
    readonly rootUserAgents: "共享";
    readonly rootBundled: "内置";
    readonly rootLibrary: "Skill 库";
    readonly badgeBlocked: "已屏蔽";
    readonly badgeValid: "有效";
    readonly badgeError: "错误";
    readonly badgeUnassigned: "未分配";
    readonly badgeBundled: "只读";
    readonly badgeVirtual: "运行时";
    readonly copiesOf: "{count} 处副本";
    readonly openDetail: "查看详情";
    readonly backToList: "返回列表";
    readonly detailDescription: "描述";
    readonly detailRoots: "存在的根位置";
    readonly detailNoCopies: "由运行时提供，磁盘上没有副本。";
    readonly detailCopyCurrent: "当前生效";
    readonly detailCopyLive: "会被 DSH 加载";
    readonly detailCopyNotLive: "DSH 不读它";
    readonly detailCopyRank: "优先级 {rank}";
    readonly detailCopyProtected: "受保护，不会删除";
    readonly detailFormBundle: "目录 bundle";
    readonly detailFormFlat: "单文件 .md";
    readonly detailRootLabel: "根";
    readonly detailFileLabel: "文件";
    readonly detailEntryName: "条目名 {name}";
    readonly detailVerdict: "判定依据";
    readonly detailInRegistry: "在 skill 注册表里（条件 A）";
    readonly detailModelInvocable: "模型可主动调用（条件 B）";
    readonly detailUserInvocable: "用户可显式调用（条件 C）";
    readonly yes: "是";
    readonly no: "否";
    readonly verdictNotInRegistry: "不在 skill 注册表里（DSH 不会加载它）";
    readonly verdictModelBlocked: "模型不能主动调用（disable-model-invocation）";
    readonly verdictUserBlocked: "用户不能显式调用（user-invocable: false）";
    readonly verdictUnavailable: "当前会话没有活跃的 agent，本次不显示有效/错误判定。";
    readonly issueMissingFrontmatter: "缺少 YAML frontmatter，DSH 会忽略它";
    readonly issueInvalidFrontmatter: "YAML frontmatter 解析失败，DSH 会忽略它";
    readonly issueMissingName: "frontmatter 缺少 name";
    readonly issueInvalidName: "name 不是合法 kebab-case";
    readonly issueMissingDescription: "frontmatter 缺少 description";
    readonly issueInvalidEntryName: "目录/文件名不是合法 kebab-case";
    readonly issueInvalidInvocation: "invocation 字段非法（含遗留键），DSH 会忽略它";
    readonly descFromBody: "描述取自正文首段";
    readonly nameFromEntry: "名字取自目录名";
    readonly notBlockable: "名字不合法，无法按名写开关";
    readonly deleteConfirm: "将在下列位置永久删除该 skill（不可恢复）。其他项目自己的 .dsh/skills 不在本面板扫描范围内：";
    readonly protectedCopy: "受保护，将跳过";
    readonly skippedOf: "有 {count} 处副本被跳过（受保护或删除失败）";
    readonly catalogUnavailable: "runtime skill 目录读取失败，本次不显示有效/错误判定。";
    readonly errBadRequest: "请求不合法（名字或参数有问题）";
    readonly errNotFound: "找不到该 skill 的落盘副本";
    readonly errProtected: "它由运行时提供，磁盘上没有可删除的副本";
    readonly errForbidden: "出于安全考虑拒绝了这次操作";
    readonly errNetwork: "无法连接到 DSH 服务";
    readonly deleteProtected: "该 skill 由运行时提供，磁盘上没有可删除的副本";
    readonly repairConfirm: "给下列文件补上 frontmatter（只改 frontmatter，正文不动）：";
    readonly resetDone: "已清空本项目全部开关";
    readonly toggleDone: "已更新";
    readonly deleteDone: "已删除";
    readonly repairDone: "已补齐 frontmatter";
    readonly wireError: "请求失败";
};
/** en 字典（keys 与 zh 完全一致）。 */
export declare const en: Record<keyof typeof zh, string>;
/** zh/en 字典对。 */
export declare const dictionaries: {
    zh: {
        readonly panelTitle: "Skill 开关";
        readonly filterAll: "全部";
        readonly filterBlocked: "已屏蔽";
        readonly searchPlaceholder: "搜索名字或描述…";
        readonly resetAll: "恢复本项全部";
        readonly resetConfirm: "清空本项目所有开关文件？所有 skill 恢复默认可见性。";
        readonly resetConfirmAllow: "本项目是白名单模式（mode=allow）：只清空 on/ 会让白名单变成空集、所有 skill 全部消失。确认会同时移除 mode 文件，让项目回到默认可见性。";
        readonly loading: "加载中…";
        readonly loadFailed: "加载失败";
        readonly emptyAll: "这个项目里还没有发现任何 skill";
        readonly emptyFiltered: "没有符合条件的 skill";
        readonly emptyBlocked: "本项目当前没有屏蔽任何 skill";
        readonly block: "屏蔽";
        readonly unblock: "启用";
        readonly ops: "操作";
        readonly delete: "删除（全部副本）";
        readonly repair: "补齐 frontmatter";
        readonly cancel: "取消";
        readonly confirm: "确认";
        readonly summary: "共 {total} 个 · 已屏蔽 {blocked} · 错误 {error}";
        readonly rootProjectDsh: "项目 .dsh";
        readonly rootProjectAgents: "项目 .agents";
        readonly rootCustom: "自定义";
        readonly rootUserDsh: "用户";
        readonly rootUserAgents: "共享";
        readonly rootBundled: "内置";
        readonly rootLibrary: "Skill 库";
        readonly badgeBlocked: "已屏蔽";
        readonly badgeValid: "有效";
        readonly badgeError: "错误";
        readonly badgeUnassigned: "未分配";
        readonly badgeBundled: "只读";
        readonly badgeVirtual: "运行时";
        readonly copiesOf: "{count} 处副本";
        readonly openDetail: "查看详情";
        readonly backToList: "返回列表";
        readonly detailDescription: "描述";
        readonly detailRoots: "存在的根位置";
        readonly detailNoCopies: "由运行时提供，磁盘上没有副本。";
        readonly detailCopyCurrent: "当前生效";
        readonly detailCopyLive: "会被 DSH 加载";
        readonly detailCopyNotLive: "DSH 不读它";
        readonly detailCopyRank: "优先级 {rank}";
        readonly detailCopyProtected: "受保护，不会删除";
        readonly detailFormBundle: "目录 bundle";
        readonly detailFormFlat: "单文件 .md";
        readonly detailRootLabel: "根";
        readonly detailFileLabel: "文件";
        readonly detailEntryName: "条目名 {name}";
        readonly detailVerdict: "判定依据";
        readonly detailInRegistry: "在 skill 注册表里（条件 A）";
        readonly detailModelInvocable: "模型可主动调用（条件 B）";
        readonly detailUserInvocable: "用户可显式调用（条件 C）";
        readonly yes: "是";
        readonly no: "否";
        readonly verdictNotInRegistry: "不在 skill 注册表里（DSH 不会加载它）";
        readonly verdictModelBlocked: "模型不能主动调用（disable-model-invocation）";
        readonly verdictUserBlocked: "用户不能显式调用（user-invocable: false）";
        readonly verdictUnavailable: "当前会话没有活跃的 agent，本次不显示有效/错误判定。";
        readonly issueMissingFrontmatter: "缺少 YAML frontmatter，DSH 会忽略它";
        readonly issueInvalidFrontmatter: "YAML frontmatter 解析失败，DSH 会忽略它";
        readonly issueMissingName: "frontmatter 缺少 name";
        readonly issueInvalidName: "name 不是合法 kebab-case";
        readonly issueMissingDescription: "frontmatter 缺少 description";
        readonly issueInvalidEntryName: "目录/文件名不是合法 kebab-case";
        readonly issueInvalidInvocation: "invocation 字段非法（含遗留键），DSH 会忽略它";
        readonly descFromBody: "描述取自正文首段";
        readonly nameFromEntry: "名字取自目录名";
        readonly notBlockable: "名字不合法，无法按名写开关";
        readonly deleteConfirm: "将在下列位置永久删除该 skill（不可恢复）。其他项目自己的 .dsh/skills 不在本面板扫描范围内：";
        readonly protectedCopy: "受保护，将跳过";
        readonly skippedOf: "有 {count} 处副本被跳过（受保护或删除失败）";
        readonly catalogUnavailable: "runtime skill 目录读取失败，本次不显示有效/错误判定。";
        readonly errBadRequest: "请求不合法（名字或参数有问题）";
        readonly errNotFound: "找不到该 skill 的落盘副本";
        readonly errProtected: "它由运行时提供，磁盘上没有可删除的副本";
        readonly errForbidden: "出于安全考虑拒绝了这次操作";
        readonly errNetwork: "无法连接到 DSH 服务";
        readonly deleteProtected: "该 skill 由运行时提供，磁盘上没有可删除的副本";
        readonly repairConfirm: "给下列文件补上 frontmatter（只改 frontmatter，正文不动）：";
        readonly resetDone: "已清空本项目全部开关";
        readonly toggleDone: "已更新";
        readonly deleteDone: "已删除";
        readonly repairDone: "已补齐 frontmatter";
        readonly wireError: "请求失败";
    };
    en: Record<"delete" | "yes" | "no" | "repair" | "panelTitle" | "filterAll" | "filterBlocked" | "searchPlaceholder" | "resetAll" | "resetConfirm" | "resetConfirmAllow" | "loading" | "loadFailed" | "emptyAll" | "emptyFiltered" | "emptyBlocked" | "block" | "unblock" | "ops" | "cancel" | "confirm" | "summary" | "rootProjectDsh" | "rootProjectAgents" | "rootCustom" | "rootUserDsh" | "rootUserAgents" | "rootBundled" | "rootLibrary" | "badgeBlocked" | "badgeValid" | "badgeError" | "badgeUnassigned" | "badgeBundled" | "badgeVirtual" | "copiesOf" | "openDetail" | "backToList" | "detailDescription" | "detailRoots" | "detailNoCopies" | "detailCopyCurrent" | "detailCopyLive" | "detailCopyNotLive" | "detailCopyRank" | "detailCopyProtected" | "detailFormBundle" | "detailFormFlat" | "detailRootLabel" | "detailFileLabel" | "detailEntryName" | "detailVerdict" | "detailInRegistry" | "detailModelInvocable" | "detailUserInvocable" | "verdictNotInRegistry" | "verdictModelBlocked" | "verdictUserBlocked" | "verdictUnavailable" | "issueMissingFrontmatter" | "issueInvalidFrontmatter" | "issueMissingName" | "issueInvalidName" | "issueMissingDescription" | "issueInvalidEntryName" | "issueInvalidInvocation" | "descFromBody" | "nameFromEntry" | "notBlockable" | "deleteConfirm" | "protectedCopy" | "skippedOf" | "catalogUnavailable" | "errBadRequest" | "errNotFound" | "errProtected" | "errForbidden" | "errNetwork" | "deleteProtected" | "repairConfirm" | "resetDone" | "toggleDone" | "deleteDone" | "repairDone" | "wireError", string>;
};
/** 文案 key。 */
export type CopyKey = keyof typeof zh;
/**
 * 挂上（或传 undefined 摘掉）DSH locale 服务。组件继续调普通的 `t()`，
 * 面板订阅 locale 快照变化后自行重渲染。
 */
export declare function attachLocale(service: {
    getSnapshot(): {
        active: string;
    };
} | undefined): void;
/** 按活动 locale 取文案；`{name}` 占位符由 params 插值。 */
export declare function t(key: CopyKey, params?: Record<string, string | number>): string;
/** 活动 locale 是否为中文。 */
export declare function isZh(): boolean;
