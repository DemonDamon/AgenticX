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

/** 示例化工厂·冷却回路 citation fixture (desensitized demo). */
export function buildBrandACitationFixture(): CitationView {
  return {
    entity_id: "device-pump-01",
    citations: [
      {
        label: "台账属性：状态",
        kind: "ledger_attr",
        source_type: "structured",
        source_id: "table:cooling_assets",
        excerpt: "active",
        confidence: 0.95,
        data_time: "2026-10-20T00:00:00Z",
        context_ptr: "row:device-pump-01",
      },
      {
        label: "文档条款：状态",
        kind: "document_clause",
        source_type: "document",
        source_id: "doc-cooling-handbook",
        excerpt: "运维手册 §4.2 将状态标为 retired",
        confidence: 0.6,
        data_time: "2026-01-01T00:00:00Z",
        context_ptr: "clause:4.2",
      },
      {
        label: "关联记录：区域",
        kind: "related_record",
        source_type: "structured",
        source_id: "table:cooling_sites",
        excerpt: "一车间冷却区",
        confidence: 0.88,
        data_time: "2026-09-01T00:00:00Z",
        context_ptr: "row:site-cooling-zone-1",
      },
    ],
    conflicts: [
      {
        identity: "attr:status",
        kind: "ledger_attr",
        values: [
          {
            value: "active",
            source_id: "table:cooling_assets",
            source_type: "structured",
            confidence: 0.95,
            data_time: "2026-10-20T00:00:00Z",
          },
          {
            value: "retired",
            source_id: "doc-cooling-handbook",
            source_type: "document",
            confidence: 0.6,
            data_time: "2026-01-01T00:00:00Z",
          },
        ],
      },
    ],
    missing: ["graph_edge", "attr:owner"],
    summary: "1号循环泵证据：3 条出处、1 处状态冲突、2 项缺失。",
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
