import type { Message } from "../store";
import { stripLegacyNoticePrefix } from "./context-notice";

type NoticePick = Pick<Message, "role" | "content" | "metadata">;

export function isSupervisorDoneNotice(message: NoticePick): boolean {
  if (message.role !== "tool") return false;
  const kind = (message.metadata as Record<string, unknown> | undefined)?.kind;
  if (kind === "unattended_done") return true;
  return /^✅\s*任务已完成/u.test(String(message.content ?? "").trim());
}

export function isSupervisorFailNotice(message: NoticePick): boolean {
  if (message.role !== "tool") return false;
  const kind = (message.metadata as Record<string, unknown> | undefined)?.kind;
  if (kind === "unattended_failed") return true;
  return String(message.content ?? "").includes("无人值守已停止");
}

export function isSupervisorNoticeMessage(message: NoticePick): boolean {
  return isSupervisorDoneNotice(message) || isSupervisorFailNotice(message);
}

/** Strip leading status emoji — icon is rendered separately in SupervisorNoticeLine. */
export function supervisorNoticeDisplayText(content: string): string {
  return stripLegacyNoticePrefix(content)
    .replace(/^✅\s*/u, "")
    .replace(/^⛔\s*/u, "")
    .trim();
}

/**
 * Supervisor may append the same done/fail notice on every poll when unattended
 * is re-enabled from desktop localStorage before ack. Keep only the last of each.
 */
export function dedupeSupervisorNotices<T extends NoticePick>(messages: readonly T[]): T[] {
  let lastDone = -1;
  let lastFail = -1;
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (!m) continue;
    if (isSupervisorDoneNotice(m)) lastDone = i;
    if (isSupervisorFailNotice(m)) lastFail = i;
  }
  if (lastDone < 0 && lastFail < 0) return [...messages];
  return messages.filter((m, i) => {
    if (isSupervisorDoneNotice(m)) return i === lastDone;
    if (isSupervisorFailNotice(m)) return i === lastFail;
    return true;
  });
}
