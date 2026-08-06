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
