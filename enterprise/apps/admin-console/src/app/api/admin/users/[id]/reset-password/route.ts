import { resetUserPassword } from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["user:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    const { initialPassword } = await resetUserPassword({
      tenantId: auth.session.tenantId,
      userId: id,
      actorUserId: auth.session.userId,
    });
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { initialPassword },
    });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "failed" },
      { status: 400 }
    );
  }
}
