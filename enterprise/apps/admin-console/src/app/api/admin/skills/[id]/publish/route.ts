import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { publishSkill, ShelfPublishError } from "../../../../../../lib/capability-packs-store";
import { PlatformSkillMetadataReadonlyError } from "../../../../../../lib/platform-catalog-store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    const skill = await publishSkill(id);
    return NextResponse.json({ code: "00000", message: "ok", data: { skill } });
  } catch (error) {
    if (error instanceof PlatformSkillMetadataReadonlyError) {
      return NextResponse.json({ code: "40300", message: error.message }, { status: 403 });
    }
    if (error instanceof ShelfPublishError) {
      return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "publish failed";
    const status = message === "skill not found" ? 404 : 400;
    return NextResponse.json({ code: status === 404 ? "40400" : "40000", message }, { status });
  }
}
