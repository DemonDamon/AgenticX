/**
 * 企业 Agent 注册表（PG / MySQL 双方言）。
 *
 * 格式校验在这里完成。能力 id 是否是已登记的 Skill/MCP，由管理台路由再调
 * `assertCapabilityIds`——本包不依赖 admin-console。
 */

import { enterpriseAgents as pgAgents } from "@agenticx/db-schema";
import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";

import { resolveDatabaseConfig } from "../database/config";
import { getIamDb } from "../db";
import {
  mysqlDeleteAgent,
  mysqlFindAgent,
  mysqlFindAgentBySlug,
  mysqlInsertAgent,
  mysqlListAgents,
  mysqlUpdateAgent,
} from "./mysql/agents";

export type AgentRuntime = "cloud" | "desktop_worker";
export type AgentStatus = "active" | "disabled";

export type EnterpriseAgent = {
  id: string;
  tenantId: string;
  slug: string;
  displayName: string;
  description: string | null;
  systemPrompt: string;
  model: string;
  runtime: AgentRuntime;
  capabilityIds: string[];
  assignmentKeys: string[];
  status: AgentStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AgentInput = {
  slug: string;
  displayName: string;
  description?: string | null;
  systemPrompt?: string;
  model: string;
  runtime?: AgentRuntime;
  capabilityIds?: string[];
  assignmentKeys?: string[];
  status?: AgentStatus;
  metadata?: Record<string, unknown>;
};

export class AgentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentValidationError";
  }
}

export class AgentNotFoundError extends Error {
  constructor(message = "智能体不存在") {
    super(message);
    this.name = "AgentNotFoundError";
  }
}

export class AgentSlugConflictError extends Error {
  constructor(message = "标识已存在") {
    super(message);
    this.name = "AgentSlugConflictError";
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
// Crockford ULID，或连接器网关早期的标准 Base32 主键（含 I/L/O/U）。与 @agenticx/config 的 isCapabilityRowId 同一规则。
const CAPABILITY_ID_RE = /^(mcp|skill):(?:[0-9A-HJKMNP-TV-Z]{26}|[A-Z2-7]{26})$/;
const SYSTEM_PROMPT_MAX = 16000;
const MODEL_MAX = 160;

type AgentRow = {
  id: string;
  tenantId: string;
  slug: string;
  displayName: string;
  description: string | null;
  systemPrompt: string;
  model: string;
  runtime: string;
  capabilityIds: unknown;
  assignmentKeys: unknown;
  status: string;
  metadata: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};

function isMysql(): boolean {
  return resolveDatabaseConfig().dialect === "mysql";
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? "");
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string") {
    try {
      return asStringArray(JSON.parse(value) as unknown);
    } catch {
      return [];
    }
  }
  return [];
}

function asMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asMetadata(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asRuntime(value: string): AgentRuntime {
  return value === "desktop_worker" ? "desktop_worker" : "cloud";
}

function asStatus(value: string): AgentStatus {
  return value === "disabled" ? "disabled" : "active";
}

function dedupe(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = value.trim();
  return text ? text : null;
}

function mapAgent(row: AgentRow): EnterpriseAgent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    displayName: row.displayName,
    description: row.description ?? null,
    systemPrompt: row.systemPrompt ?? "",
    model: row.model,
    runtime: asRuntime(row.runtime),
    capabilityIds: asStringArray(row.capabilityIds),
    assignmentKeys: asStringArray(row.assignmentKeys),
    status: asStatus(row.status),
    metadata: asMetadata(row.metadata),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** drizzle 把驱动错误挂在 cause 上，PG 23505 / MySQL 1062 都要顺着链找。 */
function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const coded = current as { code?: string; errno?: number; cause?: unknown; message?: string };
    if (coded.code === "23505" || coded.code === "ER_DUP_ENTRY" || coded.errno === 1062) return true;
    if (
      typeof coded.message === "string" &&
      /duplicate key|ER_DUP_ENTRY|enterprise_agents_tenant_slug_uq/i.test(coded.message)
    ) {
      return true;
    }
    current = coded.cause;
  }
  return false;
}

export function validateAgentInput(input: AgentInput): void {
  const slug = String(input.slug ?? "").trim();
  if (!SLUG_RE.test(slug)) {
    throw new AgentValidationError("标识须为小写字母、数字或连字符，长度 2–63，且以字母或数字开头");
  }
  const displayName = String(input.displayName ?? "").trim();
  if (!displayName || displayName.length > 64) {
    throw new AgentValidationError("名称须为 1–64 个字符");
  }
  const model = String(input.model ?? "").trim();
  if (!model) throw new AgentValidationError("模型不能为空");
  if (model.length > MODEL_MAX) throw new AgentValidationError("模型标识过长");
  const runtime = input.runtime as string | undefined;
  if (runtime !== undefined && runtime !== "cloud" && runtime !== "desktop_worker") {
    throw new AgentValidationError("运行方式不合法");
  }
  const status = input.status as string | undefined;
  if (status !== undefined && status !== "active" && status !== "disabled") {
    throw new AgentValidationError("状态不合法");
  }
  if (input.systemPrompt !== undefined && input.systemPrompt.length > SYSTEM_PROMPT_MAX) {
    throw new AgentValidationError("系统提示词不能超过 16000 字");
  }
  if (input.capabilityIds !== undefined) {
    if (!Array.isArray(input.capabilityIds)) throw new AgentValidationError("能力标识不合法");
    for (const raw of input.capabilityIds) {
      if (!CAPABILITY_ID_RE.test(String(raw ?? "").trim())) {
        throw new AgentValidationError("能力标识不合法");
      }
    }
  }
  if (input.assignmentKeys !== undefined) {
    if (!Array.isArray(input.assignmentKeys)) throw new AgentValidationError("可见范围不能为空");
    const cleaned = input.assignmentKeys.map((key) => String(key ?? "").trim()).filter(Boolean);
    if (cleaned.length === 0) throw new AgentValidationError("可见范围不能为空");
  }
}

