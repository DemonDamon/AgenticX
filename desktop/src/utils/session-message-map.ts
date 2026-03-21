import type { MessageAttachment } from "../store";

/** Snapshot row from GET /api/session/messages (snake_case). */
export function attachmentsFromSessionRow(raw: unknown): MessageAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: MessageAttachment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const o = a as { name?: unknown; mime_type?: unknown; size?: unknown; data_url?: unknown };
    const dataUrl = String(o.data_url ?? "").trim();
    if (!dataUrl.startsWith("data:image/")) continue;
    const name = String(o.name ?? "").trim() || "image";
    const mimeType = String(o.mime_type ?? "").trim() || "image/png";
    const sizeRaw = o.size;
    const size = typeof sizeRaw === "number" && Number.isFinite(sizeRaw) ? sizeRaw : Number(sizeRaw) || 0;
    out.push({ name, mimeType, size, dataUrl });
  }
  return out.length ? out : undefined;
}
