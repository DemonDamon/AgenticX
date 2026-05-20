export type SettingsPanelSize = {
  width: number;
  height: number;
};

const STORAGE_KEY = "agx-settings-panel-size-v1";

export const SETTINGS_PANEL_MIN_WIDTH = 640;
export const SETTINGS_PANEL_MIN_HEIGHT = 480;

function readViewport(): { vw: number; vh: number } {
  if (typeof window === "undefined") return { vw: 1280, vh: 800 };
  return { vw: window.innerWidth, vh: window.innerHeight };
}

export function getSettingsPanelDefaultSize(): SettingsPanelSize {
  const { vw, vh } = readViewport();
  return {
    width: Math.round(Math.min(vw * 0.92, 68 * 16)),
    height: Math.round(Math.min(vh * 0.88, vh - 32)),
  };
}

export function clampSettingsPanelSize(size: SettingsPanelSize): SettingsPanelSize {
  const { vw, vh } = readViewport();
  const maxWidth = Math.max(SETTINGS_PANEL_MIN_WIDTH, vw - 32);
  const maxHeight = Math.max(SETTINGS_PANEL_MIN_HEIGHT, vh - 32);
  return {
    width: Math.round(Math.min(Math.max(size.width, SETTINGS_PANEL_MIN_WIDTH), maxWidth)),
    height: Math.round(Math.min(Math.max(size.height, SETTINGS_PANEL_MIN_HEIGHT), maxHeight)),
  };
}

export function loadSettingsPanelSize(): SettingsPanelSize {
  const fallback = getSettingsPanelDefaultSize();
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SettingsPanelSize>;
    const width = Number(parsed.width);
    const height = Number(parsed.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return fallback;
    return clampSettingsPanelSize({ width, height });
  } catch {
    return fallback;
  }
}

export function saveSettingsPanelSize(size: SettingsPanelSize): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clampSettingsPanelSize(size)));
  } catch {
    // ignore storage failures
  }
}
