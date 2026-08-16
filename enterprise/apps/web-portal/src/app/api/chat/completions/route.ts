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
import { withPortalCapabilityContext } from "../../../../lib/portal-capabilities";
import {
  NO_TURN_REQUESTS,
  selectTurnPlan,
  type AutomaticTurnPlan,
  type TurnPlan,
  type TurnRequests,
} from "../../../../lib/chat-routing/turn-plan";
import {
  runWebSearchTurn,
  type WebSearchChatMessage,
} from "../../../../lib/web-search/tool-loop";
import {
  loadTenantWebSearchConfig,
  loadTenantWebSearchConfigStrict,
} from "../../../../lib/web-search/tenant-config";
import {
  isTenantDailySearchProviderQuotaExceeded,
  reserveTenantDailySearchProviderCall,
} from "../../../../lib/web-search/daily-provider-quota";
import { runDeepResearchTurn } from "../../../../lib/deep-research/orchestrator";
import { defaultArtifactStore } from "../../../../lib/deep-research/artifact-store";
import {
  planAutomaticTurn,
  resolveManualDeepResearchQuery,
} from "../../../../lib/deep-research/auto-need";
import type { DeepResearchIntentConfidence } from "../../../../lib/deep-research/clarification-policy";
import { withCalculatorContext } from "../../../../lib/calculator/chat-context";

