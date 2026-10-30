/** Graph incremental admin types — mirrors agenticx/knowledge/graphers/incremental JSON shapes. */

export type SourceDocumentRow = {
  id: string;
  content: string;
  content_hash: string;
  meta: Record<string, unknown>;
  last_seen_at?: string;
};

export type ChangeSetRow = {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: string[];
};

export type SyncReportRow = {
  run_id: string;
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: string[];
  extracted_source_ids: string[];
  touched_object_ids: string[];
  published_object_ids: string[];
  retired_object_ids: string[];
  graph_stats: Record<string, unknown>;
  at: string;
};

export type SourceIndexLinks = Record<string, string[]>;

export type GraphStatsSnapshot = {
  entity_count: number;
  relation_count: number;
  updated_at: string;
  /** GraphStore backend when K3 publish SoT is wired (e.g. neo4j, memory). */
  store_backend?: string;
  [key: string]: unknown;
};

export type SourceWithStatus = SourceDocumentRow & {
  fingerprint?: string;
  object_ids: string[];
  last_sync_status: "never" | "added" | "changed" | "unchanged" | "removed" | "extracted";
  last_run_id?: string;
};

/** 示例化工厂·冷却回路 synthetic seed — desensitized demo. */
export const SAMPLE_SOURCES: SourceDocumentRow[] = [
  {
    id: "src-ledger-pump-01",
    content: "示例化工厂设备台账：1号循环泵位于一车间冷却区，归属冷却回路。",
    content_hash: "",
    meta: { tags: ["ops", "sample", "cooling-loop"], kind: "ledger" },
    last_seen_at: "2026-10-29T02:00:00Z",
  },
  {
    id: "src-site-cooling-1",
    content: "区域登记：一车间冷却区，负责冷却回路运维。",
    content_hash: "",
    meta: { tags: ["ops", "sample", "cooling-loop"], kind: "site" },
    last_seen_at: "2026-10-29T02:00:00Z",
  },
  {
    id: "src-ops-note-valve",
    content: "运维说明：回路切断阀巡检计划已排入一车间冷却区值班表。",
    content_hash: "",
    meta: { tags: ["ops", "sample", "cooling-loop"], kind: "note" },
    last_seen_at: "2026-10-29T03:00:00Z",
  },
];

export const SAMPLE_SOURCE_INDEX: SourceIndexLinks = {
  "src-ledger-pump-01": ["device-pump-01"],
  "src-site-cooling-1": ["site-cooling-zone-1"],
  "src-ops-note-valve": ["device-valve-01"],
};

export const SAMPLE_GRAPH_STATS: GraphStatsSnapshot = {
  entity_count: 3,
  relation_count: 2,
  updated_at: "2026-10-29T03:05:00Z",
  store_backend: "file",
};
