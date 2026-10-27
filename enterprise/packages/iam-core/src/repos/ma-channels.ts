import { maChannelConversations, maChannelRuntimeState, maChannels, maCredentials, maVaults } from "@agenticx/db-schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { ulid } from "ulid";

import { resolveDatabaseConfig } from "../database/config";
import { getIamDb } from "../db";
import { openSecretPayload, type SealedSecret } from "../ma-vault-crypto";
import { AgentNotFoundError, getAgent } from "./agents";
import { AgentVersionNotFoundError, getAgentVersion } from "./agent-versions";
import { insertAuditEvent } from "./audit";
import { MaEnvironmentNotFoundError, getMaEnvironment } from "./ma-environments";
import {
  mysqlCountMaChannels,
  mysqlDeleteMaChannel,
  mysqlFindMaChannel,
  mysqlFindMaChannelByApp,
  mysqlFindMaChannelByName,
  mysqlInsertMaChannel,
  mysqlListEnabledMaChannels,
  mysqlListMaChannelConversations,
  mysqlListMaChannels,
  mysqlListRuntimeStates,
  mysqlLoadChannelCredential,
  mysqlUpdateMaChannel,
} from "./mysql/ma-channels";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const APP_ID_RE = /^cli_[A-Za-z0-9]{6,60}$/;
const OPEN_BASES = ["https://open.feishu.cn", "https://open.larksuite.com"] as const;
const CHANNEL_KEYS = [
  "name",
  "platform",
  "agent_id",
  "routing",
  "pinned_version",
  "environment_id",
  "app_id",
  "credential",
  "config",
  "enabled",
] as const;
const CONFIG_KEYS = ["idle_reset_hours", "open_base_url"] as const;
const CREDENTIAL_KEYS = ["vault_id", "credential_id"] as const;
const CHANNEL_LIMIT = 20;
const CONNECTION_STATUSES = ["pending", "starting", "running", "error", "stopped"] as const;

export type MaChannelRouting = "follow_latest" | "pinned";
export type MaChannelConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export type MaChannelConfig = {
  idle_reset_hours: number;
  open_base_url: string;
};

export type MaChannel = {
  id: string;
  tenantId: string;
  name: string;
  platform: "feishu";
  agentId: string;
  routing: MaChannelRouting;
  pinnedVersion: number | null;
  environmentId: string | null;
  appId: string;
  credentialVaultId: string;
  credentialId: string;
  ownerUserId: string;
  config: MaChannelConfig;
  enabled: boolean;
  revision: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MaChannelConnection = {
  status: MaChannelConnectionStatus;
  lastError: string | null;
  lastEventAt: string | null;
  startedAt: string | null;
};

export type MaChannelConversation = {
  conversationKey: string;
  conversationType: string;
  sessionId: string;
  agentVersion: number;
  lastMessageAt: string;
};

export type NormalizedChannelInput = {
  name?: string;
  platform?: "feishu";
  agentId?: string;
  routing?: MaChannelRouting;
  pinnedVersion?: number | null;
  environmentId?: string | null;
  appId?: string;
  credential?: { vaultId: string; credentialId: string };
  config?: MaChannelConfig;
  enabled?: boolean;
};

type ChannelRow = {
  id: string;
  tenantId: string;
  name: string;
  platform: string;
  agentId: string;
  routing: string;
  pinnedVersion: number | string | null;
  environmentId: string | null;
  appId: string;
  credentialVaultId: string;
  credentialId: string;
  ownerUserId: string;
  config: unknown;
  enabled: unknown;
  revision: number | string;
  createdBy: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

type StateRow = {
  channelId: string | null;
  revision: number | string | null;
  status: string | null;
  lastError: string | null;
  lastEventAt: unknown;
  startedAt: unknown;
};

type CredentialMaterial = {
  type: string;
  status: string;
  vaultStatus: string;
  ciphertext: string | null;
  wrappedDek: string | null;
  kekId: string | null;
};

export class MaChannelValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaChannelValidationError";
  }
}

