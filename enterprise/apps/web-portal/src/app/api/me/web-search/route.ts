import { NextResponse } from "next/server";
import { hasSomeScope } from "@agenticx/iam-core";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../lib/session";
import {
  getPublicWebSearchConfig,
  upsertTenantWebSearchConfig,
  WebSearchConfigValidationError,
  type WebSearchProviderUpdate,
} from "../../../../lib/web-search/tenant-config";
import {
  MAX_CONFIGURED_WEB_SEARCH_PROVIDERS,
  WEB_SEARCH_MAX_RESULTS_CAP,
} from "../../../../lib/web-search/providers";
import {
  isValidMaxSearchCalls,
  MAX_MAX_SEARCH_CALLS,
  MIN_MAX_SEARCH_CALLS,
} from "../../../../lib/web-search/search-call-budget";

function providerUpdates(raw: unknown): WebSearchProviderUpdate[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new WebSearchConfigValidationError("搜索服务列表格式无效");
  }
  if (raw.length < 1 || raw.length > MAX_CONFIGURED_WEB_SEARCH_PROVIDERS) {
    throw new WebSearchConfigValidationError(
      `搜索服务数量必须为 1 到 ${MAX_CONFIGURED_WEB_SEARCH_PROVIDERS} 个`,
    );
  }
  return raw.map((item) => {
    if (!item || typeof item !== "object") {
      throw new WebSearchConfigValidationError("搜索服务配置格式无效");
    }
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.adapter !== "string") {
      throw new WebSearchConfigValidationError("搜索服务缺少 ID 或接口协议");
    }
    if (row.options !== undefined && (!row.options || typeof row.options !== "object" || Array.isArray(row.options))) {
      throw new WebSearchConfigValidationError("搜索服务配置项格式无效");
    }
    return {
      id: row.id,
      adapter: row.adapter,
      displayName: typeof row.displayName === "string" ? row.displayName : undefined,
      apiKey: typeof row.apiKey === "string" ? row.apiKey : undefined,
      enabled: typeof row.enabled === "boolean" ? row.enabled : undefined,
      priority: typeof row.priority === "number" ? row.priority : undefined,
      options: row.options as Record<string, unknown> | undefined,
    };
  });
}

function badRequest(message: string): Response {
  return NextResponse.json(
    { error: { code: "40002", message } },
    { status: 400 },
  );
}

function canManageWebSearch(scopes: string[]): boolean {
  return hasSomeScope(scopes, ["provider:update", "provider:manage"]);
}

export async function GET() {
  const session = await getSessionFromCookies();
  if (session?.mustChangePassword) return passwordChangeRequiredResponse();
  if (!session) {
    return NextResponse.json(
      {
        error: {
          code: "40101",
          message: "unauthorized",
        },
      },
      { status: 401 },
    );
  }

  try {
    const data = await getPublicWebSearchConfig(session.tenantId);
    const canManage = canManageWebSearch(session.scopes);
    const providers = canManage
      ? data.providers
      : data.providers.map(({ endpoint: _endpoint, ...provider }) => provider);
    return NextResponse.json({ data: { ...data, providers, canManage } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "web search config unavailable";
    return NextResponse.json(
      {
        error: {
          code: "50301",
          message: `读取联网搜索配置失败：${detail}`,
        },
      },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  const session = await getSessionFromCookies();
  if (session?.mustChangePassword) return passwordChangeRequiredResponse();
  if (!session) {
    return NextResponse.json(
      {
        error: {
          code: "40101",
          message: "unauthorized",
        },
      },
      { status: 401 },
    );
  }
  if (!canManageWebSearch(session.scopes)) {
    return NextResponse.json(
      { error: { code: "40301", message: "仅管理员可修改联网搜索配置" } },
      { status: 403 },
    );
  }

  let body: {
    enabled?: unknown;
    provider?: unknown;
    maxResults?: unknown;
    maxSearchCalls?: unknown;
    apiKey?: unknown;
    deepResearchEnabled?: unknown;
    providers?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "40001",
          message: "invalid json body",
        },
      },
      { status: 400 },
    );
  }

  if (
    body.maxSearchCalls !== undefined &&
    !isValidMaxSearchCalls(body.maxSearchCalls)
  ) {
    return badRequest(
      `单轮搜索上限必须为 ${MIN_MAX_SEARCH_CALLS} 到 ${MAX_MAX_SEARCH_CALLS} 之间的整数`,
    );
  }
  if (
    body.maxResults !== undefined &&
    (!Number.isInteger(body.maxResults) ||
      (body.maxResults as number) < 1 ||
      (body.maxResults as number) > WEB_SEARCH_MAX_RESULTS_CAP)
  ) {
    return badRequest(`单次搜索结果数必须为 1 到 ${WEB_SEARCH_MAX_RESULTS_CAP} 之间的整数`);
  }
  if (
    body.apiKey !== undefined &&
    (typeof body.apiKey !== "string" ||
      body.apiKey.length > 8_192 ||
      /[\r\n]/.test(body.apiKey))
  ) {
    return badRequest("搜索服务 API Key 格式无效或过长");
  }

  let providers: WebSearchProviderUpdate[] | undefined;
  try {
    providers = providerUpdates(body.providers);
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "搜索服务配置无效");
  }

  try {
    const data = await upsertTenantWebSearchConfig(session.tenantId, {
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      provider: typeof body.provider === "string" ? body.provider : undefined,
      maxResults: typeof body.maxResults === "number" ? body.maxResults : undefined,
      maxSearchCalls: body.maxSearchCalls,
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      deepResearchEnabled:
        typeof body.deepResearchEnabled === "boolean" ? body.deepResearchEnabled : undefined,
      providers,
    });
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof WebSearchConfigValidationError) {
      return badRequest(error.message);
    }
    const detail = error instanceof Error ? error.message : "persist failed";
    return NextResponse.json(
      {
        error: {
          code: "50301",
          message: `保存联网搜索配置失败：${detail}`,
        },
      },
      { status: 503 },
    );
  }
}
