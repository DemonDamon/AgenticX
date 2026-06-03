/** Resolve KB registry document id from a knowledge_search hit (never use source.uri file paths). */
export function resolveKbDocumentIdFromHit(hit: {
  id?: unknown;
  metadata?: Record<string, unknown>;
  source?: Record<string, unknown>;
}): string {
  const meta = hit.metadata && typeof hit.metadata === "object" ? hit.metadata : {};
  const fromMeta = String(meta.document_id ?? "").trim();
  if (fromMeta.startsWith("doc_")) return fromMeta;

  const hitId = String(hit.id ?? "").trim();
  if (hitId.includes("::")) {
    const prefix = hitId.split("::", 1)[0]?.trim() ?? "";
    if (prefix.startsWith("doc_")) return prefix;
  }

  const source = hit.source && typeof hit.source === "object" ? hit.source : {};
  const uri = String(source.uri ?? "").trim();
  if (uri && !uri.includes("/") && !uri.includes("\\") && !uri.includes("::")) return uri;

  return "";
}

export function resolveKbSourcePathFromHit(hit: {
  metadata?: Record<string, unknown>;
  source?: Record<string, unknown>;
}): string {
  const meta = hit.metadata && typeof hit.metadata === "object" ? hit.metadata : {};
  const fromMeta = String(meta.source_path ?? "").trim();
  if (fromMeta) return fromMeta;
  const source = hit.source && typeof hit.source === "object" ? hit.source : {};
  const uri = String(source.uri ?? "").trim();
  if (isFilesystemPath(uri)) return uri;
  return "";
}

export function isFilesystemPath(value: string): boolean {
  const t = String(value ?? "").trim();
  if (!t) return false;
  if (t.startsWith("/")) return true;
  return /^[A-Za-z]:[\\/]/.test(t);
}
