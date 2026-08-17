import { isTraceId, newTraceId } from "@agenticx/sdk-ts";
import { log } from "./logger";

export type RequestLogUser = {
  userId?: string;
  tenantId?: string;
  sessionId?: string;
};

/**
 * 高频轮询路由：成功路径不写 finish（stdout / DB 都不写），避免一次 Deep Research
 * 把 portal_request_logs 刷成几十上百条。失败仍走 error 级。
 */
const POLLING_ROUTES: ReadonlySet<string> = new Set(["deep_research.runs"]);

function shouldLogSuccessFinish(route: string): boolean {
  return !POLLING_ROUTES.has(route);
}

export type ConversationMode = "chat" | "deep_research" | "web_search";

function defaultMode(route: string): ConversationMode {
  return route.startsWith("deep_research") ? "deep_research" : "chat";
}

export type RequestLogCtx = {
  traceId: string;
  setUser(user: RequestLogUser): void;
  /** 对话形态；未调用时按 route 取默认值（见 defaultMode）。 */
  setMode(mode: ConversationMode): void;
  /** 深度调研 run_id；同一 run 的多条请求共享。 */
  setRun(runId: string): void;
  /** 无副作用 ack（如 alreadyContinued / 参数早退）：成功路径不写 info finish。 */
  markNoop(): void;
};

export async function withRequestLog(
  route: string,
  handler: (ctx: RequestLogCtx) => Promise<Response>,
  request?: Request,
): Promise<Response> {
  const incoming = request?.headers.get("x-agenticx-trace-id")?.trim() ?? "";
  const traceId = isTraceId(incoming) ? incoming : newTraceId();
  let user: RequestLogUser = {};
  let mode: ConversationMode | null = null;
  let runId = "";
  let noop = false;
  const ctx: RequestLogCtx = {
    traceId,
    setUser(next) {
      user = { ...user, ...next };
    },
    setMode(next) {
      mode = next;
    },
    setRun(next) {
      runId = next.trim();
    },
    markNoop() {
      noop = true;
    },
  };

  const started = Date.now();
  log("debug", {
    event: `${route}.start`,
    route,
    trace_id: traceId,
  });

  try {
    const response = await handler(ctx);
    const headers = new Headers(response.headers);
    if (!headers.get("x-agenticx-trace-id")) {
      headers.set("x-agenticx-trace-id", traceId);
    }
    if (shouldLogSuccessFinish(route) && !noop) {
      log("info", {
        event: `${route}.finish`,
        route,
        trace_id: traceId,
        user_id: user.userId,
        tenant_id: user.tenantId,
        session_id: user.sessionId,
        status: response.status,
        duration_ms: Math.max(0, Date.now() - started),
        mode: mode ?? defaultMode(route),
        run_id: runId || undefined,
      });
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log("error", {
      event: `${route}.error`,
      route,
      trace_id: traceId,
      user_id: user.userId,
      tenant_id: user.tenantId,
      session_id: user.sessionId,
      duration_ms: Math.max(0, Date.now() - started),
      error_name: err.name,
      error_message: err.message,
      error_stack: err.stack,
      mode: mode ?? defaultMode(route),
      run_id: runId || undefined,
    });
    throw error;
  }
}
