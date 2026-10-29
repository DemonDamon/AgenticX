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

/** Synthetic Brand-A seed only — no real customer identifiers. */
export const SAMPLE_SOURCES: SourceDocumentRow[] = [
  {
    id: "brand-a-src-ledger-1",
    content: "Brand-A plant ledger entry for Pump 01 at site plant-a.",
    content_hash: "",
    meta: { tags: ["ops", "sample", "brand-a"], kind: "ledger" },
    last_seen_at: "2026-10-29T02:00:00Z",
  },
  {
    id: "brand-a-src-site-1",
    content: "Brand-A Plant A site registry record.",
    content_hash: "",
    meta: { tags: ["ops", "sample", "brand-a"], kind: "site" },
    last_seen_at: "2026-10-29T02:00:00Z",
  },
  {
    id: "brand-a-src-ops-note",
    content: "Brand-A ops note: valve check scheduled for plant-a.",
    content_hash: "",
    meta: { tags: ["ops", "sample", "brand-a"], kind: "note" },
    last_seen_at: "2026-10-29T03:00:00Z",
  },
];

export const SAMPLE_SOURCE_INDEX: SourceIndexLinks = {
  "brand-a-src-ledger-1": ["brand-a-entity-pump-01"],
  "brand-a-src-site-1": ["brand-a-site-plant-a"],
  "brand-a-src-ops-note": ["brand-a-entity-valve-01"],
};

export const SAMPLE_GRAPH_STATS: GraphStatsSnapshot = {
  entity_count: 3,
  relation_count: 2,
  updated_at: "2026-10-29T03:05:00Z",
  store_backend: "file",
};
