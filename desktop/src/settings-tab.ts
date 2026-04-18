/** 与 SettingsPanel 左侧导航 id 一致；用于从外部（如「查看账号」）打开指定设置分区。 */
export const SETTINGS_TAB_IDS = [
  "account",
  "general",
  "provider",
  "mcp",
  "tools",
  "skills",
  "knowledge",
  "hooks",
  "automation",
  "email",
  "workspace",
  "favorites",
  "server",
] as const;

export type SettingsTab = (typeof SETTINGS_TAB_IDS)[number];

export function isSettingsTab(x: unknown): x is SettingsTab {
  return typeof x === "string" && (SETTINGS_TAB_IDS as readonly string[]).includes(x);
}
