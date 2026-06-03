import {
  mergeSearchReferences,
  mergeSearchedQueries,
  parseSearchReferences,
  type SearchReference,
} from "../types/search-references";

/** Client fallback when SSE omits `structured` but tool `result` JSON still has KB hits. */
export function parseKbReferencesFromToolResult(resultRaw: unknown): SearchReference[] {
  let parsed: unknown = resultRaw;
  if (typeof resultRaw === "string") {
    try {
      parsed = JSON.parse(resultRaw);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== "object") return [];
  const row = parsed as { ok?: boolean; disabled?: boolean; hits?: unknown[] };
  if (row.ok === false || row.disabled) return [];
  const hits = row.hits;
  if (!Array.isArray(hits)) return [];
  const out: SearchReference[] = [];
  for (const hit of hits) {
    if (!hit || typeof hit !== "object") continue;
    const h = hit as { text?: unknown; source?: Record<string, unknown> };
    const source = h.source && typeof h.source === "object" ? h.source : {};
    const docId = String(source.uri ?? source.id ?? "").trim();
    const title = String(source.title ?? docId ?? "KB").trim() || "KB";
    const chunkIdx = source.chunk_index;
    const chunkLabel =
      chunkIdx !== undefined && chunkIdx !== null ? `#${String(chunkIdx)}` : "";
    const url = docId ? `agx://kb/${docId}${chunkLabel}` : "agx://kb/unknown";
    const snippet = String(h.text ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    out.push({
      id: out.length + 1,
      title,
      url,
      snippet,
      source: "kb",
    });
  }
  return out;
}

export function extractStructuredReferences(payloadData: unknown): {
  references: SearchReference[];
  query?: string;
} {
  if (!payloadData || typeof payloadData !== "object") {
    return { references: [] };
  }
  const structured = (payloadData as { structured?: unknown }).structured;
  if (!structured || typeof structured !== "object") {
    return { references: [] };
  }
  const row = structured as { references?: unknown; query?: unknown };
  return {
    references: parseSearchReferences(row.references),
    query: String(row.query ?? "").trim() || undefined,
  };
}

export function accumulateReferenceTurn(
  pendingReferences: SearchReference[],
  pendingQueries: string[],
  payloadData: unknown,
  toolArgs?: Record<string, unknown>,
): { references: SearchReference[]; queries: string[] } {
  const { references, query } = extractStructuredReferences(payloadData);
  let nextRefs = pendingReferences;
  if (references.length > 0) {
    nextRefs = mergeSearchReferences(pendingReferences, references);
  } else if (payloadData && typeof payloadData === "object") {
    const toolName = String((payloadData as { name?: unknown }).name ?? "").trim();
    const resultRaw = (payloadData as { result?: unknown }).result;
    if (toolName === "knowledge_search") {
      const fallback = parseKbReferencesFromToolResult(resultRaw);
      if (fallback.length > 0) {
        nextRefs = mergeSearchReferences(pendingReferences, fallback);
      }
    }
  }
  const queryCandidates = [
    query,
    String(toolArgs?.query ?? "").trim() || undefined,
  ].filter(Boolean) as string[];
  const nextQueries = mergeSearchedQueries(pendingQueries, queryCandidates);
  return { references: nextRefs, queries: nextQueries };
}

export function referenceExtrasFromTurn(
  references: SearchReference[],
  queries: string[],
): { references: SearchReference[]; searchedQueries: string[] } | undefined {
  if (references.length === 0 && queries.length === 0) return undefined;
  return {
    references,
    searchedQueries: queries,
  };
}

export function applyFinalReferencePayload(
  pendingReferences: SearchReference[],
  pendingQueries: string[],
  payloadData: unknown,
): { references: SearchReference[]; queries: string[] } {
  if (!payloadData || typeof payloadData !== "object") {
    return { references: pendingReferences, queries: pendingQueries };
  }
  const row = payloadData as { references?: unknown; searched_queries?: unknown };
  const fromFinalRefs = parseSearchReferences(row.references);
  const fromFinalQueries = Array.isArray(row.searched_queries)
    ? row.searched_queries.map((q) => String(q).trim()).filter(Boolean)
    : [];
  return {
    references: fromFinalRefs.length > 0 ? fromFinalRefs : pendingReferences,
    queries: fromFinalQueries.length > 0 ? fromFinalQueries : pendingQueries,
  };
}
