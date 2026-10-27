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
import { canonicalJson } from "@agenticx/core-api";
import { deriveProjectionCapabilityIds, type LegacyAgentFields } from "./agent-manifest-legacy";
import {
  AgentManifestInvalidError,
  ensureAgentVersionOneInTx,
  prepareManifestWithOps,
  updateAgentWithLegacyVersion,
  type AgentVersion,
} from "./agent-version-core";
import { peekTestAgents, withAgentVersionOps } from "./agent-version-ops";

export type AgentRuntime = "cloud" | "desktop_worker";
export type AgentStatus = "active" | "disabled";
export type AgentLifecycle = "draft" | "published" | "recalled";
export type AgentOrigin = "enterprise" | "employee";

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
  workerKeys: string[];
  status: AgentStatus;
  lifecycle: AgentLifecycle;
  origin: AgentOrigin;
  ownerUserId: string | null;
  localAvatarId: string | null;
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
  workerKeys?: string[];
  status?: AgentStatus;
  lifecycle?: AgentLifecycle;
  origin?: AgentOrigin;
  ownerUserId?: string | null;
  localAvatarId?: string | null;
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

export type AgentVersionRouting = "follow_latest" | "pinned";
export type EnterpriseAgentMa = {
  latestVersion: number;
  defaultEnvironmentId: string | null;
  versionRouting: AgentVersionRouting;
  pinnedVersion: number | null;
  /** 生效版本：pinned 且 pinnedVersion 非空时为 pinnedVersion，否则 latestVersion。 */
  effectiveVersion: number;
};
export type EnterpriseAgentWithMa = EnterpriseAgent & EnterpriseAgentMa;

export class AgentHasSessionsError extends Error {
  constructor(message = "该智能体已有托管会话，不能删除，请改为停用") {
    super(message);
    this.name = "AgentHasSessionsError";
  }
}

export function resolveEffectiveVersion(
  ma: Pick<EnterpriseAgentMa, "latestVersion" | "versionRouting" | "pinnedVersion">,
): number {
  return ma.versionRouting === "pinned" && ma.pinnedVersion != null ? ma.pinnedVersion : ma.latestVersion;
}

