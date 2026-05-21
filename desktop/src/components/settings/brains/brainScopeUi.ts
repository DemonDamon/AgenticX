export function brainScopeBadge(scope: string): { label: string; className: string } {
  if (scope === "private") {
    return {
      label: "专属",
      className: "bg-amber-500/15 text-amber-100 ring-amber-400/20",
    };
  }
  return {
    label: "全局",
    className: "bg-violet-500/15 text-violet-200 ring-violet-400/20",
  };
}

export function brainTypeShort(type: string): string {
  return type === "code" ? "代码" : "文档";
}
