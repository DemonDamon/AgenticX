export type SessionHistoryRowLike = {
  session_id: string;
  avatar_id: string | null;
};

function normalizeAvatarId(avatarId: string | null | undefined): string {
  return String(avatarId ?? "").trim();
}

export function isSessionVisibleInPane(
  row: Pick<SessionHistoryRowLike, "avatar_id">,
  paneAvatarId: string | null,
): boolean {
  const paneAid = normalizeAvatarId(paneAvatarId);
  const rowAid = normalizeAvatarId(row.avatar_id);
  if (!paneAid) return rowAid.length === 0;
  return rowAid === paneAid;
}

export function getVisibleBoundSession<T extends SessionHistoryRowLike>(
  boundSessionId: string | null | undefined,
  rows: readonly T[],
  paneAvatarId: string | null,
): T | null {
  const targetSid = String(boundSessionId ?? "").trim();
  if (!targetSid) return null;
  const row = rows.find((item) => String(item.session_id ?? "").trim() === targetSid) ?? null;
  if (!row) return null;
  return isSessionVisibleInPane(row, paneAvatarId) ? row : null;
}
