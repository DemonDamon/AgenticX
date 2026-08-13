import type { ChatMessageAttachment } from "@agenticx/core-api";

export type QueuedMessage = {
  id: string;
  sessionId: string;
  content: string;
  attachments?: ChatMessageAttachment[];
  /** Snapshot composer modes per message; session defaults may change while queued. */
  webSearch?: boolean;
  deepResearch?: boolean;
  deepResearchAuto?: boolean;
  timestamp: number;
};
