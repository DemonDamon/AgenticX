/**
 * 为本地开发预置两个 PAT：agent-runtime 调网关，门户调 agent-runtime。
 *
 * 用法：pnpm -C enterprise ma:provision-dev-tokens
 * 已存在且以 agx-pat- 开头的文件会跳过。明文 token 只写入 .local-secrets，不打印。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { __resetDatabaseForTests, createPat, loadAuthUserByEmail } from "@agenticx/iam-core";

const ENTERPRISE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ENTERPRISE_DIR, ".env.local");
const SECRETS_DIR = path.join(ENTERPRISE_DIR, ".local-secrets");

const TARGETS = [
  { file: "ma_runtime_gateway.pat", name: "托管运行时模型调用（本地开发）", scopes: ["workspace:chat"] },
  {
    file: "ma_portal_service.pat",
    name: "门户调用托管运行时（本地开发）",
    scopes: ["ma:sessions:read", "ma:sessions:write", "ma:sessions:on_behalf", "ma:agents:read"],
  },
] as const;

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
  const tenantId = process.env.DEFAULT_TENANT_ID.trim();
  const email = (process.env.MA_DEV_SERVICE_USER_EMAIL || "admin@agenticx.local").trim().toLowerCase();
  const user = await loadAuthUserByEmail(tenantId, email);
  if (!user) {
    console.log(`[ma-provision-dev-tokens] skip: user ${email} not found in tenant ${tenantId}`);
    return;
  }
  fs.mkdirSync(SECRETS_DIR, { recursive: true });
  for (const target of TARGETS) {
    const file = path.join(SECRETS_DIR, target.file);
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8").trim().startsWith("agx-pat-")) {
      console.log(`[ma-provision-dev-tokens] ${target.file}: exists`);
      continue;
    }
    const { record, token } = await createPat({
      tenantId,
      userId: user.id,
      deptId: user.deptId ?? null,
      name: target.name,
      createdBy: user.id,
      scopes: [...target.scopes],
      expireDays: 365,
    });
    fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
    console.log(`[ma-provision-dev-tokens] ${target.file}: created id=${record.id} prefix=${record.tokenPrefix}`);
  }
  console.log("[ma-provision-dev-tokens] done");
}

main()
  .catch((error) => {
    console.error("[ma-provision-dev-tokens] failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await __resetDatabaseForTests();
    } catch {
      // ignore close errors
    }
  });
