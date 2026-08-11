import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  getSessionAuthFromCookies,
  isAuthCookieSecure,
  passwordChangeRequiredResponse,
} from "../../../../lib/session";
import { refreshTokens } from "../../../../lib/auth-runtime";
import { isChatSessionOwned } from "../../../../lib/chat-history";
import { toChatHistoryContext } from "../../../../lib/chat-history-http";
import { listAvailableModelsForUser } from "../../../../lib/admin-providers-reader";
import { stripEmptyAssistantMessages } from "../../../../lib/chat-completion-sanitize";
import { withCurrentTimeContext } from "../../../../lib/current-time";
import { runWebSearchTurn } from "../../../../lib/web-search/tool-loop";
import { loadTenantWebSearchConfig } from "../../../../lib/web-search/tenant-config";
import { runDeepResearchTurn } from "../../../../lib/deep-research/orchestrator";
import { defaultArtifactStore } from "../../../../lib/deep-research/artifact-store";
import { shouldAutoRunDeepResearch } from "../../../../lib/deep-research/auto-need";

function withSanitizedMessages(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.messages)) return body;
  const cleaned = stripEmptyAssistantMessages(
    body.messages as Array<{ role: string; content?: string | null; tool_calls?: unknown }>,
  );
  return {
    ...body,
    // Direct (non-web-search) turns still need clock grounding — same as Desktop/Kimi.
    messages: withCurrentTimeContext(cleaned),
  };
}

const GATEWAY_COMPLETIONS_URL =
  process.env.GATEWAY_COMPLETIONS_URL ?? "http://127.0.0.1:8088/v1/chat/completions";

/**
 * Deep-research clarify alone can wait up to 5 minutes, then still needs plan/search
 * time. Keep this above CLARIFY_TIMEOUT_MS in the deep-research orchestrator, and
 * above TOTAL_BUDGET_MS (20m) plus headroom for network jitter.
 */
