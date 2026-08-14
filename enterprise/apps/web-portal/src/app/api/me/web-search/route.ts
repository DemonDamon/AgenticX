import { NextResponse } from "next/server";

import {
  getSessionFromCookies,
  passwordChangeRequiredResponse,
} from "../../../../lib/session";
import { getPublicWebSearchConfig } from "../../../../lib/web-search/tenant-config";

/**
 * Portal users only read tenant policy so the composer can expose capabilities.
 * All provider credentials and write operations live in the admin console.
 */
export async function GET() {
  const session = await getSessionFromCookies();
  if (session?.mustChangePassword) return passwordChangeRequiredResponse();
  if (!session) {
    return NextResponse.json(
      { error: { code: "40101", message: "unauthorized" } },
      { status: 401 },
    );
  }

  try {
    const data = await getPublicWebSearchConfig(session.tenantId);
    const providers = data.providers.map(({ endpoint: _endpoint, ...provider }) => provider);
    return NextResponse.json({
      data: {
        ...data,
        providers,
        canManage: false,
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
