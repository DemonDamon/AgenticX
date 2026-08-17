/** Parse optional portal-log string filters with a hard 128-char cap. */
export function parseOptionalPortalLogString(
  value: unknown,
  field: string,
): { ok: true; value?: string } | { ok: false; message: string } {
  if (typeof value !== "string") {
    return { ok: true, value: undefined };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }
  if (trimmed.length > 128) {
    return { ok: false, message: `invalid ${field}` };
  }
  return { ok: true, value: trimmed };
}
