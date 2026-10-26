import { randomBytes } from "node:crypto";

import { MA_WEBHOOK_EVENT_TYPES, type MaWebhookEventType } from "@agenticx/core-api";
import { maCredentials as pgCredentials, maWebhookDeliveries as pgDeliveries, maWebhooks as pgWebhooks } from "@agenticx/db-schema";
import { and, desc, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import { ulid } from "ulid";

import { resolveDatabaseConfig } from "../database/config";
import { getIamDb } from "../db";
import { openSecretPayload, sealSecretPayload } from "../ma-vault-crypto";
import {
  mysqlCountMaWebhooks,
  mysqlDeleteMaWebhook,
  mysqlFindMaWebhook,
  mysqlFindMaWebhookByName,
  mysqlInsertMaWebhook,
  mysqlAutoDisableMaWebhook,
  mysqlListEnabledMaWebhooks,
  mysqlListExpiringCredentialRows,
  mysqlListMaWebhookDeliveries,
  mysqlListMaWebhooks,
  mysqlUpdateMaWebhook,
} from "./mysql/ma-webhooks";

export { MA_WEBHOOK_EVENT_TYPES };
export type { MaWebhookEventType };

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const WEBHOOK_KEYS = ["name", "description", "url", "event_types", "agent_ids", "sources", "include_result_text", "enabled"] as const;
const SESSION_SOURCES = ["portal", "desktop", "api", "schedule", "channel", "eval"] as const;
const WEBHOOK_LIMIT = 20;
const AUTO_DISABLE_REASONS = ["consecutive_failures", "gone"] as const;

export type MaWebhookDisableReason = (typeof AUTO_DISABLE_REASONS)[number];

export type MaWebhook = {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  url: string;
  eventTypes: string[];
  agentIds: string[];
  sources: string[];
  includeResultText: boolean;
  enabled: boolean;
  disabledReason: string | null;
  disabledAt: string | null;
  failureResetAt: string | null;
  secretRotatedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MaWebhookDelivery = {
  id: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  lastStatusCode: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

export type NormalizedWebhookInput = {
  name?: string;
  description?: string;
  url?: string;
  eventTypes?: string[];
  agentIds?: string[];
  sources?: string[];
  includeResultText?: boolean;
  enabled?: boolean;
};

type WebhookRow = {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  url: string;
  eventTypes: unknown;
  agentIds: unknown;
  sources: unknown;
  includeResultText: unknown;
  enabled: unknown;
  disabledReason?: string | null;
  disabledAt?: unknown;
  failureResetAt?: unknown;
  secretCiphertext: string;
  wrappedDek: string;
  kekId: string;
  secretRotatedAt: unknown;
  createdBy: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

type DeliveryRow = {
  id: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number | string;
  nextAttemptAt: unknown;
  lastStatusCode: number | string | null;
  lastError: string | null;
  deliveredAt: unknown;
  createdAt: unknown;
};

type CredentialRow = {
  id: string;
  tenantId: string;
  vaultId: string;
  type: string;
  displayName: string | null;
  status: string;
  expiresAt: unknown;
};

export class MaWebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaWebhookValidationError";
  }
}

export class MaWebhookNotFoundError extends Error {
  constructor(message = "webhook not found") {
    super(message);
    this.name = "MaWebhookNotFoundError";
  }
}

export class MaWebhookNameConflictError extends Error {
  constructor(message = "name already exists") {
    super(message);
    this.name = "MaWebhookNameConflictError";
  }
}

export class MaWebhookLimitError extends Error {
  constructor(message = "a tenant can hold at most 20 webhooks") {
    super(message);
    this.name = "MaWebhookLimitError";
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
    if (typeof coded.message === "string" && /duplicate key|ER_DUP_ENTRY|ma_webhooks_tenant_name_uq/i.test(coded.message)) {
      return true;
    }
    current = coded.cause;
  }
  return false;
}

function mapWebhook(row: WebhookRow): MaWebhook {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: typeof row.description === "string" ? row.description : "",
    url: row.url,
    eventTypes: asStringArray(row.eventTypes),
    agentIds: asStringArray(row.agentIds),
    sources: asStringArray(row.sources),
    includeResultText: asFlag(row.includeResultText),
    enabled: asFlag(row.enabled),
    disabledReason: typeof row.disabledReason === "string" && row.disabledReason ? row.disabledReason : null,
    disabledAt: isoOrNull(row.disabledAt),
    failureResetAt: isoOrNull(row.failureResetAt),
    secretRotatedAt: isoOrNull(row.secretRotatedAt),
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function mapDelivery(row: DeliveryRow): MaWebhookDelivery {
  return {
    id: row.id,
    webhookId: row.webhookId,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    attempts: asInt(row.attempts) ?? 0,
    nextAttemptAt: iso(row.nextAttemptAt),
    lastStatusCode: asInt(row.lastStatusCode),
    lastError: row.lastError,
    deliveredAt: isoOrNull(row.deliveredAt),
    createdAt: iso(row.createdAt),
  };
}

export function generateSigningSecret(): string {
  return `whsec_${randomBytes(32).toString("base64")}`;
}

export function expiryWindow(now: Date, withinHours: number): { after: Date; until: Date } {
  return { after: now, until: new Date(now.getTime() + withinHours * 3_600_000) };
}

/** Active credentials whose expiry is inside (now, now + withinHours]. */
export function credentialMatchesExpiryWindow(
  status: string,
  expiresAt: Date | null,
  now: Date,
  withinHours: number,
): boolean {
  if (status !== "active" || !expiresAt || Number.isNaN(expiresAt.getTime())) return false;
  const { after, until } = expiryWindow(now, withinHours);
  return expiresAt > after && expiresAt <= until;
}

function assertKnownKeys(body: Record<string, unknown>): void {
  for (const key of Object.keys(body)) {
    if (!(WEBHOOK_KEYS as readonly string[]).includes(key)) {
      throw new MaWebhookValidationError(`${key}: is not allowed`);
    }
  }
}

function readName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new MaWebhookValidationError("name: is required");
  const name = value.trim();
  if (name.length > 120) throw new MaWebhookValidationError("name: is too long");
  return name;
}

function readUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new MaWebhookValidationError("url: is required");
  const url = value.trim();
  if (url.length > 2048) throw new MaWebhookValidationError("url: is too long");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MaWebhookValidationError("url: is invalid");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new MaWebhookValidationError("url: must be http or https");
  }
  if (parsed.username || parsed.password) throw new MaWebhookValidationError("url: must not include credentials");
  if (parsed.hash) throw new MaWebhookValidationError("url: must not include a fragment");
  return url;
}

