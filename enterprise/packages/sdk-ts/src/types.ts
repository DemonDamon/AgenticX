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

export type ChatChunk = {
  requestId: string;
  delta?: string;
  done: boolean;
  error?: {
    code: string;
    message: string;
  };
};

export type SendMessageResult = {
  requestId: string;
};

