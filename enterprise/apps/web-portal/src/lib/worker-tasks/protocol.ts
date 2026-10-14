import { NextResponse } from "next/server";
import { WorkerTaskConflictError } from "./types";

const DEVICE_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;
const CONTENT_MAX = 16000;

export class WorkerRequestError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WorkerRequestError";
  }
}

export function workerUnauthorized(): NextResponse {
  return NextResponse.json({ code: "40101", message: "企业登录已失效，请重新登录" }, { status: 401 });
}

export function workerErrorResponse(error: unknown): NextResponse {
  if (error instanceof WorkerRequestError) {
    return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
  }
  if (error instanceof WorkerTaskConflictError) {
    return NextResponse.json({ code: "40900", message: error.message }, { status: 409 });
  }
  const message = error instanceof Error ? error.message : "request failed";
  return NextResponse.json({ code: "50000", message }, { status: 500 });
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new WorkerRequestError("请求体不是合法 JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new WorkerRequestError("请求体不是合法 JSON");
  }
  return body as Record<string, unknown>;
}

export function readDeviceId(value: unknown): string {
  const deviceId = typeof value === "string" ? value.trim() : "";
  if (!DEVICE_ID_RE.test(deviceId)) throw new WorkerRequestError("device_id 不合法");
  return deviceId;
}

export function readDeviceName(value: unknown): string {
  if (typeof value !== "string") throw new WorkerRequestError("device_name 不合法");
  return value.trim().slice(0, 128);
}

export function readReplyContent(value: unknown): string {
  if (typeof value !== "string") throw new WorkerRequestError("回复内容须为 1–16000 字");
  const content = value.trim();
  if (content.length < 1 || content.length > CONTENT_MAX) {
    throw new WorkerRequestError("回复内容须为 1–16000 字");
  }
  return content;
}

export function readFailureReason(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new WorkerRequestError("失败原因不能为空");
  return value.trim();
}

export function readToolSteps(value: unknown): unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new WorkerRequestError("tool_steps 不合法");
  return value;
}
