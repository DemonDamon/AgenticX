import { isTraceId, newTraceId } from "@agenticx/sdk-ts";
import { log } from "./logger";

export type RequestLogUser = {
  userId?: string;
  tenantId?: string;
  sessionId?: string;
};

/**
 * 高频轮询路由：成功日志降为 debug，避免把 portal_request_logs 刷成访问日志。
 * 失败仍走 error 级，不受此影响。
 */
const POLLING_ROUTES: ReadonlySet<string> = new Set(["deep_research.runs"]);

function finishLevel(route: string): "info" | "debug" {
  return POLLING_ROUTES.has(route) ? "debug" : "info";
}

export type RequestLogCtx = {
  traceId: string;
  setUser(user: RequestLogUser): void;
};

export async function withRequestLog(
  route: string,
  handler: (ctx: RequestLogCtx) => Promise<Response>,
  request?: Request,
): Promise<Response> {
  const incoming = request?.headers.get("x-agenticx-trace-id")?.trim() ?? "";
  const traceId = isTraceId(incoming) ? incoming : newTraceId();
  let user: RequestLogUser = {};
  const ctx: RequestLogCtx = {
    traceId,
    setUser(next) {
      user = { ...user, ...next };
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
    log(finishLevel(route), {
      event: `${route}.finish`,
      route,
      trace_id: traceId,
      user_id: user.userId,
      tenant_id: user.tenantId,
      session_id: user.sessionId,
      status: response.status,
      duration_ms: Math.max(0, Date.now() - started),
    });
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
    });
    throw error;
  }
}
