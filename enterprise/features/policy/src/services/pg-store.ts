import { promises as fs } from "node:fs";
import path from "node:path";
import {
  policyPublishEvents,
  policyRulePacks,
  policyRules,
  policyRuleVersions,
  type PolicyAppliesTo as DbPolicyAppliesTo,
} from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { ulid } from "ulid";
import { parse } from "yaml";
import { insertPolicyAuditEvent, type PolicyAuditActor } from "../audit";
import { readTenantSnapshot, replaceTenantSnapshot, writeSnapshotWithCas } from "../snapshot/writer";
import {
  DEFAULT_POLICY_APPLIES_TO,
  type PolicyAppliesTo,
  type PolicyPack,
  type PolicyPublishEvent,
  type PolicyRule,
  type PolicyRuleFilter,
  type PolicyRulePayload,
  type PolicyRuleStatus,
  type PolicySnapshot,
  type PolicyStage,
  type PolicyTestHit,
  type PolicyTestResult,
  type PublishResult,
  type UpsertPolicyPackInput,
  type UpsertPolicyRuleInput,
} from "../types";

type BuiltinManifestRule = {
  id: string;
  kind: "keyword" | "regex" | "pii";
  action: "block" | "redact" | "warn";
  severity: "low" | "medium" | "high" | "critical";
  message?: string;
  keywords?: string[];
  pattern?: string;
  pii_type?: string;
};

type BuiltinManifest = {
  name: string;
  description?: string;
  rules?: BuiltinManifestRule[];
};

const BUILTIN_PLUGIN_PREFIX = "moderation-";
const PIIPatterns: Record<string, RegExp> = {
  mobile: /(?:(?:\+?86)?1[3-9]\d{9})/g,
  email: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g,
  "id-card": /\b\d{17}[\dXx]\b/g,
  "bank-card": /\b\d{16,19}\b/g,
  "api-key": /\b(?:sk|ak|pk|token)[-_]?[a-z0-9]{16,}\b/gi,
};

function toIso(v: Date): string {
  return v.toISOString();
}

function resolveEnterpriseRoot(): string {
  const cwd = process.cwd();
  if (cwd.endsWith("/enterprise")) return cwd;
  if (cwd.includes("/enterprise/")) {
    return cwd.slice(0, cwd.indexOf("/enterprise/") + "/enterprise".length);
  }
  return path.resolve(cwd, "../..");
}

