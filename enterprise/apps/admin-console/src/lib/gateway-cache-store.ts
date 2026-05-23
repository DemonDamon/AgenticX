import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireGatewayInternalToken } from "./gateway-internal-token";

export type GatewayCacheConfig = {
  l1_enabled: boolean;
  l2_enabled: boolean;
  l1_ttl_minutes: number;
  semantic_threshold: number;
  replay_mode: "burst" | "real-time";
  model_allowlist: string[];
  model_blocklist: string[];
  l2_embedding_model: string;
};

const DEFAULT_CONFIG: GatewayCacheConfig = {
  l1_enabled: true,
  l2_enabled: false,
  l1_ttl_minutes: 5,
  semantic_threshold: 0.92,
  replay_mode: "burst",
  model_allowlist: [],
  model_blocklist: [],
  l2_embedding_model: "",
};

function configPath(): string {
  return (
    process.env.GATEWAY_CACHE_CONFIG_FILE?.trim() ||
    path.resolve(process.cwd(), "../../.runtime/admin/cache-config.json")
  );
}

export async function readCacheConfig(): Promise<GatewayCacheConfig> {
  try {
    const raw = await readFile(configPath(), "utf-8");
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as GatewayCacheConfig) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function writeCacheConfig(config: GatewayCacheConfig): Promise<void> {
  const file = configPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(config, null, 2), "utf-8");
}

export async function evictCachePrefix(prefix: string): Promise<void> {
  const gatewayBase = process.env.GATEWAY_INTERNAL_URL?.trim() || "http://127.0.0.1:8080";
  const token = requireGatewayInternalToken();
  const res = await fetch(`${gatewayBase}/internal/cache/evict`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ prefix }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `evict failed: HTTP ${res.status}`);
  }
}
