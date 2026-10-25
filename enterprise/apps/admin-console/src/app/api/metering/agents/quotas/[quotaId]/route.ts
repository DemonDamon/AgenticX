import { MaAgentQuotaNotFoundError } from "@agenticx/iam-core";
import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { removeAgentQuota } from "../../../../../../lib/metering-service";

type RouteParams = { params: Promise<{ quotaId: string }> };

export async function DELETE(_request: Request, { params }: RouteParams) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) return guard.response;
  const { quotaId } = await params;
  try {
    await removeAgentQuota(quotaId);
    return NextResponse.json({ code: "00000", message: "ok", data: { deleted: true } });
  } catch (error) {
    if (error instanceof MaAgentQuotaNotFoundError || (error instanceof Error && error.name === "MaAgentQuotaNotFoundError")) {
      return NextResponse.json({ code: "40401", message: "quota rule not found" }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message }, { status: 500 });
  }
}