export class MaChannelNotFoundError extends Error {
  constructor(message = "channel not found") {
    super(message);
    this.name = "MaChannelNotFoundError";
  }
}

export class MaChannelConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaChannelConflictError";
  }
}

export class MaChannelLimitError extends Error {
  constructor(message = "a tenant can hold at most 20 channels") {
    super(message);
    this.name = "MaChannelLimitError";
  }
}

export class MaChannelCredentialUnavailableError extends Error {
  constructor(message = "channel credential is unavailable") {
    super(message);
    this.name = "MaChannelCredentialUnavailableError";
  }
}

function isMysql(): boolean {
  return resolveDatabaseConfig().dialect === "mysql";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    if (typeof coded.message === "string" && /duplicate key|ER_DUP_ENTRY|ma_channels_tenant_/i.test(coded.message)) {
      return true;
    }
    current = coded.cause;
  }
  return false;
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const coded = current as { message?: string; cause?: unknown };
    if (typeof coded.message === "string") parts.push(coded.message);
    current = coded.cause;
  }
  return parts.join(" ");
}

function conflictFrom(error: unknown): MaChannelConflictError | null {
  if (!isUniqueViolation(error)) return null;
  if (/ma_channels_tenant_app_uq/i.test(errorText(error))) {
    return new MaChannelConflictError("app_id is already bound to another channel");
  }
  return new MaChannelConflictError("name already exists");
}

function asConfig(value: unknown): MaChannelConfig {
  const parsed = parseJson(value);
  const record = isRecord(parsed) ? parsed : {};
  const hours = typeof record.idle_reset_hours === "number" ? record.idle_reset_hours : Number(record.idle_reset_hours);
  const base = record.open_base_url === "https://open.larksuite.com" ? "https://open.larksuite.com" : "https://open.feishu.cn";
  return {
    idle_reset_hours: Number.isInteger(hours) ? hours : 24,
    open_base_url: base,
  };
}

function mapChannel(row: ChannelRow): MaChannel {
  const routing: MaChannelRouting = row.routing === "pinned" ? "pinned" : "follow_latest";
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    platform: "feishu",
    agentId: row.agentId,
    routing,
    pinnedVersion: asInt(row.pinnedVersion),
    environmentId: row.environmentId,
    appId: row.appId,
    credentialVaultId: row.credentialVaultId,
    credentialId: row.credentialId,
    ownerUserId: row.ownerUserId,
    config: asConfig(row.config),
    enabled: asFlag(row.enabled),
    revision: asInt(row.revision) ?? 1,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function isConnectionStatus(value: string): value is MaChannelConnectionStatus {
  return (CONNECTION_STATUSES as readonly string[]).includes(value);
}

function connectionOf(channelRevision: number, state: StateRow | null): MaChannelConnection {
  if (!state || !state.channelId) {
    return { status: "pending", lastError: null, lastEventAt: null, startedAt: null };
  }
  const revision = asInt(state.revision) ?? 0;
  const raw = state.status ?? "";
  const status: MaChannelConnectionStatus =
    revision < channelRevision || !isConnectionStatus(raw) ? "pending" : raw;
  return {
    status,
    lastError: state.lastError ?? null,
    lastEventAt: isoOrNull(state.lastEventAt),
    startedAt: isoOrNull(state.startedAt),
  };
}

function assertKnownKeys(body: Record<string, unknown>): void {
  for (const key of Object.keys(body)) {
    if (key === "owner_user_id") throw new MaChannelValidationError("owner_user_id: is not allowed");
    if (!(CHANNEL_KEYS as readonly string[]).includes(key)) {
      throw new MaChannelValidationError(`${key}: is not allowed`);
    }
  }
}

function readName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new MaChannelValidationError("name: is required");
  const name = value.trim();
  if (name.length > 120) throw new MaChannelValidationError("name: is too long");
  return name;
}

function readPlatform(value: unknown): "feishu" {
  if (value == null) return "feishu";
  if (value !== "feishu") throw new MaChannelValidationError("platform: is invalid");
  return "feishu";
}

