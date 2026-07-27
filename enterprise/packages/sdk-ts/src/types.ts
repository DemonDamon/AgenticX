export type ChatRole = "system" | "user" | "assistant";

export type ChatMessageAttachment = {
  name: string;
  mimeType: string;
  size?: number;
  dataUrl: string;
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
};

export type ChatUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type WebSearchSource = {
  title: string;
  url: string;
  snippet: string;
};

export type ChatChunk = {
  requestId: string;
  delta?: string;
  done: boolean;
  usage?: ChatUsage;
  /** Structured web-search hits from portal BFF (not mixed into delta). */
  webSearchSources?: WebSearchSource[];
  /** 用户主动中断（非错误）：保留已生成内容，不视为失败。 */
  cancelled?: boolean;
  error?: {
    code: string;
    message: string;
  };
};

export type SendMessageResult = {
  requestId: string;
};

