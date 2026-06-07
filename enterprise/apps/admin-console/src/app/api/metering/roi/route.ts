import { NextResponse } from "next/server";
import {
  createBusinessRevenue,
  deleteBusinessRevenue,
  exportRoiReportCsv,
  listBusinessRevenues,
  queryRoiReport,
  updateBusinessRevenue,
} from "../../../../lib/metering-service";
import { requireAdminScope } from "../../../../lib/admin-auth";

const DIMENSIONS = new Set(["dept", "user", "model", "pat", "provider"]);

function parseDimension(value: string | null): "dept" | "user" | "model" | "pat" | "provider" {
  if (value && DIMENSIONS.has(value)) {
    return value as "dept" | "user" | "model" | "pat" | "provider";
  }
  return "dept";
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return [];
}

export async function GET(request: Request) {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) {
    return guard.response;
  }
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");

  if (mode === "revenues") {
    try {
      const result = await listBusinessRevenues();
      return NextResponse.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ code: "50001", message, data: { items: [] } }, { status: 500 });
    }
  }

  const dimension = parseDimension(url.searchParams.get("dimension"));
  const start =
    url.searchParams.get("start") ?? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const end = url.searchParams.get("end") ?? new Date().toISOString();
  const format = url.searchParams.get("format");

  try {
    const input = {
      dimension,
      start,
      end,
      dept_id: toArray(url.searchParams.getAll("dept_id")),
      user_id: toArray(url.searchParams.getAll("user_id")),
      api_token_id: toArray(url.searchParams.getAll("api_token_id")),
      provider: toArray(url.searchParams.getAll("provider")),
      model: toArray(url.searchParams.getAll("model")),
    };
    if (format === "csv") {
      const csv = await exportRoiReportCsv(input);
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="roi-report-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }
    const result = await queryRoiReport(input);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message, data: { dimension, rows: [] } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) {
    return guard.response;
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  if (typeof body.scenario_label !== "string" || body.scenario_label.trim().length === 0) {
    return NextResponse.json({ code: "40002", message: "scenario_label required" }, { status: 400 });
  }
  if (typeof body.period_start !== "string" || typeof body.period_end !== "string") {
    return NextResponse.json({ code: "40003", message: "period_start and period_end required" }, { status: 400 });
  }
  const revenueUsd = Number(body.revenue_usd);
  if (!Number.isFinite(revenueUsd)) {
    return NextResponse.json({ code: "40004", message: "revenue_usd must be a number" }, { status: 400 });
  }
  try {
    const result = await createBusinessRevenue({
      scenario_label: body.scenario_label.trim(),
      period_start: body.period_start,
      period_end: body.period_end,
      revenue_usd: revenueUsd,
      notes: typeof body.notes === "string" ? body.notes : null,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) {
    return guard.response;
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  if (typeof body.id !== "string" || body.id.length === 0) {
    return NextResponse.json({ code: "40002", message: "id required" }, { status: 400 });
  }
  const patch: {
    scenario_label?: string;
    period_start?: string;
    period_end?: string;
    revenue_usd?: number;
    notes?: string | null;
  } = {};
  if (typeof body.scenario_label === "string" && body.scenario_label.trim().length > 0) {
    patch.scenario_label = body.scenario_label.trim();
  }
  if (typeof body.period_start === "string") patch.period_start = body.period_start;
  if (typeof body.period_end === "string") patch.period_end = body.period_end;
  if (body.revenue_usd != null) {
    const revenueUsd = Number(body.revenue_usd);
    if (!Number.isFinite(revenueUsd)) {
      return NextResponse.json({ code: "40004", message: "revenue_usd must be a number" }, { status: 400 });
    }
    patch.revenue_usd = revenueUsd;
  }
  if (body.notes !== undefined) {
    patch.notes = typeof body.notes === "string" ? body.notes : null;
  }
  try {
    const result = await updateBusinessRevenue(body.id, patch);
    if (result.code !== "00000") {
      return NextResponse.json(result, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) {
    return guard.response;
  }
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ code: "40002", message: "id required" }, { status: 400 });
  }
  try {
    const result = await deleteBusinessRevenue(id);
    if (result.code !== "00000") {
      return NextResponse.json(result, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ code: "50001", message }, { status: 500 });
  }
}
