import { NextResponse } from "next/server";
import { MaMemoryValidationError } from "@agenticx/iam-core";

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
  if (!isRecord(body)) throw new MaMemoryValidationError("请求体不是合法 JSON");
  return body;
}

export function assertAdminKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .sort();
  if (unknown[0]) throw new MaMemoryValidationError(`不支持的字段：${unknown[0]}`);
}

export function memoryErrorResponse(error: unknown): NextResponse {
  if (error instanceof Error) {
    switch (error.name) {
      case "MaMemoryValidationError":
      case "MaRequestError":
        return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
      case "MaMemoryStoreNotFoundError":
        return NextResponse.json({ code: "40400", message: "记忆库不存在" }, { status: 404 });
      case "MaMemoryNotFoundError":
        return NextResponse.json({ code: "40400", message: "记忆不存在" }, { status: 404 });
      case "MaMemoryVersionConflictError":
        return NextResponse.json(
          { code: "40900", message: "该记忆已被其他会话或管理员修改，请刷新后再编辑" },
          { status: 409 },
        );
      case "MaMemoryPathConflictError":
        return NextResponse.json(
          { code: "40900", message: "路径与已有记忆冲突（同名或文件 / 目录冲突）" },
          { status: 409 },
        );
      case "MaMemoryStoreArchivedError":
        return NextResponse.json({ code: "40900", message: "记忆库已归档，不能再修改" }, { status: 409 });
      case "MaMemoryStoreNotArchivedError":
        return NextResponse.json({ code: "40900", message: "请先归档记忆库再删除" }, { status: 409 });
      case "MaMemoryStoreInUseError":
        return NextResponse.json(
          { code: "40900", message: "仍有运行中的会话挂载了该记忆库，请稍后再删除" },
          { status: 409 },
        );
      case "MaMemoryVersionIsHeadError":
        return NextResponse.json({ code: "40900", message: "不能脱敏当前版本，请先修改或删除该记忆" }, { status: 409 });
      case "MaMemoryStoreLimitError":
        return NextResponse.json({ code: "40900", message: "记忆库已达上限（2000 条 / 20 MiB）" }, { status: 409 });
      default:
        break;
    }
  }
  return NextResponse.json({ code: "50000", message: "内部错误" }, { status: 500 });
}
