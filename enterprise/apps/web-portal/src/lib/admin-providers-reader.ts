/**
 * web-portal · 只读共享 admin 落盘配置
 *
 * Portal 进程不写、不持有 Key，只读 admin-console 维护的两份 JSON：
 *   - enterprise/.runtime/admin/providers.json
 *   - enterprise/.runtime/admin/user-models.json
 *
 * 这样 admin 改完保存，下一次 portal 请求就能立刻看到新模型，不需要重启服务。
 */

import * as fs from "node:fs";
import * as path from "node:path";

const RUNTIME_DIR = path.resolve(process.cwd(), "../../.runtime/admin");
const PROVIDERS_FILE = path.join(RUNTIME_DIR, "providers.json");
const USER_MODELS_FILE = path.join(RUNTIME_DIR, "user-models.json");

export type ProviderRoute = "local" | "private-cloud" | "third-party";

export interface ProviderModelRecord {
  name: string;
  label: string;
  enabled: boolean;
  capabilities?: string[];
}

export interface ProviderRecord {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  isDefault: boolean;
  route: ProviderRoute;
  models: ProviderModelRecord[];
}

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    const raw = fs.readFileSync(file, "utf-8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function readProviders(): ProviderRecord[] {
  const json = readJson<{ providers?: ProviderRecord[] }>(PROVIDERS_FILE, {});
  return Array.isArray(json.providers) ? json.providers : [];
}

export function readUserModels(): Record<string, string[]> {
  const json = readJson<{ userModels?: Record<string, string[]> }>(USER_MODELS_FILE, {});
  return json.userModels ?? {};
}

export interface PortalModelOption {
  id: string;
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
  route: ProviderRoute;
  isDefault: boolean;
}

const LEGACY_ADMIN_EMAIL_TO_USER_ID: Record<string, string> = {
  "owner@agenticx.local": "u_001",
  "ops@agenticx.local": "u_002",
  "audit@agenticx.local": "u_003",
};

function resolveAssignmentKeys(userId: string, email?: string): string[] {
  const keys = new Set<string>();
  if (userId) keys.add(userId);
  if (!email) return Array.from(keys);
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return Array.from(keys);

  // 新链路：admin 分配会同时写入 email 别名 key。
  keys.add(`email:${normalizedEmail}`);

  // 兼容旧数据：历史分配只按 admin-console 内存种子 id（u_001 等）存储。
  const legacyUserId = LEGACY_ADMIN_EMAIL_TO_USER_ID[normalizedEmail];
  if (legacyUserId) keys.add(legacyUserId);

  return Array.from(keys);
}

/**
 * 当前用户**最终可见**的模型 = （admin 启用的 provider × admin 启用的 model）∩ 用户分配集合。
 * 如果用户没有分配过任何模型（首次登录），返回空集合 → 前台展示「无可用模型，请联系管理员分配」。
 */
export function listAvailableModelsForUser(userId: string, email?: string): PortalModelOption[] {
  const providers = readProviders();
  const userMap = readUserModels();
  const allowed = new Set<string>();
  for (const key of resolveAssignmentKeys(userId, email)) {
    for (const modelId of userMap[key] ?? []) {
      if (modelId) allowed.add(modelId);
    }
  }
  const out: PortalModelOption[] = [];
  for (const p of providers) {
    if (!p.enabled) continue;
    for (const m of p.models) {
      if (!m.enabled) continue;
      const id = `${p.id}/${m.name}`;
      if (!allowed.has(id)) continue;
      out.push({
        id,
        provider: p.id,
        providerLabel: p.displayName,
        model: m.name,
        label: m.label,
        route: p.route,
        isDefault: p.isDefault,
      });
    }
  }
  return out;
}
