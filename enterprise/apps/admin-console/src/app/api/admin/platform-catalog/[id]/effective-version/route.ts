import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import {
  setEffectiveCatalogVersion,
  ShelfPublishError,
} from "../../../../../../lib/platform-catalog-store";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    const body = (await request.json()) as { versionId?: string };
    if (!body.versionId?.trim()) {
      return NextResponse.json({ code: "40000", message: "versionId required" }, { status: 400 });
    }
    const item = await setEffectiveCatalogVersion(id, body.versionId.trim());
    return NextResponse.json({ code: "00000", message: "ok", data: { item } });
  } catch (error) {
    if (error instanceof ShelfPublishError) {
      return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "update failed" },
      { status: 400 },
    );
  }
}
