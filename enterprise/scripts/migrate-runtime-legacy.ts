/**
 * 将 enterprise/.runtime/admin/*.json 导入 Postgres 运行时表（幂等）。
 *
 * 用法：
 *   pnpm -C enterprise migrate:legacy-runtime
 *
 * 环境变量：DATABASE_URL、DEFAULT_TENANT_ID（自动从 enterprise/.env.local 加载）
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { migrateRuntimeLegacyFromDisk, type MigrateSliceResult } from "@agenticx/iam-core/runtime-legacy-migrate";

const ENTERPRISE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ENTERPRISE_DIR, ".env.local");

function loadEnvLocal(): void {
  if (!fs.existsSync(ENV_FILE)) return;
  const raw = fs.readFileSync(ENV_FILE, "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) || !process.env[key]?.trim()) {
      process.env[key] = value;
    }
  }
}

function printSlice(label: string, result: MigrateSliceResult): void {
  const suffix = result.reason ? ` (${result.reason})` : "";
  console.log(`[migrate-runtime-legacy] ${label}: ${result.action}, count=${result.count}${suffix}`);
}

async function main(): Promise<void> {
  loadEnvLocal();

  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required. Run bootstrap.sh or set enterprise/.env.local first.");
  }
  if (!process.env.DEFAULT_TENANT_ID?.trim()) {
    throw new Error("DEFAULT_TENANT_ID is required in enterprise/.env.local");
  }

  const result = await migrateRuntimeLegacyFromDisk({ cwd: ENTERPRISE_DIR });
  console.log(`[migrate-runtime-legacy] tenant=${result.tenantId}`);
  console.log(`[migrate-runtime-legacy] runtimeDir=${result.runtimeDir}`);
  printSlice("providers", result.providers);
  printSlice("userVisibleModels", result.userVisibleModels);
  printSlice("quotas", result.quotas);
  console.log("[migrate-runtime-legacy] done");
}

main().catch((error) => {
  console.error("[migrate-runtime-legacy] failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
