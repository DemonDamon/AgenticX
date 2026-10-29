/**
 * Citation UI view-model — mirrors docs/agx-rules-knowledge-suite/citation-ui-contract.md
 * and agenticx.retrieval.citation_view.to_citation_view output.
 */

export type CitationSourceType = "structured" | "graph" | "document" | "inference" | string;

export type CitationItem = {
  label: string;
  kind: string;
  source_type: CitationSourceType;
  source_id: string;
  excerpt: string;
  confidence: number | null;
  data_time: string | null;
  context_ptr: string | null;
};

export type ConflictValue = {
  value: unknown;
  source_id: string;
  source_type: CitationSourceType;
  confidence: number | null;
  data_time: string | null;
};

export type CitationConflict = {
  identity: string;
  kind: string;
  values: ConflictValue[];
};

export type CitationView = {
  entity_id: string;
  citations: CitationItem[];
  conflicts: CitationConflict[];
  missing: string[];
  summary?: string;
};

export const CITATION_VIEW_KEYS = [
  "entity_id",
  "citations",
  "conflicts",
  "missing",
  "summary",
] as const;

export const CITATION_ITEM_KEYS = [
  "label",
  "kind",
  "source_type",
  "source_id",
  "excerpt",
  "confidence",
  "data_time",
  "context_ptr",
] as const;

/** Synthetic Brand-A fixture with citations + conflict + missing (no real customer names). */
export function buildBrandACitationFixture(): CitationView {
  return {
    entity_id: "brand-a-pump-01",
    citations: [
      {
        label: "Ledger attribute: status",
        kind: "ledger_attr",
        source_type: "structured",
        source_id: "table:brand_a_assets",
        excerpt: "active",
        confidence: 0.95,
        data_time: "2026-10-20T00:00:00Z",
        context_ptr: "row:brand-a-pump-01",
      },
      {
        label: "Document clause: status",
        kind: "document_clause",
        source_type: "document",
        source_id: "doc-brand-a-handbook",
        excerpt: "status marked retired in Brand-A ops handbook §4.2",
        confidence: 0.6,
        data_time: "2026-01-01T00:00:00Z",
        context_ptr: "clause:4.2",
      },
      {
        label: "Related record: site",
        kind: "related_record",
        source_type: "structured",
        source_id: "table:brand_a_sites",
        excerpt: "Brand-A Plant A",
        confidence: 0.88,
        data_time: "2026-09-01T00:00:00Z",
        context_ptr: "row:site-plant-a",
      },
    ],
    conflicts: [
      {
        identity: "attr:status",
        kind: "ledger_attr",
        values: [
          {
            value: "active",
            source_id: "table:brand_a_assets",
            source_type: "structured",
            confidence: 0.95,
            data_time: "2026-10-20T00:00:00Z",
          },
          {
            value: "retired",
            source_id: "doc-brand-a-handbook",
            source_type: "document",
            confidence: 0.6,
            data_time: "2026-01-01T00:00:00Z",
          },
        ],
      },
    ],
    missing: ["graph_edge", "attr:owner"],
    summary: "Brand-A pump evidence: 3 citations, 1 status conflict, 2 missing required kinds/attrs.",
  };
}

export function formatConfidence(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

export function assertCitationViewShape(view: CitationView): string[] {
  const errors: string[] = [];
  if (!view.entity_id?.trim()) errors.push("entity_id required");
  if (!Array.isArray(view.citations)) errors.push("citations must be array");
  if (!Array.isArray(view.conflicts)) errors.push("conflicts must be array");
  if (!Array.isArray(view.missing)) errors.push("missing must be array");
  for (const [i, c] of (view.citations || []).entries()) {
    for (const key of CITATION_ITEM_KEYS) {
      if (!(key in c)) errors.push(`citations[${i}] missing ${key}`);
    }
  }
  return errors;
}
