/**
 * admin-console · 模型服务（厂商 + Key + 模型）持久化仓库
 *
 * 数据落盘到 enterprise/.runtime/admin/providers.json，gateway 通过同一份 JSON 消费配置。
 *
 * 接口对齐 Machi 桌面端「模型服务」面板，最小需要：
 *   - provider：基础信息 + apiKey + baseUrl + 启停 + 默认
 *   - model：name + label + 启停（保留 capabilities 字段以备后续视觉模型/工具调用扩展）
 *
 * 不做 BYOK：所有 Key 仅 admin 后台可读写；前台 portal 永远拿不到原文 Key。
 */

import * as fs from "node:fs";
import * as path from "node:path";

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
const PROVIDERS_FILE = path.join(RUNTIME_DIR, "providers.json");

function ensureDir(): void {
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 });
  }
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

function readFile(): ProviderRecord[] {
  ensureDir();
  if (!fs.existsSync(PROVIDERS_FILE)) return [];
  try {
    const raw = fs.readFileSync(PROVIDERS_FILE, "utf-8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw) as { providers?: ProviderRecord[] };
    return Array.isArray(parsed.providers) ? parsed.providers : [];
  } catch {
    return [];
  }
}

function writeFile(providers: ProviderRecord[]): void {
  ensureDir();
  const tmp = `${PROVIDERS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ providers }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, PROVIDERS_FILE);
}

declare global {
  // eslint-disable-next-line no-var
  var __agenticxModelProvidersCache: ProviderRecord[] | undefined;
}

function defaultSeed(): ProviderRecord[] {
  return [];
}

function load(): ProviderRecord[] {
  if (!globalThis.__agenticxModelProvidersCache) {
    const file = readFile();
    globalThis.__agenticxModelProvidersCache = file.length > 0 ? file : defaultSeed();
    if (file.length === 0 && globalThis.__agenticxModelProvidersCache.length > 0) {
      writeFile(globalThis.__agenticxModelProvidersCache);
    }
  }
  return globalThis.__agenticxModelProvidersCache;
}

function persist(): void {
  if (!globalThis.__agenticxModelProvidersCache) return;
  writeFile(globalThis.__agenticxModelProvidersCache);
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
    popularModels: [
      { name: "glm-4-plus", label: "GLM-4 Plus", capabilities: ["text"], enabled: true },
    ],
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
    popularModels: [
      { name: "abab6.5-chat", label: "MiniMax abab6.5", capabilities: ["text"], enabled: true },
    ],
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
    popularModels: [
      { name: "llama3.1:8b", label: "Llama 3.1 8B", capabilities: ["text"], enabled: true },
    ],
  },
];

export function listProviders(): PublicProviderRecord[] {
  return load()
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(toPublic);
}

export function getProvider(id: string): PublicProviderRecord | null {
  const found = load().find((p) => p.id === id);
  return found ? toPublic(found) : null;
}

/** Internal use only by gateway-config exporter / connectivity check; never sent to UI. */
export function getProviderInternal(id: string): ProviderRecord | null {
  return load().find((p) => p.id === id) ?? null;
}

export function listProvidersInternal(): ProviderRecord[] {
  return load().slice();
}

function normalizeProviderId(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

export function createProvider(input: CreateProviderInput): PublicProviderRecord {
  const records = load();
  const id = normalizeProviderId(input.id);
  if (!id) throw new Error("provider id is required");
  if (records.some((p) => p.id === id)) {
    throw new Error("provider already exists");
  }
  const baseUrl = input.baseUrl.trim();
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new Error("baseUrl must start with http(s)://");
  }

  const template = PROVIDER_TEMPLATES.find((t) => t.id === id);
  const next: ProviderRecord = {
    id,
    displayName: input.displayName?.trim() || template?.displayName || id,
    baseUrl,
    apiKey: input.apiKey ?? "",
    enabled: input.enabled ?? true,
    isDefault: input.isDefault ?? false,
    route: input.route ?? template?.route ?? "third-party",
    envKey: input.envKey || template?.envKey,
    models: input.models && input.models.length > 0 ? input.models : (template?.popularModels ?? []),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  if (next.isDefault) {
    for (const p of records) p.isDefault = false;
  }
  records.push(next);
  persist();
  return toPublic(next);
}

export function updateProvider(id: string, patch: UpdateProviderInput): PublicProviderRecord {
  const records = load();
  const record = records.find((p) => p.id === id);
  if (!record) throw new Error("provider not found");

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
      for (const p of records) {
        if (p.id !== id) p.isDefault = false;
      }
    }
  }
  record.updatedAt = nowIso();
  persist();
  return toPublic(record);
}

export function deleteProvider(id: string): boolean {
  const records = load();
  const idx = records.findIndex((p) => p.id === id);
  if (idx < 0) return false;
  records.splice(idx, 1);
  persist();
  return true;
}

export function addProviderModel(id: string, model: ProviderModel): PublicProviderRecord {
  const records = load();
  const record = records.find((p) => p.id === id);
  if (!record) throw new Error("provider not found");
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
  persist();
  return toPublic(record);
}

export function updateProviderModel(
  id: string,
  modelName: string,
  patch: Partial<ProviderModel>
): PublicProviderRecord {
  const records = load();
  const record = records.find((p) => p.id === id);
  if (!record) throw new Error("provider not found");
  const model = record.models.find((m) => m.name === modelName);
  if (!model) throw new Error("model not found");
  if (patch.label !== undefined) model.label = patch.label.trim();
  if (patch.capabilities !== undefined) model.capabilities = patch.capabilities;
  if (patch.enabled !== undefined) model.enabled = patch.enabled;
  record.updatedAt = nowIso();
  persist();
  return toPublic(record);
}

export function deleteProviderModel(id: string, modelName: string): PublicProviderRecord {
  const records = load();
  const record = records.find((p) => p.id === id);
  if (!record) throw new Error("provider not found");
  const idx = record.models.findIndex((m) => m.name === modelName);
  if (idx < 0) throw new Error("model not found");
  record.models.splice(idx, 1);
  record.updatedAt = nowIso();
  persist();
  return toPublic(record);
}

/** Reset cache (test only). */
export function __resetProvidersCache(): void {
  globalThis.__agenticxModelProvidersCache = undefined;
}

export function providersFilePath(): string {
  return PROVIDERS_FILE;
}
