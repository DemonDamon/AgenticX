/**
 * admin-console · 模型服务（厂商 + Key + 模型）持久化：PostgreSQL
 *
 * 原 enterprise/.runtime/admin/providers.json 由迁移逻辑一次性导入；
 * Gateway 侧通过 HTTPS internal API 获取解密后的配置。
 */

import { enterpriseRuntimeModelProviders as mpTable } from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import * as fs from "node:fs";
import * as path from "node:path";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";

import { decryptProviderApiKey, encryptProviderApiKey } from "./provider-api-key-crypto";

export type ProviderRoute = "local" | "private-cloud" | "third-party";

export interface ProviderModel {
  name: string;
  label: string;
  capabilities?: string[];
  enabled: boolean;
}

export interface ProviderRecord {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  isDefault: boolean;
  route: ProviderRoute;
  envKey?: string;
  models: ProviderModel[];
  createdAt: string;
  updatedAt: string;
}

export interface PublicProviderModel extends ProviderModel {}

export interface PublicProviderRecord extends Omit<ProviderRecord, "apiKey"> {
  apiKeyMasked: string;
  apiKeyConfigured: boolean;
}

export interface CreateProviderInput {
  id: string;
  displayName?: string;
  baseUrl: string;
  apiKey?: string;
  enabled?: boolean;
  isDefault?: boolean;
  route?: ProviderRoute;
  envKey?: string;
  models?: ProviderModel[];
}

export interface UpdateProviderInput {
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
  isDefault?: boolean;
  route?: ProviderRoute;
  envKey?: string;
}

const RUNTIME_DIR = path.resolve(process.cwd(), "../../.runtime/admin");
const LEGACY_FILE = path.join(RUNTIME_DIR, "providers.json");

let legacyMigrationRan = false;

function requiredTenantId(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) {
    throw new Error("DEFAULT_TENANT_ID is required for model provider persistence.");
  }
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

function toPublic(record: ProviderRecord): PublicProviderRecord {
  const { apiKey, ...rest } = record;
  return {
    ...rest,
    apiKeyMasked: maskKey(apiKey),
    apiKeyConfigured: apiKey.trim().length > 0,
  };
}

function rowToRecord(row: typeof mpTable.$inferSelect): ProviderRecord {
  const modelsRaw = Array.isArray(row.models) ? (row.models as ProviderModel[]) : [];
  return {
    id: row.providerId,
    displayName: row.displayName,
    baseUrl: row.baseUrl,
    apiKey: decryptProviderApiKey(row.apiKeyCipher),
    enabled: row.enabled,
    isDefault: row.isDefault,
    route: row.route as ProviderRoute,
    envKey: row.envKey ?? undefined,
    models: modelsRaw.map((m) => ({
      name: m.name,
      label: m.label,
      capabilities: m.capabilities,
      enabled: m.enabled,
    })),
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt!).toISOString(),
    updatedAt:
      row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date(row.updatedAt!).toISOString(),
  };
}

async function migrateLegacyProvidersIfNeeded(tenantId: string): Promise<void> {
  if (legacyMigrationRan) return;
  legacyMigrationRan = true;
  const db = getIamDb();
  const cnt = await db.select({ id: mpTable.id }).from(mpTable).where(eq(mpTable.tenantId, tenantId)).limit(1);
  if (cnt.length > 0) return;
  if (!fs.existsSync(LEGACY_FILE)) return;
  try {
    const raw = fs.readFileSync(LEGACY_FILE, "utf-8");
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw) as { providers?: ProviderRecord[] };
    const providers = Array.isArray(parsed.providers) ? parsed.providers : [];
    if (providers.length === 0) return;
    const now = nowIso();
    for (const p of providers) {
      await db.insert(mpTable).values({
        id: ulid(),
        tenantId,
        providerId: p.id,
        displayName: p.displayName,
        baseUrl: p.baseUrl,
        apiKeyCipher: encryptProviderApiKey(p.apiKey ?? ""),
        enabled: p.enabled ?? true,
        isDefault: p.isDefault ?? false,
        route: (p.route as string) ?? "third-party",
        envKey: p.envKey ?? null,
        models: p.models ?? [],
        createdAt: new Date(p.createdAt || now),
        updatedAt: new Date(p.updatedAt || now),
      });
    }
  } catch {
    /* ignore malformed legacy */
  }
}

