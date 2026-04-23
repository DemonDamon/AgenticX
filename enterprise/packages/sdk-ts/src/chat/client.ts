import type { ChatChunk, ChatRequest, SendMessageResult } from "../types";

export interface ChatClient {
  sendMessage(req: ChatRequest): Promise<SendMessageResult>;
  stream(requestId: string): AsyncIterable<ChatChunk>;
  cancel(requestId: string): Promise<void>;
}