function readEventTypes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new MaWebhookValidationError("event_types: is required");
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !(MA_WEBHOOK_EVENT_TYPES as readonly string[]).includes(item)) {
      throw new MaWebhookValidationError("event_types: is invalid");
    }
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function readAgentIds(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new MaWebhookValidationError("agent_ids: is invalid");
  if (value.length > 50) throw new MaWebhookValidationError("agent_ids: at most 50 items");
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !ULID_RE.test(item)) throw new MaWebhookValidationError("agent_ids: is invalid");
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function readSources(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new MaWebhookValidationError("sources: is invalid");
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !(SESSION_SOURCES as readonly string[]).includes(item)) {
      throw new MaWebhookValidationError("sources: is invalid");
    }
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function readDescription(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new MaWebhookValidationError("description: is invalid");
  const description = value.trim();
  if (description.length > 2048) throw new MaWebhookValidationError("description: is too long");
  return description;
}

function readFlag(value: unknown, field: string, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (typeof value !== "boolean") throw new MaWebhookValidationError(`${field}: is invalid`);
  return value;
}

export function normalizeWebhookInput(body: Record<string, unknown>, mode: "create" | "update"): NormalizedWebhookInput {
  assertKnownKeys(body);
  const input: NormalizedWebhookInput = {};
  if (mode === "create" || "name" in body) input.name = readName(body.name);
  if (mode === "create" || "description" in body) input.description = readDescription(body.description);
  if (mode === "create" || "url" in body) input.url = readUrl(body.url);
  if (mode === "create" || "event_types" in body) input.eventTypes = readEventTypes(body.event_types);
  if ("agent_ids" in body || mode === "create") input.agentIds = readAgentIds(body.agent_ids);
  if ("sources" in body || mode === "create") input.sources = readSources(body.sources);
  if ("include_result_text" in body || mode === "create") {
    input.includeResultText = readFlag(body.include_result_text, "include_result_text", false);
  }
  if ("enabled" in body || mode === "create") input.enabled = readFlag(body.enabled, "enabled", true);
  return input;
}

