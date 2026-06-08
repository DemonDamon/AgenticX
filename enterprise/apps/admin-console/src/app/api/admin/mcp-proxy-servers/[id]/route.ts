import { NextResponse } from "next/server";
import { deleteMcpProxyServer, getMcpProxyServer, updateMcpProxyServer } from "../../../../../lib/mcp-proxy-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const server = await getMcpProxyServer(id);
    if (!server) {
      return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });
    }
    return NextResponse.json({ code: "00000", message: "ok", data: { server } });
  } catch (e) {
    return NextResponse.json(
      { code: "50000", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const server = await updateMcpProxyServer(id, {
      name: body.name != null ? String(body.name) : undefined,
      upstreamUrl: body.upstreamUrl != null ? String(body.upstreamUrl) : undefined,
      authHeader: body.authHeader != null ? String(body.authHeader) : undefined,
      enabled: body.enabled != null ? Boolean(body.enabled) : undefined,
      toolRateLimit: body.toolRateLimit != null ? Number(body.toolRateLimit) : undefined,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { server } });
  } catch (e) {
    return NextResponse.json(
      { code: "40000", message: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    await deleteMcpProxyServer(id);
    return NextResponse.json({ code: "00000", message: "ok" });
  } catch (e) {
    return NextResponse.json(
      { code: "40000", message: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
