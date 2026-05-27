import {
  mergeSearchReferences,
  mergeSearchedQueries,
  parseSearchReferences,
  type SearchReference,
} from "../types/search-references";

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
