import { getSessionFromCookies } from "../../../../../../../lib/session";
import { formatDeepResearchEventSse } from "../../../../../../../lib/deep-research/events";
import {
  defaultRunStore,
  newEventsSince,
  type DeepResearchRunStatus,
} from "../../../../../../../lib/deep-research/run-store";
import { log } from "../../../../../../../lib/observability/logger";
import { withRequestLog } from "../../../../../../../lib/observability/with-request-log";

export const runtime = "nodejs";
export const maxDuration = 1500;

const TERMINAL: ReadonlySet<DeepResearchRunStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

const POLL_MS = 1_000;

type Params = Promise<{ runId: string }>;

function sseDelta(content: string): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-deep-research-reconnect",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`;
}

export async function GET(request: Request, segmentData: { params: Params }) {
  return withRequestLog("deep_research.stream", async (logCtx) => {
  const session = await getSessionFromCookies();
  if (!session) {
    return new Response(JSON.stringify({ error: { code: "40101", message: "unauthorized" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const { runId } = await segmentData.params;
  if (!runId?.trim()) {
    return new Response(JSON.stringify({ error: { code: "40001", message: "runId required" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  logCtx.setUser({
    userId: session.userId,
    tenantId: session.tenantId,
  });

  const store = defaultRunStore;
  const initial = await store.get(session.tenantId, session.userId, runId);
  if (!initial) {
    // 404 (not 403) — avoid runId probing
    return new Response(JSON.stringify({ error: { code: "40401", message: "not found" } }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const abortSignal = request.signal;
  const traceId = logCtx.traceId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed || abortSignal.aborted) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      try {
      // Full replay once
      for (const event of initial.events) {
        safeEnqueue(formatDeepResearchEventSse(event));
      }
      let lastEventSeq = initial.eventSeq;
      let reportLen = 0;
      if (initial.reportMarkdown) {
        safeEnqueue(sseDelta(initial.reportMarkdown));
        reportLen = initial.reportMarkdown.length;
      }

      if (TERMINAL.has(initial.status)) {
        safeEnqueue("data: [DONE]\n\n");
        try {
          controller.close();
        } catch {
          // ignore
        }
        return;
      }

      while (!closed && !abortSignal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (closed || abortSignal.aborted) break;

        const latest = await store.get(session.tenantId, session.userId, runId);
        if (!latest) {
          safeEnqueue("data: [DONE]\n\n");
          break;
        }

        for (const event of newEventsSince(latest, lastEventSeq)) {
          safeEnqueue(formatDeepResearchEventSse(event));
        }
        lastEventSeq = latest.eventSeq;

        if (latest.reportMarkdown.length > reportLen) {
          const suffix = latest.reportMarkdown.slice(reportLen);
          reportLen = latest.reportMarkdown.length;
          if (suffix) safeEnqueue(sseDelta(suffix));
        }

        if (TERMINAL.has(latest.status)) {
          safeEnqueue("data: [DONE]\n\n");
          break;
        }
      }

      try {
        controller.close();
      } catch {
        // ignore
      }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        log("error", {
          event: "deep_research.stream.error",
          route: "deep_research.stream",
          trace_id: traceId,
          run_id: runId,
          error_name: err.name,
          error_message: err.message,
          error_stack: err.stack,
        });
        try {
          controller.error(error);
        } catch {
          // ignore
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-agenticx-trace-id": traceId,
    },
  });
  }, request);
}
