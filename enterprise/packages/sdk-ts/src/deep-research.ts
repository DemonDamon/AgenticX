/** Structured deep-research SSE events (portal BFF → client). */

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
      /** Optional cost/coverage diagnostics, captured from calls already made. */
      trace?: {
        queries: Array<{
          query: string;
          kind: "primary" | "term" | "english" | "authority" | "recency" | "contrarian";
          status: "ok" | "empty" | "failed" | "skipped";
          hitCount: number;
          /** Actual configured provider instances attempted by the default search executor. */
          providerIds?: string[];
        }>;
        /** Top-level search queries run; provider adapters may internally fail over. */
        topLevelQueriesRun: number;
        /** Actual provider attempts observed; may be 0 for a custom injected search function. */
        providerCalls: number;
        candidateCount: number;
        selectedCount: number;
        uniqueHosts: number;
        dateFrom?: string;
        dateTo?: string;
      };
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
  /** Bounded model reasoning/draft attached only to a collapsible process step. */
  | {
      type: "reasoning";
      id: string;
      phase: "clarify" | "plan" | "lanes" | "reflect" | "synthesize";
      title: string;
      text: string;
      kind: "reasoning" | "draft";
      done?: boolean;
    }
  | { type: "reflection"; gaps: string[] }
  | {
      type: "research_stats";
      queriesPlanned: number;
      urlsDiscovered: number;
      sourcesSelected: number;
      pagesFetched: number;
    }
  | {
      type: "research_budget";
      usage: {
        searchQueries: { used: number; limit: number; remaining: number };
        providerCalls: { used: number; limit: number; remaining: number };
        pageFetches: { used: number; limit: number; remaining: number };
        modelCalls: { used: number; limit: number; remaining: number };
      };
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
};