function readRouting(value: unknown): MaChannelRouting {
  if (value == null) return "follow_latest";
  if (value !== "follow_latest" && value !== "pinned") throw new MaChannelValidationError("routing: is invalid");
  return value;
}

function readPinned(value: unknown, routing: MaChannelRouting, present: boolean): number | null {
  if (!present || value == null) {
    if (routing === "pinned") throw new MaChannelValidationError("pinned_version: is required");
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    if (routing !== "pinned") {
      throw new MaChannelValidationError("pinned_version: must be null unless routing is pinned");
    }
    throw new MaChannelValidationError("pinned_version: must be a positive integer");
  }
  if (routing !== "pinned") {
    throw new MaChannelValidationError("pinned_version: must be null unless routing is pinned");
  }
  return value;
}

function readUlid(value: unknown, field: string, required: boolean): string | null {
  if (value == null || value === "") {
    if (required) throw new MaChannelValidationError(`${field}: is required`);
    return null;
  }
  if (typeof value !== "string" || !ULID_RE.test(value)) throw new MaChannelValidationError(`${field}: is invalid`);
  return value;
}

function readAppId(value: unknown): string {
  if (typeof value !== "string" || !APP_ID_RE.test(value)) throw new MaChannelValidationError("app_id: is invalid");
  return value;
}

function readCredential(value: unknown, required: boolean): { vaultId: string; credentialId: string } | undefined {
  if (value == null) {
    if (required) throw new MaChannelValidationError("credential: is required");
    return undefined;
  }
  if (!isRecord(value)) throw new MaChannelValidationError("credential: is invalid");
  for (const key of Object.keys(value)) {
    if (!(CREDENTIAL_KEYS as readonly string[]).includes(key)) {
      throw new MaChannelValidationError(`credential.${key}: is not allowed`);
    }
  }
  const vaultId = readUlid(value.vault_id, "credential.vault_id", true);
  const credentialId = readUlid(value.credential_id, "credential.credential_id", true);
  if (!vaultId || !credentialId) throw new MaChannelValidationError("credential: is required");
  return { vaultId, credentialId };
}

function readConfig(value: unknown, fillDefaults: boolean): MaChannelConfig | undefined {
  if (value == null) {
    if (!fillDefaults) return undefined;
    return { idle_reset_hours: 24, open_base_url: "https://open.feishu.cn" };
  }
  if (!isRecord(value)) throw new MaChannelValidationError("config: is invalid");
  for (const key of Object.keys(value)) {
    if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
      throw new MaChannelValidationError(`config.${key}: is not allowed`);
    }
  }
  let hours = 24;
  if ("idle_reset_hours" in value) {
    const raw = value.idle_reset_hours;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 720) {
      throw new MaChannelValidationError("config.idle_reset_hours: must be an integer between 1 and 720");
    }
    hours = raw;
  }
  let base: MaChannelConfig["open_base_url"] = "https://open.feishu.cn";
  if ("open_base_url" in value) {
    if (value.open_base_url !== OPEN_BASES[0] && value.open_base_url !== OPEN_BASES[1]) {
      throw new MaChannelValidationError("config.open_base_url: is invalid");
    }
    base = value.open_base_url;
  }
  return { idle_reset_hours: hours, open_base_url: base };
}

function readEnabled(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "boolean") throw new MaChannelValidationError("enabled: is invalid");
  return value;
}

