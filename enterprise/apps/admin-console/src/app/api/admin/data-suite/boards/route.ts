import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import { listBoards, upsertBoard } from "../../../../../lib/data-suite-store";
import type { BoardSpec } from "../../../../../lib/data-board-fixture";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const boards = await listBoards();
    return NextResponse.json({ code: "00000", message: "ok", data: { boards } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load boards";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Partial<BoardSpec> & { id?: string };
    if (!body.id?.trim()) {
      return NextResponse.json({ code: "40000", message: "id required" }, { status: 400 });
    }
    const board = await upsertBoard({
      id: body.id,
      title: body.title,
      drillLevels: body.drillLevels,
      widgets: body.widgets,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { board } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "create failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
