import { enterpriseAgents as pgAgents, maEnvironments as pgEnvironments, maSessions as pgSessions, maWorkItems as pgWorkItems } from "@agenticx/db-schema";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { ulid } from "ulid";

import { resolveDatabaseConfig } from "../database/config";
import { getIamDb } from "../db";
import {
  mysqlCountMaEnvironmentReferences,
  mysqlDeleteMaEnvironment,
  mysqlFindMaEnvironment,
  mysqlFindMaEnvironmentByLowerName,
  mysqlInsertMaEnvironment,
  mysqlListMaEnvironments,
  mysqlUpdateMaEnvironment,
} from "./mysql/ma-environments";

export type MaEnvironmentType = "cloud" | "desktop_worker";
export type MaEnvironmentStatus = "active" | "disabled";
export type CloudEnvConfig = {
  type: "cloud";
  sandbox_backend: "subprocess" | "docker" | "remote";
  image: string | null;
  egress_allow_domains: string[];
  idle_ttl_seconds: number;
};
export type DesktopWorkerEnvConfig = { type: "desktop_worker"; worker_keys: string[] };
export type MaEnvironmentConfig = CloudEnvConfig | DesktopWorkerEnvConfig;

export type MaEnvironment = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  type: MaEnvironmentType;
  config: MaEnvironmentConfig;
  status: MaEnvironmentStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MaEnvironmentInput = {
  name: string;
  description?: string | null;
  type: MaEnvironmentType;
  config?: Record<string, unknown>;
  status?: MaEnvironmentStatus;
};

export class MaEnvironmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaEnvironmentValidationError";
  }
}

export class MaEnvironmentNotFoundError extends Error {
  constructor(message = "环境不存在") {
    super(message);
    this.name = "MaEnvironmentNotFoundError";
  }
}

export class MaEnvironmentNameConflictError extends Error {
  constructor(message = "环境名称已存在") {
    super(message);
    this.name = "MaEnvironmentNameConflictError";
  }
}

export class MaEnvironmentInUseError extends Error {
  constructor(message = "环境仍被智能体或进行中的会话引用，不能删除") {
    super(message);
    this.name = "MaEnvironmentInUseError";
  }
}

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]{0,63}$/u;
const DOMAIN_RE = /^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+$/;
const CLOUD_KEYS = ["type", "sandbox_backend", "image", "egress_allow_domains", "idle_ttl_seconds"] as const;
const DESKTOP_KEYS = ["type", "worker_keys"] as const;

type EnvironmentRow = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  type: string;
  config: unknown;
  status: string;
  createdBy: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

function isMysql(): boolean {
  return resolveDatabaseConfig().dialect === "mysql";
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const coded = current as { code?: string; errno?: number; cause?: unknown; message?: string };
    if (coded.code === "23505" || coded.code === "ER_DUP_ENTRY" || coded.errno === 1062) return true;
    if (
      typeof coded.message === "string" &&
      /duplicate key|ER_DUP_ENTRY|ma_environments_tenant_name_uq/i.test(coded.message)
    ) {
      return true;
    }
    current = coded.cause;
  }
  return false;
}

function assertKnownKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new MaEnvironmentValidationError(`环境配置包含未知字段：${key}`);
    }
  }
}

function asType(value: string): MaEnvironmentType {
  if (value === "cloud" || value === "desktop_worker") return value;
  throw new MaEnvironmentValidationError("环境类型不合法");
}

function asStatus(value: string): MaEnvironmentStatus {
  if (value === "active" || value === "disabled") return value;
  throw new MaEnvironmentValidationError("环境状态不合法");
}

function normalizeCloud(record: Record<string, unknown>): CloudEnvConfig {
  assertKnownKeys(record, CLOUD_KEYS);
  const sandbox = "sandbox_backend" in record ? record.sandbox_backend : "docker";
  if (sandbox !== "subprocess" && sandbox !== "docker" && sandbox !== "remote") {
    throw new MaEnvironmentValidationError("沙箱后端不合法");
  }
  let image: string | null = null;
  if ("image" in record && record.image != null && record.image !== "") {
    if (typeof record.image !== "string" || record.image.length > 255) {
      throw new MaEnvironmentValidationError("镜像名称不合法");
    }
    image = record.image;
  }
  const domains = normalizeDomains("egress_allow_domains" in record ? record.egress_allow_domains : []);
  const idle = "idle_ttl_seconds" in record ? record.idle_ttl_seconds : 3600;
  if (typeof idle !== "number" || !Number.isInteger(idle) || idle < 60 || idle > 86400) {
    throw new MaEnvironmentValidationError("空闲回收时间须为 60–86400 秒之间的整数");
  }
  return {
    type: "cloud",
    sandbox_backend: sandbox,
    image,
    egress_allow_domains: domains,
    idle_ttl_seconds: idle,
  };
}

