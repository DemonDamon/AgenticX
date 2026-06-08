import { NextResponse } from "next/server";
import { createMcpProxyServer, listMcpProxyServers } from "../../../../lib/mcp-proxy-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const servers = await listMcpProxyServers();
    return NextResponse.json({ code: "00000", message: "ok", data: { servers } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const hint = /enterprise_runtime_mcp_servers|relation .* does not exist/i.test(message)
      ? "Run enterprise DB migrations (pnpm db:migrate)."
      : message;
    return NextResponse.json({ code: "50000", message: hint }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const created = await createMcpProxyServer({
      name: String(body.name ?? ""),
      upstreamUrl: String(body.upstreamUrl ?? ""),
      authHeader: body.authHeader ? String(body.authHeader) : undefined,
      enabled: body.enabled !== false,
      toolRateLimit: body.toolRateLimit != null ? Number(body.toolRateLimit) : undefined,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { server: created } });
  } catch (e) {
    return NextResponse.json(
      { code: "40000", message: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
