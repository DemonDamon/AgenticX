import { NextResponse } from "next/server";
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
    return NextResponse.json({ data });
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
