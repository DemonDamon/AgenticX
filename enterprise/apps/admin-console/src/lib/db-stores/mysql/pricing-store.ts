import { getAdminMysqlDb } from "./database";
import { enterpriseRuntimePricing as pricingTable } from "@agenticx/db-schema/mysql";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

export type SurchargeWhen = {
  contextTokensGte?: number;
  hasReasoning?: boolean;
  toolCallsGte?: number;
};

export type SurchargeRule = {
  name?: string;
  when: SurchargeWhen;
  addPerM?: number;
  multiplierPct?: number;
  applyTo?: "input" | "output" | "reasoning" | "total";
};

export type ModelPricingEntry = {
  tier?: string;
  input: number;
  output: number;
  cachedInput?: number;
  cacheCreation?: number;
  cacheRead?: number;
  reasoningOutput?: number;
  inputPerM?: number;
  outputPerM?: number;
  reasoningPerM?: number;
  surcharges?: SurchargeRule[];
  effectiveDate?: string;
};

export type PricingConfig = {
  version: string;
  default: ModelPricingEntry;
  models: Record<string, ModelPricingEntry[]>;
  updatedAt: string;
};

const DEFAULT_CONFIG: PricingConfig = {
  version: "default-v1",
  default: {
    input: 0.000001,
    output: 0.000002,
    cachedInput: 0.0000001,
    cacheCreation: 0.000001,
    cacheRead: 0.0000001,
    reasoningOutput: 0.000003,
  },
  models: {
    "gpt-4o": [{ input: 0.0000025, output: 0.00001, cachedInput: 0.00000125 }],
    "gpt-4o-mini": [{ input: 0.00000015, output: 0.0000006, cachedInput: 0.000000075 }],
    "claude-3-5-sonnet-latest": [
      {
        input: 0.000003,
        output: 0.000015,
        cacheCreation: 0.00000375,
        cacheRead: 0.0000003,
      },
    ],
    "deepseek-chat": [{ input: 0.00000014, output: 0.00000028, cachedInput: 0.000000014 }],
  },
  updatedAt: new Date().toISOString(),
};

function tenant(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for pricing config.");
  return t;
}

function normalizeEntry(input: Partial<ModelPricingEntry> | undefined, fallback: ModelPricingEntry): ModelPricingEntry {
  const base = fallback;
  const next: ModelPricingEntry = {
    tier: input?.tier?.trim() || undefined,
    input: Number(input?.input ?? base.input),
    output: Number(input?.output ?? base.output),
    cachedInput: input?.cachedInput ?? base.cachedInput,
    cacheCreation: input?.cacheCreation ?? base.cacheCreation,
    cacheRead: input?.cacheRead ?? base.cacheRead,
    reasoningOutput: input?.reasoningOutput ?? base.reasoningOutput,
    inputPerM: input?.inputPerM,
    outputPerM: input?.outputPerM,
    reasoningPerM: input?.reasoningPerM,
    effectiveDate: input?.effectiveDate?.trim() || undefined,
    surcharges: Array.isArray(input?.surcharges) ? input!.surcharges!.map(normalizeSurcharge) : [],
  };
  return next;
}

function normalizeSurcharge(rule: SurchargeRule): SurchargeRule {
  const when: SurchargeWhen = {};
  if (rule.when?.contextTokensGte != null) when.contextTokensGte = Math.max(0, Math.floor(Number(rule.when.contextTokensGte)));
  if (rule.when?.hasReasoning != null) when.hasReasoning = !!rule.when.hasReasoning;
  if (rule.when?.toolCallsGte != null) when.toolCallsGte = Math.max(0, Math.floor(Number(rule.when.toolCallsGte)));
  const applyTo = rule.applyTo;
  return {
    name: rule.name?.trim() || undefined,
    when,
    addPerM: rule.addPerM != null && Number.isFinite(Number(rule.addPerM)) ? Number(rule.addPerM) : undefined,
    multiplierPct:
      rule.multiplierPct != null && Number.isFinite(Number(rule.multiplierPct)) ? Number(rule.multiplierPct) : undefined,
    applyTo: applyTo === "input" || applyTo === "output" || applyTo === "reasoning" || applyTo === "total" ? applyTo : "total",
  };
}

function normalizePricing(input: Partial<PricingConfig> | undefined): PricingConfig {
  const seedDefault = normalizeEntry(input?.default, DEFAULT_CONFIG.default);
  const models: Record<string, ModelPricingEntry[]> = {};
  for (const [model, entries] of Object.entries(input?.models ?? {})) {
    const key = model.trim();
    if (!key) continue;
    const list = Array.isArray(entries) ? entries : [entries as ModelPricingEntry];
    models[key] = list.map((entry) => normalizeEntry(entry, seedDefault));
  }
  if (Object.keys(models).length === 0) {
    for (const [model, entries] of Object.entries(DEFAULT_CONFIG.models)) {
      models[model] = entries.map((entry) => normalizeEntry(entry, seedDefault));
    }
  }
  const updatedAt = new Date().toISOString();
  const versionBase = input?.version?.trim() || `pricing-${updatedAt.slice(0, 10)}`;
  const version = `${versionBase}-${createHash("sha256").update(JSON.stringify({ default: seedDefault, models })).digest("hex").slice(0, 8)}`;
  return {
    version,
    default: seedDefault,
    models,
    updatedAt,
  };
}

function configFromRow(payload: Record<string, unknown> | undefined | null): PricingConfig | null {
  if (!payload || typeof payload !== "object") return null;
  return normalizePricing(payload as Partial<PricingConfig>);
}

/** 租户动态计价整包读取。 */
export async function getPricingConfig(): Promise<PricingConfig> {
  const tid = tenant();
  const db = getAdminMysqlDb();
  const row = await db.select().from(pricingTable).where(eq(pricingTable.tenantId, tid)).limit(1);
  if (!row.length) {
    const seed = normalizePricing(DEFAULT_CONFIG);
    await db
      .insert(pricingTable)
      .values({
        tenantId: tid,
        config: seed as unknown as Record<string, unknown>,
        updatedAt: new Date(seed.updatedAt),
      })
      .onDuplicateKeyUpdate({
        set: {
          config: seed as unknown as Record<string, unknown>,
          updatedAt: new Date(seed.updatedAt),
        },
      });
    return seed;
  }
  const parsed = configFromRow(row[0]?.config as Record<string, unknown>);
  return parsed ?? normalizePricing(DEFAULT_CONFIG);
}

export async function setPricingConfig(input: Partial<PricingConfig>): Promise<PricingConfig> {
  const tid = tenant();
  const next = normalizePricing(input);
  const db = getAdminMysqlDb();
  await db
    .insert(pricingTable)
    .values({
      tenantId: tid,
      config: next as unknown as Record<string, unknown>,
      updatedAt: new Date(next.updatedAt),
    })
    .onDuplicateKeyUpdate({
      set: {
        config: next as unknown as Record<string, unknown>,
        updatedAt: new Date(next.updatedAt),
      },
    });
  return next;
}

/** 网关拉取用的 active 计价快照（camelCase 字段对齐 Go json tags）。 */
export async function buildPricingSnapshotForGateway(): Promise<PricingConfig> {
  return getPricingConfig();
}
