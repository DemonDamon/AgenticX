import { NextResponse } from "next/server";
import { getBudgetConfig, listBudgetAlerts, setBudgetConfig } from "../../../../lib/budget-store";
import { requireAdminScope } from "../../../../lib/admin-auth";

export async function GET(request: Request) {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const view = url.searchParams.get("view");
  if (view === "alerts") {
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { alerts: await listBudgetAlerts(Number(url.searchParams.get("limit") ?? 50)) },
    });
  }
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { budget: await getBudgetConfig() },
  });
}

export async function PUT(request: Request) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) return guard.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  const budget = await setBudgetConfig((body as Record<string, unknown>) ?? {});
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { budget },
  });
}
