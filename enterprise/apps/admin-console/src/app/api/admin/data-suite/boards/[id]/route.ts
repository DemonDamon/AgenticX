import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { getBoard, upsertBoard } from "../../../../../../lib/data-suite-store";
import type { BoardSpec } from "../../../../../../lib/data-board-fixture";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    const board = await getBoard(id);
    if (!board) {
      return NextResponse.json({ code: "40400", message: "board not found" }, { status: 404 });
    }
    return NextResponse.json({ code: "00000", message: "ok", data: { board } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load board";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Partial<BoardSpec>;
    const board = await upsertBoard({
      id,
      title: body.title,
      drillLevels: body.drillLevels,
      widgets: body.widgets,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { board } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "update failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
