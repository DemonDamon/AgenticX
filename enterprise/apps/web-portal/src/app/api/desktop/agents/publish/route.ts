import { NextResponse } from "next/server";

import { publishEmployeeAgentVersion } from "../../../../../lib/desktop-agent-publish";
import { resolveDesktopIdentity } from "../../../../../lib/desktop-auth";
import {
  WorkerRequestError,
  readJsonObject,
  workerErrorResponse,
  workerUnauthorized,
} from "../../../../../lib/worker-tasks/protocol";

export const dynamic = "force-dynamic";

const LOCAL_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ALLOWED = ["local_avatar_id", "display_name", "description", "manifest", "note"] as const;

function requireLocalAvatarId(value: unknown): string {
  const localAvatarId = typeof value === "string" ? value.trim() : "";
  if (!LOCAL_ID_RE.test(localAvatarId)) throw new WorkerRequestError("本机分身标识不合法");
  return localAvatarId;
}

function requireDisplayName(value: unknown): string {
  const displayName = typeof value === "string" ? value.trim() : "";
  if (displayName.length < 1 || displayName.length > 64) {
    throw new WorkerRequestError("分身名称须为 1–64 个字符");
  }
  return displayName;
}

function readDescription(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > 500) {
    throw new WorkerRequestError("简介须为不超过 500 字的文本");
  }
  return value;
}

function requireManifest(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkerRequestError("manifest 必须为对象");
  }
  return value as Record<string, unknown>;
}

function readNote(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > 500) {
    throw new WorkerRequestError("版本说明须为不超过 500 字的文本");
  }
  const note = value.trim();
  return note || null;
}

export async function POST(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return workerUnauthorized();
  try {
    const body = await readJsonObject(request);
    const unknown = Object.keys(body)
      .filter((key) => !(ALLOWED as readonly string[]).includes(key))
      .sort()[0];
    if (unknown) throw new WorkerRequestError(`未知字段：${unknown}`);
    const result = await publishEmployeeAgentVersion({
      tenantId: identity.tenantId,
      userId: identity.userId,
      localAvatarId: requireLocalAvatarId(body.local_avatar_id),
      displayName: requireDisplayName(body.display_name),
      description: readDescription(body.description),
      manifest: requireManifest(body.manifest),
      note: readNote(body.note),
    });
    switch (result.kind) {
      case "ok":
        return NextResponse.json(result.body, { status: result.status });
      case "invalid":
        return NextResponse.json(
          { code: "40001", message: "manifest is invalid", errors: result.errors },
          { status: 400 },
        );
      case "recalled":
        return NextResponse.json(
          { code: "40900", message: "该智能体已被管理员回收，无法再次提交" },
          { status: 409 },
        );
      case "conflict":
        return NextResponse.json(
          { code: "40901", message: "企业侧版本刚被更新，请稍后重试" },
          { status: 409 },
        );
      default: {
        const exhaustive: never = result;
        return exhaustive;
      }
    }
  } catch (error) {
    if (error instanceof WorkerRequestError) {
      return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.name === "AgentValidationError") {
      return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
    }
    return workerErrorResponse(error);
  }
}
