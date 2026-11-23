import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type AlertChannel = {
  type: "webhook" | "feishu";
  url: string;
  minSeverity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
};

export type TenantAlertChannels = {
  channels: AlertChannel[];
  dedupWindowSeconds?: number;
  rateLimitPerMinute?: number;
};

export type AlertChannelsConfig = {
  tenants: Record<string, TenantAlertChannels>;
};

const EMPTY_CONFIG: AlertChannelsConfig = { tenants: {} };

function configPath(): string {
  return (
    process.env.GATEWAY_ADMIN_ALERTS_FILE?.trim() ||
    path.resolve(process.cwd(), "../../.runtime/admin/alert-channels.json")
  );
}

export async function readAlertChannels(): Promise<AlertChannelsConfig> {
  try {
    const raw = await readFile(configPath(), "utf-8");
    const parsed = JSON.parse(raw) as AlertChannelsConfig;
    if (!parsed || typeof parsed !== "object" || !parsed.tenants) {
      return EMPTY_CONFIG;
    }
    return parsed;
  } catch {
    return EMPTY_CONFIG;
  }
}

export async function readTenantAlertChannels(
  tenantId: string,
): Promise<TenantAlertChannels | null> {
  const config = await readAlertChannels();
  return config.tenants[tenantId] ?? null;
}

export async function writeTenantAlertChannels(
  tenantId: string,
  channels: TenantAlertChannels,
): Promise<void> {
  if (!tenantId.trim()) {
    throw new Error("tenantId is required");
  }
  for (const channel of channels.channels ?? []) {
    if (!channel.url?.trim()) {
      throw new Error("channel url is required");
    }
    if (channel.type !== "webhook" && channel.type !== "feishu") {
      throw new Error(`unsupported channel type: ${channel.type}`);
    }
  }
  const config = await readAlertChannels();
  const tenants = { ...config.tenants, [tenantId]: channels };
  const file = configPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({ tenants }, null, 2),
    "utf-8",
  );
}

export async function deleteTenantAlertChannels(tenantId: string): Promise<void> {
  const config = await readAlertChannels();
  if (!(tenantId in config.tenants)) {
    return;
  }
  const tenants = { ...config.tenants };
  delete tenants[tenantId];
  const file = configPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({ tenants }, null, 2),
    "utf-8",
  );
}