export function normalizeChannelInput(body: Record<string, unknown>, mode: "create" | "update"): NormalizedChannelInput {
  assertKnownKeys(body);
  if (mode === "update" && "app_id" in body) throw new MaChannelValidationError("app_id: is immutable");
  const input: NormalizedChannelInput = {};
  if (mode === "create" || "name" in body) input.name = readName(body.name);
  if (mode === "create" || "platform" in body) input.platform = readPlatform(body.platform);
  if (mode === "create" || "agent_id" in body) input.agentId = readUlid(body.agent_id, "agent_id", true) ?? undefined;
  const routing = mode === "create" || "routing" in body ? readRouting(body.routing) : undefined;
  if (routing) input.routing = routing;
  if ("pinned_version" in body || routing === "pinned" || routing === "follow_latest" || mode === "create") {
    const effective = routing ?? "follow_latest";
    if (mode === "update" && !routing && "pinned_version" in body && body.pinned_version != null) {
      throw new MaChannelValidationError("pinned_version: must be null unless routing is pinned");
    }
    if (routing === "pinned" && mode === "update" && !("pinned_version" in body)) {
      // The stored version is checked by updateMaChannel.
    } else if (routing || "pinned_version" in body || mode === "create") {
      input.pinnedVersion = readPinned(body.pinned_version, effective, "pinned_version" in body || mode === "create");
    }
  }
  if (routing === "follow_latest") input.pinnedVersion = null;
  if ("environment_id" in body || mode === "create") {
    input.environmentId = readUlid(body.environment_id, "environment_id", false);
  }
  if (mode === "create") input.appId = readAppId(body.app_id);
  if ("credential" in body || mode === "create") input.credential = readCredential(body.credential, mode === "create");
  if ("config" in body || mode === "create") input.config = readConfig(body.config, mode === "create");
  if ("enabled" in body || mode === "create") input.enabled = readEnabled(body.enabled);
  if (mode === "create" && input.routing === "pinned" && input.pinnedVersion == null) {
    throw new MaChannelValidationError("pinned_version: is required");
  }
  return input;
}

async function assertRefs(
  tenantId: string,
  agentId: string,
  routing: MaChannelRouting,
  pinnedVersion: number | null,
  environmentId: string | null,
): Promise<void> {
  try {
    await getAgent(tenantId, agentId);
  } catch (error) {
    if (error instanceof AgentNotFoundError) throw new MaChannelValidationError("agent_id: agent not found");
    throw error;
  }
  if (routing === "pinned") {
    if (pinnedVersion == null) throw new MaChannelValidationError("pinned_version: is required");
    try {
      await getAgentVersion(tenantId, agentId, pinnedVersion);
    } catch (error) {
      if (error instanceof AgentVersionNotFoundError || error instanceof AgentNotFoundError) {
        throw new MaChannelValidationError("pinned_version: version not found");
      }
      throw error;
    }
  }
  if (!environmentId) return;
  try {
    const environment = await getMaEnvironment(tenantId, environmentId);
    if (environment.status !== "active") {
      throw new MaChannelValidationError("environment_id: environment is not active");
    }
  } catch (error) {
    if (error instanceof MaChannelValidationError) throw error;
    if (error instanceof MaEnvironmentNotFoundError) {
      throw new MaChannelValidationError("environment_id: environment not found");
    }
    throw error;
  }
}

