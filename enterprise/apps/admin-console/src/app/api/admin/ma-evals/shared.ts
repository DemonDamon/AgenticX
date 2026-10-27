import { NextResponse } from "next/server";

import { MaRuntimeRequestError, MaRuntimeUnavailableError } from "../../../../lib/ma/runtime-internal-client";

export function requiredTenantId(): string {
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) throw new Error("DEFAULT_TENANT_ID is required.");
  return tenantId;
}

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ code: "00000", message: "ok", data }, { status });
}

export function fail(status: number, message: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ code: `${status}00`, message, ...extra }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readAdminJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!isRecord(body)) throw new Error("请求体不是合法 JSON");
  return body;
}

export function assertKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key)).sort();
  if (unknown[0]) throw new Error(`不支持的字段：${unknown[0]}`);
}

export function runtimeFailure(error: unknown): NextResponse | null {
  if (error instanceof MaRuntimeUnavailableError) {
    return fail(503, "评测运行时不可达，请确认 agent-runtime 已启动并开启评测");
  }
  if (error instanceof MaRuntimeRequestError) {
    if (error.status === 400) return fail(400, error.message);
    if (error.status === 404) return fail(404, "评测任务不存在");
    if (error.status === 409) return fail(409, "该候选已处理");
    return fail(error.status, error.message);
  }
  return null;
}

export function evalErrorResponse(error: unknown): NextResponse {
  const runtime = runtimeFailure(error);
  if (runtime) return runtime;
  if (error instanceof Error) {
    switch (error.name) {
      case "EvalValidationError":
      case "Error":
        if (error.name === "EvalValidationError" || error.message.startsWith("请求体") || error.message.startsWith("不支持")) {
          return fail(400, error.message);
        }
        break;
      case "EvalDatasetNotFoundError":
        return fail(404, "评测集不存在");
      case "EvalItemNotFoundError":
        return fail(404, "用例不存在");
      case "EvalRubricNotFoundError":
        return fail(404, "评分标准不存在");
      case "EvalNameConflictError":
        return fail(409, error.message);
      case "EvalDatasetLimitError":
        return fail(409, error.message);
      case "EvalRubricInvalidError": {
        const errors = "errors" in error && Array.isArray(error.errors) ? error.errors : [];
        return NextResponse.json({ code: "40000", message: "评分标准不合法", errors }, { status: 400 });
      }
      case "EvalCompareMismatchError":
        return fail(400, error.message);
      case "AgentVersionNotFoundError":
        return fail(400, "版本不存在");
      case "AgentNotFoundError":
        return fail(404, "智能体不存在");
      case "AgentVersionConflictError":
        return fail(409, "智能体版本已被他人更新，请刷新后重试");
      case "AgentManifestInvalidError": {
        const errors = "errors" in error && Array.isArray(error.errors) ? error.errors : [];
        return NextResponse.json({ code: "40000", message: error.message, errors }, { status: 400 });
      }
      case "MaEnvironmentNotFoundError":
        return fail(400, "环境不存在");
      default:
        break;
    }
  }
  if (error instanceof Error && (error.message.startsWith("请求体") || error.message.startsWith("不支持"))) {
    return fail(400, error.message);
  }
  return fail(500, "内部错误");
}

export function textOf(event: Record<string, unknown>): string {
  const content = event.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isRecord)
    .filter((block) => block.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("");
}
