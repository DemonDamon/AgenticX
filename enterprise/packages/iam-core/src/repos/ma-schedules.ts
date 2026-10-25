import {
  maScheduleRuns as pgRuns,
  maSchedules as pgSchedules,
} from "@agenticx/db-schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { ulid } from "ulid";

import { resolveDatabaseConfig } from "../database/config";
import { getIamDb } from "../db";
import { AgentNotFoundError, getAgent } from "./agents";
import { AgentVersionNotFoundError, getAgentVersion } from "./agent-versions";
import { MaCronValidationError, parseCron, validateTimezone } from "./ma-cron";
import { MaEnvironmentNotFoundError, getMaEnvironment } from "./ma-environments";
import {
  mysqlCountMaSchedules,
  mysqlDeleteMaSchedule,
  mysqlFindMaSchedule,
  mysqlFindMaScheduleByName,
  mysqlInsertMaSchedule,
  mysqlListDisabledMaScheduleIds,
  mysqlListEnabledMaSchedules,
  mysqlListMaScheduleRuns,
  mysqlListMaScheduleRunsForIds,
  mysqlListMaSchedules,
  mysqlUpdateMaSchedule,
} from "./mysql/ma-schedules";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SCHEDULE_KEYS = [
  "name",
  "description",
  "agent_id",
  "version_policy",
  "pinned_version",
  "environment_id",
  "cron",
  "timezone",
  "input_template",
  "vault_ids",
  "resources",
  "enabled",
  "misfire_grace_seconds",
] as const;
const RESOURCE_KEYS = ["type", "memory_store_id", "access"] as const;
const SCHEDULE_LIMIT = 100;

export type MaSchedule = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  agentId: string;
  versionPolicy: "follow_routing" | "pinned";
  pinnedVersion: number | null;
  environmentId: string | null;
  cron: string;
  timezone: string;
  inputTemplate: string;
  vaultIds: string[];
  resources: Record<string, unknown>[];
  runAsUserId: string;
  enabled: boolean;
  revision: number;
  misfireGraceSeconds: number;
  manualRunRequestedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MaScheduleRun = {
  id: string;
  scheduleId: string;
  scheduleRevision: number;
  trigger: "schedule" | "manual";
  scheduledFor: string;
  status: string;
  skipReason: string | null;
  sessionId: string | null;
  agentVersion: number | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type NormalizedScheduleInput = {
  name?: string;
  description?: string | null;
  agentId?: string;
  versionPolicy?: "follow_routing" | "pinned";
  pinnedVersion?: number | null;
  environmentId?: string | null;
  cron?: string;
  timezone?: string;
  inputTemplate?: string;
  vaultIds?: string[];
  resources?: Record<string, unknown>[];
  enabled?: boolean;
  misfireGraceSeconds?: number;
};

type ScheduleRow = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  agentId: string;
  versionPolicy: string;
  pinnedVersion: number | null;
  environmentId: string | null;
  cron: string;
  timezone: string;
  inputTemplate: string;
  vaultIds: unknown;
  resources: unknown;
  runAsUserId: string;
  enabled: unknown;
  revision: number | string;
  misfireGraceSeconds: number | string;
  manualRunRequestedAt: unknown;
  createdBy: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

type RunRow = {
  id: string;
  scheduleId: string;
  scheduleRevision: number | string;
  trigger: string;
  scheduledFor: unknown;
  status: string;
  skipReason: string | null;
  sessionId: string | null;
  agentVersion: number | string | null;
  error: string | null;
  startedAt: unknown;
  finishedAt: unknown;
  createdAt: unknown;
};

export class MaScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaScheduleValidationError";
  }
}

export class MaScheduleNotFoundError extends Error {
  constructor(message = "schedule not found") {
    super(message);
    this.name = "MaScheduleNotFoundError";
  }
}

export class MaScheduleNameConflictError extends Error {
  constructor(message = "name already exists") {
    super(message);
    this.name = "MaScheduleNameConflictError";
  }
}

export class MaScheduleLimitError extends Error {
  constructor(message = "a tenant can hold at most 100 schedules") {
    super(message);
    this.name = "MaScheduleLimitError";
  }
}

function isMysql(): boolean {
  return resolveDatabaseConfig().dialect === "mysql";
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) {
    const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return "";
}

function isoOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  const text = iso(value);
  return text || null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function asStringArray(value: unknown): string[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

function asResources(value: unknown): Record<string, unknown>[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item),
  );
}

function asFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function asInt(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const coded = current as { code?: string; errno?: number; cause?: unknown; message?: string };
    if (coded.code === "23505" || coded.code === "ER_DUP_ENTRY" || coded.errno === 1062) return true;
    if (typeof coded.message === "string" && /duplicate key|ER_DUP_ENTRY|ma_schedules_tenant_name_uq/i.test(coded.message)) {
      return true;
    }
    current = coded.cause;
  }
  return false;
}

function mapSchedule(row: ScheduleRow): MaSchedule {
  const policy = row.versionPolicy === "pinned" ? "pinned" : "follow_routing";
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    agentId: row.agentId,
    versionPolicy: policy,
    pinnedVersion: asInt(row.pinnedVersion),
    environmentId: row.environmentId,
    cron: row.cron,
    timezone: row.timezone,
    inputTemplate: row.inputTemplate,
    vaultIds: asStringArray(row.vaultIds),
    resources: asResources(row.resources),
    runAsUserId: row.runAsUserId,
    enabled: asFlag(row.enabled),
    revision: asInt(row.revision) ?? 1,
    misfireGraceSeconds: asInt(row.misfireGraceSeconds) ?? 300,
    manualRunRequestedAt: isoOrNull(row.manualRunRequestedAt),
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function mapRun(row: RunRow): MaScheduleRun {
  const trigger = row.trigger === "manual" ? "manual" : "schedule";
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    scheduleRevision: asInt(row.scheduleRevision) ?? 0,
    trigger,
    scheduledFor: iso(row.scheduledFor),
    status: row.status,
    skipReason: row.skipReason,
    sessionId: row.sessionId,
    agentVersion: asInt(row.agentVersion),
    error: row.error,
    startedAt: isoOrNull(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
    createdAt: iso(row.createdAt),
  };
}

function assertKnownKeys(body: Record<string, unknown>): void {
  for (const key of Object.keys(body)) {
    if (key === "run_as_user_id") throw new MaScheduleValidationError("run_as_user_id: is not allowed");
    if (!(SCHEDULE_KEYS as readonly string[]).includes(key)) {
      throw new MaScheduleValidationError(`${key}: is not allowed`);
    }
  }
}

function readName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new MaScheduleValidationError("name: is required");
  const name = value.trim();
  if (name.length > 120) throw new MaScheduleValidationError("name: is too long");
  return name;
}

function readDescription(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new MaScheduleValidationError("description: is invalid");
  if (value.length > 2000) throw new MaScheduleValidationError("description: is too long");
  return value;
}

function readPolicy(value: unknown): "follow_routing" | "pinned" {
  if (value == null) return "follow_routing";
  if (value !== "follow_routing" && value !== "pinned") {
    throw new MaScheduleValidationError("version_policy: is invalid");
  }
  return value;
}

function readPinned(value: unknown, policy: "follow_routing" | "pinned", present: boolean): number | null {
  if (!present) {
    if (policy === "pinned") throw new MaScheduleValidationError("pinned_version: is required");
    return null;
  }
  if (value == null) {
    if (policy === "pinned") throw new MaScheduleValidationError("pinned_version: is required");
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    if (policy !== "pinned") {
      throw new MaScheduleValidationError("pinned_version: must be null unless version_policy is pinned");
    }
    throw new MaScheduleValidationError("pinned_version: must be a positive integer");
  }
  if (policy !== "pinned") {
    throw new MaScheduleValidationError("pinned_version: must be null unless version_policy is pinned");
  }
  return value;
}

function readUlid(value: unknown, field: string, required: boolean): string | null {
  if (value == null || value === "") {
    if (required) throw new MaScheduleValidationError(`${field}: is required`);
    return null;
  }
  if (typeof value !== "string" || !ULID_RE.test(value)) throw new MaScheduleValidationError(`${field}: is invalid`);
  return value;
}

function readTemplate(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new MaScheduleValidationError("input_template: is required");
  if (new TextEncoder().encode(value).length > 16384) throw new MaScheduleValidationError("input_template: is too long");
  return value;
}