async function loadChannelCredential(
  tenantId: string,
  vaultId: string,
  credentialId: string,
): Promise<CredentialMaterial | null> {
  if (isMysql()) return mysqlLoadChannelCredential(tenantId, vaultId, credentialId);
  const rows = await getIamDb()
    .select({
      type: maCredentials.type,
      status: maCredentials.status,
      vaultStatus: maVaults.status,
      ciphertext: maCredentials.secretCiphertext,
      wrappedDek: maCredentials.wrappedDek,
      kekId: maCredentials.kekId,
    })
    .from(maCredentials)
    .innerJoin(maVaults, eq(maCredentials.vaultId, maVaults.id))
    .where(
      and(
        eq(maCredentials.tenantId, tenantId),
        eq(maCredentials.id, credentialId),
        eq(maCredentials.vaultId, vaultId),
        eq(maVaults.tenantId, tenantId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function sealOf(row: CredentialMaterial): SealedSecret | null {
  if (row.type !== "environment_variable" || row.status !== "active" || row.vaultStatus !== "active") return null;
  if (!row.ciphertext || !row.wrappedDek || !row.kekId) return null;
  return { ciphertext: row.ciphertext, wrappedDek: row.wrappedDek, kekId: row.kekId };
}

async function assertActiveCredential(tenantId: string, vaultId: string, credentialId: string): Promise<void> {
  const row = await loadChannelCredential(tenantId, vaultId, credentialId);
  if (!row || !sealOf(row)) {
    throw new MaChannelValidationError("credential: must reference an active environment_variable credential");
  }
}

async function findRow(tenantId: string, id: string): Promise<ChannelRow | null> {
  if (isMysql()) return (await mysqlFindMaChannel(tenantId, id)) as ChannelRow | null;
  const rows = await getIamDb()
    .select()
    .from(maChannels)
    .where(and(eq(maChannels.tenantId, tenantId), eq(maChannels.id, id)))
    .limit(1);
  return (rows[0] as ChannelRow | undefined) ?? null;
}

async function findByName(tenantId: string, name: string): Promise<ChannelRow | null> {
  if (isMysql()) return (await mysqlFindMaChannelByName(tenantId, name)) as ChannelRow | null;
  const rows = await getIamDb()
    .select()
    .from(maChannels)
    .where(and(eq(maChannels.tenantId, tenantId), eq(maChannels.name, name)))
    .limit(1);
  return (rows[0] as ChannelRow | undefined) ?? null;
}

async function findByApp(tenantId: string, platform: string, appId: string): Promise<ChannelRow | null> {
  if (isMysql()) return (await mysqlFindMaChannelByApp(tenantId, platform, appId)) as ChannelRow | null;
  const rows = await getIamDb()
    .select()
    .from(maChannels)
    .where(and(eq(maChannels.tenantId, tenantId), eq(maChannels.platform, platform), eq(maChannels.appId, appId)))
    .limit(1);
  return (rows[0] as ChannelRow | undefined) ?? null;
}

async function countChannels(tenantId: string): Promise<number> {
  if (isMysql()) return mysqlCountMaChannels(tenantId);
  const rows = await getIamDb()
    .select({ n: sql<number>`count(*)` })
    .from(maChannels)
    .where(eq(maChannels.tenantId, tenantId));
  return Number(rows[0]?.n ?? 0);
}

async function statesFor(channelIds: string[]): Promise<Map<string, StateRow>> {
  if (channelIds.length === 0) return new Map();
  const rows = isMysql()
    ? ((await mysqlListRuntimeStates(channelIds)) as StateRow[])
    : ((await getIamDb()
        .select()
        .from(maChannelRuntimeState)
        .where(inArray(maChannelRuntimeState.channelId, channelIds))) as StateRow[]);
  return new Map(rows.filter((row) => row.channelId).map((row) => [row.channelId as string, row]));
}

async function withConnection(row: ChannelRow): Promise<MaChannel & { connection: MaChannelConnection }> {
  const channel = mapChannel(row);
  const states = await statesFor([channel.id]);
  return { ...channel, connection: connectionOf(channel.revision, states.get(channel.id) ?? null) };
}

export async function listMaChannels(
  tenantId: string,
  filter?: { agentId?: string },
): Promise<Array<MaChannel & { connection: MaChannelConnection }>> {
  const rows = isMysql()
    ? ((await mysqlListMaChannels(tenantId, filter?.agentId)) as ChannelRow[])
    : ((await getIamDb()
        .select()
        .from(maChannels)
        .where(and(eq(maChannels.tenantId, tenantId), filter?.agentId ? eq(maChannels.agentId, filter.agentId) : undefined))
        .orderBy(asc(maChannels.name))) as ChannelRow[]);
  const states = await statesFor(rows.map((row) => row.id));
  return rows.map((row) => {
    const channel = mapChannel(row);
    return { ...channel, connection: connectionOf(channel.revision, states.get(channel.id) ?? null) };
  });
}

export async function getMaChannel(tenantId: string, id: string): Promise<MaChannel & { connection: MaChannelConnection }> {
  const row = await findRow(tenantId, id);
  if (!row) throw new MaChannelNotFoundError();
  return withConnection(row);
}

export async function createMaChannel(
  tenantId: string,
  body: Record<string, unknown>,
  actorUserId: string,
): Promise<MaChannel> {
  const input = normalizeChannelInput(body, "create");
  if (!input.name || !input.agentId || !input.appId || !input.credential || !input.routing || !input.config) {
    throw new MaChannelValidationError("name: is required");
  }
  await assertRefs(tenantId, input.agentId, input.routing, input.pinnedVersion ?? null, input.environmentId ?? null);
  await assertActiveCredential(tenantId, input.credential.vaultId, input.credential.credentialId);
  if ((await countChannels(tenantId)) >= CHANNEL_LIMIT) throw new MaChannelLimitError();
  const named = await findByName(tenantId, input.name);
  if (named) throw new MaChannelConflictError("name already exists");
  const bound = await findByApp(tenantId, input.platform ?? "feishu", input.appId);
  if (bound) throw new MaChannelConflictError("app_id is already bound to another channel");
  const now = new Date();
  const row = {
    id: ulid(),
    tenantId,
    name: input.name,
    platform: input.platform ?? "feishu",
    agentId: input.agentId,
    routing: input.routing,
    pinnedVersion: input.pinnedVersion ?? null,
    environmentId: input.environmentId ?? null,
    appId: input.appId,
    credentialVaultId: input.credential.vaultId,
    credentialId: input.credential.credentialId,
    ownerUserId: actorUserId,
    config: input.config,
    enabled: input.enabled ?? true,
    revision: 1,
    createdBy: actorUserId,
    createdAt: now,
    updatedAt: now,
  };
  try {
    if (isMysql()) await mysqlInsertMaChannel(row);
    else await getIamDb().insert(maChannels).values(row);
  } catch (error) {
    const conflict = conflictFrom(error);
    if (conflict) throw conflict;
    throw error;
  }
  return mapChannel((await findRow(tenantId, row.id)) as ChannelRow);
}

export async function updateMaChannel(tenantId: string, id: string, body: Record<string, unknown>): Promise<MaChannel> {
  const existing = await findRow(tenantId, id);
  if (!existing) throw new MaChannelNotFoundError();
  const currentChannel = mapChannel(existing);
  const patch = normalizeChannelInput(body, "update");
  const routing = patch.routing ?? currentChannel.routing;
  let pinnedVersion = patch.pinnedVersion === undefined ? currentChannel.pinnedVersion : patch.pinnedVersion;
  if (routing === "follow_latest") pinnedVersion = null;
  if (routing === "pinned" && pinnedVersion == null) throw new MaChannelValidationError("pinned_version: is required");
  const next = {
    name: patch.name ?? currentChannel.name,
    platform: patch.platform ?? currentChannel.platform,
    agentId: patch.agentId ?? currentChannel.agentId,
    routing,
    pinnedVersion,
    environmentId: patch.environmentId === undefined ? currentChannel.environmentId : patch.environmentId,
    credentialVaultId: patch.credential?.vaultId ?? currentChannel.credentialVaultId,
    credentialId: patch.credential?.credentialId ?? currentChannel.credentialId,
    config: patch.config ?? currentChannel.config,
    enabled: patch.enabled ?? currentChannel.enabled,
  };
  await assertRefs(tenantId, next.agentId, next.routing, next.pinnedVersion, next.environmentId);
  await assertActiveCredential(tenantId, next.credentialVaultId, next.credentialId);
  if (next.name !== currentChannel.name) {
    const named = await findByName(tenantId, next.name);
    if (named && named.id !== id) throw new MaChannelConflictError("name already exists");
  }
  const changed =
    next.name !== currentChannel.name ||
    next.platform !== currentChannel.platform ||
    next.agentId !== currentChannel.agentId ||
    next.routing !== currentChannel.routing ||
    next.pinnedVersion !== currentChannel.pinnedVersion ||
    next.environmentId !== currentChannel.environmentId ||
    next.credentialVaultId !== currentChannel.credentialVaultId ||
    next.credentialId !== currentChannel.credentialId ||
    next.enabled !== currentChannel.enabled ||
    next.config.idle_reset_hours !== currentChannel.config.idle_reset_hours ||
    next.config.open_base_url !== currentChannel.config.open_base_url;
  if (!changed) return currentChannel;
  const values = { ...next, revision: currentChannel.revision + 1, updatedAt: new Date() };
  try {
    if (isMysql()) await mysqlUpdateMaChannel(tenantId, id, values);
    else {
      await getIamDb().update(maChannels).set(values).where(and(eq(maChannels.tenantId, tenantId), eq(maChannels.id, id)));
    }
  } catch (error) {
    const conflict = conflictFrom(error);
    if (conflict) throw conflict;
    throw error;
  }
  return mapChannel((await findRow(tenantId, id)) as ChannelRow);
}

export async function deleteMaChannel(tenantId: string, id: string): Promise<void> {
  const row = await findRow(tenantId, id);
  if (!row) throw new MaChannelNotFoundError();
  if (isMysql()) {
    await mysqlDeleteMaChannel(tenantId, id);
    return;
  }
  await getIamDb().delete(maChannels).where(and(eq(maChannels.tenantId, tenantId), eq(maChannels.id, id)));
}

export async function listEnabledMaChannelsForRuntime(): Promise<MaChannel[]> {
  const rows = isMysql()
    ? ((await mysqlListEnabledMaChannels()) as ChannelRow[])
    : ((await getIamDb().select().from(maChannels).where(eq(maChannels.enabled, true)).orderBy(asc(maChannels.name))) as ChannelRow[]);
  return rows.map(mapChannel);
}

export async function readMaChannelAppSecret(
  tenantId: string,
  channelId: string,
): Promise<{ appId: string; vaultId: string; credentialId: string; sealed: SealedSecret }> {
  const row = await findRow(tenantId, channelId);
  if (!row || !asFlag(row.enabled)) throw new MaChannelNotFoundError();
  const channel = mapChannel(row);
  const material = await loadChannelCredential(tenantId, channel.credentialVaultId, channel.credentialId);
  const sealed = material ? sealOf(material) : null;
  if (!sealed) throw new MaChannelCredentialUnavailableError();
  return {
    appId: channel.appId,
    vaultId: channel.credentialVaultId,
    credentialId: channel.credentialId,
    sealed,
  };
}

export function channelCredentialAudit(
  tenantId: string,
  channelId: string,
  vaultId: string,
  credentialId: string,
) {
  return {
    tenantId,
    actorUserId: null,
    eventType: "ma.channel.credential_resolve",
    targetKind: "ma_channel",
    targetId: channelId,
    detail: { vault_id: vaultId, credential_id: credentialId },
  };
}

export async function resolveMaChannelAppSecret(
  tenantId: string,
  channelId: string,
): Promise<{ appId: string; appSecret: string }> {
  const loaded = await readMaChannelAppSecret(tenantId, channelId);
  await insertAuditEvent(channelCredentialAudit(tenantId, channelId, loaded.vaultId, loaded.credentialId));
  const appSecret = openSecretPayload(loaded.sealed).secret_value;
  if (!appSecret) throw new MaChannelCredentialUnavailableError();
  return { appId: loaded.appId, appSecret };
}

export async function listMaChannelConversations(
  tenantId: string,
  channelId: string,
  limit: number,
): Promise<MaChannelConversation[]> {
  const row = await findRow(tenantId, channelId);
  if (!row) throw new MaChannelNotFoundError();
  const rows = isMysql()
    ? await mysqlListMaChannelConversations(tenantId, channelId, limit)
    : await getIamDb()
        .select()
        .from(maChannelConversations)
        .where(and(eq(maChannelConversations.tenantId, tenantId), eq(maChannelConversations.channelId, channelId)))
        .orderBy(desc(maChannelConversations.lastMessageAt))
        .limit(limit);
  return rows.map((item) => ({
    conversationKey: item.conversationKey,
    conversationType: item.conversationType,
    sessionId: item.sessionId,
    agentVersion: asInt(item.agentVersion) ?? 0,
    lastMessageAt: iso(item.lastMessageAt),
  }));
}
