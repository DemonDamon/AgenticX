import { NextResponse } from "next/server";
import { getMcpServer, getMcpServerHealth } from "../../../../../../lib/mcp-servers-store";
import { requireAdminScope } from "../../../../../../lib/admin-auth";

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
    const stats = await getMcpServerHealth(server.name);
    const failRate = stats.callCount > 0 ? stats.failCount / stats.callCount : 0;
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: {
        window: "1h",
        callCount: stats.callCount,
        failCount: stats.failCount,
        failRate,
        p50LatencyMs: stats.p50LatencyMs,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { code: "50000", message: error instanceof Error ? error.message : "stats failed" },
      { status: 500 }
    );
  }
}
