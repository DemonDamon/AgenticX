const STORAGE_KEY = "agx-trusted-external-hosts-v1";

let cachedHosts: string[] | null = null;

function readStorage(): string[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeStorage(hosts: string[]): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(hosts));
  } catch {
    /* ignore quota / private-mode */
  }
}

function loadHosts(): string[] {
  if (cachedHosts) return cachedHosts;
  cachedHosts = readStorage();
  return cachedHosts;
}

export function hostnameFromHttpUrl(url: string): string | null {
  const href = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    const parsed = new URL(href);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const host = parsed.hostname.trim().toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

export function listTrustedExternalHosts(): string[] {
  return [...loadHosts()];
}

export function isTrustedExternalHost(url: string): boolean {
  const host = hostnameFromHttpUrl(url);
  if (!host) return false;
  return loadHosts().includes(host);
}

export function addTrustedExternalHost(url: string): void {
  const host = hostnameFromHttpUrl(url);
  if (!host) return;
  const next = new Set(loadHosts());
  next.add(host);
  cachedHosts = [...next];
  writeStorage(cachedHosts);
}

export function _resetTrustedExternalHostsForTests(): void {
  cachedHosts = [];
  try {
    window.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* node tests without localStorage */
  }
}
