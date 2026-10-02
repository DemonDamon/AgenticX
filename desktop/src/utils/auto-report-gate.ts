import type { SubAgentStatus } from "../store";

const ACTIVE_STATUSES: ReadonlySet<SubAgentStatus> = new Set([
  "pending",
  "running",
  "awaiting_confirm",
  "awaiting_input",
]);

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