function withSanitizedMessages(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.messages)) return body;
  const cleaned = stripEmptyAssistantMessages(
    body.messages as Array<{ role: string; content?: string | null; tool_calls?: unknown }>,
  );
  return {
    ...body,
    // Direct (non-web-search) turns still need clock grounding — same as Desktop/Kimi.
    messages: withPortalCapabilityContext(withCurrentTimeContext(cleaned)),
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
  let turnRequests: TurnRequests = NO_TURN_REQUESTS;
  let parsedBody: Record<string, unknown> | null = null;
  // portal 把模型 id 编码为 "<provider>/<model>"；admin 配置好的 provider 与上游 endpoint 一一对应。
  // gateway 用 model 字段查表，所以这里把 provider 拆出来放请求头，body.model 仅保留模型名。
  let parsedRequest: (Record<string, unknown> & {
    model?: string;
    agenticx_web_search?: unknown;
    agenticx_deep_research?: unknown;
    agenticx_deep_research_auto?: unknown;
  }) | null = null;
  try {
    parsedRequest = JSON.parse(rawBody) as Record<string, unknown> & {
      model?: string;
      agenticx_web_search?: unknown;
      agenticx_deep_research?: unknown;
      agenticx_deep_research_auto?: unknown;
    };
  } catch {
    // Non-JSON bodies are forwarded unchanged.
  }

  if (parsedRequest) {
    const parsed = parsedRequest;
    turnRequests = {
      webSearchRequested: parsed.agenticx_web_search === true,
      manualDeepResearchRequested: parsed.agenticx_deep_research === true,
      automaticDeepResearchRequested: parsed.agenticx_deep_research_auto === true,
    };
    const {
      agenticx_web_search: _stripWs,
      agenticx_deep_research: _stripDr,
      agenticx_deep_research_auto: _stripDrAuto,
      ...withoutFlag
    } = parsed;
    parsedBody = withoutFlag;

    if (typeof parsed.model === "string" && process.env.NEXT_PUBLIC_CHAT_CLIENT_MODE !== "mock") {
      // Resolve every portal model through the user's effective list. This
      // prevents a bare model name from bypassing provider visibility before
      // the same model is used for automatic routing or the final answer.
      let effectiveModels: Awaited<ReturnType<typeof listAvailableModelsForUser>>;
      try {
        effectiveModels = await listAvailableModelsForUser(
          session.userId,
          session.email,
          session.deptId ?? undefined,
        );
      } catch (error) {
        console.error(
          "[chat] effective model policy unavailable:",
          error instanceof Error ? error.message : error,
        );
        return NextResponse.json(
          {
            error: {
              code: "50302",
              message: "模型权限暂时无法校验，请稍后重试",
            },
          },
          { status: 503 },
        );
      }
      const requestedModel = parsed.model.trim();
      const resolvedModelId = requestedModel.includes("/")
        ? effectiveModels.find((model) => model.id === requestedModel)?.id
        : (() => {
            const matches = effectiveModels.filter(
              (model) => model.id.split("/").slice(1).join("/") === requestedModel,
            );
            return matches.length === 1 ? matches[0]?.id : undefined;
          })();
      if (!resolvedModelId) {
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

      const [providerId, ...rest] = resolvedModelId.split("/");
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

  let tenantSearchConfigSnapshot: Awaited<ReturnType<typeof loadTenantWebSearchConfig>> = null;
  let tenantSearchConfigLoaded = false;
  let ordinaryTenantConfigPromise: ReturnType<typeof loadTenantWebSearchConfig> | null = null;
  const loadTenantSearchConfigForWeb = () => {
    if (tenantSearchConfigLoaded) return Promise.resolve(tenantSearchConfigSnapshot);
    ordinaryTenantConfigPromise ??= loadTenantWebSearchConfig(session.tenantId);
    return ordinaryTenantConfigPromise;
  };
  let tenantDeepResearchEnabled = true;
  if (
    (turnRequests.manualDeepResearchRequested ||
      turnRequests.automaticDeepResearchRequested) &&
    parsedBody
  ) {
    try {
      tenantSearchConfigSnapshot = await loadTenantWebSearchConfigStrict(session.tenantId);
      tenantSearchConfigLoaded = true;
      tenantDeepResearchEnabled = tenantSearchConfigSnapshot?.deepResearchEnabled ?? true;
    } catch (error) {
      console.error(
        "[deep-research] tenant policy unavailable:",
        error instanceof Error ? error.message : error,
      );
      if (turnRequests.manualDeepResearchRequested) {
        return NextResponse.json(
          {
            error: {
              code: "50303",
              message: "深度研究策略暂时无法校验，请稍后重试",
            },
          },
          { status: 503 },
        );
      }
      // Automatic mode is fail-closed for the expensive path. Ordinary web
      // search may still use its established best-effort configuration path.
      tenantDeepResearchEnabled = false;
      console.info("[deep-research] automatic route skipped (policy_unavailable)");
    }
    if (
      tenantSearchConfigLoaded &&
      !tenantDeepResearchEnabled &&
      turnRequests.automaticDeepResearchRequested &&
      !turnRequests.manualDeepResearchRequested
    ) {
      // Automatic mode silently falls back to the ordinary web-search policy.
      // A manual request stays enabled so the orchestrator can return its
      // existing administrator-disabled explanation without a router call.
      console.info("[deep-research] automatic route skipped (tenant_disabled)");
    }
  }

  let automaticTurnPlan: AutomaticTurnPlan | undefined;
  if (
    tenantDeepResearchEnabled &&
    turnRequests.automaticDeepResearchRequested &&
    !turnRequests.manualDeepResearchRequested &&
    parsedBody
  ) {
    const outcome = await planAutomaticTurn(
      Array.isArray(parsedBody.messages)
        ? (parsedBody.messages as WebSearchChatMessage[])
        : [],
      {
        url: GATEWAY_COMPLETIONS_URL,
        headers: gatewayHeaders,
        signal: request.signal,
        model: typeof parsedBody.model === "string" ? parsedBody.model : undefined,
      },
      {
        allowWebSearch: turnRequests.webSearchRequested,
        maxSearchCalls: tenantSearchConfigSnapshot?.maxSearchCalls,
      },
    );
    if (outcome.kind === "planned") {
      automaticTurnPlan = outcome.plan;
      console.info(`[chat-routing] automatic plan mode=${outcome.plan.mode}`);
    } else {
      console.info(
        `[chat-routing] automatic plan fallback reason=${outcome.reason}`,
      );
    }
  }

  let turnPlan: TurnPlan = selectTurnPlan(turnRequests, automaticTurnPlan);

  // Automatic routing already resolved the contextual query in its one model
  // call. Manual activation intentionally skips the decision gate, but still
  // uses the shared resolver when history is needed to fill missing context.
  if (
    tenantDeepResearchEnabled &&
    turnPlan.mode === "deep" &&
    turnPlan.source === "manual" &&
    parsedBody &&
    !turnPlan.researchQuery
  ) {
    const queryResolution = await resolveManualDeepResearchQuery(
      Array.isArray(parsedBody.messages)
        ? (parsedBody.messages as WebSearchChatMessage[])
        : [],
      {
        url: GATEWAY_COMPLETIONS_URL,
        headers: gatewayHeaders,
        signal: request.signal,
        model: typeof parsedBody.model === "string" ? parsedBody.model : undefined,
      },
    );
    if (queryResolution.kind === "unresolved") {
      console.warn(
        `[deep-research] manual query unresolved (${queryResolution.reason}); rejecting instead of silently downgrading`,
      );
      return NextResponse.json(
        {
          error: {
            code: "40001",
            message: "无法从本轮消息确定深度研究主题，请补充文字说明后重试",
          },
        },
        { status: 400 },
      );
    } else {
      // Manual activation is an explicit high-confidence routing choice; the
      // existing resolver confidence still decides whether its context is safe.
      const intentConfidence: DeepResearchIntentConfidence = {
        routeConfidence: 1,
        queryConfidence: queryResolution.value.confidence,
      };
      turnPlan = {
        mode: "deep",
        source: "manual",
        researchQuery: queryResolution.value.query,
        intentConfidence,
      };
      console.info(
        `[deep-research] standalone query source=${queryResolution.value.source} confidence=${queryResolution.value.confidence.toFixed(2)} chars=${queryResolution.value.query.length}`,
      );
    }
  }

  console.info(
    `[chat-routing] selected mode=${turnPlan.mode} source=${turnPlan.source}`,
  );

  if (turnPlan.mode === "deep" && parsedBody) {
    return runDeepResearchTurn(withSanitizedMessages(parsedBody), {
      url: GATEWAY_COMPLETIONS_URL,
      headers: gatewayHeaders,
      signal: request.signal,
      tenantConfig: tenantSearchConfigSnapshot,
      artifactStore: defaultArtifactStore,
      tenantId: session.tenantId,
      userId: session.userId,
      sessionId: chatSessionId,
      resolvedUserQuery: turnPlan.researchQuery,
      intentConfidence: turnPlan.intentConfidence,
      reserveProviderCall: () => reserveTenantDailySearchProviderCall(session.tenantId),
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

  if (turnPlan.mode === "web" && parsedBody) {
    try {
      return await runWebSearchTurn(
        withSanitizedMessages(parsedBody),
        {
          url: GATEWAY_COMPLETIONS_URL,
          headers: gatewayHeaders,
          signal: request.signal,
          loadTenantConfig: loadTenantSearchConfigForWeb,
          reserveProviderCall: () => reserveTenantDailySearchProviderCall(session.tenantId),
        },
        turnPlan.searchPlan
          ? { preparedSearchPlan: turnPlan.searchPlan }
          : {},
      );
    } catch (error) {
      if (isTenantDailySearchProviderQuotaExceeded(error)) {
        // Never fall through to a search-free model answer: the user asked for
        // the web, and the tenant gate is the reason they did not get it.
        return NextResponse.json(
          { error: { code: error.reason === "exhausted" ? "42903" : "50302", message: error.userMessage } },
          { status: error.reason === "exhausted" ? 429 : 503 },
        );
      }
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
    const directBody = withSanitizedMessages(parsedBody);
    const calculatedBody = await withCalculatorContext(
      directBody,
      {
        url: GATEWAY_COMPLETIONS_URL,
        headers: gatewayHeaders,
        signal: request.signal,
      },
      // Automatic routing already read this turn on its way to choosing plain
      // chat; if it said the answer needs arithmetic, that outranks the pattern.
      turnPlan.mode === "plain" ? { intent: turnPlan.calculationIntent } : {},
    );
    forwardBody = JSON.stringify(calculatedBody ?? directBody);
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
