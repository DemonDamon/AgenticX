import { NextResponse } from "next/server";
import { isValidSessionTokenLimits } from "@agenticx/config";
import {
  BudgetConfigConflictError,
  getBudgetConfig,
  listBudgetAlerts,
  setBudgetConfig,
} from "../../../../lib/budget-store";
import { requireAdminScope } from "../../../../lib/admin-auth";

const PATCHABLE_BUDGET_KEYS = [
  "companyLimits",
  "sessionTokenLimits",
  "defaults",
  "tenants",
  "departments",
  "users",
] as const;
const ACCEPTED_BUDGET_KEYS = new Set<string>([
  "updatedAt",
  "expectedUpdatedAt",
  ...PATCHABLE_BUDGET_KEYS,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  if (!isRecord(body)) {
    return NextResponse.json({ code: "40001", message: "invalid budget payload" }, { status: 400 });
  }
  const unknownKeys = Object.keys(body).filter((key) => !ACCEPTED_BUDGET_KEYS.has(key));
  if (unknownKeys.length) {
    return NextResponse.json(
      { code: "40001", message: `unsupported budget field: ${unknownKeys[0]}` },
      { status: 400 },
    );
  }
  if (!PATCHABLE_BUDGET_KEYS.some((key) => Object.prototype.hasOwnProperty.call(body, key))) {
    return NextResponse.json(
      { code: "40001", message: "no budget fields to update" },
      { status: 400 },
    );
  }
  const expectedUpdatedAt = body.expectedUpdatedAt ?? body.updatedAt;
  if (
    expectedUpdatedAt !== undefined &&
    (typeof expectedUpdatedAt !== "string" || Number.isNaN(new Date(expectedUpdatedAt).getTime()))
  ) {
    return NextResponse.json(
      { code: "40001", message: "invalid budget version" },
      { status: 400 },
    );
  }
  if (
    body.expectedUpdatedAt !== undefined &&
    body.updatedAt !== undefined &&
    body.expectedUpdatedAt !== body.updatedAt
  ) {
    return NextResponse.json(
      { code: "40001", message: "conflicting budget versions" },
      { status: 400 },
    );
  }
  const input = Object.fromEntries(
    PATCHABLE_BUDGET_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(body, key)).map(
      (key) => [key, body[key]],
    ),
  );
  if (
    input.sessionTokenLimits !== undefined &&
    !isValidSessionTokenLimits(input.sessionTokenLimits)
  ) {
    return NextResponse.json(
      {
        code: "40002",
        message: "单会话黄色提醒阈值必须低于红色提醒阈值，且均须为有效整数",
      },
      { status: 400 },
    );
  }
  try {
    const budget = await setBudgetConfig(
      input,
      guard.session.tenantId,
      typeof expectedUpdatedAt === "string" ? expectedUpdatedAt : undefined,
    );
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { budget },
    });
  } catch (error) {
    if (error instanceof BudgetConfigConflictError) {
      return NextResponse.json(
        {
          code: "40901",
          message: "预算配置已被其他管理员更新，请刷新后重试",
        },
        { status: 409 },
      );
    }
    throw error;
  }
}
