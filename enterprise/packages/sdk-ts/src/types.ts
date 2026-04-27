export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
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
  error?: {
    code: string;
    message: string;
  };
};

export type SendMessageResult = {
  requestId: string;
};

