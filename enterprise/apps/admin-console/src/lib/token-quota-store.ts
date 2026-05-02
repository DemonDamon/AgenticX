import * as fs from "node:fs";
import * as path from "node:path";

export type QuotaAction = "block" | "warn" | "fallback";

export type QuotaRule = {
  monthlyTokens: number;
  action: QuotaAction;
};

export type QuotaConfig = {
  defaults: {
    role: Record<string, QuotaRule>;
    model: Record<string, QuotaRule>;
  };
  users: Record<string, QuotaRule>;
  departments: Record<string, QuotaRule>;
  updatedAt: string;
};

const ROOT = path.resolve(process.cwd(), "../..");
const RUNTIME_DIR = process.env.ENTERPRISE_ADMIN_RUNTIME_DIR || path.join(ROOT, ".runtime/admin");
const FILE_PATH = process.env.ENTERPRISE_QUOTA_CONFIG_FILE || path.join(RUNTIME_DIR, "quotas.json");

const DEFAULT_CONFIG: QuotaConfig = {
  defaults: {
    role: {
      admin: { monthlyTokens: 1_500_000, action: "warn" },
      staff: { monthlyTokens: 600_000, action: "warn" },
      guest: { monthlyTokens: 300_000, action: "block" },
    },
    model: {},
  },
  users: {},
  departments: {},
  updatedAt: new Date().toISOString(),
};

function ensureDir(): void {
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 });
  }
}

function normalizeRule(input: Partial<QuotaRule> | undefined): QuotaRule {
  const monthlyTokens = Number(input?.monthlyTokens ?? 0);
  const action = input?.action ?? "warn";
  return {
    monthlyTokens: Number.isFinite(monthlyTokens) && monthlyTokens > 0 ? Math.floor(monthlyTokens) : 0,
    action: action === "block" || action === "fallback" ? action : "warn",
  };
}

function normalize(config: Partial<QuotaConfig> | undefined): QuotaConfig {
  const next: QuotaConfig = {
    defaults: { role: {}, model: {} },
    users: {},
    departments: {},
    updatedAt: new Date().toISOString(),
  };

  const roles = config?.defaults?.role ?? {};
  for (const [key, value] of Object.entries(roles)) next.defaults.role[key] = normalizeRule(value);
  const models = config?.defaults?.model ?? {};
  for (const [key, value] of Object.entries(models)) next.defaults.model[key] = normalizeRule(value);
  const users = config?.users ?? {};
  for (const [key, value] of Object.entries(users)) next.users[key] = normalizeRule(value);
  const depts = config?.departments ?? {};
  for (const [key, value] of Object.entries(depts)) next.departments[key] = normalizeRule(value);
  return next;
}

export function getQuotaConfig(): QuotaConfig {
  ensureDir();
  if (!fs.existsSync(FILE_PATH)) {
    fs.writeFileSync(FILE_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), { mode: 0o600 });
    return DEFAULT_CONFIG;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE_PATH, "utf-8")) as Partial<QuotaConfig>;
    return normalize(parsed);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function setQuotaConfig(input: Partial<QuotaConfig>): QuotaConfig {
  ensureDir();
  const next = normalize(input);
  next.updatedAt = new Date().toISOString();
  const tmp = `${FILE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE_PATH);
  return next;
}

export function quotaFilePath(): string {
  return FILE_PATH;
}
