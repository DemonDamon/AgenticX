import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { deleteConnector } from "../../../../../lib/gateway-connectors-store";

export async function DELETE(_request: Request, { params }: { params: Promise<{ connectorId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { connectorId } = await params;
    await deleteConnector(connectorId);
    return NextResponse.json({ code: "00000", message: "ok", data: { deleted: true } });
  } catch (error) {
    return NextResponse.json(
      { code: "50000", message: error instanceof Error ? error.message : "delete failed" },
      { status: 500 }
    );
  }
}
