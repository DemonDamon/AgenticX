const AVATAR_LAST_SESSION_STORAGE_KEY = "agx-avatar-last-session-v1";

type AvatarLastSessionMap = Record<string, string>;

function avatarSessionMapKey(avatarId?: string | null): string {
  const aid = String(avatarId ?? "").trim();
  return aid || "__meta__";
}

function readAvatarLastSessionMap(): AvatarLastSessionMap {
  try {
    const raw = window.localStorage.getItem(AVATAR_LAST_SESSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: AvatarLastSessionMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const key = String(k || "").trim();
      const sid = String(v ?? "").trim();
      if (!key || !sid) continue;
      out[key] = sid;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAvatarLastSessionMap(data: AvatarLastSessionMap): void {
  try {
    window.localStorage.setItem(AVATAR_LAST_SESSION_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore storage failures
  }
}

export function getRememberedSessionForAvatar(avatarId?: string | null): string | null {
  const key = avatarSessionMapKey(avatarId);
  const map = readAvatarLastSessionMap();
  const sid = String(map[key] ?? "").trim();
  return sid || null;
}

export function rememberSessionForAvatar(avatarId: string | null | undefined, sessionId: string): void {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return;
  const key = avatarSessionMapKey(avatarId);
  const map = readAvatarLastSessionMap();
  if (map[key] === sid) return;
  map[key] = sid;
  writeAvatarLastSessionMap(map);
}
