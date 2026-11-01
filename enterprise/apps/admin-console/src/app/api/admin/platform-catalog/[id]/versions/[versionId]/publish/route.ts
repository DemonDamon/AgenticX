import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../../../../lib/admin-auth";
import {
  ApprovalRequiredError,
  publishCatalogVersion,
  ShelfPublishError,
} from "../../../../../../../../lib/platform-catalog-store";

export async function POST(_request: Request, context: { params: Promise<{ id: string; versionId: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id, versionId } = await context.params;
  try {
    const result = await publishCatalogVersion(id, versionId, auth.session.tenantId);
    return NextResponse.json({ code: "00000", message: "ok", data: result });
  } catch (error) {
    if (error instanceof ShelfPublishError) {
      return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
    }
    if (error instanceof ApprovalRequiredError) {
      return NextResponse.json({ code: "40901", message: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "publish failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