function readVaultIds(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new MaScheduleValidationError("vault_ids: is invalid");
  if (value.length > 20) throw new MaScheduleValidationError("vault_ids: at most 20 items");
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !ULID_RE.test(item)) throw new MaScheduleValidationError("vault_ids: is invalid");
    if (out.includes(item)) throw new MaScheduleValidationError("vault_ids: contains duplicates");
    out.push(item);
  }
  return out;
}

function readResources(value: unknown): Record<string, unknown>[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new MaScheduleValidationError("resources: is invalid");
  if (value.length > 8) throw new MaScheduleValidationError("resources: at most 8 items");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new MaScheduleValidationError("resources: is invalid");
    }
    const record = item as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!(RESOURCE_KEYS as readonly string[]).includes(key)) {
        throw new MaScheduleValidationError("resources: is invalid");
      }
    }
    if (record.type !== "memory_store") throw new MaScheduleValidationError("resources: is invalid");
    if (typeof record.memory_store_id !== "string" || !ULID_RE.test(record.memory_store_id)) {
      throw new MaScheduleValidationError("resources: is invalid");
    }
    const access = record.access ?? "read_write";
    if (access !== "read_only" && access !== "read_write") throw new MaScheduleValidationError("resources: is invalid");
    return { type: "memory_store", memory_store_id: record.memory_store_id, access };
  });
}

function readGrace(value: unknown): number {
  if (value == null) return 300;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 60 || value > 86400) {
    throw new MaScheduleValidationError("misfire_grace_seconds: must be between 60 and 86400");
  }
  return value;
}

function readEnabled(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "boolean") throw new MaScheduleValidationError("enabled: is invalid");
  return value;
}

export function normalizeScheduleInput(body: Record<string, unknown>, mode: "create" | "update"): NormalizedScheduleInput {
  assertKnownKeys(body);
  const input: NormalizedScheduleInput = {};
  if (mode === "create" || "name" in body) input.name = readName(body.name);
  if ("description" in body) input.description = readDescription(body.description);
  if (mode === "create" || "agent_id" in body) input.agentId = readUlid(body.agent_id, "agent_id", true) ?? undefined;
  const policyPresent = "version_policy" in body || mode === "create";
  const policy = policyPresent ? readPolicy(body.version_policy) : undefined;
  if (policy) input.versionPolicy = policy;
  if ("pinned_version" in body || (mode === "create" && policy === "pinned") || (policy === "follow_routing" && "pinned_version" in body)) {
    const effective = policy ?? "follow_routing";
    if (mode === "update" && !policy && "pinned_version" in body && body.pinned_version != null) {
      throw new MaScheduleValidationError("pinned_version: must be null unless version_policy is pinned");
    }
    if (policy === "pinned" && mode === "update" && !("pinned_version" in body)) {
      // Keep the stored version. The update path checks it is present.
    } else if (policy || "pinned_version" in body || mode === "create") {
      const pinnedPolicy = policy ?? "follow_routing";
      input.pinnedVersion = readPinned(body.pinned_version, pinnedPolicy, "pinned_version" in body || mode === "create");
    }
  }
  if (policy === "follow_routing") input.pinnedVersion = null;
  if ("environment_id" in body || mode === "create") {
    input.environmentId = readUlid(body.environment_id, "environment_id", false);
  }
  if (mode === "create" || "cron" in body) {
    if (typeof body.cron !== "string") throw new MaCronValidationError("cron: expected 5 fields");
    parseCron(body.cron);
    input.cron = body.cron.trim();
  }
  if (mode === "create" || "timezone" in body) {
    const raw = "timezone" in body ? body.timezone : "Asia/Shanghai";
    if (typeof raw !== "string") throw new MaCronValidationError("timezone: unknown time zone");
    input.timezone = validateTimezone(raw);
  }
  if (mode === "create" || "input_template" in body) input.inputTemplate = readTemplate(body.input_template);
  if ("vault_ids" in body || mode === "create") input.vaultIds = readVaultIds(body.vault_ids);
  if ("resources" in body || mode === "create") input.resources = readResources(body.resources);
  if ("enabled" in body || mode === "create") input.enabled = readEnabled(body.enabled);
  if ("misfire_grace_seconds" in body || mode === "create") input.misfireGraceSeconds = readGrace(body.misfire_grace_seconds);
  if (mode === "create" && input.versionPolicy === "pinned" && input.pinnedVersion == null) {
    throw new MaScheduleValidationError("pinned_version: is required");
  }
  return input;
}

