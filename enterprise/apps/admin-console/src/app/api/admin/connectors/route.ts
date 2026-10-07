import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { importConnector, listConnectors } from "../../../../lib/gateway-connectors-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const connectors = await listConnectors();
    return NextResponse.json({ code: "00000", message: "ok", data: { connectors } });
  } catch (error) {
    return NextResponse.json(
      { code: "50000", message: error instanceof Error ? error.message : "failed to load connectors" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as {
      connectorId?: string;
      displayName?: string;
      baseUrl?: string;
      spec?: unknown;
      confirmDestructive?: boolean;
    };
    if (!body.connectorId?.trim() || !body.spec) {
      return NextResponse.json(
        { code: "40000", message: "connectorId and spec are required" },
        { status: 400 }
      );
    }
    const result = await importConnector({
      connectorId: body.connectorId.trim(),
      displayName: body.displayName,
      baseUrl: body.baseUrl,
      spec: body.spec,
      confirmDestructive: Boolean(body.confirmDestructive),
    });
    return NextResponse.json({ code: "00000", message: "ok", data: result });
  } catch (error) {
    // 409：destructive 待确认（携带动作列表回前端供勾选确认）
    const status = (error as { status?: number }).status;
    if (status === 409) {
      const message = error instanceof Error ? error.message : "destructive actions need confirmation";
      const destructive = (error as { data?: { destructive?: string[] } }).data?.destructive ?? [];
      return NextResponse.json({ code: "40901", message, data: { destructive } }, { status: 409 });
    }
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "import failed" },
      { status: 400 }
    );
  }
}
