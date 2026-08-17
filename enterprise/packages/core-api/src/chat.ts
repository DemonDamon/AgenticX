export type IsoDateTime = string;
export type EntityId = string;

export type ChatMessageRole = "system" | "user" | "assistant" | "tool";

export type ToolCallSummary = {
  id: string;
  tool_name: string;
  status: "queued" | "running" | "success" | "failed";
  args_preview?: string;
  result_preview?: string;
};

/**
 * Chat attachment persisted in chat_messages.metadata.
 * - images: `data_url` → OpenAI image_url
 * - documents: `parsed_text` injected into user content for Q&A
 */
export type ChatMessageAttachment = {
  name: string;
  mime_type: string;
  size?: number;
  /** Image (or small binary) data URL; omit for text-only document attachments. */
  data_url?: string;
  /** Extracted plain text for document Q&A. */
  parsed_text?: string;
  kind?: "image" | "document" | "video";
  /** Original-file blob id in enterprise_chat_attachments (when retained). */
  attachment_id?: string;
};

/** Web-search hit attached to an assistant message (portal BFF). */
export type WebSearchSource = {
  title: string;
  url: string;
  snippet: string;
  /** True when this hit was injected into the model prompt for the turn. */
  usedByModel?: boolean;
  /**
   * Provider publication timestamp as reported, unparsed. Absent for providers
   * that do not report one, which is most of them; persisted so retrieval
   * ordering can be checked after the fact.
   */
  publishedAt?: string;
};

/**
 * Lightweight, provider-agnostic diagnostics for one automatic web-search turn.
 * Persisted as optional chat message metadata; never required to render history.
 */
export type WebSearchTrace = {
  version: 1;
  decision: "search" | "skip";
  reason: string;
  resolvedQuery?: string;
  facets?: Array<{
    query: string;
    /** Configured provider instance ids attempted for this facet, in order. */
    providerIds?: string[];
    hitCount: number;
    uniqueHosts: number;
    dateFrom?: string;
    dateTo?: string;
  }>;
  providerCalls: number;
  retry?: {
    used: true;
    queryIndex: number;
    reason: string;
    fromProviderId: string;
    toProviderId: string;
  };
  timings?: {
    queryResolutionMs: number;
    retrievalMs: number;
  };
};

const MAX_WEB_SEARCH_TRACE_REASON_CHARS = 500;
const MAX_WEB_SEARCH_TRACE_QUERY_CHARS = 2_000;
const MAX_WEB_SEARCH_TRACE_PROVIDER_ID_CHARS = 200;
const MAX_WEB_SEARCH_TRACE_FACETS = 5;
const MAX_WEB_SEARCH_TRACE_COUNT = 10_000;
const MAX_WEB_SEARCH_TRACE_DURATION_MS = 10 * 60 * 1_000;

function boundedTraceInteger(raw: unknown, max: number): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return undefined;
  return Math.min(Math.trunc(raw), max);
}

function boundedTraceString(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  return value ? value.slice(0, max) : undefined;
}

/**
 * Best-effort boundary sanitizer for optional retrieval diagnostics.
 * Unknown versions or malformed required fields are dropped instead of failing chat history.
 */
export function sanitizeWebSearchTrace(raw: unknown): WebSearchTrace | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  if (row.version !== 1 || (row.decision !== "search" && row.decision !== "skip")) {
    return undefined;
  }
  const reason = boundedTraceString(row.reason, MAX_WEB_SEARCH_TRACE_REASON_CHARS);
  const providerCalls = boundedTraceInteger(row.providerCalls, MAX_WEB_SEARCH_TRACE_COUNT);
  if (!reason || providerCalls === undefined) return undefined;

  const resolvedQuery = boundedTraceString(row.resolvedQuery, MAX_WEB_SEARCH_TRACE_QUERY_CHARS);
  let facets: WebSearchTrace["facets"];
  if (Array.isArray(row.facets)) {
    const sanitized = row.facets
      .slice(0, MAX_WEB_SEARCH_TRACE_FACETS)
      .flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const facet = item as Record<string, unknown>;
        const query = boundedTraceString(facet.query, MAX_WEB_SEARCH_TRACE_QUERY_CHARS);
        const hitCount = boundedTraceInteger(facet.hitCount, MAX_WEB_SEARCH_TRACE_COUNT);
        const uniqueHosts = boundedTraceInteger(facet.uniqueHosts, MAX_WEB_SEARCH_TRACE_COUNT);
        if (!query || hitCount === undefined || uniqueHosts === undefined) return [];
        const providerIds = Array.isArray(facet.providerIds)
          ? facet.providerIds
              .slice(0, 2)
              .flatMap((providerId) => {
                const value = boundedTraceString(
                  providerId,
                  MAX_WEB_SEARCH_TRACE_PROVIDER_ID_CHARS,
                );
                return value ? [value] : [];
              })
          : [];
        const dateFrom = boundedTraceString(facet.dateFrom, 32);
        const dateTo = boundedTraceString(facet.dateTo, 32);
        return [{
          query,
          ...(providerIds.length > 0 ? { providerIds } : {}),
          hitCount,
          uniqueHosts,
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
        }];
      });
    if (sanitized.length > 0) facets = sanitized;
  }

  let retry: WebSearchTrace["retry"];
  if (row.retry && typeof row.retry === "object" && !Array.isArray(row.retry)) {
    const value = row.retry as Record<string, unknown>;
    const queryIndex = boundedTraceInteger(value.queryIndex, MAX_WEB_SEARCH_TRACE_COUNT);
    const retryReason = boundedTraceString(value.reason, MAX_WEB_SEARCH_TRACE_REASON_CHARS);
    const fromProviderId = boundedTraceString(value.fromProviderId, MAX_WEB_SEARCH_TRACE_PROVIDER_ID_CHARS);
    const toProviderId = boundedTraceString(value.toProviderId, MAX_WEB_SEARCH_TRACE_PROVIDER_ID_CHARS);
    if (
      value.used === true &&
      queryIndex !== undefined &&
      queryIndex < MAX_WEB_SEARCH_TRACE_FACETS &&
      retryReason &&
      fromProviderId &&
      toProviderId
    ) {
      retry = {
        used: true,
        queryIndex,
        reason: retryReason,
        fromProviderId,
        toProviderId,
      };
    }
  }

  let timings: WebSearchTrace["timings"];
  if (row.timings && typeof row.timings === "object" && !Array.isArray(row.timings)) {
    const value = row.timings as Record<string, unknown>;
    const queryResolutionMs = boundedTraceInteger(
      value.queryResolutionMs,
      MAX_WEB_SEARCH_TRACE_DURATION_MS,
    );
    const retrievalMs = boundedTraceInteger(value.retrievalMs, MAX_WEB_SEARCH_TRACE_DURATION_MS);
    if (queryResolutionMs !== undefined && retrievalMs !== undefined) {
      timings = { queryResolutionMs, retrievalMs };
    }
  }

  return {
    version: 1,
    decision: row.decision,
    reason,
    ...(resolvedQuery ? { resolvedQuery } : {}),
    ...(facets ? { facets } : {}),
    providerCalls,
    ...(retry ? { retry } : {}),
    ...(timings ? { timings } : {}),
  };
}

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