export const maxDuration = 1500;
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await getSessionAuthFromCookies();
  if (!auth) {
    return NextResponse.json(
      {
        error: {
          code: "40101",
          message: "unauthorized",
        },
      },
      { status: 401 }
    );
  }
  if (auth.session.mustChangePassword) {
    return passwordChangeRequiredResponse();
  }
  const { session, accessToken } = auth;
  let refreshToken = auth.refreshToken;

  const chatSessionId = request.headers.get("x-chat-session-id")?.trim();
  if (!chatSessionId) {
    return NextResponse.json(
      {
        error: {
          code: "40001",
          message: "missing chat session",
        },
      },
      { status: 400 }
    );
  }

  const ctx = toChatHistoryContext(session);
  const owned = await isChatSessionOwned(ctx, chatSessionId);
  if (!owned) {
    return NextResponse.json(
      {
        error: {
          code: "40301",
          message: "forbidden",
        },
      },
      { status: 403 }
    );
  }

  const rawBody = await request.text();
  let providerHint = "";
  let forwardBody = rawBody;
  let enableWebSearch = false;
  let enableDeepResearch = false;
  let enableDeepResearchAuto = false;
  let parsedBody: Record<string, unknown> | null = null;
  // portal 把模型 id 编码为 "<provider>/<model>"；admin 配置好的 provider 与上游 endpoint 一一对应。
  // gateway 用 model 字段查表，所以这里把 provider 拆出来放请求头，body.model 仅保留模型名。
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown> & {
      model?: string;
      agenticx_web_search?: unknown;
      agenticx_deep_research?: unknown;
      agenticx_deep_research_auto?: unknown;
    };
    enableWebSearch = parsed.agenticx_web_search === true;
    enableDeepResearch = parsed.agenticx_deep_research === true;
    enableDeepResearchAuto = parsed.agenticx_deep_research_auto === true;
    const {
      agenticx_web_search: _stripWs,
      agenticx_deep_research: _stripDr,
      agenticx_deep_research_auto: _stripDrAuto,
      ...withoutFlag
    } = parsed;
    parsedBody = withoutFlag;

    if (typeof parsed.model === "string" && parsed.model.includes("/")) {
      // 服务端实时校验：用户/部门可见模型收窄后，禁止转发到已失效的模型（客户端未刷新前也不得放行）。
      const effectiveModels = await listAvailableModelsForUser(session.userId, session.email, session.deptId ?? undefined);
      const isVisible = effectiveModels.some((m) => m.id === parsed.model);
      if (!isVisible) {
        return NextResponse.json(
          {
            error: {
              code: "40301",
              message: "该模型已不在您的可见范围内，请刷新页面重新选择模型",
            },
          },
          { status: 403 },
        );
      }

      const [providerId, ...rest] = parsed.model.split("/");
      const modelName = rest.join("/");
      if (providerId && modelName) {
        providerHint = providerId;
        parsedBody = { ...withoutFlag, model: modelName };
        forwardBody = JSON.stringify(parsedBody);
      } else {
        forwardBody = JSON.stringify(withoutFlag);
      }
    } else {
      forwardBody = JSON.stringify(withoutFlag);
    }
  } catch {
    // body 不是 JSON 时维持原样转发
  }

  if (enableDeepResearchAuto && parsedBody) {
    enableDeepResearch = shouldAutoRunDeepResearch(
      Array.isArray(parsedBody.messages) ? (parsedBody.messages as Array<{ role?: unknown; content?: unknown }>) : [],
    );
  }

  const gatewayHeaders: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
    "x-tenant-id": session.tenantId,
    "x-user-id": session.userId,
    "x-dept-id": session.deptId ?? "",
    "x-user-email": session.email,
    "x-session-id": session.sessionId,
    ...(providerHint ? { "x-agenticx-provider": providerHint } : {}),
  };

  if (enableDeepResearch && parsedBody) {
    return runDeepResearchTurn(withSanitizedMessages(parsedBody), {
      url: GATEWAY_COMPLETIONS_URL,
      headers: gatewayHeaders,
      signal: request.signal,
      loadTenantConfig: () => loadTenantWebSearchConfig(session.tenantId),
      artifactStore: defaultArtifactStore,
      tenantId: session.tenantId,
      userId: session.userId,
      sessionId: chatSessionId,
      refreshAccessToken: async () => {
        if (!refreshToken) return null;
        try {
          const next = await refreshTokens(refreshToken);
          refreshToken = next.refreshToken;
          // Best-effort: attach rotated cookies on the (still-open) response.
          // In-memory Bearer update for subsequent Gateway calls is what matters.
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
            // Streaming responses may reject mid-flight cookie writes; ignore.
          }
          return { accessToken: next.accessToken };
        } catch {
          return null;
        }
      },
    });
  }

  if (enableWebSearch && parsedBody) {
    try {
      return await runWebSearchTurn(withSanitizedMessages(parsedBody), {
        url: GATEWAY_COMPLETIONS_URL,
        headers: gatewayHeaders,
        signal: request.signal,
        loadTenantConfig: () => loadTenantWebSearchConfig(session.tenantId),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "web search turn failed";
      return NextResponse.json(
        {
          error: {
            code: "50000",
            message: `联网搜索对话失败：${detail}`,
          },
        },
        { status: 500 },
      );
    }
  }

  if (parsedBody) {
    forwardBody = JSON.stringify(withSanitizedMessages(parsedBody));
  }

  let upstream: Response;
  try {
    upstream = await fetch(GATEWAY_COMPLETIONS_URL, {
      method: "POST",
      headers: gatewayHeaders,
      body: forwardBody,
      signal: request.signal,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "gateway unreachable";
    return NextResponse.json(
      {
        error: {
          code: "50301",
          message: `Gateway 不可用（${GATEWAY_COMPLETIONS_URL}）：${detail}。请确认已执行 bash scripts/start-dev.sh 且 :8088 网关进程正常。`,
        },
      },
      { status: 503 },
    );
  }

  if (!upstream.ok) {
    const errorBody = await upstream.text();
    return new NextResponse(errorBody, {
      status: upstream.status,
      headers: {
        "content-type": "application/json",
      },
    });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