function normalizeDomains(raw: unknown): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new MaEnvironmentValidationError(`出站白名单格式不合法：${String(raw)}`);
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      throw new MaEnvironmentValidationError(`出站白名单格式不合法：${String(item)}`);
    }
    const value = item.trim().toLowerCase();
    if (!value || value.length > 253 || !DOMAIN_RE.test(value)) {
      throw new MaEnvironmentValidationError(`出站白名单格式不合法：${value || item}`);
    }
    if (!out.includes(value)) out.push(value);
  }
  if (out.length > 100) throw new MaEnvironmentValidationError("出站白名单最多 100 项");
  return out;
}

function normalizeDesktop(record: Record<string, unknown>): DesktopWorkerEnvConfig {
  assertKnownKeys(record, DESKTOP_KEYS);
  const raw = "worker_keys" in record ? record.worker_keys : [];
  if (!Array.isArray(raw)) throw new MaEnvironmentValidationError("可承接执行的员工不合法");
  const keys: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") throw new MaEnvironmentValidationError("可承接执行的员工不合法");
    const value = item.trim();
    if (!value) throw new MaEnvironmentValidationError("可承接执行的员工不合法");
    if (!keys.includes(value)) keys.push(value);
  }
  if (keys.length > 200) throw new MaEnvironmentValidationError("可承接执行的员工不合法");
  return { type: "desktop_worker", worker_keys: keys };
}