async function assertRefs(
  tenantId: string,
  agentId: string,
  versionPolicy: "follow_routing" | "pinned",
  pinnedVersion: number | null,
  environmentId: string | null,
): Promise<void> {
  try {
    await getAgent(tenantId, agentId);
  } catch (error) {
    if (error instanceof AgentNotFoundError) throw new MaScheduleValidationError("agent_id: agent not found");
    throw error;
  }
  if (versionPolicy === "pinned") {
    if (pinnedVersion == null) throw new MaScheduleValidationError("pinned_version: is required");
    try {
      await getAgentVersion(tenantId, agentId, pinnedVersion);
    } catch (error) {
      if (error instanceof AgentVersionNotFoundError || error instanceof AgentNotFoundError) {
        throw new MaScheduleValidationError("pinned_version: version not found");
      }
      throw error;
    }
  }
  if (!environmentId) return;
  try {
    const environment = await getMaEnvironment(tenantId, environmentId);
    if (environment.status !== "active") {
      throw new MaScheduleValidationError("environment_id: environment is not active");
    }
  } catch (error) {
    if (error instanceof MaScheduleValidationError) throw error;
    if (error instanceof MaEnvironmentNotFoundError) {
      throw new MaScheduleValidationError("environment_id: environment not found");
    }
    throw error;
  }
}

async function findRow(tenantId: string, id: string): Promise<ScheduleRow | null> {
  if (isMysql()) return (await mysqlFindMaSchedule(tenantId, id)) as ScheduleRow | null;
  const rows = await getIamDb()
    .select()
    .from(pgSchedules)
    .where(and(eq(pgSchedules.tenantId, tenantId), eq(pgSchedules.id, id)))
    .limit(1);
  return (rows[0] as ScheduleRow | undefined) ?? null;
}

async function findByName(tenantId: string, name: string): Promise<ScheduleRow | null> {
  if (isMysql()) return (await mysqlFindMaScheduleByName(tenantId, name)) as ScheduleRow | null;
  const rows = await getIamDb()
    .select()
    .from(pgSchedules)
    .where(and(eq(pgSchedules.tenantId, tenantId), eq(pgSchedules.name, name)))
    .limit(1);
  return (rows[0] as ScheduleRow | undefined) ?? null;
}

async function countSchedules(tenantId: string): Promise<number> {
  if (isMysql()) return mysqlCountMaSchedules(tenantId);
  const rows = await getIamDb()
    .select({ n: sql<number>`count(*)` })
    .from(pgSchedules)
    .where(eq(pgSchedules.tenantId, tenantId));
  return Number(rows[0]?.n ?? 0);
}

async function assertNameAvailable(tenantId: string, name: string, exceptId?: string): Promise<void> {
  const existing = await findByName(tenantId, name);
  if (existing && existing.id !== exceptId) throw new MaScheduleNameConflictError();
}

export async function listMaSchedules(tenantId: string, filter?: { agentId?: string }): Promise<MaSchedule[]> {
  if (isMysql()) {
    const rows = (await mysqlListMaSchedules(tenantId, filter?.agentId)) as ScheduleRow[];
    return rows.map(mapSchedule);
  }
  const rows = await getIamDb()
    .select()
    .from(pgSchedules)
    .where(
      and(
        eq(pgSchedules.tenantId, tenantId),
        filter?.agentId ? eq(pgSchedules.agentId, filter.agentId) : undefined,
      ),
    )
    .orderBy(asc(pgSchedules.name));
  return (rows as ScheduleRow[]).map(mapSchedule);
}

export async function getMaSchedule(tenantId: string, id: string): Promise<MaSchedule> {
  const row = await findRow(tenantId, id);
  if (!row) throw new MaScheduleNotFoundError();
  return mapSchedule(row);
}

