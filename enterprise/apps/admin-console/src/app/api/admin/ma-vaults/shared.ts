import { NextResponse } from "next/server";
import { MaVaultValidationError } from "@agenticx/iam-core";

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
  if (!isRecord(body)) {
    throw new MaVaultValidationError("请求体不是合法 JSON");
  }
  return body;
}

export function assertAdminKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .sort();
  if (unknown[0]) throw new MaVaultValidationError(`不支持的字段：${unknown[0]}`);
}

export function vaultErrorResponse(error: unknown): NextResponse {
  if (error instanceof Error) {
    switch (error.name) {
      case "MaVaultValidationError":
        return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
      case "MaVaultNotFoundError":
        return NextResponse.json({ code: "40400", message: "凭证库不存在" }, { status: 404 });
      case "MaCredentialNotFoundError":
        return NextResponse.json({ code: "40400", message: "凭证不存在" }, { status: 404 });
      case "MaCredentialIdentityConflictError":
        return NextResponse.json({ code: "40900", message: "该凭证库中已存在相同匹配目标的有效凭证" }, { status: 409 });
      case "MaVaultCredentialLimitError":
        return NextResponse.json({ code: "40900", message: "单个凭证库最多 100 条有效凭证" }, { status: 409 });
      case "MaVaultNotArchivedError":
        return NextResponse.json({ code: "40900", message: "请先归档凭证库再删除" }, { status: 409 });
      case "MaVaultArchivedError":
        return NextResponse.json({ code: "40900", message: "凭证库已归档，不能再修改" }, { status: 409 });
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
