import { NextResponse } from "next/server";
import {
  AgentNotFoundError,
  AgentSlugConflictError,
  AgentValidationError,
  validateAgentInput,
  type AgentInput,
  type AgentRuntime,
  type AgentStatus,
} from "@agenticx/iam-core";

import { assertCapabilityIds, normalizeAssignmentKeys } from "../../../../lib/capability-packs-store";

const MIGRATE_HINT = "请先执行 pnpm --filter @agenticx/db-schema db:migrate";

export function requiredTenantId(): string {
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) throw new Error("DEFAULT_TENANT_ID is required.");
  return tenantId;
}

function isMissingAgentsTable(message: string): boolean {
  return /enterprise_agents|relation .* does not exist/i.test(message);
}

export function agentErrorResponse(error: unknown): NextResponse {
  if (error instanceof AgentValidationError) {
    return NextResponse.json({ code: "40000", message: error.message }, { status: 400 });
  }
  if (error instanceof AgentSlugConflictError) {
    return NextResponse.json({ code: "40900", message: error.message }, { status: 409 });
  }
  if (error instanceof AgentNotFoundError) {
    return NextResponse.json({ code: "40400", message: error.message }, { status: 404 });
  }
  const message = error instanceof Error ? error.message : "request failed";
  if (isMissingAgentsTable(message)) {
    return NextResponse.json({ code: "50000", message: MIGRATE_HINT }, { status: 500 });
  }
  return NextResponse.json({ code: "50000", message }, { status: 500 });
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AgentValidationError("请求体不是合法 JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AgentValidationError("请求体不是合法 JSON");
  }
  return body as Record<string, unknown>;
}

function readRuntime(value: unknown): AgentRuntime | undefined {
  if (value === undefined) return undefined;
  if (value === "cloud" || value === "desktop_worker") return value;
  throw new AgentValidationError("运行方式不合法");
}

function readStatus(value: unknown): AgentStatus | undefined {
  if (value === undefined) return undefined;
  if (value === "active" || value === "disabled") return value;
  throw new AgentValidationError("状态不合法");
}

function readDescription(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value;
  throw new AgentValidationError("描述不合法");
}

function readMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentValidationError("附加信息不合法");
  }
  return value as Record<string, unknown>;
}

function readWorkerKeys(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new AgentValidationError("可承接执行的员工不合法");
  const keys: string[] = [];
  for (const raw of value) {
    const key = String(raw ?? "").trim();
    if (!key) throw new AgentValidationError("可承接执行的员工不合法");
    keys.push(key);
  }
  return normalizeAssignmentKeys(keys);
}

function checkedCapabilityIds(ids: readonly string[]): string[] {
  try {
    return assertCapabilityIds(ids);
  } catch (error) {
    const message = error instanceof Error ? error.message : "能力标识不合法";
    throw new AgentValidationError(message);
  }
}

export async function prepareCreateInput(request: Request): Promise<AgentInput> {
  const body = await readJsonObject(request);
  if (body.capabilityIds !== undefined && !Array.isArray(body.capabilityIds)) {
    throw new AgentValidationError("能力标识不合法");
  }
  if (body.assignmentKeys !== undefined && !Array.isArray(body.assignmentKeys)) {
    throw new AgentValidationError("可见范围不能为空");
  }
  const input: AgentInput = {
    slug: typeof body.slug === "string" ? body.slug : "",
    displayName: typeof body.displayName === "string" ? body.displayName : "",
    description: readDescription(body.description),
    systemPrompt: typeof body.systemPrompt === "string" ? body.systemPrompt : undefined,
    model: typeof body.model === "string" ? body.model : "",
    runtime: readRuntime(body.runtime),
    capabilityIds: Array.isArray(body.capabilityIds) ? body.capabilityIds.map(String) : undefined,
    assignmentKeys: Array.isArray(body.assignmentKeys) ? body.assignmentKeys.map(String) : undefined,
    workerKeys: readWorkerKeys(body.workerKeys),
    status: readStatus(body.status),
    metadata: readMetadata(body.metadata),
  };
  validateAgentInput(input);
  const capabilityIds = checkedCapabilityIds(input.capabilityIds ?? []);
  const assignmentKeys = normalizeAssignmentKeys(input.assignmentKeys ?? ["all"]);
  if (assignmentKeys.length === 0) throw new AgentValidationError("可见范围不能为空");
  return { ...input, capabilityIds, assignmentKeys, workerKeys: input.workerKeys ?? [] };
}

export async function preparePatchInput(request: Request): Promise<Partial<AgentInput>> {
  const body = await readJsonObject(request);
  const patch: Partial<AgentInput> = {};
  if (typeof body.slug === "string") patch.slug = body.slug;
  if (typeof body.displayName === "string") patch.displayName = body.displayName;
  if (body.description !== undefined) patch.description = readDescription(body.description);
  if (typeof body.systemPrompt === "string") patch.systemPrompt = body.systemPrompt;
  if (typeof body.model === "string") patch.model = body.model;
  if (body.runtime !== undefined) patch.runtime = readRuntime(body.runtime);
  if (body.status !== undefined) patch.status = readStatus(body.status);
  if (body.metadata !== undefined) patch.metadata = readMetadata(body.metadata);
  if (body.capabilityIds !== undefined) {
    if (!Array.isArray(body.capabilityIds)) throw new AgentValidationError("能力标识不合法");
    patch.capabilityIds = checkedCapabilityIds(body.capabilityIds.map(String));
  }
  if (body.assignmentKeys !== undefined) {
    if (!Array.isArray(body.assignmentKeys)) throw new AgentValidationError("可见范围不能为空");
    const keys = normalizeAssignmentKeys(body.assignmentKeys.map(String));
    if (keys.length === 0) throw new AgentValidationError("可见范围不能为空");
    patch.assignmentKeys = keys;
  }
  if (body.workerKeys !== undefined) {
    patch.workerKeys = readWorkerKeys(body.workerKeys) ?? [];
  }
  return patch;
}