function normalizeForWrite(input: AgentInput) {
  return {
    slug: input.slug.trim(),
    displayName: input.displayName.trim(),
    description: normalizeDescription(input.description),
    systemPrompt: input.systemPrompt ?? "",
    model: input.model.trim(),
    runtime: input.runtime ?? "cloud",
    capabilityIds: dedupe(input.capabilityIds ?? []),
    assignmentKeys: dedupe(input.assignmentKeys ?? ["all"]),
    status: input.status ?? "active",
    metadata: asMetadata(input.metadata),
  };
}

async function findRow(tenantId: string, id: string): Promise<AgentRow | null> {
  if (isMysql()) return (await mysqlFindAgent(tenantId, id)) as AgentRow | null;
  const rows = await getIamDb()
    .select()
    .from(pgAgents)
    .where(and(eq(pgAgents.tenantId, tenantId), eq(pgAgents.id, id)))
    .limit(1);
  return (rows[0] as AgentRow | undefined) ?? null;
}

export async function listAgents(
  tenantId: string,
  opts?: { status?: AgentStatus },
): Promise<EnterpriseAgent[]> {
  const rows = isMysql()
    ? await mysqlListAgents(tenantId, opts?.status)
    : await getIamDb()
        .select()
        .from(pgAgents)
        .where(
          opts?.status
            ? and(eq(pgAgents.tenantId, tenantId), eq(pgAgents.status, opts.status))
            : eq(pgAgents.tenantId, tenantId),
        )
        .orderBy(desc(pgAgents.updatedAt));
  return (rows as AgentRow[]).map(mapAgent);
}

export async function getAgent(tenantId: string, id: string): Promise<EnterpriseAgent> {
  const row = await findRow(tenantId, id.trim());
  if (!row) throw new AgentNotFoundError();
  return mapAgent(row);
}

export async function getAgentBySlug(tenantId: string, slug: string): Promise<EnterpriseAgent | null> {
  const key = slug.trim();
  if (!key) return null;
  const row = isMysql()
    ? await mysqlFindAgentBySlug(tenantId, key)
    : (
        await getIamDb()
          .select()
          .from(pgAgents)
          .where(and(eq(pgAgents.tenantId, tenantId), eq(pgAgents.slug, key)))
          .limit(1)
      )[0];
  return row ? mapAgent(row as AgentRow) : null;
}

async function insertRow(row: ReturnType<typeof normalizeForWrite> & { id: string; tenantId: string; createdAt: Date; updatedAt: Date }): Promise<void> {
  try {
    if (isMysql()) await mysqlInsertAgent(row);
    else await getIamDb().insert(pgAgents).values(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new AgentSlugConflictError();
    throw error;
  }
}

export async function createAgent(tenantId: string, input: AgentInput): Promise<EnterpriseAgent> {
  validateAgentInput(input);
  const normalized = normalizeForWrite(input);
  const now = new Date();
  const id = ulid();
  await insertRow({ id, tenantId, ...normalized, createdAt: now, updatedAt: now });
  return getAgent(tenantId, id);
}

export async function updateAgent(
  tenantId: string,
  id: string,
  patch: Partial<AgentInput>,
): Promise<EnterpriseAgent> {
  const existing = await getAgent(tenantId, id);
  const merged: AgentInput = {
    slug: patch.slug ?? existing.slug,
    displayName: patch.displayName ?? existing.displayName,
    description: patch.description !== undefined ? patch.description : existing.description,
    systemPrompt: patch.systemPrompt ?? existing.systemPrompt,
    model: patch.model ?? existing.model,
    runtime: patch.runtime ?? existing.runtime,
    capabilityIds: patch.capabilityIds ?? existing.capabilityIds,
    assignmentKeys: patch.assignmentKeys ?? existing.assignmentKeys,
    status: patch.status ?? existing.status,
    metadata: patch.metadata ?? existing.metadata,
  };
  validateAgentInput(merged);
  const normalized = normalizeForWrite(merged);
  const updatedAt = new Date();
  try {
    if (isMysql()) await mysqlUpdateAgent(tenantId, existing.id, { ...normalized, updatedAt });
    else
      await getIamDb()
        .update(pgAgents)
        .set({ ...normalized, updatedAt })
        .where(and(eq(pgAgents.tenantId, tenantId), eq(pgAgents.id, existing.id)));
  } catch (error) {
    if (isUniqueViolation(error)) throw new AgentSlugConflictError();
    throw error;
  }
  return getAgent(tenantId, existing.id);
}

export async function deleteAgent(tenantId: string, id: string): Promise<void> {
  const existing = await getAgent(tenantId, id);
  if (isMysql()) await mysqlDeleteAgent(tenantId, existing.id);
  else
    await getIamDb()
      .delete(pgAgents)
      .where(and(eq(pgAgents.tenantId, tenantId), eq(pgAgents.id, existing.id)));
}

/** 门户用：status=active 且 assignment_keys 与 keys 有交集。 */
export async function listAgentsVisibleToKeys(
  tenantId: string,
  keys: string[],
): Promise<EnterpriseAgent[]> {
  const wanted = new Set(keys.map((key) => key.trim()).filter(Boolean));
  if (wanted.size === 0) return [];
  const agents = await listAgents(tenantId, { status: "active" });
  return agents.filter((agent) => agent.assignmentKeys.some((key) => wanted.has(key)));
}
