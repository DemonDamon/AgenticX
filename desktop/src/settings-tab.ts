/** 与 SettingsPanel 左侧导航 id 一致；用于从外部（如「查看账号」）打开指定设置分区。 */
export const SETTINGS_TAB_IDS = [
  "account",
  "general",
  "permissions",
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
  "developer",
  "server",
] as const;

export type SettingsTab = (typeof SETTINGS_TAB_IDS)[number];

/** Customer delivery navigation: one level, ordered by common user tasks. */
export const DELIVERY_VISIBLE_SETTINGS_TAB_IDS = [
  "account",
  "general",
  "permissions",
  "skills",
  "mcp",
  "connectors",
  "favorites",
] as const satisfies readonly SettingsTab[];

/**
 * Advanced controls live behind one clearly separated page. Keeping this out of
 * the ordinary list prevents implementation-oriented settings from competing
 * with the seven everyday tasks above.
 */
export const DELIVERY_DEVELOPER_SETTINGS_TAB_ID =
  "developer" as const satisfies SettingsTab;

const DELIVERY_VISIBLE_SETTINGS_TABS = new Set<SettingsTab>(
  DELIVERY_VISIBLE_SETTINGS_TAB_IDS,
);

export function isSettingsTab(x: unknown): x is SettingsTab {
  return typeof x === "string" && (SETTINGS_TAB_IDS as readonly string[]).includes(x);
}

/** Hidden provider management is represented by the enterprise account page. */
export function resolveDeliverySettingsTab(x: unknown): SettingsTab {
  if (x === "provider") return "account";
  if (x === DELIVERY_DEVELOPER_SETTINGS_TAB_ID) return x;
  if (isSettingsTab(x) && DELIVERY_VISIBLE_SETTINGS_TABS.has(x)) return x;
  return "general";
}
