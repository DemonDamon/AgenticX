/** Browser-local vault for PAT plaintext (created in this browser). Server stores hash only. */

export type PatVaultEntry = {
  id: number;
  name: string;
  tokenPrefix: string;
  plainToken: string;
  savedAt: string;
};

const VAULT_KEY = "agx-pat-vault-v1";
const SELECTED_KEY = "agx-pat-selected-v1";
const LEGACY_CACHE_KEY = "agx-mcp-pat-cache-v1";
const LEGACY_SELECTED_KEY = "agx-mcp-pat-selected-v1";

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

function migrateLegacyVault() {
  if (!canUseStorage()) return;
  try {
    const legacyRaw = sessionStorage.getItem(LEGACY_CACHE_KEY);
    if (!legacyRaw) return;
    const legacy = JSON.parse(legacyRaw) as PatVaultEntry[];
    if (!Array.isArray(legacy) || legacy.length === 0) return;
    for (const item of legacy) {
      if (item?.id && item.plainToken?.startsWith("agx-pat-")) {
        upsertPatVault({
          id: item.id,
          name: item.name,
          tokenPrefix: item.tokenPrefix,
          plainToken: item.plainToken,
        });
      }
    }
    sessionStorage.removeItem(LEGACY_CACHE_KEY);
  } catch {
    /* ignore */
  }
  const legacySelected = sessionStorage.getItem(LEGACY_SELECTED_KEY)?.trim();
  if (legacySelected?.startsWith("agx-pat-")) {
    writePatSelected(legacySelected);
    sessionStorage.removeItem(LEGACY_SELECTED_KEY);
  }
}

export function readPatVault(): PatVaultEntry[] {
  if (!canUseStorage()) return [];
  migrateLegacyVault();
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PatVaultEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function upsertPatVault(entry: {
  id: number;
  name: string;
  tokenPrefix: string;
  plainToken: string;
}): void {
  if (!canUseStorage()) return;
  migrateLegacyVault();
  const next = readPatVault().filter((e) => e.id !== entry.id);
  next.unshift({
    ...entry,
    savedAt: new Date().toISOString(),
  });
  localStorage.setItem(VAULT_KEY, JSON.stringify(next.slice(0, 50)));
}

export function getPatPlainFromVault(tokenId: number): string | null {
  const hit = readPatVault().find((e) => e.id === tokenId);
  return hit?.plainToken?.trim() || null;
}

export function removePatFromVault(tokenId: number): void {
  if (!canUseStorage()) return;
  migrateLegacyVault();
  const next = readPatVault().filter((e) => e.id !== tokenId);
  localStorage.setItem(VAULT_KEY, JSON.stringify(next));
}

export function readPatSelected(): string {
  if (!canUseStorage()) return "";
  migrateLegacyVault();
  return localStorage.getItem(SELECTED_KEY)?.trim() ?? "";
}

export function writePatSelected(token: string): void {
  if (!canUseStorage()) return;
  localStorage.setItem(SELECTED_KEY, token.trim());
}

export function isValidPat(token: string): boolean {
  return token.trim().startsWith("agx-pat-");
}

export function plainMatchesTokenPrefix(plain: string, tokenPrefix: string): boolean {
  const trimmed = plain.trim();
  return isValidPat(trimmed) && tokenPrefix.length >= 8 && trimmed.startsWith(tokenPrefix);
}

/** Match server token row by prefix and persist plaintext in local vault. */
export function upsertPatFromPlainIfMatches(
  rows: { id: number; name: string; tokenPrefix: string }[],
  plain: string
): boolean {
  const trimmed = plain.trim();
  if (!isValidPat(trimmed)) return false;
  const matched = rows.find((row) => plainMatchesTokenPrefix(trimmed, row.tokenPrefix));
  if (!matched) return false;
  upsertPatVault({
    id: matched.id,
    name: matched.name,
    tokenPrefix: matched.tokenPrefix,
    plainToken: trimmed,
  });
  return true;
}
