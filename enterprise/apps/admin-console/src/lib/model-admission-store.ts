import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// SP2 security-eval-and-admission: model admission gate data
// (threshold + imported scorecards + recorded overrides). File store
// follows the alert-channels pattern: `.runtime/admin/*.json`, hot data.

export type AdmissionThreshold = {
  enabled: boolean;
  minScore: number;
  requireScorecard: boolean;
};

export type ScorecardEntry = {
  model: string;
  provider: string;
  runId: string;
  createdAt: string;
  corpusVersion: string;
  safetyScore: number;
  grade: string;
  attempts: number;
  refused: number;
  blockedByRule: number;
  bypassed: number;
  errors: number;
  source: "agx-security-eval";
};

export type AdmissionOverride = {
  model: string;
  operator: string;
  reason: string;
  ticket?: string;
  at: string;
  scoreAtOverride: number;
};

export type TenantAdmission = {
  threshold: AdmissionThreshold;
  scorecards: Record<string, { latest: ScorecardEntry; history: ScorecardEntry[] }>;
  overrides: AdmissionOverride[];
};

export type ModelAdmissionConfig = {
  tenants: Record<string, TenantAdmission>;
};

export const DEFAULT_THRESHOLD: AdmissionThreshold = {
  enabled: true,
  minScore: 80,
  requireScorecard: false,
};

const EMPTY_CONFIG: ModelAdmissionConfig = { tenants: {} };
const HISTORY_CAP = 10;

// Reserved object keys: a model name taken from an imported scorecard must
// never be used as a plain-object key (`obj["__proto__"] = x` rewrites the
// prototype — CodeQL prototype pollution).
const RESERVED_OBJ_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isReservedObjectKey(key: string): boolean {
  return RESERVED_OBJ_KEYS.has(key);
}

function configPath(): string {
  return (
    process.env.ADMIN_MODEL_ADMISSION_FILE?.trim() ||
    path.resolve(process.cwd(), "../../.runtime/admin/model-admission.json")
  );
}

export async function readModelAdmission(): Promise<ModelAdmissionConfig> {
  try {
    const raw = await readFile(configPath(), "utf-8");
    const parsed = JSON.parse(raw) as ModelAdmissionConfig;
    if (!parsed || typeof parsed !== "object" || !parsed.tenants) {
      return EMPTY_CONFIG;
    }
    return parsed;
  } catch {
    return EMPTY_CONFIG;
  }
}

export async function readTenantAdmission(tenantId: string): Promise<TenantAdmission> {
  const config = await readModelAdmission();
  const tenant = config.tenants[tenantId];
  if (tenant) {
    return tenant;
  }
  return { threshold: { ...DEFAULT_THRESHOLD }, scorecards: {}, overrides: [] };
}

async function writeConfig(config: ModelAdmissionConfig): Promise<void> {
  const file = configPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export async function writeThreshold(
  tenantId: string,
  threshold: AdmissionThreshold,
): Promise<TenantAdmission> {
  const config = await readModelAdmission();
  const tenant = config.tenants[tenantId] ?? {
    threshold: { ...DEFAULT_THRESHOLD },
    scorecards: {},
    overrides: [],
  };
  tenant.threshold = threshold;
  config.tenants[tenantId] = tenant;
  await writeConfig(config);
  return tenant;
}

// Imported payload from `agx security-eval` scorecard.json (schema agx-security-scorecard/1).
export type ScorecardImport = {
  schema: string;
  run_id: string;
  created_at: string;
  corpus?: { version?: string };
  models?: Array<{
    provider: string;
    model: string;
    safety_score: number;
    grade: string;
    attempts: number;
    refused: number;
    blocked_by_rule: number;
    bypassed: number;
    errors: number;
  }>;
};

export function parseScorecardImport(payload: unknown): ScorecardImport {
  if (!payload || typeof payload !== "object") {
    throw new Error("scorecard payload must be a JSON object");
  }
  const card = payload as ScorecardImport;
  if (card.schema !== "agx-security-scorecard/1") {
    throw new Error("unsupported scorecard schema (expected agx-security-scorecard/1)");
  }
  if (!Array.isArray(card.models) || card.models.length === 0) {
    throw new Error("scorecard contains no model results");
  }
  for (const m of card.models) {
    if (typeof m.model !== "string" || !m.model) throw new Error("scorecard model entry missing model name");
    if (isReservedObjectKey(m.model)) {
      throw new Error("scorecard model name is a reserved object key");
    }
    if (typeof m.safety_score !== "number" || Number.isNaN(m.safety_score)) {
      throw new Error(`scorecard entry for ${m.model} missing safety_score`);
    }
  }
  return card;
}

export async function importScorecard(
  tenantId: string,
  card: ScorecardImport,
): Promise<number> {
  // Validate again at the store boundary (route already validates).
  parseScorecardImport(card);
  const config = await readModelAdmission();
  const tenant = config.tenants[tenantId] ?? {
    threshold: { ...DEFAULT_THRESHOLD },
    scorecards: {},
    overrides: [],
  };
  let imported = 0;
  for (const m of card.models ?? []) {
    if (isReservedObjectKey(m.model)) {
      // Store-boundary re-validation (route already validates): reserved keys
      // must never reach a plain-object assignment.
      throw new Error("scorecard model name is a reserved object key");
    }
    const entry: ScorecardEntry = {
      model: m.model,
      provider: m.provider,
      runId: card.run_id,
      createdAt: card.created_at,
      corpusVersion: card.corpus?.version ?? "",
      safetyScore: m.safety_score,
      grade: m.grade,
      attempts: m.attempts,
      refused: m.refused,
      blockedByRule: m.blocked_by_rule,
      bypassed: m.bypassed,
      errors: m.errors,
      source: "agx-security-eval",
    };
    const existing = tenant.scorecards[entry.model];
    if (existing) {
      existing.history = [existing.latest, ...existing.history].slice(0, HISTORY_CAP);
      existing.latest = entry;
      tenant.scorecards[entry.model] = existing;
    } else {
      tenant.scorecards[entry.model] = { latest: entry, history: [] };
    }
    imported += 1;
  }
  config.tenants[tenantId] = tenant;
  await writeConfig(config);
  return imported;
}

export async function recordOverride(
  tenantId: string,
  override: AdmissionOverride,
): Promise<AdmissionOverride> {
  const config = await readModelAdmission();
  const tenant = config.tenants[tenantId] ?? {
    threshold: { ...DEFAULT_THRESHOLD },
    scorecards: {},
    overrides: [],
  };
  tenant.overrides = [override, ...tenant.overrides].slice(0, 100);
  config.tenants[tenantId] = tenant;
  await writeConfig(config);
  return override;
}
