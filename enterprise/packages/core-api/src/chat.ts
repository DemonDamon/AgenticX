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

export type ChatMessage = {
  id: EntityId;
  session_id: EntityId;
  tenant_id: EntityId;
  user_id: EntityId;
  role: ChatMessageRole;
  content: string;
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

