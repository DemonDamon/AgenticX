import type { SearchReference } from "../types/search-references";

/**
 * Document identity for a reference. KB hits are chunk-level (one reference per
 * chunk), so multiple references can share a document. We group by the registry
 * doc id encoded in the `agx://kb/<doc_id>#<chunk>` url; web results are each
 * their own "document" keyed by url.
 */
export function deriveDocKey(ref: SearchReference): string {
  const url = String(ref.url ?? "").trim();
  if (ref.source === "kb" || url.startsWith("agx://kb/")) {
    const base = url.split("#", 1)[0]?.trim() ?? "";
    if (base && base !== "agx://kb/unknown") return base;
    const path = String(ref.kbSourcePath ?? "").trim();
    if (path) return `path:${path}`;
    const title = String(ref.title ?? "").trim();
    if (title) return `title:${title}`;
    return url || "kb:unknown";
  }
  if (url) return url;
  return `title:${String(ref.title ?? "").trim()}`;
}

/**
 * Map each reference id to a 1-based document number. References are walked in
 * ascending id order so the numbering matches the order the model received the
 * hits (and what it cites as `[N]`). Chunks of the same document share a number.
 */
export function buildDocNumberMap(refs: SearchReference[]): Map<number, number> {
  const byKey = new Map<string, number>();
  const byId = new Map<number, number>();
  const ordered = [...refs].sort((a, b) => a.id - b.id);
  let next = 1;
  for (const ref of ordered) {
    const key = deriveDocKey(ref);
    let docNumber = byKey.get(key);
    if (docNumber === undefined) {
      docNumber = next;
      next += 1;
      byKey.set(key, docNumber);
    }
    byId.set(ref.id, docNumber);
  }
  return byId;
}

export type DocGroup = {
  docNumber: number;
  docKey: string;
  /** First (highest-ranked / lowest-id) reference, used for title + open action. */
  primary: SearchReference;
  /** All chunk references for this document, in id order. */
  chunks: SearchReference[];
};

/**
 * Collapse chunk-level references into one entry per document for the sources
 * card. Ordered by docNumber (i.e. citation order).
 */
export function dedupeReferencesByDoc(refs: SearchReference[]): DocGroup[] {
  const docNumberById = buildDocNumberMap(refs);
  const groups = new Map<number, DocGroup>();
  const ordered = [...refs].sort((a, b) => a.id - b.id);
  for (const ref of ordered) {
    const docNumber = docNumberById.get(ref.id) ?? ref.id;
    const existing = groups.get(docNumber);
    if (existing) {
      existing.chunks.push(ref);
      continue;
    }
    groups.set(docNumber, {
      docNumber,
      docKey: deriveDocKey(ref),
      primary: ref,
      chunks: [ref],
    });
  }
  return [...groups.values()].sort((a, b) => a.docNumber - b.docNumber);
}
