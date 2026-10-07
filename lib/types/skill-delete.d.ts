import type { SkillForm, SkillRootSource } from './skill-scan.ts';
/** 一处待删除的副本。 */
export interface DeleteTarget {
    /** SKILL.md（bundle）或 <name>.md（flat）的绝对路径。 */
    path: string;
    /** bundle 的目录；flat 忽略。 */
    directory: string;
    form: SkillForm;
    /** 所属根的绝对路径。 */
    rootPath: string;
    source: SkillRootSource;
    /** 该根是否允许删除。 */
    deletable: boolean;
}
/** 单处副本的处理结果原因。 */
export type SkipReason = 'protected' | 'outside-root' | 'missing' | 'error';
/** 一次全局删除的结果。 */
export interface DeleteOutcome {
    /** 真正被删除的路径（bundle 为目录，flat 为文件）。 */
    removed: string[];
    /** 未删除的副本及其原因。 */
    skipped: Array<{
        path: string;
        source: SkillRootSource;
        reason: SkipReason;
        message?: string;
    }>;
}
/**
 * 断言 `candidate` 解析后严格位于 `root` 之内。
 * @param root - 所属根（绝对路径）。
 * @param candidate - 待校验路径。
 * @returns candidate 的解析结果。
 * @throws SwitchError('forbidden') 当目标是根本身或逃出根。
 */
export declare function assertWithinRoot(root: string, candidate: string): string;
/**
 * 断言 `candidate` 的**真实路径**（解析符号链接之后）仍位于 `root` 的真实路径之内。
 *
 * `assertWithinRoot` 只做字符串前缀比较：`<root>/linked/SKILL.md` 在字面上位于根内，
 * 但 `linked` 若是指向根外目录的符号链接，**写入**就会穿透到根外（删除不受影响，
 * `fs.rm` 只摘链接本身）。扫描层用 `stat`（会跟随链接）发现条目，所以写路径
 * （补齐 frontmatter）必须再做一次 realpath 校验。
 *
 * 只校验父目录的真实路径：文件本身是符号链接时，`writeFileAtomic` 的
 * 「同目录临时文件 + rename」替换的是链接本身，不会写进链接目标。
 *
 * @param root - 所属根（绝对路径，必须已存在）。
 * @param candidate - 待写入的文件路径。
 * @returns 父目录的真实路径。
 * @throws SwitchError('forbidden') 当父目录的真实路径逃出根。
 */
export declare function assertRealPathWithinRoot(root: string, candidate: string): Promise<string>;
/**
 * 逐个删除副本；单点失败不阻断其余副本，但至少要删掉一处。
 * @param targets - 已由服务端扫描得到的副本清单（客户端不参与路径推导）。
 * @returns 删除结果。
 * @throws SwitchError('not-found') 当所有副本都不存在。
 * @throws SwitchError('protected') 当所有存在的副本都属于受保护根。
 */
export declare function deleteSkillCopies(targets: DeleteTarget[]): Promise<DeleteOutcome>;
