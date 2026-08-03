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
};

/** Deep-research workbench state attached to an assistant message. */
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
  /** Short assistant prose between workbench steps (not part of final report content). */
  | { type: "narrative"; text: string };

export type ChatMessageDeepResearch = {
  runId: string;
  status: "running" | "awaiting_clarify" | "completed" | "failed" | "cancelled";
  events: DeepResearchEvent[];
  artifactIds?: string[];
  /** User answers from clarify panel (client + persist). */
  clarifyAnswers?: Record<string, string>;
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
  deep_research?: ChatMessageDeepResearch;
  model?: string;
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

