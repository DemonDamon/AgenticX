/**
 * Drop inline / overlong avatar URLs before holding them in chat messages.
 * Registry portraits are resolved live at display time (ChatImAvatar).
 *
 * Author: Damon Li
 */

const MAX_STORED_AVATAR_URL_LEN = 2048;

export function compactStoredAvatarUrl(url: string | null | undefined): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) return "";
  if (raw.length > MAX_STORED_AVATAR_URL_LEN) return "";
  return raw;
}