/** Run-level interaction profile: depth, clarify mode, and plan visibility are independent. */
export type ResearchInteractionProfile = {
  researchDepth: "light" | "standard" | "deep";
  clarifyMode: "card" | "chat" | "none";
  clarifyBudget: { maxRounds: number; allowMidRun: boolean };
  planVisibility: "hidden" | "preview" | "editable" | "chat_editable";
  assumptions: string[];
};

/** Deep-research workbench state attached to an assistant message. */
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
      /** 0 = preflight, 1..n = midrun; absent means preflight for legacy events. */
      roundIndex?: number;
      phase?: "preflight" | "midrun";
      /** High-impact ambiguity that cannot be silently skipped. */
      blocking?: boolean;
    }
  | {
      type: "clarify_chat";
      runId: string;
      roundIndex: number;
      phase: "preflight" | "midrun" | "plan";
      promptText: string;
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
  /** Short assistant prose between workbench steps (not part of final report content). */
  | { type: "narrative"; text: string };

/** Optional wall-clock ISO timestamp stamped at emit time for trace duration. */
export type DeepResearchEvent = DeepResearchEventPayload & { ts?: string };

export type ChatMessageDeepResearch = {
  runId: string;
  status: "running" | "awaiting_clarify" | "completed" | "failed" | "cancelled";
  events: DeepResearchEvent[];
  artifactIds?: string[];
  /** User answers from clarify panel (client + persist). */
  clarifyAnswers?: Record<string, string>;
  /** Latest interaction profile (from research_profile event). */
  profile?: ResearchInteractionProfile;
  /** Latest plan snapshot and version (from research_plan event). */
  plan?: ResearchPlanSnapshot;
  planVersion?: number;
  assumptions?: string[];
};

export type ChatMessage = {
  id: EntityId;
  session_id: EntityId;
  tenant_id: EntityId;
  user_id: EntityId;
  role: ChatMessageRole;
  content: string;
  attachments?: ChatMessageAttachment[];
  web_search_sources?: WebSearchSource[];
  web_search_trace?: WebSearchTrace;
  deep_research?: ChatMessageDeepResearch;
  model?: string;
  /**
   * 本轮请求的 x-agenticx-trace-id（26 位 ULID）。
   * 用于把这条助手回复关联到 admin-console 的 Portal 日志 / 网关审计。
   * 仅助手消息有值；历史消息在该字段引入前写入的为 undefined。
   */
  trace_id?: string;
  provider?: string;
  reasoning?: string;
  tool_calls?: ToolCallSummary[];
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  created_at: IsoDateTime;
};

export type ChatSession = {
  id: EntityId;
  tenant_id: EntityId;
  user_id: EntityId;
  title: string;
  active_model?: string;
  message_count: number;
  last_message_at?: IsoDateTime;
  /** ISO time when pinned; omit/undefined when not pinned. */
  pinned_at?: IsoDateTime;
  /** Short preview for history list (first assistant, else first user). */
  preview?: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
};

export type ChatRequest = {
  session_id: EntityId;
  tenant_id: EntityId;
  user_id: EntityId;
  model?: string;
  provider?: string;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  messages: ChatMessage[];
  metadata?: Record<string, string | number | boolean | null>;
};

export type ChatError = {
  // 4xxxx: 业务错误；9xxxx: 策略拦截（由 gateway/policy-engine 触发）
  code: string;
  message: string;
  retryable?: boolean;
  detail?: string;
};

export type ChatChunk = {
  request_id: EntityId;
  session_id: EntityId;
  delta?: string;
  reasoning?: string;
  tool_call?: ToolCallSummary;
  done: boolean;
  error?: ChatError;
};

export type ChatResponse = {
  request_id: EntityId;
  session: ChatSession;
  messages: ChatMessage[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost_usd?: number;
  };
  route?: "local" | "private-cloud" | "third-party";
};

export type ApiEnvelope<T> = {
  code: string;
  message: string;
  data?: T;
};
