import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  archiveQuotaPlan,
  deleteQuotaPlan,
  getQuotaPlan,
  updateQuotaPlan,
} from "../../../../../lib/quota-plans-store";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const plan = await getQuotaPlan(id);
  if (!plan) {
    return NextResponse.json({ code: "40401", message: "plan not found" }, { status: 404 });
  }
  return NextResponse.json({ code: "00000", message: "ok", data: { plan } });
}

export async function PUT(request: Request, { params }: RouteParams) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  try {
    if (body.status === "archived") {
      const plan = await archiveQuotaPlan(id);
      return NextResponse.json({ code: "00000", message: "ok", data: { plan } });
    }
    const plan = await updateQuotaPlan(id, {
      name: body.name !== undefined ? String(body.name) : undefined,
      monthlyTokens:
        body.monthlyTokens !== undefined
          ? Number(body.monthlyTokens)
          : body.monthly_tokens !== undefined
            ? Number(body.monthly_tokens)
            : undefined,
      rpm: body.rpm !== undefined ? Number(body.rpm) : undefined,
      tpm: body.tpm !== undefined ? Number(body.tpm) : undefined,
      maxConcurrency:
        body.maxConcurrency !== undefined
          ? Number(body.maxConcurrency)
          : body.max_concurrency !== undefined
            ? Number(body.max_concurrency)
            : undefined,
      models: Array.isArray(body.models) ? body.models.map(String) : undefined,
      period: body.period === "week" ? "week" : body.period === "month" ? "month" : undefined,
      status:
        body.status === "draft" || body.status === "active" || body.status === "archived"
          ? body.status
          : undefined,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { plan } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "update failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ code: status === 404 ? "40401" : "40002", message }, { status });
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  try {
    await deleteQuotaPlan(id);
    return NextResponse.json({ code: "00000", message: "ok", data: { deleted: true } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "delete failed";
    return NextResponse.json({ code: "40002", message }, { status: 400 });
  }
}
