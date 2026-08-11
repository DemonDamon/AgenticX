/** Structured deep-research SSE events (portal BFF → client). */

/** User-facing research plan snapshot (no model chain-of-thought). */
export type ResearchPlanSnapshot = {
  version: number;
  objective: string;
  scope: string[];
  subQuestions: Array<{
    id: string;
    title: string;
    purpose?: string;
  }>;
  sourceStrategy: string[];
  deliverables: string[];
  assumptions: string[];
};

/** Run-level interaction profile: depth / clarify mode / plan visibility are independent. */
export type ResearchInteractionProfile = {
  researchDepth: "light" | "standard" | "deep";
  clarifyMode: "card" | "chat" | "none";
  clarifyBudget: { maxRounds: number; allowMidRun: boolean };
  planVisibility: "hidden" | "preview" | "editable" | "chat_editable";
  assumptions: string[];
};

export type DeepResearchEventPayload =
  | { type: "run_started"; runId: string }
  | {
      type: "phase";
      phase: "recon" | "clarify" | "plan" | "lanes" | "reflect" | "synthesize" | "done";
      message: string;
    }
  | {
      type: "clarify";
      runId: string;
      step: number;
      total: number;
      questionId: string;
      question: string;
      options: Array<{ id: string; label: string }>;
      allowCustom?: boolean;
      /** default true；false = single-select chips */
      multiSelect?: boolean;
      /** 0 = preflight, 1..n = midrun；缺省视为 0（旧事件兼容） */
      roundIndex?: number;
      phase?: "preflight" | "midrun";
      /** true = 高风险缺关键槽位，「直接开始」也不能静默绕过 */
      blocking?: boolean;
    }
  /** Conversational clarify (no card): assistant asks in natural language. */
  | {
      type: "clarify_chat";
      runId: string;
      roundIndex: number;
      /** `plan` = 计划对齐多轮对话引导（与 preflight/midrun 澄清区分） */
      phase: "preflight" | "midrun" | "plan";
      /** 模型发的自然语言引导 */
      promptText: string;
      /** 后端解析用户回复后得到的槽位（hydrate 用） */
      resolvedSlots?: Record<string, string>;
    }
  | {
      type: "research_profile";
      runId: string;
      researchDepth: "light" | "standard" | "deep";
      clarifyMode: "card" | "chat" | "none";
      clarifyBudget: { maxRounds: number; allowMidRun: boolean };
      planVisibility: "hidden" | "preview" | "editable" | "chat_editable";
      assumptions: string[];
    }
  | {
      type: "research_plan";
      runId: string;
      action: "proposed" | "updated" | "approved";
      version: number;
      plan: ResearchPlanSnapshot;
    }
  | { type: "lane_started"; laneId: string; title: string; index: number; total: number }
  | { type: "lane_progress"; laneId: string; message: string; sourcesCollected?: number }
  | { type: "lane_done"; laneId: string; artifactPath?: string; status: "ok" | "failed" }
  /** Per-lane source list so the workbench can show which pages were searched. */
  | {
      type: "lane_sources";
      laneId: string;
      sources: Array<{
        title: string;
        url: string;
        /** Truncated search snippet (<= 200 chars). */
        snippet?: string;
        /** Artifact path when the full text was archived. */
        archivedPath?: string;
        /** Whether the full text was fetched successfully. */
        fetched?: boolean;
      }>;
    }
  | {
      type: "artifact";
      id: string;
      path: string;
      title: string;
      kind: "memo" | "report" | "other";
      bytes: number;
    }
  | { type: "clarify_timeout"; runId: string }
  | { type: "reflection"; gaps: string[] }
  | {
      type: "research_stats";
      queriesPlanned: number;
      urlsDiscovered: number;
      sourcesSelected: number;
      pagesFetched: number;
    }
  | { type: "narrative"; text: string };

/** Optional wall-clock ISO timestamp stamped at emit time for trace duration. */
export type DeepResearchEvent = DeepResearchEventPayload & { ts?: string };

export type DeepResearchStatus =
  | "running"
  | "awaiting_clarify"
  | "completed"
  | "failed"
  | "cancelled";

export type DeepResearchState = {
  runId: string;
  status: DeepResearchStatus;
  events: DeepResearchEvent[];
  artifactIds?: string[];
  clarifyAnswers?: Record<string, string>;
  /** Latest interaction profile (from research_profile event). */
  profile?: ResearchInteractionProfile;
  /** Latest plan snapshot + version (from research_plan event). */
  plan?: ResearchPlanSnapshot;
  planVersion?: number;
  assumptions?: string[];
};
