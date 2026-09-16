/** 设置页内锚点；从「自定义」等入口打开时滚到对应区块，而不是只切 Tab。 */
export const SETTINGS_FOCUS_IDS = ["security-rules"] as const;

export type SettingsFocus = (typeof SETTINGS_FOCUS_IDS)[number];

export function isSettingsFocus(x: unknown): x is SettingsFocus {
  return typeof x === "string" && (SETTINGS_FOCUS_IDS as readonly string[]).includes(x);
}

/** 运行模式菜单「自定义」的落点：安全中心里的路径 / 命令 / 工具规则。 */
export const SECURITY_RULES_FOCUS = "security-rules" satisfies SettingsFocus;

export const SECURITY_RULES_ANCHOR_ID = "agx-security-rules";

/** 与 SettingsPanel 左侧导航 id 一致；用于从外部（如「查看账号」）打开指定设置分区。 */
export const SETTINGS_TAB_IDS = [
  "account",
  "general",
  "security",
  "provider",
  "mcp",
  "connectors",
  "tools",
  "skills",
  "knowledge",
  "data_sources",
  "memory",
  "hooks",
  "automation",
  "voice",
  "email",
  "workspace",
  "favorites",
  "server",
] as const;

export type SettingsTab = (typeof SETTINGS_TAB_IDS)[number];

export function isSettingsTab(x: unknown): x is SettingsTab {
  return typeof x === "string" && (SETTINGS_TAB_IDS as readonly string[]).includes(x);
}
