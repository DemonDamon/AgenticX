import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  getSessionAuthFromCookies,
  isAuthCookieSecure,
  passwordChangeRequiredResponse,
} from "../../../../../lib/session";
import { refreshTokens } from "../../../../../lib/auth-runtime";
import { isChatSessionOwned } from "../../../../../lib/chat-history";
import { toChatHistoryContext } from "../../../../../lib/chat-history-http";
import { listAvailableModelsForUser } from "../../../../../lib/admin-providers-reader";
import { isPlatformFeatureAllowedForUser } from "../../../../../lib/capability-packs-reader";
import { defaultArtifactStore } from "../../../../../lib/deep-research/artifact-store";
import {
  hasGatewayBearerLifetime,
  refreshGatewayBearer,
  requiredResearchBearerLifetimeMs,
} from "../../../../../lib/deep-research/gateway-auth-refresh";
import {
  CLARIFY_TIMEOUT_MS,
  TOTAL_BUDGET_MS,
  continueFromReport,
} from "../../../../../lib/deep-research/orchestrator";
import { loadReportCheckpoint } from "../../../../../lib/deep-research/report-checkpoint";
import { defaultRunStore } from "../../../../../lib/deep-research/run-store";
import { resolvePortalLocaleFromCookies } from "../../../../../lib/portal-locale";
import { withRequestLog } from "../../../../../lib/observability/with-request-log";
import { loadTenantWebSearchConfig } from "../../../../../lib/web-search/tenant-config";
import { executeWebSearch } from "../../../../../lib/web-search/providers";
import {
  FeatureUsageUnavailableError,
  admitFeatureUsage,
  reserveMemberSearchProviderCall,
} from "../../../../../lib/feature-usage/gate";
import { featureUsageSubject, type FeatureUsageSession } from "../../../../../lib/feature-usage/subject";

export const runtime = "nodejs";
export const maxDuration = 1500;

const GATEWAY_COMPLETIONS_URL =
  process.env.GATEWAY_COMPLETIONS_URL ?? "http://127.0.0.1:8088/v1/chat/completions";

type RotatedAuthTokens = Awaited<ReturnType<typeof refreshTokens>>;

function failure(status: number, message: string) {
  return NextResponse.json({ error: { message } }, { status });
}

function withRotatedAuthCookies(response: Response, tokens: RotatedAuthTokens): NextResponse {
  const outgoing = new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  outgoing.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isAuthCookieSecure(),
    maxAge: tokens.expiresInSeconds,
    path: "/",
  });
  outgoing.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isAuthCookieSecure(),
    maxAge: 7 * 24 * 60 * 60,
    path: "/",
  });
  return outgoing;
}

function countedExecuteSearch(session: FeatureUsageSession): typeof executeWebSearch {
  return async (query, maxResults, cfg, fetchImpl) => {
    if (!query.trim()) return [];
    let subject;
    try {
      subject = await featureUsageSubject(session);
    } catch (error) {
      throw new FeatureUsageUnavailableError("search_provider_calls", error);
    }
    await admitFeatureUsage("search_provider_calls", subject);
    await reserveMemberSearchProviderCall(subject);
    return executeWebSearch(query, maxResults, cfg, fetchImpl);
  };
}

async function drainResponseBody(response: Response): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  try {
    while (!(await reader.read()).done) {
      // The run store writer owns persistence. This request only admits the run.
    }
  } catch {
    console.warn("[deep-research] continuation transport ended");
  }
}