async function findRow(tenantId: string, id: string): Promise<WebhookRow | null> {
  if (isMysql()) return (await mysqlFindMaWebhook(tenantId, id)) as WebhookRow | null;
  const rows = await getIamDb()
    .select()
    .from(pgWebhooks)
    .where(and(eq(pgWebhooks.tenantId, tenantId), eq(pgWebhooks.id, id)))
    .limit(1);
  return (rows[0] as WebhookRow | undefined) ?? null;
}

async function findByName(tenantId: string, name: string): Promise<WebhookRow | null> {
  if (isMysql()) return (await mysqlFindMaWebhookByName(tenantId, name)) as WebhookRow | null;
  const rows = await getIamDb()
    .select()
    .from(pgWebhooks)
    .where(and(eq(pgWebhooks.tenantId, tenantId), eq(pgWebhooks.name, name)))
    .limit(1);
  return (rows[0] as WebhookRow | undefined) ?? null;
}

async function countWebhooks(tenantId: string): Promise<number> {
  if (isMysql()) return mysqlCountMaWebhooks(tenantId);
  const rows = await getIamDb()
    .select({ n: sql<number>`count(*)` })
    .from(pgWebhooks)
    .where(eq(pgWebhooks.tenantId, tenantId));
  return Number(rows[0]?.n ?? 0);
}

async function assertNameAvailable(tenantId: string, name: string, exceptId?: string): Promise<void> {
  const existing = await findByName(tenantId, name);
  if (existing && existing.id !== exceptId) throw new MaWebhookNameConflictError();
}

function sealedColumns(secret: string) {
  const sealed = sealSecretPayload({ signing_secret: secret });
  return { secretCiphertext: sealed.ciphertext, wrappedDek: sealed.wrappedDek, kekId: sealed.kekId };
}

export async function listMaWebhooks(tenantId: string): Promise<MaWebhook[]> {
  if (isMysql()) return ((await mysqlListMaWebhooks(tenantId)) as WebhookRow[]).map(mapWebhook);
  const rows = await getIamDb().select().from(pgWebhooks).where(eq(pgWebhooks.tenantId, tenantId)).orderBy(desc(pgWebhooks.createdAt));
  return (rows as WebhookRow[]).map(mapWebhook);
}

export async function getMaWebhook(tenantId: string, id: string): Promise<MaWebhook> {
  const row = await findRow(tenantId, id);
  if (!row) throw new MaWebhookNotFoundError();
  return mapWebhook(row);
}