export async function createMaSchedule(
  tenantId: string,
  body: Record<string, unknown>,
  actorUserId: string,
): Promise<MaSchedule> {
  const input = normalizeScheduleInput(body, "create");
  if (!input.name || !input.agentId || !input.cron || !input.timezone || !input.inputTemplate || !input.versionPolicy) {
    throw new MaScheduleValidationError("name: is required");
  }
  await assertRefs(tenantId, input.agentId, input.versionPolicy, input.pinnedVersion ?? null, input.environmentId ?? null);
  if ((await countSchedules(tenantId)) >= SCHEDULE_LIMIT) throw new MaScheduleLimitError();
  await assertNameAvailable(tenantId, input.name);
  const now = new Date();
  const row = {
    id: ulid(),
    tenantId,
    name: input.name,
    description: input.description ?? null,
    agentId: input.agentId,
    versionPolicy: input.versionPolicy,
    pinnedVersion: input.pinnedVersion ?? null,
    environmentId: input.environmentId ?? null,
    cron: input.cron,
    timezone: input.timezone,
    inputTemplate: input.inputTemplate,
    vaultIds: input.vaultIds ?? [],
    resources: input.resources ?? [],
    runAsUserId: actorUserId,
    enabled: input.enabled ?? true,
    revision: 1,
    misfireGraceSeconds: input.misfireGraceSeconds ?? 300,
    manualRunRequestedAt: null,
    createdBy: actorUserId,
    createdAt: now,
    updatedAt: now,
  };
  try {
    if (isMysql()) await mysqlInsertMaSchedule(row);
    else await getIamDb().insert(pgSchedules).values(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new MaScheduleNameConflictError();
    throw error;
  }
  return getMaSchedule(tenantId, row.id);
}

export async function updateMaSchedule(
  tenantId: string,
  id: string,
  body: Record<string, unknown>,
): Promise<MaSchedule> {
  const current = await getMaSchedule(tenantId, id);
  const patch = normalizeScheduleInput(body, "update");
  const versionPolicy = patch.versionPolicy ?? current.versionPolicy;
  let pinnedVersion = patch.pinnedVersion === undefined ? current.pinnedVersion : patch.pinnedVersion;
  if (versionPolicy === "follow_routing") pinnedVersion = null;
  if (versionPolicy === "pinned" && pinnedVersion == null) {
    throw new MaScheduleValidationError("pinned_version: is required");
  }
  if (versionPolicy === "follow_routing" && pinnedVersion != null) {
    throw new MaScheduleValidationError("pinned_version: must be null unless version_policy is pinned");
  }
  const next = {
    name: patch.name ?? current.name,
    description: patch.description === undefined ? current.description : patch.description,
    agentId: patch.agentId ?? current.agentId,
    versionPolicy,
    pinnedVersion,
    environmentId: patch.environmentId === undefined ? current.environmentId : patch.environmentId,
    cron: patch.cron ?? current.cron,
    timezone: patch.timezone ?? current.timezone,
    inputTemplate: patch.inputTemplate ?? current.inputTemplate,
    vaultIds: patch.vaultIds ?? current.vaultIds,
    resources: patch.resources ?? current.resources,
    enabled: patch.enabled ?? current.enabled,
    misfireGraceSeconds: patch.misfireGraceSeconds ?? current.misfireGraceSeconds,
  };
  await assertRefs(tenantId, next.agentId, next.versionPolicy, next.pinnedVersion, next.environmentId);
  if (next.name !== current.name) await assertNameAvailable(tenantId, next.name, id);
  const values = { ...next, revision: current.revision + 1, updatedAt: new Date() };
  try {
    if (isMysql()) await mysqlUpdateMaSchedule(tenantId, id, values);
    else {
      await getIamDb()
        .update(pgSchedules)
        .set(values)
        .where(and(eq(pgSchedules.tenantId, tenantId), eq(pgSchedules.id, id)));
    }
  } catch (error) {
    if (isUniqueViolation(error)) throw new MaScheduleNameConflictError();
    throw error;
  }
  return getMaSchedule(tenantId, id);
}

export async function deleteMaSchedule(tenantId: string, id: string): Promise<void> {
  await getMaSchedule(tenantId, id);
  if (isMysql()) {
    await mysqlDeleteMaSchedule(tenantId, id);
    return;
  }
  await getIamDb().delete(pgSchedules).where(and(eq(pgSchedules.tenantId, tenantId), eq(pgSchedules.id, id)));
}

export async function requestMaScheduleRun(tenantId: string, id: string): Promise<MaSchedule> {
  await getMaSchedule(tenantId, id);
  const now = new Date();
  if (isMysql()) await mysqlUpdateMaSchedule(tenantId, id, { manualRunRequestedAt: now, updatedAt: now });
  else {
    await getIamDb()
      .update(pgSchedules)
      .set({ manualRunRequestedAt: now, updatedAt: now })
      .where(and(eq(pgSchedules.tenantId, tenantId), eq(pgSchedules.id, id)));
  }
  return getMaSchedule(tenantId, id);
}

export async function listEnabledMaSchedulesForRuntime(): Promise<{ enabled: MaSchedule[]; disabledIds: string[] }> {
  if (isMysql()) {
    const enabled = ((await mysqlListEnabledMaSchedules()) as ScheduleRow[]).map(mapSchedule);
    const disabledIds = await mysqlListDisabledMaScheduleIds();
    return { enabled, disabledIds };
  }
  const db = getIamDb();
  const enabledRows = await db.select().from(pgSchedules).where(eq(pgSchedules.enabled, true));
  const disabledRows = await db.select({ id: pgSchedules.id }).from(pgSchedules).where(eq(pgSchedules.enabled, false));
  return {
    enabled: (enabledRows as ScheduleRow[]).map(mapSchedule),
    disabledIds: disabledRows.map((row) => row.id),
  };
}

export async function listMaScheduleRuns(tenantId: string, scheduleId: string, limit: number): Promise<MaScheduleRun[]> {
  await getMaSchedule(tenantId, scheduleId);
  if (isMysql()) return ((await mysqlListMaScheduleRuns(tenantId, scheduleId, limit)) as RunRow[]).map(mapRun);
  const rows = await getIamDb()
    .select()
    .from(pgRuns)
    .where(and(eq(pgRuns.tenantId, tenantId), eq(pgRuns.scheduleId, scheduleId)))
    .orderBy(desc(pgRuns.scheduledFor))
    .limit(limit);
  return (rows as RunRow[]).map(mapRun);
}

export async function getMaScheduleRunSummary(
  tenantId: string,
  scheduleIds: string[],
): Promise<Map<string, { nextRunAt: string | null; lastRun: MaScheduleRun | null }>> {
  const summary = new Map<string, { nextRunAt: string | null; lastRun: MaScheduleRun | null }>();
  for (const id of scheduleIds) summary.set(id, { nextRunAt: null, lastRun: null });
  if (scheduleIds.length === 0) return summary;
  const schedules = isMysql()
    ? ((await mysqlListMaSchedules(tenantId)) as ScheduleRow[]).filter((row) => scheduleIds.includes(row.id))
    : ((await getIamDb()
        .select()
        .from(pgSchedules)
        .where(and(eq(pgSchedules.tenantId, tenantId), inArray(pgSchedules.id, scheduleIds)))) as ScheduleRow[]);
  const revisionById = new Map(schedules.map((row) => [row.id, asInt(row.revision) ?? 1]));
  const runRows = isMysql()
    ? ((await mysqlListMaScheduleRunsForIds(tenantId, scheduleIds)) as RunRow[])
    : ((await getIamDb()
        .select()
        .from(pgRuns)
        .where(and(eq(pgRuns.tenantId, tenantId), inArray(pgRuns.scheduleId, scheduleIds)))) as RunRow[]);
  const grouped = new Map<string, MaScheduleRun[]>();
  for (const row of runRows.map(mapRun)) {
    const list = grouped.get(row.scheduleId) ?? [];
    list.push(row);
    grouped.set(row.scheduleId, list);
  }
  for (const id of scheduleIds) {
    const runs = grouped.get(id) ?? [];
    const revision = revisionById.get(id);
    const next = runs
      .filter((run) => run.trigger === "schedule" && run.status === "scheduled" && run.scheduleRevision === revision)
      .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor))[0];
    const last = runs
      .filter((run) => run.status !== "scheduled")
      .sort((left, right) => right.scheduledFor.localeCompare(left.scheduledFor))[0];
    summary.set(id, { nextRunAt: next?.scheduledFor ?? null, lastRun: last ?? null });
  }
  return summary;
}
