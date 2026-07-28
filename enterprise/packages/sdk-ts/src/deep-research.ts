/** Structured deep-research SSE events (portal BFF → client). */

export type DeepResearchEvent =
  | { type: "run_started"; runId: string }
  | {
      type: "phase";
      phase: "clarify" | "plan" | "lanes" | "synthesize" | "done";
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
    }
  | { type: "lane_started"; laneId: string; title: string; index: number; total: number }
  | { type: "lane_progress"; laneId: string; message: string; sourcesCollected?: number }
  | { type: "lane_done"; laneId: string; artifactPath?: string; status: "ok" | "failed" }
  | {
      type: "artifact";
      id: string;
      path: string;
      title: string;
      kind: "memo" | "report" | "other";
      bytes: number;
    }
  | { type: "clarify_timeout"; runId: string }
  | { type: "narrative"; text: string };

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
};
