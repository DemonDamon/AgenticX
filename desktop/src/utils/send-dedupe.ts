export type SendDedupeEntry = {
  sessionId: string;
  text: string;
  at: number;
};

type PendingTurnRow = { role: string; content?: string };

/** Last visible turn is the same user text with no assistant reply yet (retry / barge-in). */
export function shouldSuppressDuplicatePendingUserEcho(
  messages: PendingTurnRow[],
  text: string,
): boolean {
  const normalized = String(text ?? "").trim();
  if (!normalized) return false;
  const nonTool = messages.filter((m) => m.role !== "tool");
  const last = nonTool[nonTool.length - 1];
  if (!last || last.role !== "user") return false;
  return String(last.content ?? "").trim() === normalized;
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
