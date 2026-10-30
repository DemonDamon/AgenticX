/** Knowledge lifecycle admin types — mirrors agenticx/knowledge/lifecycle JSON shapes. */

export type KnowledgeStatus = "draft" | "pending_review" | "published" | "retired";

export type IssueStatus = "open" | "in_progress" | "resolved" | "waived";

export type KnowledgeObjectRow = {
  id: string;
  kind: string;
  status: KnowledgeStatus;
  version: number;
  attrs: Record<string, unknown>;
  relations: Record<string, unknown>[];
  source_ids: string[];
  meta: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type KnowledgeIssueRow = {
  id: string;
  object_id: string;
  code: string;
  severity: string;
  status: IssueStatus;
  message: string;
  detail: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  resolved_by?: string;
  fingerprint?: string;
};

export type ChangeEventRow = {
  id: string;
  object_id: string;
  action: string;
  actor: string;
  from_status?: string | null;
  to_status?: string | null;
  detail: Record<string, unknown>;
  at: string;
};

export type QualityFindingRow = {
  code: string;
  severity: string;
  object_id: string;
  message: string;
  detail: Record<string, unknown>;
};

export const ALLOWED_OBJECT_TRANSITIONS: Record<KnowledgeStatus, KnowledgeStatus[]> = {
  draft: ["pending_review", "retired"],
  pending_review: ["published", "draft", "retired"],
  published: ["retired", "draft"],
  retired: ["draft"],
};

export const ALLOWED_ISSUE_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  open: ["in_progress", "resolved", "waived"],
  in_progress: ["resolved", "waived", "open"],
  resolved: ["open"],
  waived: ["open"],
};

/** 示例化工厂·冷却回路 synthetic seed — desensitized demo, not a real customer. */
export const SAMPLE_KNOWLEDGE_OBJECTS: KnowledgeObjectRow[] = [
  {
    id: "device-pump-01",
    kind: "entity",
    status: "draft",
    version: 1,
    attrs: { name: "1号循环泵", site: "一车间冷却区" },
    relations: [{ rel: "located_in", target_id: "site-cooling-zone-1" }],
    source_ids: ["src-ledger-pump-01"],
    meta: { tags: ["ops", "sample", "cooling-loop"] },
    created_at: "2026-10-29T00:00:00Z",
    updated_at: "2026-10-29T00:00:00Z",
  },
  {
    id: "site-cooling-zone-1",
    kind: "site",
    status: "published",
    version: 2,
    attrs: { name: "一车间冷却区" },
    relations: [],
    source_ids: ["src-site-cooling-1"],
    meta: { tags: ["ops", "sample", "cooling-loop"] },
    created_at: "2026-10-28T00:00:00Z",
    updated_at: "2026-10-29T00:00:00Z",
  },
  {
    id: "device-pump-02",
    kind: "entity",
    status: "pending_review",
    version: 1,
    attrs: { name: "2号循环泵" },
    relations: [{ rel: "located_in", target_id: "site-cooling-zone-missing" }],
    source_ids: [],
    meta: { tags: ["ops", "sample", "cooling-loop"], expect_sources: true },
    created_at: "2026-10-29T01:00:00Z",
    updated_at: "2026-10-29T01:00:00Z",
  },
];

export const SAMPLE_QUALITY_POLICY = {
  required_attrs: { entity: ["name"], site: ["name"] } as Record<string, string[]>,
  relation_targets_must_exist: true,
  duplicate_keys: ["kind", "attrs.name"],
  stale_if_status: ["retired"],
  require_source_ids: false,
};
