import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  appendReviewAction,
  listReviewActions,
  type ReviewAction,
} from "../../../../../lib/data-suite-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const actions = await listReviewActions();
    return NextResponse.json({ code: "00000", message: "ok", data: { actions } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load review actions";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Partial<ReviewAction> & {
      id?: string;
      decision?: ReviewAction["decision"];
    };
    if (!body.id?.trim()) {
      return NextResponse.json({ code: "40000", message: "id required" }, { status: 400 });
    }
    if (!body.decision || !["approve", "reject", "keep"].includes(body.decision)) {
      return NextResponse.json(
        { code: "40000", message: "decision must be approve|reject|keep" },
        { status: 400 },
      );
    }
    const action = await appendReviewAction({
      id: body.id,
      target_rule_id: body.target_rule_id,
      decision: body.decision,
      note: body.note,
      at: body.at,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { action } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "append failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
