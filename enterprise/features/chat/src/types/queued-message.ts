import type { ChatMessageAttachment } from "@agenticx/core-api";

export type QueuedMessage = {
  id: string;
  sessionId: string;
  content: string;
  attachments?: ChatMessageAttachment[];
  timestamp: number;
};
