/**
 * zh/en 文案。走 DSH 的 i18n 系统：client apply 时挂上 `ctx.locale`，
 * `t()` 从活动 locale 解析文案；两份字典同时注册进 DSH 的 locale registry。
 */
export declare const LOCALE_NS = "dsh-skill-switch";
/** zh 字典（同时注册进 DSH locale registry）。 */
export declare const zh: {
    readonly panelTitle: "Skill 开关";
    readonly filterAll: "全部";
    readonly filterBlocked: "已屏蔽";
    readonly filterBroken: "未生效";
    readonly searchPlaceholder: "搜索名字或描述…";
    readonly resetAll: "恢复本项全部";
    readonly resetConfirm: "清空本项目所有开关文件？所有 skill 恢复默认可见性。";
    readonly resetConfirmAllow: "本项目是白名单模式（mode=allow）：只清空 on/ 会让白名单变成空集、所有 skill 全部消失。确认会同时移除 mode 文件，让项目回到默认可见性。";
    readonly loading: "加载中…";
    readonly loadFailed: "加载失败";
    readonly emptyAll: "这个项目里还没有发现任何 skill";
    readonly emptyFiltered: "没有符合条件的 skill";
    readonly emptyBlocked: "本项目当前没有屏蔽任何 skill";
    readonly emptyBroken: "没有\"未生效\"的 skill：所有 skill 的 frontmatter 都完整";
    readonly block: "屏蔽";
    readonly unblock: "启用";
    readonly ops: "操作";
    readonly delete: "删除（全部副本）";
    readonly repair: "补齐 frontmatter";
    readonly cancel: "取消";
    readonly confirm: "确认";
    readonly summary: "共 {total} 个 · 已屏蔽 {blocked} · 未生效 {broken}";
    readonly projectOf: "项目";
    readonly switchesOf: "开关目录";
    readonly rootProjectDsh: "项目 .dsh";
    readonly rootProjectAgents: "项目 .agents";
    readonly rootCustom: "自定义";
    readonly rootUserDsh: "用户";
    readonly rootUserAgents: "共享";
    readonly rootBundled: "内置";
    readonly rootLibrary: "Skill 库";
    readonly badgeBlocked: "已屏蔽";
    readonly badgeBroken: "未生效";
    readonly badgeUnassigned: "未分配";
    readonly badgeBundled: "只读";
    readonly badgeVirtual: "运行时";
    readonly copiesOf: "{count} 处副本";
    readonly issueMissingFrontmatter: "缺少 YAML frontmatter，DSH 会忽略它";
    readonly issueInvalidFrontmatter: "YAML frontmatter 解析失败，DSH 会忽略它";
    readonly issueMissingName: "frontmatter 缺少 name";
    readonly issueInvalidName: "name 不是合法 kebab-case";
    readonly issueMissingDescription: "frontmatter 缺少 description";
    readonly issueInvalidEntryName: "目录/文件名不是合法 kebab-case";
    readonly issueInvalidInvocation: "invocation 字段非法（含遗留键），DSH 会忽略它";
    readonly issueUnknown: "注册表里没有它，但 frontmatter 也看不出问题——原因未知";
    readonly descFromBody: "描述取自正文首段";
    readonly nameFromEntry: "名字取自目录名";
    readonly notBlockable: "名字不合法，无法按名写开关";
    readonly deleteConfirm: "将在下列位置永久删除该 skill（不可恢复）。其他项目自己的 .dsh/skills 不在本面板扫描范围内：";
    readonly protectedCopy: "受保护，将跳过";
    readonly skippedOf: "有 {count} 处副本被跳过（受保护或删除失败）";
    readonly catalogUnavailable: "runtime skill 目录读取失败，下面的「生效状态」不可信。";
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
        readonly filterBroken: "未生效";
        readonly searchPlaceholder: "搜索名字或描述…";
        readonly resetAll: "恢复本项全部";
        readonly resetConfirm: "清空本项目所有开关文件？所有 skill 恢复默认可见性。";
        readonly resetConfirmAllow: "本项目是白名单模式（mode=allow）：只清空 on/ 会让白名单变成空集、所有 skill 全部消失。确认会同时移除 mode 文件，让项目回到默认可见性。";
        readonly loading: "加载中…";
        readonly loadFailed: "加载失败";
        readonly emptyAll: "这个项目里还没有发现任何 skill";
        readonly emptyFiltered: "没有符合条件的 skill";
        readonly emptyBlocked: "本项目当前没有屏蔽任何 skill";
        readonly emptyBroken: "没有\"未生效\"的 skill：所有 skill 的 frontmatter 都完整";
        readonly block: "屏蔽";
        readonly unblock: "启用";
        readonly ops: "操作";
        readonly delete: "删除（全部副本）";
        readonly repair: "补齐 frontmatter";
        readonly cancel: "取消";
        readonly confirm: "确认";
        readonly summary: "共 {total} 个 · 已屏蔽 {blocked} · 未生效 {broken}";
        readonly projectOf: "项目";
        readonly switchesOf: "开关目录";
        readonly rootProjectDsh: "项目 .dsh";
        readonly rootProjectAgents: "项目 .agents";
        readonly rootCustom: "自定义";
        readonly rootUserDsh: "用户";
        readonly rootUserAgents: "共享";
        readonly rootBundled: "内置";
        readonly rootLibrary: "Skill 库";
        readonly badgeBlocked: "已屏蔽";
        readonly badgeBroken: "未生效";
        readonly badgeUnassigned: "未分配";
        readonly badgeBundled: "只读";
        readonly badgeVirtual: "运行时";
        readonly copiesOf: "{count} 处副本";
        readonly issueMissingFrontmatter: "缺少 YAML frontmatter，DSH 会忽略它";
        readonly issueInvalidFrontmatter: "YAML frontmatter 解析失败，DSH 会忽略它";
        readonly issueMissingName: "frontmatter 缺少 name";
        readonly issueInvalidName: "name 不是合法 kebab-case";
        readonly issueMissingDescription: "frontmatter 缺少 description";
        readonly issueInvalidEntryName: "目录/文件名不是合法 kebab-case";
        readonly issueInvalidInvocation: "invocation 字段非法（含遗留键），DSH 会忽略它";
        readonly issueUnknown: "注册表里没有它，但 frontmatter 也看不出问题——原因未知";
        readonly descFromBody: "描述取自正文首段";
        readonly nameFromEntry: "名字取自目录名";
        readonly notBlockable: "名字不合法，无法按名写开关";
        readonly deleteConfirm: "将在下列位置永久删除该 skill（不可恢复）。其他项目自己的 .dsh/skills 不在本面板扫描范围内：";
        readonly protectedCopy: "受保护，将跳过";
        readonly skippedOf: "有 {count} 处副本被跳过（受保护或删除失败）";
        readonly catalogUnavailable: "runtime skill 目录读取失败，下面的「生效状态」不可信。";
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
    en: Record<"delete" | "repair" | "panelTitle" | "filterAll" | "filterBlocked" | "filterBroken" | "searchPlaceholder" | "resetAll" | "resetConfirm" | "resetConfirmAllow" | "loading" | "loadFailed" | "emptyAll" | "emptyFiltered" | "emptyBlocked" | "emptyBroken" | "block" | "unblock" | "ops" | "cancel" | "confirm" | "summary" | "projectOf" | "switchesOf" | "rootProjectDsh" | "rootProjectAgents" | "rootCustom" | "rootUserDsh" | "rootUserAgents" | "rootBundled" | "rootLibrary" | "badgeBlocked" | "badgeBroken" | "badgeUnassigned" | "badgeBundled" | "badgeVirtual" | "copiesOf" | "issueMissingFrontmatter" | "issueInvalidFrontmatter" | "issueMissingName" | "issueInvalidName" | "issueMissingDescription" | "issueInvalidEntryName" | "issueInvalidInvocation" | "issueUnknown" | "descFromBody" | "nameFromEntry" | "notBlockable" | "deleteConfirm" | "protectedCopy" | "skippedOf" | "catalogUnavailable" | "errBadRequest" | "errNotFound" | "errProtected" | "errForbidden" | "errNetwork" | "deleteProtected" | "repairConfirm" | "resetDone" | "toggleDone" | "deleteDone" | "repairDone" | "wireError", string>;
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