export type AgentMaSettingsPatch = {
  defaultEnvironmentId?: string | null;
  versionRouting?: AgentVersionRouting;
  pinnedVersion?: number | null;
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
// Crockford ULID，或连接器网关早期的标准 Base32 主键（含 I/L/O/U）。与 @agenticx/config 的 isCapabilityRowId 同一规则。
const CAPABILITY_ID_RE = /^(mcp|skill):(?:[0-9A-HJKMNP-TV-Z]{26}|[A-Z2-7]{26})$/;
const SYSTEM_PROMPT_MAX = 65536;
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
  workerKeys: unknown;
  status: string;
  lifecycle?: string;
  origin?: string;
  ownerUserId?: string | null;
  localAvatarId?: string | null;
  metadata: unknown;
  latestVersion?: unknown;
  defaultEnvironmentId?: string | null;
  versionRouting?: string;
  pinnedVersion?: unknown;
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

function asLifecycle(value: string | undefined): AgentLifecycle {
  if (value === "draft" || value === "recalled") return value;
  return "published";
}

function asOrigin(value: string | undefined): AgentOrigin {
  return value === "employee" ? "employee" : "enterprise";
}

export function isVisibleToEmployees(agent: Pick<EnterpriseAgent, "status" | "lifecycle">): boolean {
  return agent.status !== "disabled" && agent.lifecycle === "published";
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
    workerKeys: asStringArray(row.workerKeys),
    status: asStatus(row.status),
    lifecycle: asLifecycle(row.lifecycle),
    origin: asOrigin(row.origin),
    ownerUserId: row.ownerUserId ?? null,
    localAvatarId: row.localAvatarId ?? null,
    metadata: asMetadata(row.metadata),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function mapAgentWithMa(row: AgentRow): EnterpriseAgentWithMa {
  const latestVersion = Number(row.latestVersion ?? 1) || 1;
  const versionRouting: AgentVersionRouting = row.versionRouting === "pinned" ? "pinned" : "follow_latest";
  const pinnedVersion = row.pinnedVersion == null ? null : Number(row.pinnedVersion);
  return {
    ...mapAgent(row),
    latestVersion,
    defaultEnvironmentId: row.defaultEnvironmentId ?? null,
    versionRouting,
    pinnedVersion,
    effectiveVersion: resolveEffectiveVersion({ latestVersion, versionRouting, pinnedVersion }),
  };
}

function mapLockedWithMa(row: {
  id: string;
  tenantId: string;
  model: string;
  systemPrompt: string;
  capabilityIds: string[];
  metadata: Record<string, unknown>;
  runtime: string;
  latestVersion: number;
  versionRouting: string;
  pinnedVersion: number | null;
  defaultEnvironmentId: string | null;
}): EnterpriseAgentWithMa {
  return mapAgentWithMa({
    id: row.id,
    tenantId: row.tenantId,
    slug: "agent",
    displayName: "Agent",
    description: null,
    systemPrompt: row.systemPrompt,
    model: row.model,
    runtime: row.runtime,
    capabilityIds: row.capabilityIds,
    assignmentKeys: ["all"],
    workerKeys: [],
    status: "active",
    lifecycle: "published",
    origin: "enterprise",
    ownerUserId: null,
    localAvatarId: null,
    metadata: row.metadata,
    latestVersion: row.latestVersion,
    defaultEnvironmentId: row.defaultEnvironmentId,
    versionRouting: row.versionRouting,
    pinnedVersion: row.pinnedVersion,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  });
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

export function isForeignKeyViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const coded = current as { code?: string; errno?: number; cause?: unknown; message?: string };
    if (coded.code === "23503" || coded.code === "ER_ROW_IS_REFERENCED_2" || coded.errno === 1451) return true;
    if (
      typeof coded.message === "string" &&
      /violates foreign key constraint|ER_ROW_IS_REFERENCED|ma_sessions_agent_fk/i.test(coded.message)
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
  const lifecycle = input.lifecycle as string | undefined;
  if (lifecycle !== undefined && lifecycle !== "draft" && lifecycle !== "published" && lifecycle !== "recalled") {
    throw new AgentValidationError("生命周期不合法");
  }
  const origin = input.origin as string | undefined;
  if (origin !== undefined && origin !== "enterprise" && origin !== "employee") {
    throw new AgentValidationError("来源不合法");
  }
  if (input.systemPrompt !== undefined && input.systemPrompt.length > SYSTEM_PROMPT_MAX) {
    throw new AgentValidationError("系统提示词不能超过 65536 字");
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
  if (input.workerKeys !== undefined) {
    if (!Array.isArray(input.workerKeys)) throw new AgentValidationError("可承接执行的员工不合法");
    for (const raw of input.workerKeys) {
      if (!String(raw ?? "").trim()) throw new AgentValidationError("可承接执行的员工不合法");
    }
  }
  assertKnowledgeSearchUrl(input.metadata);
}

function assertKnowledgeSearchUrl(metadata: unknown): void {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return;
  const raw = (metadata as Record<string, unknown>).knowledgeSearchUrl;
  if (raw === undefined || raw === null || raw === "") return;
  if (typeof raw !== "string") throw new AgentValidationError("知识库地址不合法");
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new AgentValidationError("知识库地址不合法");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AgentValidationError("知识库地址不合法");
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
    workerKeys: dedupe(input.workerKeys ?? []),
    status: input.status ?? "active",
    lifecycle: input.lifecycle ?? "draft",
    origin: input.origin ?? "enterprise",
    ownerUserId: input.ownerUserId ?? null,
    localAvatarId: input.localAvatarId ?? null,
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

async function listRows(tenantId: string, status?: AgentStatus): Promise<AgentRow[]> {
  const rows = isMysql()
    ? await mysqlListAgents(tenantId, status)
    : await getIamDb()
        .select()
        .from(pgAgents)
        .where(
          status
            ? and(eq(pgAgents.tenantId, tenantId), eq(pgAgents.status, status))
            : eq(pgAgents.tenantId, tenantId),
        )
        .orderBy(desc(pgAgents.updatedAt));
  return rows as AgentRow[];
}

export async function listAgents(
  tenantId: string,
  opts?: { status?: AgentStatus },
): Promise<EnterpriseAgent[]> {
  return (await listRows(tenantId, opts?.status)).map(mapAgent);
}

export async function listAgentsWithMa(tenantId: string): Promise<EnterpriseAgentWithMa[]> {
  return (await listRows(tenantId)).map(mapAgentWithMa);
}

export async function getAgentWithMa(tenantId: string, id: string): Promise<EnterpriseAgentWithMa> {
  const testAgents = peekTestAgents(tenantId);
  if (testAgents) {
    const hit = testAgents.find((agent) => agent.id === id.trim());
    if (!hit) throw new AgentNotFoundError();
    return mapLockedWithMa(hit);
  }
  const row = await findRow(tenantId, id.trim());
  if (!row) throw new AgentNotFoundError();
  return mapAgentWithMa(row);
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
    workerKeys: patch.workerKeys ?? existing.workerKeys,
    status: patch.status ?? existing.status,
    lifecycle: patch.lifecycle ?? existing.lifecycle,
    origin: patch.origin ?? existing.origin,
    ownerUserId: patch.ownerUserId !== undefined ? patch.ownerUserId : existing.ownerUserId,
    localAvatarId: patch.localAvatarId !== undefined ? patch.localAvatarId : existing.localAvatarId,
    metadata: patch.metadata ?? existing.metadata,
  };
  validateAgentInput(merged);
  const normalized = normalizeForWrite(merged);
  const updatedAt = new Date();
  const manifestFieldsChanged =
    normalized.model !== existing.model ||
    normalized.systemPrompt !== existing.systemPrompt ||
    normalized.capabilityIds.join("\n") !== existing.capabilityIds.join("\n") ||
    (patch.metadata !== undefined && canonicalJson(normalized.metadata) !== canonicalJson(existing.metadata));
  if (manifestFieldsChanged) {
    const legacyFields: LegacyAgentFields = {
      model: merged.model,
      systemPrompt: merged.systemPrompt ?? normalized.systemPrompt,
      capabilityIds: merged.capabilityIds ?? normalized.capabilityIds,
      metadata: merged.metadata ?? normalized.metadata,
    };
    let outcome: "not_found" | "updated" | "versioned";
    try {
      outcome = await withAgentVersionOps((ops) =>
        updateAgentWithLegacyVersion(
          ops,
          tenantId,
          existing.id,
          { ...normalized, updatedAt },
          legacyFields,
          patch.metadata !== undefined,
        ),
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new AgentSlugConflictError();
      throw error;
    }
    if (outcome === "not_found") throw new AgentNotFoundError();
    return getAgent(tenantId, existing.id);
  }
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
  try {
    if (isMysql()) await mysqlDeleteAgent(tenantId, existing.id);
    else
      await getIamDb()
        .delete(pgAgents)
        .where(and(eq(pgAgents.tenantId, tenantId), eq(pgAgents.id, existing.id)));
  } catch (error) {
    if (isForeignKeyViolation(error)) throw new AgentHasSessionsError();
    throw error;
  }
}

function normalizeVersionNote(note: string | null | undefined): string | null {
  if (note == null) return null;
  const trimmed = note.trim();
  if (!trimmed) return null;
  if (trimmed.length > 500) throw new AgentValidationError("版本说明不能超过 500 字");
  return trimmed;
}

function parseRouting(value: string): AgentVersionRouting {
  if (value === "follow_latest" || value === "pinned") return value;
  throw new AgentValidationError("路由方式不合法");
}

export async function updateAgentMaSettings(
  tenantId: string,
  agentId: string,
  patch: AgentMaSettingsPatch,
): Promise<EnterpriseAgentWithMa> {
  if (patch.pinnedVersion !== undefined && patch.versionRouting === undefined) {
    throw new AgentValidationError("指定固定版本时须同时选择路由方式");
  }
  if (patch.versionRouting !== undefined) parseRouting(patch.versionRouting);
  await withAgentVersionOps(async (ops) => {
    const agent = await ops.lockAgent(tenantId, agentId);
    if (!agent) throw new AgentNotFoundError();
    const settings: {
      defaultEnvironmentId?: string | null;
      versionRouting?: string;
      pinnedVersion?: number | null;
    } = {};
    if (patch.versionRouting === "pinned") {
      if (!Number.isInteger(patch.pinnedVersion) || (patch.pinnedVersion ?? 0) < 1) {
        throw new AgentValidationError("请选择要固定的版本");
      }
      await ensureAgentVersionOneInTx(ops, agent);
      const pinned = patch.pinnedVersion as number;
      const found = await ops.findVersion(tenantId, agent.id, pinned);
      if (!found) throw new AgentValidationError("固定版本不存在");
      settings.versionRouting = "pinned";
      settings.pinnedVersion = pinned;
    } else if (patch.versionRouting === "follow_latest") {
      settings.versionRouting = "follow_latest";
      settings.pinnedVersion = null;
    }
    if (patch.defaultEnvironmentId !== undefined) {
      if (patch.defaultEnvironmentId === null || patch.defaultEnvironmentId.trim() === "") {
        settings.defaultEnvironmentId = null;
      } else {
        const env = await ops.findEnvironment(tenantId, patch.defaultEnvironmentId.trim());
        if (!env || env.status !== "active") throw new AgentValidationError("默认环境不存在或已停用");
        if (env.type !== agent.runtime) throw new AgentValidationError("默认环境类型与运行方式不一致");
        settings.defaultEnvironmentId = env.id;
      }
    }
    await ops.setMaSettings(tenantId, agent.id, settings, new Date());
  });
  return getAgentWithMa(tenantId, agentId);
}

export async function createAgentWithInitialVersion(
  tenantId: string,
  input: AgentInput,
  version: { manifest: unknown; note?: string | null; createdBy?: string | null; source: "admin" | "api" | "desktop" },
): Promise<{ agent: EnterpriseAgentWithMa; version: AgentVersion }> {
  const id = ulid();
  let created: AgentVersion | null = null;
  try {
    created = await withAgentVersionOps(async (ops) => {
      const prepared = await prepareManifestWithOps(ops, tenantId, version.manifest, { selfAgentId: id });
      if (!prepared.ok) throw new AgentManifestInvalidError(prepared.errors);
      const inputForWrite: AgentInput = {
        ...input,
        model: String(prepared.normalized.model ?? ""),
        systemPrompt: String(prepared.normalized.system ?? ""),
        capabilityIds: deriveProjectionCapabilityIds(prepared.normalized),
      };
      validateAgentInput(inputForWrite);
      const note = normalizeVersionNote(version.note);
      const normalized = normalizeForWrite(inputForWrite);
      const now = new Date();
      await ops.insertAgent({
        id,
        tenantId,
        ...normalized,
        latestVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      const row: AgentVersion = {
        id: ulid(),
        tenantId,
        agentId: id,
        version: 1,
        manifest: prepared.normalized,
        manifestHash: prepared.manifestHash,
        note,
        source: version.source,
        createdBy: version.createdBy ?? null,
        createdAt: now.toISOString(),
      };
      await ops.insertVersion(row);
      return row;
    });
  } catch (error) {
    if (error instanceof AgentManifestInvalidError) throw error;
    if (isUniqueViolation(error)) throw new AgentSlugConflictError();
    throw error;
  }
  if (!created) throw new AgentNotFoundError();
  return { agent: await getAgentWithMa(tenantId, id), version: created };
}

function employeeSlug(localAvatarId: string): string {
  const compact = localAvatarId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
  const slug = `e${compact}`;
  return slug.length >= 2 ? slug.slice(0, 63) : "employee-agent";
}

/** 员工在桌面创建或更新数字专家时登记到企业。回收后的记录不会被这次同步重新发布。 */
export async function registerEmployeeAgent(input: {
  tenantId: string;
  ownerUserId: string;
  localAvatarId: string;
  displayName: string;
  systemPrompt?: string;
  model?: string;
  description?: string | null;
}): Promise<EnterpriseAgent> {
  const localAvatarId = input.localAvatarId.trim();
  if (!localAvatarId) throw new AgentValidationError("本机分身标识不能为空");
  const agents = await listAgents(input.tenantId);
  const existing = agents.find(
    (agent) =>
      agent.origin === "employee" &&
      agent.ownerUserId === input.ownerUserId &&
      agent.localAvatarId === localAvatarId,
  );
  if (existing) {
    return updateAgent(input.tenantId, existing.id, {
      displayName: input.displayName,
      systemPrompt: input.systemPrompt ?? existing.systemPrompt,
      model: input.model?.trim() || existing.model,
      description: input.description,
    });
  }
  return createAgent(input.tenantId, {
    slug: employeeSlug(localAvatarId),
    displayName: input.displayName,
    systemPrompt: input.systemPrompt ?? "",
    model: input.model?.trim() || "local/default",
    description: input.description,
    runtime: "desktop_worker",
    assignmentKeys: [input.ownerUserId],
    workerKeys: [input.ownerUserId],
    lifecycle: "published",
    origin: "employee",
    ownerUserId: input.ownerUserId,
    localAvatarId,
  });
}

/** 门户和桌面用：已发布、未停用，且 assignment_keys 与 keys 有交集。 */
export async function listAgentsVisibleToKeys(
  tenantId: string,
  keys: string[],
): Promise<EnterpriseAgent[]> {
  const wanted = new Set(keys.map((key) => key.trim()).filter(Boolean));
  if (wanted.size === 0) return [];
  const agents = await listAgents(tenantId, { status: "active" });
  return agents.filter(
    (agent) => isVisibleToEmployees(agent) && agent.assignmentKeys.some((key) => wanted.has(key)),
  );
}