function resolvePluginsDir(): string {
  const root = resolveEnterpriseRoot();
  return path.join(root, "plugins");
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function normalizeAppliesTo(input?: Partial<PolicyAppliesTo> | DbPolicyAppliesTo | null): PolicyAppliesTo {
  const src = input ?? {};
  return {
    version: 1,
    departmentIds: uniq(src.departmentIds ?? DEFAULT_POLICY_APPLIES_TO.departmentIds),
    departmentRecursive: src.departmentRecursive ?? DEFAULT_POLICY_APPLIES_TO.departmentRecursive,
    roleCodes: uniq(src.roleCodes ?? DEFAULT_POLICY_APPLIES_TO.roleCodes),
    userIds: uniq(src.userIds ?? DEFAULT_POLICY_APPLIES_TO.userIds),
    userExcludeIds: uniq(src.userExcludeIds ?? DEFAULT_POLICY_APPLIES_TO.userExcludeIds),
    clientTypes: uniq(src.clientTypes ?? DEFAULT_POLICY_APPLIES_TO.clientTypes),
    stages: (src.stages?.filter((s): s is PolicyStage => s === "request" || s === "response") ??
      DEFAULT_POLICY_APPLIES_TO.stages) as PolicyStage[],
  };
}

function normalizeRulePayload(kind: UpsertPolicyRuleInput["kind"], payload: PolicyRulePayload): PolicyRulePayload {
  if (kind === "keyword") {
    const keywords = uniq(payload.keywords ?? []);
    if (!keywords.length) throw new Error("关键词规则至少需要一个关键词");
    return { keywords };
  }
  if (kind === "regex") {
    const pattern = payload.pattern?.trim();
    if (!pattern) throw new Error("正则规则缺少 pattern");
    return { pattern };
  }
  const piiType = payload.piiType?.trim();
  if (!piiType) throw new Error("PII 规则缺少 piiType");
  return { piiType };
}

function dbPackToModel(row: typeof policyRulePacks.$inferSelect): PolicyPack {
  return {
    id: row.id,
    tenantId: row.tenantId,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    source: row.source as PolicyPack["source"],
    enabled: row.enabled,
    appliesTo: normalizeAppliesTo(row.appliesTo as DbPolicyAppliesTo),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function dbRuleToModel(row: typeof policyRules.$inferSelect): PolicyRule {
  const payload = (row.payload ?? {}) as PolicyRulePayload;
  return {
    id: row.id,
    tenantId: row.tenantId,
    packId: row.packId,
    code: row.code,
    kind: row.kind as PolicyRule["kind"],
    action: row.action as PolicyRule["action"],
    severity: row.severity as PolicyRule["severity"],
    message: row.message ?? null,
    payload,
    appliesTo: row.appliesTo ? normalizeAppliesTo(row.appliesTo as DbPolicyAppliesTo) : null,
    status: row.status as PolicyRuleStatus,
    updatedBy: row.updatedBy ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function normalizeRegex(pattern: string): { source: string; flags: string } {
  if (pattern.startsWith("(?i)")) {
    return { source: pattern.slice(4), flags: "gi" };
  }
  return { source: pattern, flags: "g" };
}

function findMatches(rule: PolicyRule, text: string): string[] {
  if (rule.kind === "keyword") {
    const out: string[] = [];
    for (const kw of rule.payload.keywords ?? []) {
      if (!kw) continue;
      if (text.includes(kw)) out.push(kw);
    }
    return out;
  }
  if (rule.kind === "regex") {
    const pattern = rule.payload.pattern ?? "";
    if (!pattern) return [];
    const { source, flags } = normalizeRegex(pattern);
    const re = new RegExp(source, flags);
    return Array.from(text.matchAll(re)).map((m) => m[0]).filter(Boolean);
  }
  const piiType = (rule.payload.piiType ?? "").toLowerCase();
  const re = PIIPatterns[piiType];
  if (!re) return [];
  return Array.from(text.matchAll(re)).map((m) => m[0]).filter(Boolean);
}

export class PgPolicyStore {
  private builtinSeeded = new Set<string>();

  private async assertPackBelongsToTenant(tenantId: string, packId: string): Promise<void> {
    const db = getIamDb();
    const [pack] = await db
      .select({ id: policyRulePacks.id })
      .from(policyRulePacks)
      .where(and(eq(policyRulePacks.tenantId, tenantId), eq(policyRulePacks.id, packId)))
      .limit(1);
    if (!pack) throw new Error("规则包不存在或不属于当前租户");
  }

  public async ensureBuiltinSeed(tenantId: string): Promise<void> {
    if (this.builtinSeeded.has(tenantId)) return;
    const db = getIamDb();
    const pluginDir = resolvePluginsDir();
    let entries: string[] = [];
    try {
      const dirs = await fs.readdir(pluginDir, { withFileTypes: true });
      entries = dirs.filter((d) => d.isDirectory() && d.name.startsWith(BUILTIN_PLUGIN_PREFIX)).map((d) => d.name);
    } catch {
      this.builtinSeeded.add(tenantId);
      return;
    }

    for (const dirName of entries.sort()) {
      const manifestPath = path.join(pluginDir, dirName, "manifest.yaml");
      let raw = "";
      try {
        raw = await fs.readFile(manifestPath, "utf-8");
      } catch {
        continue;
      }
      const manifest = parse(raw) as BuiltinManifest;
      const code = (manifest.name || dirName).trim();
      if (!code) continue;
      const now = new Date();
      const packId = ulid();
      await db
        .insert(policyRulePacks)
        .values({
          id: packId,
          tenantId,
          code,
          name: code,
          description: manifest.description ?? null,
          source: "builtin",
          enabled: true,
          appliesTo: normalizeAppliesTo(DEFAULT_POLICY_APPLIES_TO),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [policyRulePacks.tenantId, policyRulePacks.code],
          set: {
            name: code,
            description: manifest.description ?? null,
            source: "builtin",
            updatedAt: now,
          },
        });

      const [packRow] = await db
        .select({ id: policyRulePacks.id })
        .from(policyRulePacks)
        .where(and(eq(policyRulePacks.tenantId, tenantId), eq(policyRulePacks.code, code)))
        .limit(1);
      const resolvedPackId = packRow?.id;
      if (!resolvedPackId) continue;

      for (const rule of manifest.rules ?? []) {
        if (!rule?.id) continue;
        const payload: PolicyRulePayload =
          rule.kind === "keyword"
            ? { keywords: uniq(rule.keywords ?? []) }
            : rule.kind === "regex"
              ? { pattern: rule.pattern ?? "" }
              : { piiType: rule.pii_type ?? "" };
        const normalizedPayload = normalizeRulePayload(rule.kind, payload);
        await db
          .insert(policyRules)
          .values({
            id: ulid(),
            tenantId,
            packId: resolvedPackId,
            code: rule.id,
            kind: rule.kind,
            action: rule.action,
            severity: rule.severity,
            message: rule.message ?? null,
            payload: normalizedPayload,
            appliesTo: null,
            status: "active",
            updatedBy: null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [policyRules.tenantId, policyRules.packId, policyRules.code],
            set: {
              kind: rule.kind,
              action: rule.action,
              severity: rule.severity,
              message: rule.message ?? null,
              payload: normalizedPayload,
              updatedAt: now,
            },
          });
      }
    }

    this.builtinSeeded.add(tenantId);
  }

  public async listPacks(tenantId: string): Promise<PolicyPack[]> {
    await this.ensureBuiltinSeed(tenantId);
    const db = getIamDb();
    const rows = await db
      .select()
      .from(policyRulePacks)
      .where(eq(policyRulePacks.tenantId, tenantId))
      .orderBy(asc(policyRulePacks.code));
    return rows.map(dbPackToModel);
  }

  public async getPack(tenantId: string, code: string): Promise<PolicyPack | null> {
    await this.ensureBuiltinSeed(tenantId);
    const db = getIamDb();
    const [row] = await db
      .select()
      .from(policyRulePacks)
      .where(and(eq(policyRulePacks.tenantId, tenantId), eq(policyRulePacks.code, code)))
      .limit(1);
    return row ? dbPackToModel(row) : null;
  }

  public async createPack(input: UpsertPolicyPackInput): Promise<PolicyPack> {
    await this.ensureBuiltinSeed(input.tenantId);
    const db = getIamDb();
    const code = input.code.trim();
    const name = input.name.trim() || code;
    if (!code) throw new Error("规则包 code 不能为空");
    const now = new Date();
    await db.insert(policyRulePacks).values({
      id: ulid(),
      tenantId: input.tenantId,
      code,
      name,
      description: input.description ?? null,
      source: input.source ?? "custom",
      enabled: input.enabled ?? true,
      appliesTo: normalizeAppliesTo(input.appliesTo),
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.getPack(input.tenantId, code);
    if (!created) throw new Error("创建规则包失败");
    return created;
  }

  public async updatePack(
    tenantId: string,
    code: string,
    patch: Partial<Omit<UpsertPolicyPackInput, "tenantId" | "code" | "source">>
  ): Promise<PolicyPack> {
    await this.ensureBuiltinSeed(tenantId);
    const db = getIamDb();
    const [current] = await db
      .select()
      .from(policyRulePacks)
      .where(and(eq(policyRulePacks.tenantId, tenantId), eq(policyRulePacks.code, code)))
      .limit(1);
    if (!current) throw new Error("规则包不存在");
    if (current.source === "builtin" && patch.name && patch.name !== current.name) {
      throw new Error("内置规则包不允许改名");
    }
    const nextAppliesTo =
      patch.appliesTo === undefined
        ? undefined
        : patch.appliesTo === null
          ? normalizeAppliesTo(DEFAULT_POLICY_APPLIES_TO)
          : normalizeAppliesTo(patch.appliesTo);
    await db
      .update(policyRulePacks)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() || current.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description ?? null } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(nextAppliesTo ? { appliesTo: nextAppliesTo } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(policyRulePacks.tenantId, tenantId), eq(policyRulePacks.code, code)));
    const updated = await this.getPack(tenantId, code);
    if (!updated) throw new Error("更新规则包失败");
    return updated;
  }

  public async deletePack(tenantId: string, code: string): Promise<void> {
    await this.ensureBuiltinSeed(tenantId);
    const db = getIamDb();
    const [current] = await db
      .select()
      .from(policyRulePacks)
      .where(and(eq(policyRulePacks.tenantId, tenantId), eq(policyRulePacks.code, code)))
      .limit(1);
    if (!current) throw new Error("规则包不存在");
    if (current.source === "builtin") throw new Error("内置规则包不允许删除");
    await db.delete(policyRulePacks).where(and(eq(policyRulePacks.tenantId, tenantId), eq(policyRulePacks.code, code)));
  }

  public async listRules(tenantId: string, filter: PolicyRuleFilter = {}): Promise<PolicyRule[]> {
    await this.ensureBuiltinSeed(tenantId);
    const db = getIamDb();
    let packId: string | null = null;
    if (filter.packCode) {
      const [pack] = await db
        .select({ id: policyRulePacks.id })
        .from(policyRulePacks)
        .where(and(eq(policyRulePacks.tenantId, tenantId), eq(policyRulePacks.code, filter.packCode)))
        .limit(1);
      packId = pack?.id ?? null;
      if (!packId) return [];
    }
    const conditions = [eq(policyRules.tenantId, tenantId)];
    if (packId) conditions.push(eq(policyRules.packId, packId));
    if (filter.kind) conditions.push(eq(policyRules.kind, filter.kind));
    if (filter.status) conditions.push(eq(policyRules.status, filter.status));
    const rows = await db
      .select()
      .from(policyRules)
      .where(and(...conditions))
      .orderBy(asc(policyRules.code));
    return rows.map(dbRuleToModel);
  }

  public async upsertRule(input: UpsertPolicyRuleInput): Promise<PolicyRule> {
    await this.ensureBuiltinSeed(input.tenantId);
    const db = getIamDb();
    const code = input.code.trim();
    if (!code) throw new Error("规则 code 不能为空");
    const payload = normalizeRulePayload(input.kind, input.payload);
    const nextAppliesTo = input.appliesTo === null ? null : input.appliesTo ? normalizeAppliesTo(input.appliesTo) : undefined;
    const now = new Date();
    await this.assertPackBelongsToTenant(input.tenantId, input.packId);

    if (input.id) {
      const [current] = await db
        .select()
        .from(policyRules)
        .where(and(eq(policyRules.tenantId, input.tenantId), eq(policyRules.id, input.id)))
        .limit(1);
      if (!current) throw new Error("规则不存在");
      await db
        .update(policyRules)
        .set({
          packId: input.packId,
          code,
          kind: input.kind,
          action: input.action,
          severity: input.severity,
          message: input.message ?? null,
          payload,
          ...(nextAppliesTo !== undefined ? { appliesTo: nextAppliesTo } : {}),
          ...(input.status ? { status: input.status } : {}),
          updatedBy: input.updatedBy ?? null,
          updatedAt: now,
        })
        .where(and(eq(policyRules.tenantId, input.tenantId), eq(policyRules.id, input.id)));
      const [updated] = await db
        .select()
        .from(policyRules)
        .where(and(eq(policyRules.tenantId, input.tenantId), eq(policyRules.id, input.id)))
        .limit(1);
      if (!updated) throw new Error("更新规则失败");
      return dbRuleToModel(updated);
    }

    const id = ulid();
    await db.insert(policyRules).values({
      id,
      tenantId: input.tenantId,
      packId: input.packId,
      code,
      kind: input.kind,
      action: input.action,
      severity: input.severity,
      message: input.message ?? null,
      payload,
      appliesTo: nextAppliesTo === undefined ? null : nextAppliesTo,
      status: input.status ?? "draft",
      updatedBy: input.updatedBy ?? null,
      createdAt: now,
      updatedAt: now,
    });
    const [created] = await db
      .select()
      .from(policyRules)
      .where(and(eq(policyRules.tenantId, input.tenantId), eq(policyRules.id, id)))
      .limit(1);
    if (!created) throw new Error("创建规则失败");
    return dbRuleToModel(created);
  }

  public async deleteRule(tenantId: string, ruleId: string): Promise<void> {
    const db = getIamDb();
    await db.delete(policyRules).where(and(eq(policyRules.tenantId, tenantId), eq(policyRules.id, ruleId)));
  }

  public async setRuleStatus(
    tenantId: string,
    ruleId: string,
    status: PolicyRuleStatus,
    updatedBy?: string
  ): Promise<void> {
    const db = getIamDb();
    const updated = await db
      .update(policyRules)
      .set({ status, updatedBy: updatedBy ?? null, updatedAt: new Date() })
      .where(and(eq(policyRules.tenantId, tenantId), eq(policyRules.id, ruleId)))
      .returning({ id: policyRules.id });
    if (!updated.length) {
      throw new Error("规则不存在");
    }
  }

  public async testRules(
    tenantId: string,
    ruleIds: string[],
    sampleText: string,
    stage: PolicyStage = "request"
  ): Promise<PolicyTestResult> {
    const db = getIamDb();
    const cleanIds = uniq(ruleIds);
    if (!cleanIds.length) {
      return { blocked: false, redactedText: sampleText, hits: [] };
    }
    const rows = await db
      .select()
      .from(policyRules)
      .where(and(eq(policyRules.tenantId, tenantId), inArray(policyRules.id, cleanIds)));
    let redactedText = sampleText;
    let blocked = false;
    const hits: PolicyTestHit[] = [];
    for (const row of rows.map(dbRuleToModel)) {
      const matched = findMatches(row, redactedText);
      for (const item of matched) {
        hits.push({
          ruleId: row.id,
          code: row.code,
          kind: row.kind,
          action: row.action,
          severity: row.severity,
          message: row.message ?? null,
          matched: item,
          stage,
        });
        if (row.action === "block") blocked = true;
        if (row.action === "redact") {
          redactedText = redactedText.split(item).join("[REDACTED]");
        }
      }
    }
    return { blocked, redactedText, hits };
  }

  private async nextPublishVersion(tenantId: string): Promise<number> {
    const db = getIamDb();
    const [row] = await db
      .select({ maxVersion: max(policyPublishEvents.version) })
      .from(policyPublishEvents)
      .where(eq(policyPublishEvents.tenantId, tenantId));
    return (row?.maxVersion ?? 0) + 1;
  }

  private async buildSnapshot(tenantId: string, version: number, publisher: string | null): Promise<PolicySnapshot> {
    await this.ensureBuiltinSeed(tenantId);
    const db = getIamDb();
    const packs = await db
      .select()
      .from(policyRulePacks)
      .where(and(eq(policyRulePacks.tenantId, tenantId), eq(policyRulePacks.enabled, true)))
      .orderBy(asc(policyRulePacks.code));
    const rules = await db
      .select()
      .from(policyRules)
      .where(and(eq(policyRules.tenantId, tenantId), eq(policyRules.status, "active")))
      .orderBy(asc(policyRules.code));

    const rulesByPack = new Map<string, PolicyRule[]>();
    for (const row of rules) {
      const mapped = dbRuleToModel(row);
      const list = rulesByPack.get(mapped.packId) ?? [];
      list.push(mapped);
      rulesByPack.set(mapped.packId, list);
    }

    return {
      tenantId,
      version,
      publishedAt: new Date().toISOString(),
      publisher,
      deptIndex: {},
      packs: packs.map((pack) => {
        const packModel = dbPackToModel(pack);
        const childRules = rulesByPack.get(pack.id) ?? [];
        return {
          code: packModel.code,
          name: packModel.name,
          description: packModel.description,
          source: packModel.source,
          enabled: packModel.enabled,
          appliesTo: packModel.appliesTo,
          rules: childRules.map((r) => ({
            id: r.id,
            code: r.code,
            kind: r.kind,
            action: r.action,
            severity: r.severity,
            message: r.message,
            payload: r.payload,
            appliesTo: r.appliesTo,
            status: r.status,
            updatedBy: r.updatedBy,
          })),
        };
      }),
    };
  }

  private async appendRuleVersions(tenantId: string, rules: PolicyRule[], actorId: string | null): Promise<void> {
    const db = getIamDb();
    for (const rule of rules) {
      const [row] = await db
        .select({ maxVersion: max(policyRuleVersions.version) })
        .from(policyRuleVersions)
        .where(and(eq(policyRuleVersions.tenantId, tenantId), eq(policyRuleVersions.ruleId, rule.id)));
      const version = (row?.maxVersion ?? 0) + 1;
      await db.insert(policyRuleVersions).values({
        id: ulid(),
        tenantId,
        ruleId: rule.id,
        version,
        snapshot: rule,
        author: actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  private async toPublishEvent(row: typeof policyPublishEvents.$inferSelect): Promise<PolicyPublishEvent> {
    return {
      id: row.id,
      tenantId: row.tenantId,
      version: row.version,
      snapshot: row.snapshot as PolicySnapshot,
      summary: (row.summary ?? null) as Record<string, unknown> | null,
      publisher: row.publisher ?? null,
      publishedAt: row.publishedAt.toISOString(),
      status: row.status as PolicyPublishEvent["status"],
    };
  }

  public async listPublishes(tenantId: string, limit = 20): Promise<PolicyPublishEvent[]> {
    const db = getIamDb();
    const rows = await db
      .select()
      .from(policyPublishEvents)
      .where(eq(policyPublishEvents.tenantId, tenantId))
      .orderBy(desc(policyPublishEvents.publishedAt))
      .limit(Math.max(1, Math.min(limit, 100)));
    const out: PolicyPublishEvent[] = [];
    for (const row of rows) out.push(await this.toPublishEvent(row));
    return out;
  }

  public async publish(
    tenantId: string,
    actor: PolicyAuditActor,
    options?: { activateDraftRuleIds?: string[] }
  ): Promise<PublishResult> {
    await this.ensureBuiltinSeed(tenantId);
    const db = getIamDb();
    const previousSnapshot = await readTenantSnapshot(tenantId);
    const previousPublishId = previousSnapshot?.publishId ?? null;
    let snapshotWritten = false;
    let snapshotPath = "";
    let publishId = "";
    let publishVersion = 0;
    let publishedRuleCount = 0;
    let publishedPackCount = 0;

    try {
      await db.transaction(async (tx) => {
        publishId = ulid();
        if (options?.activateDraftRuleIds?.length) {
          const clean = uniq(options.activateDraftRuleIds);
          await tx
            .update(policyRules)
            .set({ status: "active", updatedBy: actor.userId, updatedAt: new Date() })
            .where(and(eq(policyRules.tenantId, tenantId), inArray(policyRules.id, clean)));
        }

        const [versionRow] = await tx
          .select({ maxVersion: max(policyPublishEvents.version) })
          .from(policyPublishEvents)
          .where(eq(policyPublishEvents.tenantId, tenantId));
        const version = (versionRow?.maxVersion ?? 0) + 1;
        publishVersion = version;

        const packs = await tx
          .select()
          .from(policyRulePacks)
          .where(and(eq(policyRulePacks.tenantId, tenantId), eq(policyRulePacks.enabled, true)))
          .orderBy(asc(policyRulePacks.code));
        const activeRuleRows = await tx
          .select()
          .from(policyRules)
          .orderBy(asc(policyRules.code))
          .where(and(eq(policyRules.tenantId, tenantId), eq(policyRules.status, "active")));
        const activeRules = activeRuleRows.map(dbRuleToModel);

        const rulesByPack = new Map<string, PolicyRule[]>();
        for (const row of activeRules) {
          const list = rulesByPack.get(row.packId) ?? [];
          list.push(row);
          rulesByPack.set(row.packId, list);
        }

        const snapshot: PolicySnapshot = {
          tenantId,
          version,
          publishId,
          publishedAt: new Date().toISOString(),
          publisher: actor.userId,
          deptIndex: {},
          packs: packs.map((pack) => {
            const packModel = dbPackToModel(pack);
            const childRules = rulesByPack.get(pack.id) ?? [];
            return {
              code: packModel.code,
              name: packModel.name,
              description: packModel.description,
              source: packModel.source,
              enabled: packModel.enabled,
              appliesTo: packModel.appliesTo,
              rules: childRules.map((r) => ({
                id: r.id,
                code: r.code,
                kind: r.kind,
                action: r.action,
                severity: r.severity,
                message: r.message,
                payload: r.payload,
                appliesTo: r.appliesTo,
                status: r.status,
                updatedBy: r.updatedBy,
              })),
            };
          }),
        };
        publishedRuleCount = activeRules.length;
        publishedPackCount = snapshot.packs.length;

        for (const rule of activeRules) {
          const [row] = await tx
            .select({ maxVersion: max(policyRuleVersions.version) })
            .from(policyRuleVersions)
            .where(and(eq(policyRuleVersions.tenantId, tenantId), eq(policyRuleVersions.ruleId, rule.id)));
          const nextVersion = (row?.maxVersion ?? 0) + 1;
          await tx.insert(policyRuleVersions).values({
            id: ulid(),
            tenantId,
            ruleId: rule.id,
            version: nextVersion,
            snapshot: rule,
            author: actor.userId,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }

        const now = new Date();
        snapshotPath = await writeSnapshotWithCas(snapshot, previousPublishId);
        snapshotWritten = true;
        await tx.insert(policyPublishEvents).values({
          id: publishId,
          tenantId,
          version,
          snapshot,
          summary: { packCount: snapshot.packs.length, ruleCount: activeRules.length },
          publisher: actor.userId,
          publishedAt: now,
          status: "published",
          createdAt: now,
          updatedAt: now,
        });
      });
    } catch (error) {
      if (snapshotWritten) {
        await replaceTenantSnapshot(tenantId, previousSnapshot, { expectedCurrentPublishId: publishId }).catch(
          () => undefined
        );
      }
      throw error;
    }

    if (publishId) {
      await insertPolicyAuditEvent(actor, "policy_publish", {
        publish_id: publishId,
        version: publishVersion,
        pack_count: publishedPackCount,
        rule_count: publishedRuleCount,
      }).catch(() => undefined);
    }

    const [row] = await db
      .select()
      .from(policyPublishEvents)
      .where(and(eq(policyPublishEvents.tenantId, tenantId), eq(policyPublishEvents.id, publishId)))
      .limit(1);
    if (!row) throw new Error("发布记录写入失败");
    return { event: await this.toPublishEvent(row), snapshotPath };
  }

  public async rollback(tenantId: string, eventId: string, actor: PolicyAuditActor): Promise<PublishResult> {
    const db = getIamDb();
    const previousSnapshot = await readTenantSnapshot(tenantId);
    const previousPublishId = previousSnapshot?.publishId ?? null;
    let snapshotWritten = false;
    let snapshotPath = "";
    let publishId = "";
    let version = 0;

    try {
      await db.transaction(async (tx) => {
        const [target] = await tx
          .select()
          .from(policyPublishEvents)
          .where(and(eq(policyPublishEvents.tenantId, tenantId), eq(policyPublishEvents.id, eventId)))
          .limit(1);
        if (!target) throw new Error("目标发布记录不存在");

        const sourceSnapshot = target.snapshot as PolicySnapshot;
        const [versionRow] = await tx
          .select({ maxVersion: max(policyPublishEvents.version) })
          .from(policyPublishEvents)
          .where(eq(policyPublishEvents.tenantId, tenantId));
        version = (versionRow?.maxVersion ?? 0) + 1;
        publishId = ulid();
        const now = new Date();
        const nextSnapshot: PolicySnapshot = {
          ...sourceSnapshot,
          version,
          publishId,
          publishedAt: now.toISOString(),
          publisher: actor.userId,
        };

        await tx
          .update(policyPublishEvents)
          .set({ status: "rolled_back", updatedAt: now })
          .where(and(eq(policyPublishEvents.tenantId, tenantId), eq(policyPublishEvents.id, eventId)));

        snapshotPath = await writeSnapshotWithCas(nextSnapshot, previousPublishId);
        snapshotWritten = true;
        await tx.insert(policyPublishEvents).values({
          id: publishId,
          tenantId,
          version,
          snapshot: nextSnapshot,
          summary: { rollbackFrom: eventId, packCount: nextSnapshot.packs.length },
          publisher: actor.userId,
          publishedAt: now,
          status: "published",
          createdAt: now,
          updatedAt: now,
        });
      });
    } catch (error) {
      if (snapshotWritten) {
        await replaceTenantSnapshot(tenantId, previousSnapshot, { expectedCurrentPublishId: publishId }).catch(
          () => undefined
        );
      }
      throw error;
    }

    if (publishId) {
      await insertPolicyAuditEvent(actor, "policy_publish", {
        publish_id: publishId,
        version,
        rollback_from: eventId,
      }).catch(() => undefined);
    }

    const [row] = await db
      .select()
      .from(policyPublishEvents)
      .where(and(eq(policyPublishEvents.tenantId, tenantId), eq(policyPublishEvents.id, publishId)))
      .limit(1);
    if (!row) throw new Error("回滚发布记录写入失败");
    return { event: await this.toPublishEvent(row), snapshotPath };
  }

  public async recordRuleChange(
    actor: PolicyAuditActor,
    detail: Record<string, unknown>
  ): Promise<void> {
    await insertPolicyAuditEvent(actor, "policy_rule_change", detail);
  }
}
