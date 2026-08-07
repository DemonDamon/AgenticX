import type { DeepResearchEvent } from "@agenticx/core-api";
import { activeRunReconnectUrl } from "./deep-research-active-run";

export type ReconnectStreamHandlers = {
  onEvent: (event: DeepResearchEvent) => void;
  onDelta?: (text: string) => void;
  onDone?: () => void;
  onError?: (error: unknown) => void;
  signal?: AbortSignal;
};

/** Consume reconnect SSE and fan out deep-research events + report deltas. */
export async function consumeDeepResearchReconnectStream(
  runId: string,
  handlers: ReconnectStreamHandlers,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(activeRunReconnectUrl(runId), {
    cache: "no-store",
    signal: handlers.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`reconnect failed: HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      idx = buffer.indexOf("\n\n");
      const dataLine = frame
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const data = dataLine.replace(/^data:\s*/, "");
      if (data === "[DONE]") {
        handlers.onDone?.();
        return;
      }
      try {
        const parsed = JSON.parse(data) as {
          agenticx_deep_research_event?: DeepResearchEvent;
          choices?: Array<{ delta?: { content?: string } }>;
        };
        if (parsed.agenticx_deep_research_event) {
          handlers.onEvent(parsed.agenticx_deep_research_event);
        }
        const piece = parsed.choices?.[0]?.delta?.content;
        if (typeof piece === "string" && piece) {
          handlers.onDelta?.(piece);
        }
      } catch {
        // ignore malformed frames
      }
    }
  }
  handlers.onDone?.();
}

/**
 * Reconnect manager: 同一 runId 同时只允许一条活跃重连流。
 * 重复点击「继续查看」/ 切换会话必须先 abort 旧流——否则多条轮询流会把同一批
 * live 事件重复追加到同一条消息上（撰写报告卡片翻倍的生产事故根因）。
 */
const activeReconnects = new Map<string, AbortController>();

export function abortDeepResearchReconnect(runId: string): void {
  const controller = activeReconnects.get(runId);
  if (!controller) return;
  activeReconnects.delete(runId);
  controller.abort();
}

export function abortAllDeepResearchReconnects(): void {
  for (const controller of activeReconnects.values()) {
    controller.abort();
  }
  activeReconnects.clear();
}

/** Test helper: how many reconnect streams are currently alive. */
export function countActiveDeepResearchReconnects(): number {
  return activeReconnects.size;
}

export async function startDeepResearchReconnect(
  runId: string,
  handlers: ReconnectStreamHandlers,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  abortDeepResearchReconnect(runId);
  const controller = new AbortController();
  activeReconnects.set(runId, controller);
  try {
    await consumeDeepResearchReconnectStream(
      runId,
      { ...handlers, signal: controller.signal },
      fetchImpl,
    );
  } catch (error) {
    // 主动 abort 是正常退出（新流顶替 / 切换会话），不向上抛。
    if (controller.signal.aborted) return;
    throw error;
  } finally {
    if (activeReconnects.get(runId) === controller) {
      activeReconnects.delete(runId);
    }
  }
}