async function loadAll(tenantId: string): Promise<ProviderRecord[]> {
  await migrateLegacyProvidersIfNeeded(tenantId);
  const db = getIamDb();
  const rows = await db.select().from(mpTable).where(eq(mpTable.tenantId, tenantId));
  return rows.map(rowToRecord).sort((a, b) => a.id.localeCompare(b.id));
}

export interface ProviderTemplate {
  id: string;
  displayName: string;
  baseUrl: string;
  envKey: string;
  route: ProviderRoute;
  popularModels: ProviderModel[];
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    route: "third-party",
    popularModels: [
      { name: "gpt-4o-mini", label: "GPT-4o Mini", capabilities: ["text"], enabled: true },
      { name: "gpt-4o", label: "GPT-4o", capabilities: ["text", "vision"], enabled: false },
    ],
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    envKey: "ANTHROPIC_API_KEY",
    route: "third-party",
    popularModels: [
      { name: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet", capabilities: ["text"], enabled: true },
    ],
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    envKey: "DEEPSEEK_API_KEY",
    route: "third-party",
    popularModels: [
      { name: "deepseek-chat", label: "DeepSeek Chat", capabilities: ["text"], enabled: true },
      { name: "deepseek-reasoner", label: "DeepSeek R1", capabilities: ["text", "reasoning"], enabled: false },
    ],
  },
  {
    id: "moonshot",
    displayName: "月之暗面 (Moonshot)",
    baseUrl: "https://api.moonshot.cn/v1",
    envKey: "MOONSHOT_API_KEY",
    route: "third-party",
    popularModels: [
      { name: "moonshot-v1-8k", label: "Moonshot v1 8K", capabilities: ["text"], enabled: true },
      { name: "moonshot-v1-32k", label: "Moonshot v1 32K", capabilities: ["text"], enabled: false },
    ],
  },
  {
    id: "zhipu",
    displayName: "智谱开放平台",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    envKey: "ZHIPU_API_KEY",
    route: "third-party",
    popularModels: [{ name: "glm-4-plus", label: "GLM-4 Plus", capabilities: ["text"], enabled: true }],
  },
  {
    id: "dashscope",
    displayName: "阿里云百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    envKey: "DASHSCOPE_API_KEY",
    route: "third-party",
    popularModels: [
      { name: "qwen-max", label: "通义千问 Max", capabilities: ["text"], enabled: true },
      { name: "qwen-plus", label: "通义千问 Plus", capabilities: ["text"], enabled: false },
    ],
  },
  {
    id: "minimax",
    displayName: "MiniMax",
    baseUrl: "https://api.minimax.chat/v1",
    envKey: "MINIMAX_API_KEY",
    route: "third-party",
    popularModels: [{ name: "abab6.5-chat", label: "MiniMax abab6.5", capabilities: ["text"], enabled: true }],
  },
  {
    id: "qianfan",
    displayName: "百度千帆",
    baseUrl: "https://qianfan.baidubce.com/v2",
    envKey: "QIANFAN_API_KEY",
    route: "third-party",
    popularModels: [
      { name: "ernie-4.0-turbo-8k", label: "ERNIE 4.0 Turbo", capabilities: ["text"], enabled: true },
    ],
  },
  {
    id: "volcengine",
    displayName: "火山引擎方舟",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    envKey: "VOLCENGINE_API_KEY",
    route: "third-party",
    popularModels: [
      { name: "doubao-pro-32k", label: "豆包 Pro 32K", capabilities: ["text"], enabled: true },
    ],
  },
  {
    id: "ollama",
    displayName: "Ollama (本地)",
    baseUrl: "http://127.0.0.1:11434/v1",
    envKey: "OLLAMA_API_KEY",
    route: "local",
    popularModels: [{ name: "llama3.1:8b", label: "Llama 3.1 8B", capabilities: ["text"], enabled: true }],
  },
];

