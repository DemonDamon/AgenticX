export type WorkspaceMountModeSwitch = {
  next: "link" | "reference";
  labelKey: "panel.changeToLink" | "panel.changeToReference";
};

/** 带源路径的挂载根：引用可改直连，直连可改回只读引用。副本不走这条。 */
export function mountModeSwitchForEntry(entry: {
  mount_mode?: string | null;
  source_path?: string | null;
}): WorkspaceMountModeSwitch | null {
  const source = String(entry.source_path ?? "").trim();
  if (!source) return null;
  const mode = String(entry.mount_mode ?? "").trim();
  if (mode === "reference") {
    return { next: "link", labelKey: "panel.changeToLink" };
  }
  if (mode === "link") {
    return { next: "reference", labelKey: "panel.changeToReference" };
  }
  return null;
}
