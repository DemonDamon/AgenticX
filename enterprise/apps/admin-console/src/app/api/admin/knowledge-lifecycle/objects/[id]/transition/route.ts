import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../../lib/admin-auth";
import {
  transitionObject,
  type KnowledgeStatus,
} from "../../../../../../../lib/knowledge-lifecycle-store";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { status?: string; actor?: string };
    if (!body.status?.trim()) {
      return NextResponse.json({ code: "40000", message: "status required" }, { status: 400 });
    }
    const object = await transitionObject(id, body.status as KnowledgeStatus, {
      actor: body.actor || "admin",
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { object } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "transition failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