export async function createMaWebhook(
  tenantId: string,
  body: Record<string, unknown>,
  actorUserId: string,
): Promise<{ webhook: MaWebhook; signingSecret: string }> {
  const input = normalizeWebhookInput(body, "create");
  if (!input.name || !input.url || !input.eventTypes) throw new MaWebhookValidationError("name: is required");
  if ((await countWebhooks(tenantId)) >= WEBHOOK_LIMIT) throw new MaWebhookLimitError();
  await assertNameAvailable(tenantId, input.name);
  const signingSecret = generateSigningSecret();
  const now = new Date();
  const row = {
    id: ulid(),
    tenantId,
    name: input.name,
    description: input.description ?? "",
    url: input.url,
    eventTypes: input.eventTypes,
    agentIds: input.agentIds ?? [],
    sources: input.sources ?? [],
    includeResultText: input.includeResultText ?? false,
    enabled: input.enabled ?? true,
    ...sealedColumns(signingSecret),
    secretRotatedAt: now,
    createdBy: actorUserId,
    createdAt: now,
    updatedAt: now,
  };
  try {
    if (isMysql()) await mysqlInsertMaWebhook(row);
    else await getIamDb().insert(pgWebhooks).values(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new MaWebhookNameConflictError();
    throw error;
  }
  return { webhook: await getMaWebhook(tenantId, row.id), signingSecret };
}

export async function updateMaWebhook(tenantId: string, id: string, body: Record<string, unknown>): Promise<MaWebhook> {
  const current = await getMaWebhook(tenantId, id);
  const patch = normalizeWebhookInput(body, "update");
  const now = new Date();
  const enabled = patch.enabled ?? current.enabled;
  const reenabled = current.enabled === false && enabled === true;
  const next = {
    name: patch.name ?? current.name,
    description: patch.description ?? current.description,
    url: patch.url ?? current.url,
    eventTypes: patch.eventTypes ?? current.eventTypes,
    agentIds: patch.agentIds ?? current.agentIds,
    sources: patch.sources ?? current.sources,
    includeResultText: patch.includeResultText ?? current.includeResultText,
    enabled,
    ...(reenabled ? { disabledReason: null, disabledAt: null, failureResetAt: now } : {}),
    updatedAt: now,
  };
  if (next.name !== current.name) await assertNameAvailable(tenantId, next.name, id);
  try {
    if (isMysql()) await mysqlUpdateMaWebhook(tenantId, id, next);
    else {
      await getIamDb().update(pgWebhooks).set(next).where(and(eq(pgWebhooks.tenantId, tenantId), eq(pgWebhooks.id, id)));
    }
  } catch (error) {
    if (isUniqueViolation(error)) throw new MaWebhookNameConflictError();
    throw error;
  }
  return getMaWebhook(tenantId, id);
}

export async function autoDisableMaWebhook(
  tenantId: string,
  webhookId: string,
  reason: MaWebhookDisableReason,
): Promise<boolean> {
  if (!(AUTO_DISABLE_REASONS as readonly string[]).includes(reason)) {
    throw new MaWebhookValidationError("reason: is invalid");
  }
  const now = new Date();
  const patch = { enabled: false, disabledReason: reason, disabledAt: now, updatedAt: now };
  if (isMysql()) return mysqlAutoDisableMaWebhook(tenantId, webhookId, patch);
  const updated = await getIamDb()
    .update(pgWebhooks)
    .set(patch)
    .where(and(eq(pgWebhooks.tenantId, tenantId), eq(pgWebhooks.id, webhookId), eq(pgWebhooks.enabled, true)))
    .returning({ id: pgWebhooks.id });
  return updated.length > 0;
}

export async function rotateMaWebhookSecret(
  tenantId: string,
  id: string,
): Promise<{ webhook: MaWebhook; signingSecret: string }> {
  await getMaWebhook(tenantId, id);
  const signingSecret = generateSigningSecret();
  const now = new Date();
  const patch = { ...sealedColumns(signingSecret), secretRotatedAt: now, updatedAt: now };
  if (isMysql()) await mysqlUpdateMaWebhook(tenantId, id, patch);
  else {
    await getIamDb().update(pgWebhooks).set(patch).where(and(eq(pgWebhooks.tenantId, tenantId), eq(pgWebhooks.id, id)));
  }
  return { webhook: await getMaWebhook(tenantId, id), signingSecret };
}

export async function deleteMaWebhook(tenantId: string, id: string): Promise<void> {
  await getMaWebhook(tenantId, id);
  if (isMysql()) {
    await mysqlDeleteMaWebhook(tenantId, id);
    return;
  }
  await getIamDb().delete(pgWebhooks).where(and(eq(pgWebhooks.tenantId, tenantId), eq(pgWebhooks.id, id)));
}

export async function listEnabledMaWebhooksForRuntime(): Promise<
  Array<{
    id: string;
    tenantId: string;
    url: string;
    eventTypes: string[];
    agentIds: string[];
    sources: string[];
    includeResultText: boolean;
    failureResetAt: string | null;
    signingSecret: string;
  }>
> {
  const rows = isMysql()
    ? ((await mysqlListEnabledMaWebhooks()) as WebhookRow[])
    : ((await getIamDb().select().from(pgWebhooks).where(eq(pgWebhooks.enabled, true))) as WebhookRow[]);
  const out = [];
  for (const row of rows) {
    try {
      const opened = openSecretPayload({
        ciphertext: row.secretCiphertext,
        wrappedDek: row.wrappedDek,
        kekId: row.kekId,
      });
      const signingSecret = opened.signing_secret;
      if (typeof signingSecret !== "string" || !signingSecret) throw new Error("missing signing secret");
      const mapped = mapWebhook(row);
      out.push({
        id: mapped.id,
        tenantId: mapped.tenantId,
        url: mapped.url,
        eventTypes: mapped.eventTypes,
        agentIds: mapped.agentIds,
        sources: mapped.sources,
        includeResultText: mapped.includeResultText,
        failureResetAt: mapped.failureResetAt,
        signingSecret,
      });
    } catch {
      console.error("ma.webhook.decrypt_failed", row.id);
    }
  }
  return out;
}

export async function listMaWebhookDeliveries(
  tenantId: string,
  webhookId: string,
  limit: number,
): Promise<MaWebhookDelivery[]> {
  await getMaWebhook(tenantId, webhookId);
  if (isMysql()) return ((await mysqlListMaWebhookDeliveries(tenantId, webhookId, limit)) as DeliveryRow[]).map(mapDelivery);
  const rows = await getIamDb()
    .select()
    .from(pgDeliveries)
    .where(and(eq(pgDeliveries.tenantId, tenantId), eq(pgDeliveries.webhookId, webhookId)))
    .orderBy(desc(pgDeliveries.createdAt))
    .limit(limit);
  return (rows as DeliveryRow[]).map(mapDelivery);
}

export async function listExpiringMaCredentials(
  withinHours: number,
  now: Date = new Date(),
): Promise<
  Array<{
    tenantId: string;
    vaultId: string;
    credentialId: string;
    credentialType: string;
    displayName: string | null;
    expiresAt: string;
  }>
> {
  const { after, until } = expiryWindow(now, withinHours);
  const rows = isMysql()
    ? ((await mysqlListExpiringCredentialRows(after, until)) as CredentialRow[])
    : ((await getIamDb()
        .select({
          id: pgCredentials.id,
          tenantId: pgCredentials.tenantId,
          vaultId: pgCredentials.vaultId,
          type: pgCredentials.type,
          displayName: pgCredentials.displayName,
          status: pgCredentials.status,
          expiresAt: pgCredentials.expiresAt,
        })
        .from(pgCredentials)
        .where(
          and(
            eq(pgCredentials.status, "active"),
            isNotNull(pgCredentials.expiresAt),
            gt(pgCredentials.expiresAt, after),
            lte(pgCredentials.expiresAt, until),
          ),
        )) as CredentialRow[]);
  return rows
    .filter((row) => {
      const expires = row.expiresAt instanceof Date ? row.expiresAt : new Date(iso(row.expiresAt));
      return credentialMatchesExpiryWindow(row.status, expires, now, withinHours);
    })
    .map((row) => ({
      tenantId: row.tenantId,
      vaultId: row.vaultId,
      credentialId: row.id,
      credentialType: row.type,
      displayName: row.displayName,
      expiresAt: iso(row.expiresAt),
    }));
}
