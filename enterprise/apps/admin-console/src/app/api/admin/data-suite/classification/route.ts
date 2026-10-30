import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  listClassificationGrades,
  upsertClassificationGrade,
  type ClassificationGrade,
} from "../../../../../lib/data-suite-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const grades = await listClassificationGrades();
    return NextResponse.json({ code: "00000", message: "ok", data: { grades } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load classification";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Partial<ClassificationGrade> & { id?: string };
    if (!body.id?.trim()) {
      return NextResponse.json({ code: "40000", message: "id required" }, { status: 400 });
    }
    const grade = await upsertClassificationGrade({
      id: body.id,
      label: body.label,
      rank: body.rank,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { grade } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "upsert failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
