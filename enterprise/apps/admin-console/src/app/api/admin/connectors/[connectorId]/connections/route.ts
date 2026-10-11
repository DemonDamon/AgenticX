import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { createConnection, listConnections } from "../../../../../../lib/gateway-connectors-store";

export async function GET(_request: Request, { params }: { params: Promise<{ connectorId: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { connectorId } = await params;
    const connections = await listConnections(connectorId);
    return NextResponse.json({ code: "00000", message: "ok", data: { connections } });
  } catch (error) {
    return NextResponse.json(
      { code: "50000", message: error instanceof Error ? error.message : "failed to load connections" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ connectorId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { connectorId } = await params;
    const body = (await request.json()) as {
      name?: string;
      grantedScopes?: string[];
      apiKey?: string;
    };
    if (!body.name?.trim()) {
      return NextResponse.json({ code: "40000", message: "name is required" }, { status: 400 });
    }
    const connection = await createConnection(connectorId, {
      name: body.name.trim(),
      grantedScopes: body.grantedScopes,
      apiKey: body.apiKey,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { connection } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "create failed" },
      { status: 400 }
    );
  }
}
