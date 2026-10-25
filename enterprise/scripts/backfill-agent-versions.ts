/**
 * 把每个现有 enterprise_agents 行回填为 version 1。
 *
 * 用法：
 *   pnpm -C enterprise ma:backfill-agent-versions
 *
 * 环境变量：DATABASE_URL、DEFAULT_TENANT_ID（自动从 enterprise/.env.local 加载）
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { __resetDatabaseForTests, backfillAgentVersions } from "@agenticx/iam-core";

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

async function main(): Promise<void> {
  loadEnvLocal();

  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required. Run bootstrap.sh or set enterprise/.env.local first.");
  }
  if (!process.env.DEFAULT_TENANT_ID?.trim()) {
    throw new Error("DEFAULT_TENANT_ID is required in enterprise/.env.local");
  }

  const report = await backfillAgentVersions(process.env.DEFAULT_TENANT_ID!.trim());
  console.log(
    `[backfill-agent-versions] tenant=${report.tenantId} created=${report.created} exists=${report.exists} invalid=${report.invalid.length}`,
  );
  for (const item of report.invalid) {
    console.log(
      `[backfill-agent-versions] invalid agent=${item.agentId} slug=${item.slug} first_error=${item.errors[0] ?? ""}`,
    );
  }
  console.log("[backfill-agent-versions] done");
}

main()
  .catch((error) => {
    console.error("[backfill-agent-versions] failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await __resetDatabaseForTests();
    } catch {
      // ignore close errors
    }
  });
