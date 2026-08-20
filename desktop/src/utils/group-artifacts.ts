import type { MessageAttachment } from "../store";

export function parseGroupArtifacts(raw: unknown): MessageAttachment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: MessageAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const sourcePath = String(row.source_path ?? "").trim();
    if (!sourcePath || seen.has(sourcePath)) continue;
    seen.add(sourcePath);
    out.push({
      name: String(row.name ?? "").trim() || sourcePath.split(/[\\/]/).pop() || "file",
      mimeType: String(row.mime_type ?? "").trim() || "application/octet-stream",
      size: Math.max(0, Number(row.size) || 0),
      sourcePath,
      referenceToken: true,
    });
  }
  return out.length ? out.slice(0, 8) : undefined;
}
