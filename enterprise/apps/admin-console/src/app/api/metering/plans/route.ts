import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { createQuotaPlan, listQuotaPlans } from "../../../../lib/quota-plans-store";

export async function GET() {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;
  const plans = await listQuotaPlans();
  return NextResponse.json({ code: "00000", message: "ok", data: { plans } });
}

export async function POST(request: Request) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) return guard.response;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  try {
    const plan = await createQuotaPlan({
      name: String(body.name ?? ""),
      monthlyTokens: Number(body.monthlyTokens ?? body.monthly_tokens ?? 0),
      rpm: Number(body.rpm ?? 0),
      tpm: Number(body.tpm ?? 0),
      maxConcurrency: Number(body.maxConcurrency ?? body.max_concurrency ?? 0),
      models: Array.isArray(body.models) ? body.models.map(String) : [],
      period: body.period === "week" ? "week" : "month",
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { plan } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "create failed";
    return NextResponse.json({ code: "40002", message }, { status: 400 });
  }
}
