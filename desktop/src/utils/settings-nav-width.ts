const STORAGE_KEY = "agx-settings-nav-width-v1";

export const SETTINGS_NAV_MIN_WIDTH = 160;
export const SETTINGS_NAV_DEFAULT_WIDTH = 200;
export const SETTINGS_NAV_MAX_WIDTH = 320;
/** 右侧内容区至少保留的可读宽度 */
export const SETTINGS_NAV_MIN_CONTENT_WIDTH = 360;

export function clampSettingsNavWidth(width: number, panelWidth: number): number {
  const maxByPanel = Math.max(
    SETTINGS_NAV_MIN_WIDTH,
    panelWidth - SETTINGS_NAV_MIN_CONTENT_WIDTH,
  );
  const max = Math.min(SETTINGS_NAV_MAX_WIDTH, maxByPanel);
  return Math.round(Math.min(Math.max(width, SETTINGS_NAV_MIN_WIDTH), max));
}

export function loadSettingsNavWidth(panelWidth?: number): number {
  const fallback = SETTINGS_NAV_DEFAULT_WIDTH;
  if (typeof window === "undefined") return fallback;
  const panel = panelWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1280);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return clampSettingsNavWidth(fallback, panel);
    const parsed = Number(JSON.parse(raw));
    if (!Number.isFinite(parsed)) return clampSettingsNavWidth(fallback, panel);
    return clampSettingsNavWidth(parsed, panel);
  } catch {
    return clampSettingsNavWidth(fallback, panel);
  }
}

export function saveSettingsNavWidth(width: number, panelWidth: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(clampSettingsNavWidth(width, panelWidth)),
    );
  } catch {
    // ignore storage failures
  }
}
