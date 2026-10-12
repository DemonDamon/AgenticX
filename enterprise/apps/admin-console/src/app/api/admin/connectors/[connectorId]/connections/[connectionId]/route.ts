import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../../lib/admin-auth";
import { revokeConnection, rotateConnection } from "../../../../../../../lib/gateway-connectors-store";

export async function POST(request: Request, { params }: { params: Promise<{ connectorId: string; connectionId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { connectorId, connectionId } = await params;
    const body = (await request.json()) as { action?: string; apiKey?: string };
    if (body.action === "rotate") {
      if (!body.apiKey?.trim()) {
        return NextResponse.json({ code: "40000", message: "apiKey is required" }, { status: 400 });
      }
      await rotateConnection(connectorId, connectionId, body.apiKey.trim());
      return NextResponse.json({ code: "00000", message: "ok", data: { rotated: true } });
    }
    if (body.action === "revoke") {
      await revokeConnection(connectorId, connectionId);
      return NextResponse.json({ code: "00000", message: "ok", data: { revoked: true } });
    }
    return NextResponse.json({ code: "40000", message: "action must be rotate or revoke" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "operation failed" },
      { status: 400 }
    );
  }
}
