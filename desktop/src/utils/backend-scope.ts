/** Backend-scoped localStorage keys for Near Desktop (local vs remote agx serve). */

export const LOCAL_BACKEND_SCOPE = "local";

export function normalizeBackendScopeFromRemoteUrl(url: string): string {
  const trimmed = String(url ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return LOCAL_BACKEND_SCOPE;
  try {
    const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `http://${trimmed}`;
    const u = new URL(withProto);
    const host = u.hostname.toLowerCase();
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    return `${host}:${port}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

/** Sync scope injected by Electron preload from main process argv. */
export function getBackendScope(): string {
  if (typeof window !== "undefined") {
    const sync = window.agenticxDesktop?.getBackendScopeSync?.();
    if (typeof sync === "string" && sync.trim()) return sync.trim();
  }
  return LOCAL_BACKEND_SCOPE;
}

export function getConnectionModeSync(): "local" | "remote" {
  if (typeof window !== "undefined") {
    const mode = window.agenticxDesktop?.getConnectionModeSync?.();
    if (mode === "remote" || mode === "local") return mode;
  }
  return "local";
}

export function scopedKey(base: string, scope?: string): string {
  const s = (scope ?? getBackendScope()).trim() || LOCAL_BACKEND_SCOPE;
  return `${base}::${s}`;
}

/** Read scoped value; for `local` scope migrates legacy unscoped key once. */
export function readScopedLocalStorage(base: string, scope?: string): string | null {
  const s = (scope ?? getBackendScope()).trim() || LOCAL_BACKEND_SCOPE;
  const key = scopedKey(base, s);
  try {
    const scoped = window.localStorage.getItem(key);
    if (scoped !== null) return scoped;
    if (s === LOCAL_BACKEND_SCOPE) {
      const legacy = window.localStorage.getItem(base);
      if (legacy !== null) {
        window.localStorage.setItem(key, legacy);
        window.localStorage.removeItem(base);
        return legacy;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function writeScopedLocalStorage(base: string, value: string, scope?: string): void {
  const key = scopedKey(base, scope);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore quota errors
  }
}

export function formatBackendChipLabel(scope: string, mode: "local" | "remote"): string {
  if (mode === "local" || scope === LOCAL_BACKEND_SCOPE) return "本地";
  const label = scope.trim();
  if (label.length <= 22) return label;
  const colon = label.indexOf(":");
  if (colon > 0 && colon < label.length - 1) {
    const host = label.slice(0, colon);
    const port = label.slice(colon + 1);
    if (host.length > 14) return `${host.slice(0, 6)}…${host.slice(-4)}:${port}`;
  }
  return `${label.slice(0, 10)}…${label.slice(-6)}`;
}
