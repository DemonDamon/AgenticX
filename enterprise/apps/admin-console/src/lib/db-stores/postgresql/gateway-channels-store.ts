/**
 * admin-console · Gateway Channel 持久化（PG）
 */

import { gatewayChannels as chTable } from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";

import { decryptProviderApiKey, encryptProviderApiKey } from "../../provider-api-key-crypto";
import { getGatewayInternalToken, requireGatewayInternalToken } from "../../gateway-internal-token";

export type ChannelStatus = "active" | "disabled";

export interface GatewayChannelRecord {
  id: string;
  tenantId: string;
  name: string;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  weight: number;
  priority: number;
  status: ChannelStatus;
  supportedModels: string[];
  region?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PublicGatewayChannel extends Omit<GatewayChannelRecord, "apiKey"> {
  apiKeyMasked: string;
  apiKeyConfigured: boolean;
}

export interface CreateChannelInput {
  name: string;
  providerType?: string;
  baseUrl: string;
  apiKey?: string;
  weight?: number;
  priority?: number;
  status?: ChannelStatus;
  supportedModels: string[];
  region?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateChannelInput {
  name?: string;
  providerType?: string;
  baseUrl?: string;
  apiKey?: string;
  weight?: number;
  priority?: number;
  status?: ChannelStatus;
  supportedModels?: string[];
  region?: string | null;
  metadata?: Record<string, unknown>;
}

function requiredTenantId(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for gateway channel persistence.");
  return t;
}

function nowIso(): string {
  return new Date().toISOString();
}

function maskKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "•".repeat(Math.max(4, trimmed.length));
  return `${trimmed.slice(0, 4)}${"•".repeat(Math.max(8, trimmed.length - 8))}${trimmed.slice(-4)}`;
}

function rowToRecord(row: typeof chTable.$inferSelect): GatewayChannelRecord {
  const models = Array.isArray(row.supportedModels) ? row.supportedModels : [];
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    providerType: row.providerType,
    baseUrl: row.baseUrl,
    apiKey: decryptProviderApiKey(row.apiKeyCipher),
    weight: row.weight ?? 1,
    priority: row.priority ?? 0,
    status: (row.status as ChannelStatus) || "active",
    supportedModels: models.map(String),
    region: row.region ?? null,
    metadata,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

function toPublic(record: GatewayChannelRecord): PublicGatewayChannel {
  const { apiKey, ...rest } = record;
  return {
    ...rest,
    apiKeyMasked: maskKey(apiKey),
    apiKeyConfigured: apiKey.trim().length > 0,
  };
}

function toGatewayPayload(record: GatewayChannelRecord) {
  const providerLabel =
    typeof record.metadata.provider === "string"
      ? record.metadata.provider
      : typeof record.metadata.providerLabel === "string"
        ? record.metadata.providerLabel
        : record.name;
  const route =
    typeof record.metadata.route === "string" ? record.metadata.route : "third-party";
  return {
    id: record.id,
    tenantId: record.tenantId,
    name: record.name,
    providerType: record.providerType,
    baseUrl: record.baseUrl,
    apiKey: record.apiKey,
    weight: record.weight,
    priority: record.priority,
    status: record.status,
    supportedModels: record.supportedModels,
    metadata: record.metadata,
    region: record.region ?? undefined,
    providerLabel,
    route,
  };
}

async function loadAll(tenantId: string): Promise<GatewayChannelRecord[]> {
  const db = getIamDb();
  const rows = await db.select().from(chTable).where(eq(chTable.tenantId, tenantId));
  return rows.map(rowToRecord);
}

export async function listChannels(): Promise<PublicGatewayChannel[]> {
  const records = await loadAll(requiredTenantId());
  return records.map(toPublic);
}

export async function listChannelsInternal(): Promise<ReturnType<typeof toGatewayPayload>[]> {
  const records = await loadAll(requiredTenantId());
  return records.filter((r) => r.status === "active").map(toGatewayPayload);
}

export async function createChannel(input: CreateChannelInput): Promise<PublicGatewayChannel> {
  const tenantId = requiredTenantId();
  const db = getIamDb();
  const name = input.name.trim();
  if (!name) throw new Error("name is required");
  const baseUrl = input.baseUrl.trim();
  if (!/^https?:\/\//.test(baseUrl)) throw new Error("baseUrl must start with http(s)://");
  if (!input.supportedModels?.length) throw new Error("supportedModels is required");

  const dup = await db
    .select({ id: chTable.id })
    .from(chTable)
    .where(and(eq(chTable.tenantId, tenantId), eq(chTable.name, name)))
    .limit(1);
  if (dup.length) throw new Error("channel name already exists");

  const id = ulid();
  const ts = nowIso();
  await db.insert(chTable).values({
    id,
    tenantId,
    name,
    providerType: input.providerType?.trim() || "openai",
    baseUrl,
    apiKeyCipher: encryptProviderApiKey(input.apiKey ?? ""),
    weight: input.weight ?? 1,
    priority: input.priority ?? 0,
    status: input.status ?? "active",
    supportedModels: input.supportedModels,
    region: input.region?.trim() || null,
    metadata: input.metadata ?? {},
    createdAt: new Date(ts),
    updatedAt: new Date(ts),
  });
  const created = (await loadAll(tenantId)).find((r) => r.id === id);
  if (!created) throw new Error("create channel failed");
  return toPublic(created);
}

export async function updateChannel(id: string, input: UpdateChannelInput): Promise<PublicGatewayChannel> {
  const tenantId = requiredTenantId();
  const db = getIamDb();
  const existing = (await loadAll(tenantId)).find((r) => r.id === id);
  if (!existing) throw new Error("channel not found");

  const patch: Partial<typeof chTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.providerType !== undefined) patch.providerType = input.providerType.trim() || "openai";
  if (input.baseUrl !== undefined) {
    const baseUrl = input.baseUrl.trim();
    if (!/^https?:\/\//.test(baseUrl)) throw new Error("baseUrl must start with http(s)://");
    patch.baseUrl = baseUrl;
  }
  if (input.apiKey !== undefined) patch.apiKeyCipher = encryptProviderApiKey(input.apiKey);
  if (input.weight !== undefined) patch.weight = input.weight;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.status !== undefined) patch.status = input.status;
  if (input.supportedModels !== undefined) patch.supportedModels = input.supportedModels;
  if (input.region !== undefined) patch.region = input.region?.trim() || null;
  if (input.metadata !== undefined) patch.metadata = { ...existing.metadata, ...input.metadata };

  await db.update(chTable).set(patch).where(and(eq(chTable.tenantId, tenantId), eq(chTable.id, id)));
  const updated = (await loadAll(tenantId)).find((r) => r.id === id);
  if (!updated) throw new Error("update channel failed");
  return toPublic(updated);
}

export async function deleteChannel(id: string): Promise<void> {
  const tenantId = requiredTenantId();
  const db = getIamDb();
  await db.delete(chTable).where(and(eq(chTable.tenantId, tenantId), eq(chTable.id, id)));
}

export async function fetchGatewayKeypoolStats(channelId: string, keyRefs: string[]): Promise<unknown[]> {
  const base = process.env.GATEWAY_INTERNAL_BASE_URL?.trim() || "http://127.0.0.1:8080";
  const token = getGatewayInternalToken();
  if (!token || !channelId) return [];
  const qs = new URLSearchParams({ channel_id: channelId, key_refs: keyRefs.join(",") });
  const res = await fetch(`${base.replace(/\/$/, "")}/internal/keypool-stats?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: { keys?: unknown[] } };
  return body.data?.keys ?? [];
}

export async function resetGatewayKeypoolCooldown(channelId: string, keyRef: string): Promise<void> {
  const base = process.env.GATEWAY_INTERNAL_BASE_URL?.trim() || "http://127.0.0.1:8080";
  const token = requireGatewayInternalToken();
  const res = await fetch(`${base.replace(/\/$/, "")}/internal/keypool/reset`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel_id: channelId, key_ref: keyRef }),
  });
  if (!res.ok) throw new Error("reset keypool cooldown failed");
}

export async function fetchGatewayChannelStats(): Promise<Record<string, unknown>> {
  const base = process.env.GATEWAY_INTERNAL_BASE_URL?.trim() || "http://127.0.0.1:8080";
  const token = getGatewayInternalToken();
  if (!token) return {};
  const res = await fetch(`${base.replace(/\/$/, "")}/internal/channel-stats`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return {};
  const body = (await res.json()) as { data?: { stats?: Record<string, unknown> } };
  return body.data?.stats ?? {};
}
