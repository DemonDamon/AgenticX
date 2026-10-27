import { NextResponse } from "next/server";
import {
  MaEnvironmentValidationError,
  type MaEnvironmentInput,
  type MaEnvironmentStatus,
  type MaEnvironmentType,
} from "@agenticx/iam-core";

import { agentErrorResponse } from "../agents/shared";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function environmentErrorResponse(error: unknown): NextResponse {
  if (error instanceof Error) {
    switch (error.name) {
      case "MaEnvironmentValidationError":
        return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
      case "MaEnvironmentNotFoundError":
        return NextResponse.json({ code: "40400", message: error.message }, { status: 404 });
      case "MaEnvironmentNameConflictError":
      case "MaEnvironmentInUseError":
        return NextResponse.json({ code: "40900", message: error.message }, { status: 409 });
      default:
        break;
    }
  }
  return agentErrorResponse(error);
}

const INPUT_KEYS = ["name", "type", "description", "config", "status"] as const;

export function readEnvironmentInput(body: Record<string, unknown>, mode: "create"): MaEnvironmentInput;
export function readEnvironmentInput(body: Record<string, unknown>, mode: "patch"): Partial<MaEnvironmentInput>;
export function readEnvironmentInput(
  body: Record<string, unknown>,
  mode: "create" | "patch",
): MaEnvironmentInput | Partial<MaEnvironmentInput> {
  const unknown = Object.keys(body)
    .filter((key) => !(INPUT_KEYS as readonly string[]).includes(key))
    .sort();
  if (unknown[0]) throw new MaEnvironmentValidationError(`不支持的字段：${unknown[0]}`);

  const input: Partial<MaEnvironmentInput> = {};
  if ("name" in body) {
    if (typeof body.name !== "string") throw new MaEnvironmentValidationError("名称不合法");
    input.name = body.name;
  } else if (mode === "create") {
    throw new MaEnvironmentValidationError("名称不合法");
  }
  if ("type" in body) {
    if (body.type !== "cloud" && body.type !== "desktop_worker") {
      throw new MaEnvironmentValidationError("环境类型不合法");
    }
    input.type = body.type;
  } else if (mode === "create") {
    throw new MaEnvironmentValidationError("环境类型不合法");
  }
  if ("description" in body) {
    if (body.description !== null && typeof body.description !== "string") {
      throw new MaEnvironmentValidationError("描述不合法");
    }
    input.description = body.description;
  }
  if ("config" in body) {
    if (!isRecord(body.config)) throw new MaEnvironmentValidationError("环境配置须为对象");
    input.config = body.config;
  }
  if ("status" in body) {
    if (body.status !== "active" && body.status !== "disabled") {
      throw new MaEnvironmentValidationError("环境状态不合法");
    }
    input.status = body.status;
  }

  switch (mode) {
    case "create":
      return input as MaEnvironmentInput;
    case "patch":
      return input;
    default: {
      const unreachable: never = mode;
      throw new MaEnvironmentValidationError(String(unreachable));
    }
  }
}

export function readEnvironmentListFilter(url: URL): { status?: MaEnvironmentStatus; type?: MaEnvironmentType } {
  const status = url.searchParams.get("status");
  const type = url.searchParams.get("type");
  const filter: { status?: MaEnvironmentStatus; type?: MaEnvironmentType } = {};
  if (status != null) {
    if (status !== "active" && status !== "disabled") throw new MaEnvironmentValidationError("环境状态不合法");
    filter.status = status;
  }
  if (type != null) {
    if (type !== "cloud" && type !== "desktop_worker") throw new MaEnvironmentValidationError("环境类型不合法");
    filter.type = type;
  }
  return filter;
}
