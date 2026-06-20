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
};

export type ChatUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ChatChunk = {
  requestId: string;
  delta?: string;
  done: boolean;
  usage?: ChatUsage;
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

