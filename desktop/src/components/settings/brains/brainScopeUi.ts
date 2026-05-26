export const BRAIN_SCOPE_GLOBAL_BADGE =
  "bg-[var(--brain-scope-global-bg)] text-[var(--brain-scope-global-fg)] ring-1 ring-[var(--brain-scope-global-ring)]";

export const BRAIN_SCOPE_PRIVATE_BADGE =
  "bg-[var(--brain-scope-private-bg)] text-[var(--brain-scope-private-fg)] ring-1 ring-[var(--brain-scope-private-ring)]";

export function brainScopeBadge(scope: string): { label: string; className: string } {
  if (scope === "private") {
    return {
      label: "专属",
      className: BRAIN_SCOPE_PRIVATE_BADGE,
    };
  }
  return {
    label: "全局",
    className: BRAIN_SCOPE_GLOBAL_BADGE,
  };
}

export function brainTypeShort(type: string): string {
  return type === "code" ? "代码" : "文档";
}
