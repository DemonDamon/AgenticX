/** Structured deep-research SSE events (portal BFF → client). */

export type DeepResearchEvent =
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
