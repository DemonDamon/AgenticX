import type { MessageAttachment } from "../store";
import {
  canonicalizeUserReferenceMentions,
  stableAttachmentSetIdentity,
} from "./reference-attachment";

export type SendDedupeEntry = {
  sessionId: string;
  text: string;
  at: number;
};

type PendingTurnRow = {
  role: string;
  content?: string;
  attachments?: MessageAttachment[];
  metadata?: Record<string, unknown>;
};

/** Last visible turn is the same user text with no assistant reply yet (retry / barge-in). */
export function shouldSuppressDuplicatePendingUserEcho(
  messages: PendingTurnRow[],
  text: string,
  attachments?: MessageAttachment[],
  clientTurnId?: string,
): boolean {
  const normalized = String(text ?? "").trim();
  if (!normalized) return false;
  const nonTool = messages.filter((m) => m.role !== "tool");
  const last = nonTool[nonTool.length - 1];
  if (!last || last.role !== "user") return false;
  const existingKey = canonicalizeUserReferenceMentions(
    String(last.content ?? ""),
    last.attachments,
  ).trim();
  const incomingKey = canonicalizeUserReferenceMentions(
    normalized,
    attachments,
  ).trim();
  const existingAttachments = stableAttachmentSetIdentity(last.attachments);
  const incomingAttachments = stableAttachmentSetIdentity(attachments);
  const hasAttachments =
    Boolean(last.attachments?.length) || Boolean(attachments?.length);
  if (
    hasAttachments &&
    (!existingAttachments.strong || !incomingAttachments.strong)
  ) {
    return false;
  }
  const existingClientTurnId = String(
    last.metadata?.client_turn_id ?? "",
  ).trim();
  const incomingClientTurnId = String(clientTurnId ?? "").trim();
  if (
    existingClientTurnId &&
    incomingClientTurnId &&
    existingClientTurnId !== incomingClientTurnId
  ) {
    return false;
  }
  return (
    existingKey === incomingKey &&
    existingAttachments.key === incomingAttachments.key
  );
}

/** Drop duplicate user sends within a short window (double-click / chip burst). */
export function shouldDropDuplicateUserSend(
  entry: SendDedupeEntry | null | undefined,
  sessionId: string,
  text: string,
  now: number,
  windowMs = 2000,
): boolean {
  const sid = String(sessionId ?? "").trim();
  const normalized = String(text ?? "").trim();
  if (!sid || !normalized || !entry) return false;
  return (
    entry.sessionId === sid &&
    entry.text === normalized &&
    now - entry.at >= 0 &&
    now - entry.at < windowMs
  );
}
