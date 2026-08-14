import type { ToolStep } from "./graph-types";

export type ToolSpan = {
  callId: string;
  toolName: string;
  startMs: number;
  /** 未闭合（phase=calling）时为 undefined —— 对齐上游 TraceToolSpan.outputTs 语义 */
  endMs?: number;
  running: boolean;
};

export type TimelineWindow = { startMs: number; endMs: number };

export function nodeIdForAgent(agentId: string): string {
  const aid = String(agentId || "").trim();
  if (!aid) return "";
  return aid.startsWith("agent:") ? aid : `agent:${aid}`;
}

export function agentIdFromNode(nodeId: string): string {
  return nodeId.startsWith("agent:") ? nodeId.slice("agent:".length) : nodeId;
}

export function deriveToolSpans(steps: ToolStep[]): ToolSpan[] {
  const indexed: Array<{ span: ToolSpan; order: number }> = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    if (!Number.isFinite(step.startedAt) || !Number.isFinite(step.updatedAt)) continue;
    const startMs = step.startedAt;
    if (step.phase === "calling") {
      indexed.push({
        order: i,
        span: {
          callId: step.callId,
          toolName: step.toolName,
          startMs,
          endMs: undefined,
          running: true,
        },
      });
      continue;
    }
    let endMs = step.updatedAt;
    if (endMs < startMs) endMs = startMs;
    indexed.push({
      order: i,
      span: {
        callId: step.callId,
        toolName: step.toolName,
        startMs,
        endMs,
        running: false,
      },
    });
  }
  indexed.sort((a, b) => {
    if (a.span.startMs !== b.span.startMs) return a.span.startMs - b.span.startMs;
    return a.order - b.order;
  });
  return indexed.map((row) => row.span);
}

/** nowMs 用于给未闭合 span 收口，便于测试注入 */
export function deriveTimelineWindow(spans: ToolSpan[], nowMs: number): TimelineWindow | null {
  if (spans.length === 0) return null;
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  let hasRunning = false;
  for (const span of spans) {
    if (span.startMs < startMs) startMs = span.startMs;
    if (span.running) {
      hasRunning = true;
      continue;
    }
    if (typeof span.endMs === "number" && span.endMs > endMs) endMs = span.endMs;
  }
  if (hasRunning && Number.isFinite(nowMs) && nowMs > endMs) endMs = nowMs;
  if (!Number.isFinite(startMs)) return null;
  if (!Number.isFinite(endMs) || endMs < startMs) endMs = startMs;
  if (endMs === startMs) endMs = startMs + 1000;
  return { startMs, endMs };
}
