import { isTraceId, newTraceId } from "@agenticx/sdk-ts";
import { log } from "./logger";

export type RequestLogUser = {
  userId?: string;
  tenantId?: string;
  sessionId?: string;
};

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
    log("info", {
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
