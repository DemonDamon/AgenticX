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

/** Synthetic Brand-A seed sessions covering all three modes. */
export function buildSampleSessions(now = "2026-10-29T02:00:00Z"): DisambiguationSession[] {
  return [
    {
      id: "das-brand-a-candidate",
      status: "open",
      source: "rules_nl",
      pending: [
        {
          id: "daq-brand-a-cand-1",
          mode: "candidate_select",
          prompt: "Which Brand-A device threshold object should this rule bind to?",
          field: "object",
          candidates: [
            { id: "brand-a-pump-01", label: "Brand-A Pump 01", score: 0.91 },
            { id: "brand-a-pump-02", label: "Brand-A Pump 02", score: 0.84 },
            { id: "brand-a-valve-01", label: "Brand-A Valve 01", score: 0.62 },
          ],
          conflicts: [],
          allow_free_text: false,
          context: { sample: "brand-a" },
          session_id: "das-brand-a-candidate",
        },
      ],
      resolved: [],
      slots: {},
      created_at: now,
      updated_at: now,
      meta: { tags: ["ops", "sample", "brand-a"] },
    },
    {
      id: "das-brand-a-supplement",
      status: "open",
      source: "rules_nl",
      pending: [
        {
          id: "daq-brand-a-info-1",
          mode: "info_supplement",
          prompt: "Brand-A rule draft is missing a notify channel — please supply one.",
          field: "notify_channel",
          candidates: [],
          conflicts: [],
          allow_free_text: true,
          context: { sample: "brand-a" },
          session_id: "das-brand-a-supplement",
        },
      ],
      resolved: [],
      slots: {},
      created_at: now,
      updated_at: now,
      meta: { tags: ["ops", "sample", "brand-a"] },
    },
    {
      id: "das-brand-a-conflict",
      status: "open",
      source: "retrieval",
      pending: [
        {
          id: "daq-brand-a-conf-1",
          mode: "conflict_resolve",
          prompt: "Conflicting site labels for Brand-A entity — pick the correct value.",
          field: "site_name",
          candidates: [
            { id: "val-plant-a", label: "Brand-A Plant A", score: 0.8 },
            { id: "val-plant-b", label: "Brand-A Plant B", score: 0.77 },
          ],
          conflicts: [
            {
              field: "site_name",
              values: ["Brand-A Plant A", "Brand-A Plant B"],
              sources: ["ledger", "graph"],
              reason: "near-score multi-source conflict",
            },
          ],
          allow_free_text: true,
          context: { sample: "brand-a" },
          session_id: "das-brand-a-conflict",
        },
      ],
      resolved: [],
      slots: {},
      created_at: now,
      updated_at: now,
      meta: { tags: ["ops", "sample", "brand-a"] },
    },
  ];
}

export const SAMPLE_DISAMBIGUATION_SESSIONS = buildSampleSessions();
