import { NextResponse } from "next/server";

import { resolveDesktopIdentity } from "../../../../../lib/desktop-auth";
import { resolveWebSearchConfig } from "../../../../../lib/web-search/config";
import {
  isTenantDailySearchProviderQuotaExceeded,
  reserveTenantDailySearchProviderCall,
} from "../../../../../lib/web-search/daily-provider-quota";
import {
  executeWebSearch,
  type WebSearchProviderAttempt,
} from "../../../../../lib/web-search/providers";
import { loadTenantWebSearchConfigStrict } from "../../../../../lib/web-search/tenant-config";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_QUERY_CHARS = 2_000;

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function normalizeMaxResults(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return Number.NaN;
  return Math.floor(parsed);
}

export async function POST(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) {
    return errorResponse(401, "40101", "企业登录已失效，请重新登录");
  }
  if (!identity.scopes.includes("workspace:chat")) {
    return errorResponse(403, "40301", "当前企业账号没有联网搜索权限");
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    payload = parsed as Record<string, unknown>;
  } catch {
    return errorResponse(400, "40001", "请求内容格式不正确");
  }

  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  if (!query) return errorResponse(400, "40002", "请输入要搜索的内容");
  if (Array.from(query).length > MAX_QUERY_CHARS) {
    return errorResponse(400, "40003", `搜索内容不能超过 ${MAX_QUERY_CHARS} 个字符`);
  }
  const maxResults = normalizeMaxResults(payload.max_results);
  if (Number.isNaN(maxResults)) {
    return errorResponse(400, "40004", "搜索结果数量必须是大于 0 的整数");
  }

  let tenantConfig: Awaited<ReturnType<typeof loadTenantWebSearchConfigStrict>>;
  try {
    tenantConfig = await loadTenantWebSearchConfigStrict(identity.tenantId);
  } catch (error) {
    console.error(
      "[desktop-web-search] tenant config unavailable:",
      error instanceof Error ? error.message : error,
    );
    return errorResponse(503, "50303", "企业联网搜索配置暂时无法读取，请稍后重试");
  }

  const config = resolveWebSearchConfig(tenantConfig);
  if (!config.enabled) {
    return errorResponse(403, "40302", "企业管理员已关闭联网搜索");
  }

  const attempts: WebSearchProviderAttempt[] = [];
  try {
    const hits = await executeWebSearch(query, maxResults, config, undefined, {
      signal: request.signal,
      beforeProviderAttempt: () => reserveTenantDailySearchProviderCall(identity.tenantId),
      onProviderAttempt: (attempt) => attempts.push(attempt),
    });
    let successful: WebSearchProviderAttempt | undefined;
    for (let index = attempts.length - 1; index >= 0; index -= 1) {
      const attempt = attempts[index];
      if (!attempt) continue;
      if (attempt.outcome === "ok" && attempt.hitCount > 0) {
        successful = attempt;
        break;
      }
    }
    return NextResponse.json({
      ok: true,
      provider: successful?.providerId ?? config.primaryProviderId ?? config.provider,
      hits: hits.map((hit) => ({
        title: hit.title,
        url: hit.url,
        snippet: hit.snippet,
        ...(hit.publishedAt ? { published_at: hit.publishedAt } : {}),
      })),
    });
  } catch (error) {
    if (isTenantDailySearchProviderQuotaExceeded(error)) {
      return errorResponse(
        error.reason === "exhausted" ? 429 : 503,
        error.reason === "exhausted" ? "42903" : "50302",
        error.userMessage,
      );
    }
    console.error(
      "[desktop-web-search] provider chain failed:",
      error instanceof Error ? error.message : error,
    );
    return errorResponse(
      502,
      "50201",
      "企业联网搜索暂时不可用，请联系管理员检查搜索服务配置",
    );
  }
}
