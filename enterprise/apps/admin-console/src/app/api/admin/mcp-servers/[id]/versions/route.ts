import { NextResponse } from "next/server";
import {
  listMcpServerVersions,
  publishCurrentMcpSurface,
  publishMcpServerVersion,
  rollbackMcpServerVersion,
} from "../../../../../../lib/mcp-servers-store";
import { requireAdminScope } from "../../../../../../lib/admin-auth";

type Params = { params: Promise<{ id: string }> };
type VersionAction = "publish_current" | "publish" | "rollback";

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const data = await listMcpServerVersions(id);
    return NextResponse.json({ code: "00000", message: "ok", data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "load failed";
    const status = message === "server not found" ? 404 : 500;
    return NextResponse.json({ code: status === 404 ? "40400" : "50000", message }, { status });
  }
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const body = (await request.json()) as { action?: VersionAction; versionId?: string };
    const action = body.action;
    if (action !== "publish_current" && action !== "publish" && action !== "rollback") {
      return NextResponse.json({ code: "40000", message: "action required" }, { status: 400 });
    }
    const server = await applyVersionAction(id, action, body.versionId, auth.session.userId);
    return NextResponse.json({ code: "00000", message: "ok", data: { server } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "update failed";
    const status = message === "server not found" || message === "version not found" ? 404 : 400;
    return NextResponse.json({ code: status === 404 ? "40400" : "40000", message }, { status });
  }
}

async function applyVersionAction(
  serverId: string,
  action: VersionAction,
  versionId: string | undefined,
  createdBy: string,
) {
  switch (action) {
    case "publish_current":
      return publishCurrentMcpSurface(serverId, createdBy);
    case "publish":
      if (!versionId?.trim()) throw new Error("version not found");
      return publishMcpServerVersion(serverId, versionId.trim());
    case "rollback":
      if (!versionId?.trim()) throw new Error("version not found");
      return rollbackMcpServerVersion(serverId, versionId.trim());
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}