function normalizeProviderId(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

export async function listProviders(): Promise<PublicProviderRecord[]> {
  const tenantId = requiredTenantId();
  const rows = await loadAll(tenantId);
  return rows.map(toPublic);
}

export async function getProvider(id: string): Promise<PublicProviderRecord | null> {
  const found = (await loadAll(requiredTenantId())).find((p) => p.id === id);
  return found ? toPublic(found) : null;
}

/** Internal use only — 含明文 API Key（Gateway bootstrap）。 */
export async function getProviderInternal(id: string): Promise<ProviderRecord | null> {
  const found = (await loadAll(requiredTenantId())).find((p) => p.id === id);
  return found ?? null;
}

export async function listProvidersInternal(): Promise<ProviderRecord[]> {
  return loadAll(requiredTenantId());
}

export async function createProvider(input: CreateProviderInput): Promise<PublicProviderRecord> {
  const tenantId = requiredTenantId();
  await migrateLegacyProvidersIfNeeded(tenantId);
  const db = getIamDb();
  const id = normalizeProviderId(input.id);
  if (!id) throw new Error("provider id is required");
  const dup = await db
    .select({ id: mpTable.id })
    .from(mpTable)
    .where(and(eq(mpTable.tenantId, tenantId), eq(mpTable.providerId, id)))
    .limit(1);
  if (dup.length) throw new Error("provider already exists");
  const baseUrl = input.baseUrl.trim();
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new Error("baseUrl must start with http(s)://");
  }

  const template = PROVIDER_TEMPLATES.find((t) => t.id === id);
  const ts = nowIso();
  const next: ProviderRecord = {
    id,
    displayName: input.displayName?.trim() || template?.displayName || id,
    baseUrl,
    apiKey: input.apiKey ?? "",
    enabled: input.enabled ?? true,
    isDefault: input.isDefault ?? false,
    route: input.route ?? template?.route ?? "third-party",
    envKey: input.envKey || template?.envKey,
    models: input.models && input.models.length > 0 ? input.models : template?.popularModels ?? [],
    createdAt: ts,
    updatedAt: ts,
  };

  if (next.isDefault) {
    await db.update(mpTable).set({ isDefault: false, updatedAt: new Date() }).where(eq(mpTable.tenantId, tenantId));
  }

  await db.insert(mpTable).values({
    id: ulid(),
    tenantId,
    providerId: next.id,
    displayName: next.displayName,
    baseUrl: next.baseUrl,
    apiKeyCipher: encryptProviderApiKey(next.apiKey),
    enabled: next.enabled,
    isDefault: next.isDefault,
    route: next.route,
    envKey: next.envKey ?? null,
    models: next.models as unknown[],
    createdAt: new Date(ts),
    updatedAt: new Date(ts),
  });

  return toPublic(next);
}

