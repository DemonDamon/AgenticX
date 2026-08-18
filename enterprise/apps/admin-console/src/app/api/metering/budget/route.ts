import { NextResponse } from "next/server";
import { isValidSessionTokenLimits } from "@agenticx/config";
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
      data: {
        alerts: await listBudgetAlerts(
          Number(url.searchParams.get("limit") ?? 50),
          guard.session.tenantId,
        ),
      },
    });
  }
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { budget: await getBudgetConfig(guard.session.tenantId) },
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
  const input = (body as Record<string, unknown>) ?? {};
  if (
    input.sessionTokenLimits !== undefined &&
    !isValidSessionTokenLimits(input.sessionTokenLimits)
  ) {
    return NextResponse.json(
      {
        code: "40002",
        message: "单会话提醒阈值必须小于停止阈值，且均须为有效整数",
      },
      { status: 400 },
    );
  }
  const budget = await setBudgetConfig(input, guard.session.tenantId);
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { budget },
  });
}
