/**
 * avatar_id for POST /api/sessions.
 * Keep `group:<id>` / `automation:<id>` prefixes so group/automation panes
 * bind the new session to the correct identity (not a bare Meta session).
 */
export function sessionCreateAvatarId(paneAvatarId: string | null | undefined): string | undefined {
  const aid = String(paneAvatarId ?? "").trim();
  return aid || undefined;
}