export async function updateProvider(id: string, patch: UpdateProviderInput): Promise<PublicProviderRecord> {
  const tenantId = requiredTenantId();
  await migrateLegacyProvidersIfNeeded(tenantId);
  const db = getIamDb();
  const rows = await db
    .select()
    .from(mpTable)
    .where(and(eq(mpTable.tenantId, tenantId), eq(mpTable.providerId, id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("provider not found");

  let record = rowToRecord(row);

  if (patch.baseUrl !== undefined) {
    const trimmed = patch.baseUrl.trim();
    if (!/^https?:\/\//.test(trimmed)) throw new Error("baseUrl must start with http(s)://");
    record.baseUrl = trimmed;
  }
  if (patch.displayName !== undefined) record.displayName = patch.displayName.trim();
  if (patch.apiKey !== undefined) record.apiKey = patch.apiKey;
  if (patch.enabled !== undefined) record.enabled = patch.enabled;
  if (patch.route !== undefined) record.route = patch.route;
  if (patch.envKey !== undefined) record.envKey = patch.envKey;
  if (patch.isDefault !== undefined) {
    record.isDefault = patch.isDefault;
    if (patch.isDefault) {
      await db.update(mpTable).set({ isDefault: false, updatedAt: new Date() }).where(eq(mpTable.tenantId, tenantId));
    }
  }
  record.updatedAt = nowIso();

  await db
    .update(mpTable)
    .set({
      displayName: record.displayName,
      baseUrl: record.baseUrl,
      apiKeyCipher: encryptProviderApiKey(record.apiKey),
      enabled: record.enabled,
      isDefault: record.isDefault,
      route: record.route,
      envKey: record.envKey ?? null,
      models: record.models as unknown[],
      updatedAt: new Date(record.updatedAt),
    })
    .where(and(eq(mpTable.tenantId, tenantId), eq(mpTable.providerId, id)));

  return toPublic(record);
}

export async function deleteProvider(id: string): Promise<boolean> {
  const tenantId = requiredTenantId();
  const db = getIamDb();
  const deleted = await db
    .delete(mpTable)
    .where(and(eq(mpTable.tenantId, tenantId), eq(mpTable.providerId, id)))
    .returning({ id: mpTable.id });
  return deleted.length > 0;
}

export async function addProviderModel(id: string, model: ProviderModel): Promise<PublicProviderRecord> {
  const tenantId = requiredTenantId();
  await migrateLegacyProvidersIfNeeded(tenantId);
  const db = getIamDb();
  const rows = await db
    .select()
    .from(mpTable)
    .where(and(eq(mpTable.tenantId, tenantId), eq(mpTable.providerId, id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("provider not found");

  let record = rowToRecord(row);
  if (!model.name.trim()) throw new Error("model.name is required");
  if (record.models.some((m) => m.name === model.name)) {
    throw new Error("model already exists");
  }
  record.models.push({
    name: model.name.trim(),
    label: model.label?.trim() || model.name.trim(),
    capabilities: model.capabilities ?? ["text"],
    enabled: model.enabled ?? true,
  });
  record.updatedAt = nowIso();

  await db
    .update(mpTable)
    .set({
      models: record.models as unknown[],
      updatedAt: new Date(record.updatedAt),
    })
    .where(and(eq(mpTable.tenantId, tenantId), eq(mpTable.providerId, id)));

  return toPublic(record);
}

export async function updateProviderModel(
  id: string,
  modelName: string,
  patch: Partial<ProviderModel>
): Promise<PublicProviderRecord> {
  const tenantId = requiredTenantId();
  await migrateLegacyProvidersIfNeeded(tenantId);
  const db = getIamDb();
  const rows = await db
    .select()
    .from(mpTable)
    .where(and(eq(mpTable.tenantId, tenantId), eq(mpTable.providerId, id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("provider not found");

  let record = rowToRecord(row);
  const model = record.models.find((m) => m.name === modelName);
  if (!model) throw new Error("model not found");
  if (patch.label !== undefined) model.label = patch.label.trim();
  if (patch.capabilities !== undefined) model.capabilities = patch.capabilities;
  if (patch.enabled !== undefined) model.enabled = patch.enabled;
  record.updatedAt = nowIso();

  await db
    .update(mpTable)
    .set({
      models: record.models as unknown[],
      updatedAt: new Date(record.updatedAt),
    })
    .where(and(eq(mpTable.tenantId, tenantId), eq(mpTable.providerId, id)));

  return toPublic(record);
}

export async function deleteProviderModel(id: string, modelName: string): Promise<PublicProviderRecord> {
  const tenantId = requiredTenantId();
  await migrateLegacyProvidersIfNeeded(tenantId);
  const db = getIamDb();
  const rows = await db
    .select()
    .from(mpTable)
    .where(and(eq(mpTable.tenantId, tenantId), eq(mpTable.providerId, id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("provider not found");

  let record = rowToRecord(row);
  const idx = record.models.findIndex((m) => m.name === modelName);
  if (idx < 0) throw new Error("model not found");
  record.models.splice(idx, 1);
  record.updatedAt = nowIso();

  await db
    .update(mpTable)
    .set({
      models: record.models as unknown[],
      updatedAt: new Date(record.updatedAt),
    })
    .where(and(eq(mpTable.tenantId, tenantId), eq(mpTable.providerId, id)));

  return toPublic(record);
}

/** Reset migrate flag（test）。 */
export function __resetProvidersCache(): void {
  legacyMigrationRan = false;
}

/** 已不再使用文件路径；占位兼容旧 metering / health。 */
export function providersFilePath(): string {
  return LEGACY_FILE;
}