export function normalizeEnvironmentConfig(type: MaEnvironmentType, raw: unknown): MaEnvironmentConfig {
  const value = raw === undefined ? {} : parseJson(raw);
  if (!isRecord(value)) throw new MaEnvironmentValidationError("环境配置须为对象");
  if ("type" in value && value.type !== type) {
    throw new MaEnvironmentValidationError("环境配置类型与环境类型不一致");
  }
  switch (type) {
    case "cloud":
      return normalizeCloud(value);
    case "desktop_worker":
      return normalizeDesktop(value);
    default: {
      const _exhaustive: never = type;
      throw new MaEnvironmentValidationError(`环境类型不合法: ${String(_exhaustive)}`);
    }
  }
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

export function validateEnvironmentInput(input: MaEnvironmentInput): void {
  const name = String(input.name ?? "").trim();
  if (!NAME_RE.test(name)) {
    throw new MaEnvironmentValidationError("环境名称须为 1–64 个字符，可含中英文、数字、空格、下划线、点和连字符");
  }
  if (input.description != null && String(input.description).trim().length > 500) {
    throw new MaEnvironmentValidationError("环境描述不能超过 500 字");
  }
  if (input.type !== "cloud" && input.type !== "desktop_worker") {
    throw new MaEnvironmentValidationError("环境类型不合法");
  }
  if (input.status !== undefined && input.status !== "active" && input.status !== "disabled") {
    throw new MaEnvironmentValidationError("环境状态不合法");
  }
  normalizeEnvironmentConfig(input.type, input.config);
}

function mapEnvironment(row: EnvironmentRow): MaEnvironment {
  const type = asType(row.type);
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description ?? null,
    type,
    config: normalizeEnvironmentConfig(type, row.config),
    status: asStatus(row.status),
    createdBy: row.createdBy ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

async function countNumber(rows: Array<{ n: unknown }>): Promise<number> {
  return Number(rows[0]?.n ?? 0) || 0;
}

async function findRow(tenantId: string, id: string): Promise<EnvironmentRow | null> {
  if (isMysql()) return (await mysqlFindMaEnvironment(tenantId, id)) as EnvironmentRow | null;
  const rows = await getIamDb()
    .select()
    .from(pgEnvironments)
    .where(and(eq(pgEnvironments.tenantId, tenantId), eq(pgEnvironments.id, id)))
    .limit(1);
  return (rows[0] as EnvironmentRow | undefined) ?? null;
}

async function findByLowerName(tenantId: string, name: string): Promise<EnvironmentRow | null> {
  if (isMysql()) return (await mysqlFindMaEnvironmentByLowerName(tenantId, name)) as EnvironmentRow | null;
  const rows = await getIamDb()
    .select()
    .from(pgEnvironments)
    .where(and(eq(pgEnvironments.tenantId, tenantId), sql`lower(${pgEnvironments.name}) = ${name.toLowerCase()}`))
    .limit(1);
  return (rows[0] as EnvironmentRow | undefined) ?? null;
}

async function assertNameAvailable(tenantId: string, name: string, excludeId?: string): Promise<void> {
  const existing = await findByLowerName(tenantId, name);
  if (existing && existing.id !== excludeId) throw new MaEnvironmentNameConflictError();
}

export async function listMaEnvironments(
  tenantId: string,
  opts?: { status?: MaEnvironmentStatus; type?: MaEnvironmentType },
): Promise<MaEnvironment[]> {
  const rows = isMysql()
    ? await mysqlListMaEnvironments(tenantId, opts)
    : await getIamDb()
        .select()
        .from(pgEnvironments)
        .where(
          and(
            eq(pgEnvironments.tenantId, tenantId),
            opts?.status ? eq(pgEnvironments.status, opts.status) : undefined,
            opts?.type ? eq(pgEnvironments.type, opts.type) : undefined,
          ),
        )
        .orderBy(asc(pgEnvironments.name));
  return (rows as EnvironmentRow[]).map(mapEnvironment);
}

export async function getMaEnvironment(tenantId: string, id: string): Promise<MaEnvironment> {
  const row = await findRow(tenantId, id.trim());
  if (!row) throw new MaEnvironmentNotFoundError();
  return mapEnvironment(row);
}

export async function createMaEnvironment(
  tenantId: string,
  input: MaEnvironmentInput,
  createdBy: string | null,
): Promise<MaEnvironment> {
  validateEnvironmentInput(input);
  const name = input.name.trim();
  const config = normalizeEnvironmentConfig(input.type, input.config);
  await assertNameAvailable(tenantId, name);
  const now = new Date();
  const id = ulid();
  const row = {
    id,
    tenantId,
    name,
    description: normalizeDescription(input.description),
    type: input.type,
    config,
    status: input.status ?? "active",
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
  try {
    if (isMysql()) await mysqlInsertMaEnvironment(row);
    else await getIamDb().insert(pgEnvironments).values(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new MaEnvironmentNameConflictError();
    throw error;
  }
  return getMaEnvironment(tenantId, id);
}

/** type 不可改：patch 里出现 type 且与现值不同 → MaEnvironmentValidationError。 */
export async function updateMaEnvironment(
  tenantId: string,
  id: string,
  patch: Partial<MaEnvironmentInput>,
): Promise<MaEnvironment> {
  const existing = await getMaEnvironment(tenantId, id);
  if (patch.type !== undefined && patch.type !== existing.type) {
    throw new MaEnvironmentValidationError("环境类型创建后不能修改");
  }
  const merged: MaEnvironmentInput = {
    name: patch.name ?? existing.name,
    description: patch.description !== undefined ? patch.description : existing.description,
    type: existing.type,
    config: (patch.config ?? existing.config) as Record<string, unknown>,
    status: patch.status ?? existing.status,
  };
  validateEnvironmentInput(merged);
  const name = merged.name.trim();
  await assertNameAvailable(tenantId, name, existing.id);
  const updatedAt = new Date();
  const set = {
    name,
    description: normalizeDescription(merged.description),
    config: normalizeEnvironmentConfig(existing.type, merged.config),
    status: merged.status ?? existing.status,
    updatedAt,
  };
  try {
    if (isMysql()) await mysqlUpdateMaEnvironment(tenantId, existing.id, set);
    else
      await getIamDb()
        .update(pgEnvironments)
        .set(set)
        .where(and(eq(pgEnvironments.tenantId, tenantId), eq(pgEnvironments.id, existing.id)));
  } catch (error) {
    if (isUniqueViolation(error)) throw new MaEnvironmentNameConflictError();
    throw error;
  }
  return getMaEnvironment(tenantId, existing.id);
}

export async function countMaEnvironmentReferences(
  tenantId: string,
  id: string,
): Promise<{ agents: number; activeSessions: number; openWorkItems: number }> {
  if (isMysql()) return mysqlCountMaEnvironmentReferences(tenantId, id);
  const db = getIamDb();
  const agents = await countNumber(
    await db
      .select({ n: sql<number>`count(*)` })
      .from(pgAgents)
      .where(and(eq(pgAgents.tenantId, tenantId), eq(pgAgents.defaultEnvironmentId, id))),
  );
  const activeSessions = await countNumber(
    await db
      .select({ n: sql<number>`count(*)` })
      .from(pgSessions)
      .where(
        and(
          eq(pgSessions.tenantId, tenantId),
          eq(pgSessions.environmentId, id),
          notInArray(pgSessions.status, ["terminated", "archived"]),
        ),
      ),
  );
  const openWorkItems = await countNumber(
    await db
      .select({ n: sql<number>`count(*)` })
      .from(pgWorkItems)
      .where(
        and(
          eq(pgWorkItems.tenantId, tenantId),
          eq(pgWorkItems.environmentId, id),
          inArray(pgWorkItems.status, ["queued", "claimed", "running"]),
        ),
      ),
  );
  return { agents, activeSessions, openWorkItems };
}

export async function deleteMaEnvironment(tenantId: string, id: string): Promise<void> {
  const existing = await findRow(tenantId, id.trim());
  if (!existing) throw new MaEnvironmentNotFoundError();
  const refs = await countMaEnvironmentReferences(tenantId, existing.id);
  if (refs.agents > 0 || refs.activeSessions > 0 || refs.openWorkItems > 0) {
    throw new MaEnvironmentInUseError();
  }
  if (isMysql()) await mysqlDeleteMaEnvironment(tenantId, existing.id);
  else
    await getIamDb()
      .delete(pgEnvironments)
      .where(and(eq(pgEnvironments.tenantId, tenantId), eq(pgEnvironments.id, existing.id)));
}
