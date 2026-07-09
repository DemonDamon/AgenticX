import type { Message } from "../store";

type NoticePick = Pick<Message, "role" | "content" | "metadata">;

export type ContinuationNoticeVariant = "supervisor" | "auto_nudge" | "manual";

export type ContinuationNoticeParsed = {
  variant: ContinuationNoticeVariant;
  title: string;
  reason?: string;
  round?: number;
  maxRounds?: number;
};

const SUPERVISOR_RE =
  /^🔁\s*无人值守续跑\s*·\s*原因：(.+?)\s*·\s*第\s*(\d+)\s*轮/u;
const AUTO_RE =
  /^🔔\s*自动续跑提醒(?:（第\s*(\d+)(?:\/(\d+))?\s*次）)?\s*·\s*原因：(.+)/u;
const MANUAL_RE = /^🔁\s*手动续跑\s*·\s*原因：(.+)/u;

export function isContinuationNoticeMessage(message: NoticePick): boolean {
  if (message.role !== "tool") return false;
  const kind = (message.metadata as Record<string, unknown> | undefined)?.kind;
  if (kind === "continuation_notice") return true;
  const text = String(message.content ?? "").trim();
  return (
    /^🔁\s*(无人值守续跑|手动续跑)/u.test(text) || /^🔔\s*自动续跑提醒/u.test(text)
  );
}

export function parseContinuationNotice(message: NoticePick): ContinuationNoticeParsed | null {
  const meta = (message.metadata ?? {}) as Record<string, unknown>;
  const text = String(message.content ?? "").trim();
  const reasonFromMeta = String(meta.reason ?? "").trim();
  const roundFromMeta = Number(meta.continuation_round);
  const source = String(meta.source ?? "").trim();

  const supervisor = text.match(SUPERVISOR_RE);
  if (supervisor) {
    return {
      variant: "supervisor",
      title: "无人值守续跑",
      reason: supervisor[1]!.trim(),
      round: Math.max(1, parseInt(supervisor[2]!, 10)),
    };
  }

  const auto = text.match(AUTO_RE);
  if (auto) {
    const round = auto[1] ? Math.max(1, parseInt(auto[1], 10)) : undefined;
    const maxRounds = auto[2] ? Math.max(1, parseInt(auto[2], 10)) : undefined;
    return {
      variant: "auto_nudge",
      title: "自动续跑",
      reason: auto[3]!.trim(),
      round,
      maxRounds,
    };
  }

  const manual = text.match(MANUAL_RE);
  if (manual) {
    return {
      variant: "manual",
      title: "手动续跑",
      reason: manual[1]!.trim(),
    };
  }

  if ((meta.kind === "continuation_notice" || source) && text) {
    const variant: ContinuationNoticeVariant =
      source === "supervisor"
        ? "supervisor"
        : source === "desktop_auto_nudge"
          ? "auto_nudge"
          : "manual";
    return {
      variant,
      title:
        variant === "supervisor"
          ? "无人值守续跑"
          : variant === "auto_nudge"
            ? "自动续跑"
            : "手动续跑",
      ...(reasonFromMeta ? { reason: reasonFromMeta } : {}),
      ...(Number.isFinite(roundFromMeta) && roundFromMeta > 0
        ? { round: Math.floor(roundFromMeta) }
        : {}),
    };
  }

  return null;
}

export function continuationNoticeKey(message: NoticePick): string {
  const parsed = parseContinuationNotice(message);
  if (parsed) {
    return `${parsed.variant}|${parsed.reason ?? ""}|${parsed.round ?? 0}|${parsed.maxRounds ?? 0}`;
  }
  return String(message.content ?? "").trim();
}

/** Drop duplicate continuation rows (SSE echo + disk reload). Keep the last of each key. */
export function dedupeContinuationNotices<T extends NoticePick>(messages: readonly T[]): T[] {
  const lastByKey = new Map<string, number>();
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (!m || !isContinuationNoticeMessage(m)) continue;
    lastByKey.set(continuationNoticeKey(m), i);
  }
  if (lastByKey.size === 0) return [...messages];
  return messages.filter((m, i) => {
    if (!isContinuationNoticeMessage(m)) return true;
    return lastByKey.get(continuationNoticeKey(m)) === i;
  });
}

export function maxContinuationRound(messages: readonly NoticePick[]): number {
  let maxRound = 0;
  for (const message of messages) {
    if (!message || !isContinuationNoticeMessage(message)) continue;
    const parsed = parseContinuationNotice(message);
    if (parsed?.round && Number.isFinite(parsed.round)) {
      maxRound = Math.max(maxRound, Math.floor(parsed.round));
    }
  }
  return maxRound;
}
