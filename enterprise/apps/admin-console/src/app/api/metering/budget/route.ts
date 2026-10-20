import { NextResponse } from "next/server";
import {
  BUDGET_PATCH_KEYS,
  BudgetConflictError,
  getBudgetConfig,
  listBudgetAlerts,
  mergeBudgetPatch,
  setBudgetConfig,
  type BudgetConfigPatch,
} from "../../../../lib/budget-store";
import { requireAdminScope } from "../../../../lib/admin-auth";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBudgetConflict(error: unknown): boolean {
  return error instanceof BudgetConflictError || (error instanceof Error && error.name === "BudgetConflictError");
}

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
  const budget = await getBudgetConfig();
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { budget, tenantId: process.env.DEFAULT_TENANT_ID?.trim() ?? "" },
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
  if (!isRecord(body)) {
    return NextResponse.json({ code: "40001", message: "invalid budget payload" }, { status: 400 });
  }

  let expectedUpdatedAt: string | undefined;
  if (Object.prototype.hasOwnProperty.call(body, "expectedUpdatedAt")) {
    const raw = body.expectedUpdatedAt;
    if (typeof raw !== "string" || Number.isNaN(new Date(raw).getTime())) {
      return NextResponse.json({ code: "40001", message: "invalid budget version" }, { status: 400 });
    }
    expectedUpdatedAt = raw;
  }

  const patch: BudgetConfigPatch = {};
  for (const key of BUDGET_PATCH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      (patch as Record<string, unknown>)[key] = body[key];
    }
  }
  if (!BUDGET_PATCH_KEYS.some((key) => Object.prototype.hasOwnProperty.call(patch, key))) {
    return NextResponse.json({ code: "40001", message: "no budget fields to update" }, { status: 400 });
  }

  try {
    const current = await getBudgetConfig();
    const budget = await setBudgetConfig(mergeBudgetPatch(current, patch), expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : undefined);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { budget },
    });
  } catch (error) {
    if (isBudgetConflict(error)) {
      return NextResponse.json(
        { code: "40900", message: "预算刚被其他管理员修改，请刷新后重试" },
        { status: 409 },
      );
    }
    throw error;
  }
}
