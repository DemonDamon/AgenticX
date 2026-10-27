import { NextResponse } from "next/server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requiredTenantId(): string {
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) throw new Error("DEFAULT_TENANT_ID is required.");
  return tenantId;
}

export async function readAdminJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!isRecord(body)) throw Object.assign(new Error("请求体不是合法 JSON"), { name: "MaScheduleValidationError" });
  return body;
}

export function assertAdminKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .sort();
  const first = unknown[0];
  if (first) throw Object.assign(new Error(`不支持的字段：${first}`), { name: "MaScheduleValidationError" });
}

export function automationErrorResponse(error: unknown): NextResponse {
  if (error instanceof Error) {
    switch (error.name) {
      case "MaRequestError":
      case "MaScheduleValidationError":
      case "MaWebhookValidationError":
      case "MaCronValidationError":
        return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
      case "MaScheduleNameConflictError":
      case "MaWebhookNameConflictError":
        return NextResponse.json({ code: "40000", message: "名称已存在" }, { status: 400 });
      case "MaScheduleNotFoundError":
        return NextResponse.json({ code: "40400", message: "定时任务不存在" }, { status: 404 });
      case "MaWebhookNotFoundError":
        return NextResponse.json({ code: "40400", message: "Webhook 不存在" }, { status: 404 });
      case "MaScheduleLimitError":
        return NextResponse.json({ code: "40900", message: "每个租户最多 100 条定时任务" }, { status: 409 });
      case "MaWebhookLimitError":
        return NextResponse.json({ code: "40900", message: "每个租户最多 20 个 Webhook" }, { status: 409 });
      case "VaultCryptoUnavailableError":
        return NextResponse.json(
          { code: "50300", message: "凭证加密未配置（MA_VAULT_MASTER_KEY），请联系运维" },
          { status: 503 },
        );
      default:
        break;
    }
  }
  return NextResponse.json({ code: "50000", message: "内部错误" }, { status: 500 });
}

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ code: "00000", message: "ok", data }, { status });
}
