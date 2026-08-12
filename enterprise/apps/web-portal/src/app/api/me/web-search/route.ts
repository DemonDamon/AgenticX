import { NextResponse } from "next/server";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../lib/session";
import {
  getPublicWebSearchConfig,
  upsertTenantWebSearchConfig,
  type WebSearchProviderUpdate,
} from "../../../../lib/web-search/tenant-config";

function providerUpdates(raw: unknown): WebSearchProviderUpdate[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.adapter !== "string") return [];
    return [
      {
        id: row.id,
        adapter: row.adapter,
        displayName: typeof row.displayName === "string" ? row.displayName : undefined,
        apiKey: typeof row.apiKey === "string" ? row.apiKey : undefined,
        enabled: typeof row.enabled === "boolean" ? row.enabled : undefined,
        priority: typeof row.priority === "number" ? row.priority : undefined,
        options:
          row.options && typeof row.options === "object" && !Array.isArray(row.options)
            ? (row.options as Record<string, unknown>)
            : undefined,
      },
    ];
  });
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

  let body: {
    enabled?: unknown;
    provider?: unknown;
    maxResults?: unknown;
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

  try {
    const data = await upsertTenantWebSearchConfig(session.tenantId, {
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      provider: typeof body.provider === "string" ? body.provider : undefined,
      maxResults: typeof body.maxResults === "number" ? body.maxResults : undefined,
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      deepResearchEnabled:
        typeof body.deepResearchEnabled === "boolean" ? body.deepResearchEnabled : undefined,
      providers: providerUpdates(body.providers),
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
