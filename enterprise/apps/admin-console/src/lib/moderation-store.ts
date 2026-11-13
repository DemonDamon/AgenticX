import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ModerationProviderConfig = {
  type: "http";
  name?: string;
  url: string;
  apiKey?: string;
};

export type TenantModerationConfig = {
  enabled: boolean;
  mode: "degraded" | "strict";
  blockSeverity?: "critical" | "high" | "medium" | "low";
  timeoutSeconds?: number;
  categories?: string[];
  provider: ModerationProviderConfig;
};

export type ModerationConfig = {
  tenants: Record<string, TenantModerationConfig>;
};

const EMPTY_CONFIG: ModerationConfig = { tenants: {} };

function configPath(): string {
  return (
    process.env.GATEWAY_ADMIN_MODERATION_FILE?.trim() ||
    path.resolve(process.cwd(), "../../.runtime/admin/moderation.json")
  );
}

export async function readModerationConfig(): Promise<ModerationConfig> {
  try {
    const raw = await readFile(configPath(), "utf-8");
    const parsed = JSON.parse(raw) as ModerationConfig;
    if (!parsed || typeof parsed !== "object" || !parsed.tenants) {
      return EMPTY_CONFIG;
    }
    return parsed;
  } catch {
    return EMPTY_CONFIG;
  }
}

export async function readTenantModerationConfig(
  tenantId: string,
): Promise<TenantModerationConfig | null> {
  const config = await readModerationConfig();
  return config.tenants[tenantId] ?? null;
}

function validateConfig(tenantId: string, config: TenantModerationConfig): void {
  if (!tenantId.trim()) {
    throw new Error("tenantId is required");
  }
  if (config.mode !== "degraded" && config.mode !== "strict") {
    throw new Error("mode must be degraded or strict");
  }
  if (!config.provider || config.provider.type !== "http") {
    throw new Error("provider.type must be http");
  }
  if (config.enabled && !config.provider.url?.trim()) {
    throw new Error("provider url is required when enabled");
  }
}

export async function writeTenantModerationConfig(
  tenantId: string,
  config: TenantModerationConfig,
): Promise<void> {
  validateConfig(tenantId, config);
  const full = await readModerationConfig();
  const next = { ...config, provider: { ...config.provider } };
  // apiKey 回显为掩码，PUT 原样带回时保留旧值，避免误覆盖。
  if (next.provider.apiKey === "******") {
    next.provider.apiKey = full.tenants[tenantId]?.provider.apiKey ?? "";
  }
  const tenants = { ...full.tenants, [tenantId]: next };
  const file = configPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({ tenants }, null, 2),
    "utf-8",
  );
}

export async function deleteTenantModerationConfig(tenantId: string): Promise<void> {
  const full = await readModerationConfig();
  if (!(tenantId in full.tenants)) {
    return;
  }
  const tenants = { ...full.tenants };
  delete tenants[tenantId];
  const file = configPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({ tenants }, null, 2),
    "utf-8",
  );
}
