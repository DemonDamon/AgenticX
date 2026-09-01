/**
 * WorkPanel「任务摘要」手风琴：显式聚焦某一区块时互斥展开，避免待办 / 参考 / 子智能体抢视觉。
 *
 * Author: Damon Li
 */

export type SummarySectionId = "todo" | "artifacts" | "changes" | "spawns" | "refs" | "members";

export const COLLAPSED_SUMMARY_SECTIONS: Record<SummarySectionId, boolean> = {
  todo: false,
  artifacts: false,
  changes: false,
  spawns: false,
  refs: false,
  members: false,
};

export function exclusiveOpenSections(
  section: SummarySectionId,
): Record<SummarySectionId, boolean> {
  return { ...COLLAPSED_SUMMARY_SECTIONS, [section]: true };
}

export function contentDrivenOpenSections(flags: {
  todo: boolean;
  artifacts: boolean;
  changes: boolean;
  spawns: boolean;
  refs: boolean;
  members: boolean;
}): Record<SummarySectionId, boolean> {
  return {
    todo: flags.todo,
    artifacts: flags.artifacts,
    changes: flags.changes,
    spawns: flags.spawns,
    refs: flags.refs,
    members: flags.members,
  };
}

/**
 * Auto-expand/collapse a section from content arrival.
 * While a section is pinned (user focused 产物 / 变更), other sections stay put.
 * The pinned section itself stays open so the empty state remains visible.
 */
export function applyPinnedAutoExpand(
  prev: Record<SummarySectionId, boolean>,
  id: SummarySectionId,
  shouldOpen: boolean,
  pinned: SummarySectionId | null,
): Record<SummarySectionId, boolean> {
  if (pinned != null && pinned !== id) return prev;
  if (pinned === id) {
    return prev[id] ? prev : { ...prev, [id]: true };
  }
  if (prev[id] === shouldOpen) return prev;
  return { ...prev, [id]: shouldOpen };
}
