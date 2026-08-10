/** Parse optional audit filter IDs with a hard length cap (index safety). */
export function parseOptionalAuditId(
  value: unknown,
  field: "trace_id" | "session_id",
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
