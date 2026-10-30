import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { listConflicts, resolveConflict } from "../../../../../../lib/idmapping-store";

export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const conflicts = await listConflicts(
      status === "open" || status === "resolved" ? status : undefined,
    );
    return NextResponse.json({ code: "00000", message: "ok", data: { conflicts } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load conflicts";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}

type Body = {
  conflict_id?: string;
  decision?: "keep_value" | "reject_merge";
  chosen_value?: unknown;
  note?: string;
};

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Body;
    if (!body.conflict_id?.trim()) {
      return NextResponse.json({ code: "40000", message: "conflict_id required" }, { status: 400 });
    }
    if (body.decision !== "keep_value" && body.decision !== "reject_merge") {
      return NextResponse.json(
        { code: "40000", message: "decision must be keep_value|reject_merge" },
        { status: 400 },
      );
    }
    const conflict = await resolveConflict({
      conflict_id: body.conflict_id,
      decision: body.decision,
      chosen_value: body.chosen_value,
      note: body.note,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { conflict } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "resolve failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
