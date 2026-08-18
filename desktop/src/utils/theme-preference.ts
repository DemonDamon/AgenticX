import type { ThemeMode } from "../store";

/** Accept only persisted theme modes understood by both renderer and Electron. */
export function parsePersistedThemeMode(value: unknown): ThemeMode | null {
  const normalized = String(value ?? "").trim();
  return normalized === "light" || normalized === "dim" || normalized === "dark"
    ? normalized
    : null;
}
