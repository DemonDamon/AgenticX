import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  getQualityLastRun,
  listQualityMetrics,
  upsertQualityMetric,
  type QualityMetric,
} from "../../../../../lib/data-suite-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const metrics = await listQualityMetrics();
    const last_run = await getQualityLastRun();
    return NextResponse.json({ code: "00000", message: "ok", data: { metrics, last_run } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load quality metrics";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Partial<QualityMetric> & { id?: string };
    if (!body.id?.trim()) {
      return NextResponse.json({ code: "40000", message: "id required" }, { status: 400 });
    }
    const metric = await upsertQualityMetric({
      id: body.id,
      type: body.type,
      field: body.field,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { metric } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "upsert failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
