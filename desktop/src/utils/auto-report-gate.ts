import type { SubAgentStatus } from "../store";

const ACTIVE_STATUSES: ReadonlySet<SubAgentStatus> = new Set([
  "pending",
  "running",
  "awaiting_confirm",
  "awaiting_input",
]);

const TERMINAL_STATUSES: ReadonlySet<SubAgentStatus> = new Set([
  "completed",
  "failed",
  "paused",
]);

/**
 * Restart hydrate must not re-fire auto-report: the first poll already sees
 * terminal rows. Only notify when this process observed an active→terminal
 * transition.
 */
export function shouldNotifySubagentCompletion(
  prevStatus: SubAgentStatus | undefined,
  nextStatus: SubAgentStatus,
): boolean {
  if (!TERMINAL_STATUSES.has(nextStatus)) return false;
  if (!prevStatus) return false;
  if (TERMINAL_STATUSES.has(prevStatus)) return false;
  return ACTIVE_STATUSES.has(prevStatus);
}

/** 同会话仍有子智能体在跑时，自动汇报先排队；超过 maxDeferMs 仍未收齐则放行，避免永远不汇报。 */
export function shouldDeferAutoReport(args: {
  sessionId: string;
  subAgents: ReadonlyArray<{ sessionId?: string; status: SubAgentStatus }>;
  oldestQueuedAt: number;
  now: number;
  maxDeferMs?: number;
}): boolean {
  const sid = args.sessionId.trim();
  const stillActive = args.subAgents.some(
    (item) => (item.sessionId ?? "").trim() === sid && ACTIVE_STATUSES.has(item.status),
  );
  if (!stillActive) return false;
  const maxDeferMs = args.maxDeferMs ?? 10 * 60 * 1000;
  return args.now - args.oldestQueuedAt < maxDeferMs;
}
