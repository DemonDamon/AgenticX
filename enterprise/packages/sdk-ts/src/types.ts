import type { DeepResearchEvent } from "./deep-research";

export type { DeepResearchEvent, DeepResearchState, DeepResearchStatus } from "./deep-research";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessageAttachment = {
  name: string;
  mimeType: string;
  size?: number;
  dataUrl?: string;
  parsedText?: string;
  kind?: "image" | "document" | "video";
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  attachments?: ChatMessageAttachment[];
  createdAt: string;
};

export type ChatRequest = {
  sessionId: string;
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  /** User toggled web search in the composer; BFF injects the web_search tool when true. */
  webSearch?: boolean;
  /** User toggled deep research in the composer; BFF runs the multi-stage research pipeline. */
  deepResearch?: boolean;
  deepResearchAuto?: boolean;
  /** Deep-research interaction preference: auto / direct / card_first / plan_chat. */
  deepResearchInteraction?: string;
};

export type ChatUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ChatQuotaErrorKind = "token_day" | "token_week" | "monthly";

/** Structured enterprise quota rejection returned by the managed gateway. */
export type ChatQuotaError = {
  kind: ChatQuotaErrorKind;
  message: string;
  period?: string;
  resetAt?: string;
  used?: number;
  limit?: number;
};

export type ChatChunkError = {
  code: string;
  message: string;
  kind?: ChatQuotaErrorKind;
  period?: string;
  resetAt?: string;
  used?: number;
  limit?: number;
};

export type WebSearchSource = {
  title: string;
  url: string;
  snippet: string;
  /** True when this hit was injected into the model prompt for the turn. */
  usedByModel?: boolean;
  /** Provider publication timestamp; absent for providers that do not report one. */
  publishedAt?: string;
};

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

export type ChatChunk = {
  requestId: string;
  /** Correlates browser → portal → gateway audit / token traces. */
  traceId?: string;
  delta?: string;
  done: boolean;
  usage?: ChatUsage;
  /** Structured web-search hits from portal BFF (not mixed into delta). */
  webSearchSources?: WebSearchSource[];
  /** Optional provider-agnostic retrieval diagnostics from portal BFF. */
  webSearchTrace?: WebSearchTrace;
  /** Structured deep-research progress (not mixed into delta). */
  deepResearchEvent?: DeepResearchEvent;
  /** 用户主动中断（非错误）：保留已生成内容，不视为失败。 */
  cancelled?: boolean;
  error?: ChatChunkError;
};

export type SendMessageResult = {
  requestId: string;
  traceId: string;
};
