import { NextResponse } from "next/server";
import { isPlatformFeatureAllowedForUser } from "../../../../lib/capability-packs-reader";
import { getSessionFromCookies } from "../../../../lib/session";
import {
  getPublicWebSearchConfig,
  upsertTenantWebSearchConfig,
} from "../../../../lib/web-search/tenant-config";

export async function GET() {
  const session = await getSessionFromCookies();
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
    // 租户总开关之上再看分配范围。查不动时保持租户配置原样，避免一次抖动把入口藏掉。
    const [webAllowed, deepAllowed] = await Promise.all([
      isPlatformFeatureAllowedForUser("web_search", session.userId, session.email, session.deptId).catch(
        () => true,
      ),
      isPlatformFeatureAllowedForUser(
        "deep_research",
        session.userId,
        session.email,
        session.deptId,
      ).catch(() => true),
    ]);
    return NextResponse.json({
      data: {
        ...data,
        enabled: data.enabled && webAllowed,
        deepResearchEnabled: data.deepResearchEnabled && deepAllowed,
      },
    });
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

  let body: {
    enabled?: unknown;
    provider?: unknown;
    maxResults?: unknown;
    apiKey?: unknown;
    deepResearchEnabled?: unknown;
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

  try {
    const data = await upsertTenantWebSearchConfig(session.tenantId, {
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      provider: typeof body.provider === "string" ? body.provider : undefined,
      maxResults: typeof body.maxResults === "number" ? body.maxResults : undefined,
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      deepResearchEnabled:
        typeof body.deepResearchEnabled === "boolean" ? body.deepResearchEnabled : undefined,
    });
    return NextResponse.json({ data });
  } catch (error) {
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
