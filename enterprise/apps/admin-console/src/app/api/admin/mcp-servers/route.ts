import { NextResponse } from "next/server";
import { createMcpServer, listMcpServers } from "../../../../lib/mcp-servers-store";
import { requireAdminScope } from "../../../../lib/admin-auth";

export async function GET() {
  try {
    const auth = await requireAdminScope(["provider:read"]);
    if (!auth.ok) return auth.response;
    const servers = await listMcpServers();
    return NextResponse.json({ code: "00000", message: "ok", data: { servers } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load mcp servers";
    const hint = /mcp_servers|relation .* does not exist/i.test(message)
      ? "请先执行 pnpm --filter @agenticx/db-schema db:migrate"
      : message;
    return NextResponse.json({ code: "50000", message: hint }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as {
      name?: string;
      displayName?: string;
      transport?: string;
      backendType?: string;
      backendConfig?: Record<string, unknown>;
      requiredScopes?: string[];
      status?: "active" | "disabled";
      rateLimit?: Record<string, unknown>;
    };
    if (!body.name?.trim() || !body.backendType?.trim()) {
      return NextResponse.json({ code: "40000", message: "name and backendType required" }, { status: 400 });
    }
    const server = await createMcpServer({
      name: body.name.trim(),
      displayName: body.displayName,
      transport: body.transport,
      backendType: body.backendType.trim(),
      backendConfig: body.backendConfig,
      requiredScopes: body.requiredScopes,
      status: body.status,
      rateLimit: body.rateLimit,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { server } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "create failed" },
      { status: 400 }
    );
  }
}