export async function POST(request: Request) {
  return withRequestLog("deep_research.continue", async (logCtx) => {
    const auth = await getSessionAuthFromCookies();
    if (!auth) return failure(401, "请重新登录。");
    const { session, accessToken } = auth;
    let refreshToken = auth.refreshToken;
    if (session.mustChangePassword) return passwordChangeRequiredResponse();

    let runId = "";
    try {
      const body = await request.json();
      runId = typeof body?.runId === "string" ? body.runId.trim() : "";
    } catch {
      return failure(400, "请求格式错误。");
    }
    if (!runId) return failure(400, "缺少研究任务 ID。");
    logCtx.setUser({ tenantId: session.tenantId, userId: session.userId });
    logCtx.setMode("deep_research");

    let rotatedTokens: RotatedAuthTokens | null = null;
    try {
      const run = await defaultRunStore.get(session.tenantId, session.userId, runId);
      if (!run || !(await isChatSessionOwned(toChatHistoryContext(session), run.sessionId))) {
        return failure(404, "研究任务不存在。");
      }
      if (run.status !== "failed" && run.status !== "cancelled") {
        return failure(409, "该任务没有可用检查点，无法续写。");
      }
      const saved = await loadReportCheckpoint(
        defaultArtifactStore,
        { tenantId: session.tenantId, userId: session.userId },
        runId,
      );
      if (!saved) return failure(409, "该任务没有可用检查点，无法续写。");

      const result = (traceId?: string) =>
        NextResponse.json({
          code: "00000",
          data: { runId: saved.nextRunId, sessionId: run.sessionId, traceId },
        });
      const existing = await defaultRunStore.get(session.tenantId, session.userId, saved.nextRunId);
      if (existing) return result(existing.traceId);

      const models = await listAvailableModelsForUser(session.userId, session.email, session.deptId);
      const model = models.find(
        (entry) =>
          (entry.model === saved.model && entry.provider === saved.provider) ||
          entry.id === saved.model ||
          entry.id === `${saved.provider}/${saved.model}`,
      );
      if (!model) return failure(403, "原研究模型当前不可用或无权限，请联系管理员。");
      const tenantConfig = await loadTenantWebSearchConfig(session.tenantId);
      if (tenantConfig && (!tenantConfig.deepResearchEnabled || !tenantConfig.enabled)) {
        return failure(403, "深度研究当前已停用。");
      }
      const allowed = await isPlatformFeatureAllowedForUser(
        "deep_research",
        session.userId,
        session.email,
        session.deptId,
      ).catch(() => true);
      if (!allowed) return failure(403, "当前账号没有深度研究权限。");

      const requiredBearerLifetimeMs = requiredResearchBearerLifetimeMs(TOTAL_BUDGET_MS, CLARIFY_TIMEOUT_MS);
      const gatewayHeaders: Record<string, string> = {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        "x-tenant-id": session.tenantId,
        "x-user-id": session.userId,
        "x-user-email": session.email,
        "x-dept-id": session.deptId ?? "",
        "x-session-id": session.sessionId,
        ...(saved.provider ? { "x-agenticx-provider": saved.provider } : {}),
      };
      if (!hasGatewayBearerLifetime(accessToken, requiredBearerLifetimeMs)) {
        if (!refreshToken) return failure(401, "登录状态即将到期，无法续写深度调研。请刷新页面后重试。");
        try {
          rotatedTokens = await refreshTokens(refreshToken);
        } catch {
          return failure(401, "登录状态续期失败，无法续写深度调研。请刷新页面后重试。");
        }
        const refreshedAccessToken = rotatedTokens.accessToken;
        if (
          !hasGatewayBearerLifetime(refreshedAccessToken, requiredBearerLifetimeMs) ||
          !(await refreshGatewayBearer({
            headers: gatewayHeaders,
            refreshAccessToken: async () => ({ accessToken: refreshedAccessToken }),
          }))
        ) {
          return withRotatedAuthCookies(
            failure(401, "登录状态续期后仍不足以完成深度调研，请刷新页面后重试。"),
            rotatedTokens,
          );
        }
        refreshToken = rotatedTokens.refreshToken;
      }

      logCtx.setRun(saved.nextRunId);
      const usageSession: FeatureUsageSession = {
        tenantId: session.tenantId,
        userId: session.userId,
        deptId: session.deptId,
        scopes: session.scopes ?? [],
      };
      const response = await continueFromReport(saved, {
        url: GATEWAY_COMPLETIONS_URL,
        headers: gatewayHeaders,
        executeSearch: countedExecuteSearch(usageSession),
        loadTenantConfig: () => loadTenantWebSearchConfig(session.tenantId),
        artifactStore: defaultArtifactStore,
        runStore: defaultRunStore,
        tenantId: session.tenantId,
        userId: session.userId,
        sessionId: run.sessionId,
        runId: saved.nextRunId,
        traceId: logCtx.traceId,
        locale: await resolvePortalLocaleFromCookies(),
        refreshAccessToken: async () => {
          if (!refreshToken) return null;
          try {
            const next = await refreshTokens(refreshToken);
            refreshToken = next.refreshToken;
            try {
              const cookieStore = await cookies();
              cookieStore.set(ACCESS_COOKIE, next.accessToken, {
                httpOnly: true,
                sameSite: "lax",
                secure: isAuthCookieSecure(),
                maxAge: next.expiresInSeconds,
                path: "/",
              });
              cookieStore.set(REFRESH_COOKIE, next.refreshToken, {
                httpOnly: true,
                sameSite: "lax",
                secure: isAuthCookieSecure(),
                maxAge: 7 * 24 * 60 * 60,
                path: "/",
              });
            } catch {
              // Streaming cookie writes can fail after the response starts.
            }
            return { accessToken: next.accessToken };
          } catch {
            return null;
          }
        },
      });
      if (!response.ok) {
        const admitted = await defaultRunStore.get(session.tenantId, session.userId, saved.nextRunId);
        const outcome = admitted ? result(admitted.traceId) : response;
        return rotatedTokens ? withRotatedAuthCookies(outcome, rotatedTokens) : outcome;
      }
      void drainResponseBody(response);
      const outcome = result(logCtx.traceId);
      return rotatedTokens ? withRotatedAuthCookies(outcome, rotatedTokens) : outcome;
    } catch {
      const outcome = failure(503, "暂时无法恢复研究，请稍后重试。");
      return rotatedTokens ? withRotatedAuthCookies(outcome, rotatedTokens) : outcome;
    }
  }, request);
}
