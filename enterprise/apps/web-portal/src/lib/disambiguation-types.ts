/** Disambiguation admin types — mirrors agenticx/runtime/disambiguation.py */

export type DisambiguationMode =
  | "candidate_select"
  | "info_supplement"
  | "conflict_resolve";

export type DisambiguationSessionStatus = "open" | "completed" | "cancelled";

export type DisambiguationCandidate = {
  id: string;
  label: string;
  score?: number | null;
  meta?: Record<string, unknown>;
};

export type DisambiguationConflict = {
  field: string;
  values: unknown[];
  sources: string[];
  reason?: string;
};

export type DisambiguationRequest = {
  id: string;
  mode: DisambiguationMode;
  prompt: string;
  field?: string;
  candidates: DisambiguationCandidate[];
  conflicts: DisambiguationConflict[];
  allow_free_text?: boolean;
  context?: Record<string, unknown>;
  session_id?: string;
};

export type DisambiguationResponse = {
  request_id: string;
  selected_ids?: string[];
  free_text?: string | null;
  cancelled?: boolean;
  meta?: Record<string, unknown>;
};

export type DisambiguationSession = {
  id: string;
  status: DisambiguationSessionStatus;
  source: string;
  pending: DisambiguationRequest[];
  resolved: { request: DisambiguationRequest; response: DisambiguationResponse }[];
  slots: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  meta?: Record<string, unknown>;
};

/** 示例化工厂·冷却回路 — synthetic seed covering all three modes (desensitized demo). */
export function buildSampleSessions(now = "2026-10-29T02:00:00Z"): DisambiguationSession[] {
  return [
    {
      id: "das-cooling-candidate",
      status: "open",
      source: "rules_nl",
      pending: [
        {
          id: "daq-cooling-cand-1",
          mode: "candidate_select",
          prompt: "这条「冷却回路超温告警」规则，应该绑定哪台设备？",
          field: "object",
          candidates: [
            { id: "device-pump-01", label: "1号循环泵", score: 0.91 },
            { id: "device-pump-02", label: "2号循环泵", score: 0.84 },
            { id: "device-valve-01", label: "回路切断阀", score: 0.62 },
          ],
          conflicts: [],
          allow_free_text: false,
          context: { sample: "cooling-loop", tenant: "示例化工厂" },
          session_id: "das-cooling-candidate",
        },
      ],
      resolved: [],
      slots: {},
      created_at: now,
      updated_at: now,
      meta: { tags: ["ops", "sample", "cooling-loop"] },
    },
    {
      id: "das-cooling-supplement",
      status: "open",
      source: "rules_nl",
      pending: [
        {
          id: "daq-cooling-info-1",
          mode: "info_supplement",
          prompt: "规则草稿还缺告警通知渠道，请补充（例如：值班群 / 短信 / 邮件）。",
          field: "notify_channel",
          candidates: [],
          conflicts: [],
          allow_free_text: true,
          context: { sample: "cooling-loop", tenant: "示例化工厂" },
          session_id: "das-cooling-supplement",
        },
      ],
      resolved: [],
      slots: {},
      created_at: now,
      updated_at: now,
      meta: { tags: ["ops", "sample", "cooling-loop"] },
    },
    {
      id: "das-cooling-conflict",
      status: "open",
      source: "retrieval",
      pending: [
        {
          id: "daq-cooling-conf-1",
          mode: "conflict_resolve",
          prompt: "同一设备在两份台账里的所属区域不一致，请确认以哪个为准。",
          field: "site_name",
          candidates: [
            { id: "zone-cooling-1", label: "一车间冷却区", score: 0.8 },
            { id: "zone-cooling-2", label: "二车间冷却区", score: 0.77 },
          ],
          conflicts: [
            {
              field: "所属区域",
              values: ["一车间冷却区", "二车间冷却区"],
              sources: ["设备台账", "工艺图谱"],
              reason: "多源近分冲突，需人工确认",
            },
          ],
          allow_free_text: true,
          context: { sample: "cooling-loop", tenant: "示例化工厂" },
          session_id: "das-cooling-conflict",
        },
      ],
      resolved: [],
      slots: {},
      created_at: now,
      updated_at: now,
      meta: { tags: ["ops", "sample", "cooling-loop"] },
    },
  ];
}

export const SAMPLE_DISAMBIGUATION_SESSIONS = buildSampleSessions();
