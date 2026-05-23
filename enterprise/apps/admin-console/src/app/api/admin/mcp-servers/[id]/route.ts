import { NextResponse } from "next/server";
import {
  deleteMcpServer,
  getMcpServer,
  listMcpTools,
  updateMcpServer,
} from "../../../../../lib/mcp-servers-store";
import { requireAdminScope } from "../../../../../lib/admin-auth";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const auth = await requireAdminScope(["provider:read"]);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const server = await getMcpServer(id);
    if (!server) {
      return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });
    }
    const tools = await listMcpTools(id);
    return NextResponse.json({ code: "00000", message: "ok", data: { server, tools } });
  } catch (error) {
    return NextResponse.json(
      { code: "50000", message: error instanceof Error ? error.message : "load failed" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request, { params }: Params) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const server = await updateMcpServer(id, {
      displayName: body.displayName as string | undefined,
      transport: body.transport as string | undefined,
      backendType: body.backendType as string | undefined,
      backendConfig: body.backendConfig as Record<string, unknown> | undefined,
      requiredScopes: body.requiredScopes as string[] | undefined,
      status: body.status as "active" | "disabled" | undefined,
      rateLimit: body.rateLimit as Record<string, unknown> | undefined,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { server } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "update failed" },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    await deleteMcpServer(id);
    return NextResponse.json({ code: "00000", message: "ok" });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "delete failed" },
      { status: 400 }
    );
  }
}
