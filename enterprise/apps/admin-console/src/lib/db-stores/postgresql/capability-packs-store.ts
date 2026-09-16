/**
 * admin-console · 企业能力包持久化（PG）
 *
 * 能力一律以 `mcp:<ulid>` / `skill:<ulid>` 引用，构造与校验走 @agenticx/config
 * 的 capability-id，避免各处手拼出第二种写法。
 */

import {
  enterpriseCapabilityAssignments,
  enterpriseCapabilityPackMembers,
  enterpriseCapabilityPacks,
  enterpriseSkills,
} from "@agenticx/db-schema";
import { isCapabilityId } from "@agenticx/config";
import { getIamDb } from "@agenticx/iam-core";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ulid } from "ulid";

export type CapabilityStatus = "active" | "disabled";

export interface SkillRecord {
  id: string;
  tenantId: string;
  slug: string;
  displayName: string;
  description: string;
  version: string;
  bundleUri: string;
  bundleDigest: string;
  requiredCapabilities: string[];
  status: CapabilityStatus;
  /**
   * 安全扫描结论。null 表示从未扫过——手工登记的技能就是这个状态。
   * 货架上必须和「扫过且判定安全」分开显示，否则「没查过」会被看成「查过没问题」。
   */
  scanVerdict: string | null;
  scanSource: string | null;
  scannedAt: string | null;
  scannedBy: string | null;
  scanFindings: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityPackRecord {
  id: string;
  tenantId: string;
  slug: string;
  displayName: string;
  description: string;
  status: CapabilityStatus;
  metadata: Record<string, unknown>;
  /** `mcp:<ulid>` / `skill:<ulid>` */
  capabilityIds: string[];
  /** `all` / `dept:<id>` / 用户 ulid */
  assignmentKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillInput {
  slug: string;
  displayName?: string;
  description?: string;
  version?: string;
  bundleUri?: string;
  bundleDigest?: string;
  requiredCapabilities?: string[];
  status?: CapabilityStatus;
}

export interface UpdateSkillInput {
  displayName?: string;
  description?: string;
  version?: string;
  bundleUri?: string;
  bundleDigest?: string;
  requiredCapabilities?: string[];
  status?: CapabilityStatus;
}

export interface CreateCapabilityPackInput {
  slug: string;
  displayName?: string;
  description?: string;
  status?: CapabilityStatus;
  metadata?: Record<string, unknown>;
  capabilityIds?: string[];
  assignmentKeys?: string[];
}

export interface UpdateCapabilityPackInput {
  displayName?: string;
  description?: string;
  status?: CapabilityStatus;
  metadata?: Record<string, unknown>;
  capabilityIds?: string[];
  assignmentKeys?: string[];
}

function requiredTenantId(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for capability pack persistence.");
  return t;
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** 非法能力 id 直接拒绝而不是静默丢弃——静默丢弃会让管理员以为已经加进去了。 */
export function assertCapabilityIds(ids: readonly string[]): string[] {
  const cleaned: string[] = [];
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    if (!isCapabilityId(id)) throw new Error(`invalid capability id: ${id}`);
    if (!cleaned.includes(id)) cleaned.push(id);
  }
  return cleaned;
}

/** 分配键：`all`、`dept:<id>`，或用户 ulid。 */
export function normalizeAssignmentKeys(keys: readonly string[]): string[] {
  const cleaned: string[] = [];
  for (const raw of keys) {
    const key = String(raw ?? "").trim();
    if (!key) continue;
    if (!cleaned.includes(key)) cleaned.push(key);
  }
  return cleaned;
}

function rowToSkill(row: typeof enterpriseSkills.$inferSelect): SkillRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    displayName: row.displayName ?? "",
    description: row.description ?? "",
    version: row.version,
    bundleUri: row.bundleUri ?? "",
    bundleDigest: row.bundleDigest ?? "",
    requiredCapabilities: Array.isArray(row.requiredCapabilities)
      ? row.requiredCapabilities.map(String)
      : [],
    status: (row.status as CapabilityStatus) || "active",
    scanVerdict: row.scanVerdict ?? null,
    scanSource: row.scanSource ?? null,
    scannedAt: row.scannedAt ?? null,
    scannedBy: row.scannedBy ?? null,
    scanFindings: Array.isArray(row.scanFindings) ? row.scanFindings : [],
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function listSkills(): Promise<SkillRecord[]> {
  const db = getIamDb();
  const tenantId = requiredTenantId();
  const rows = await db
    .select()
    .from(enterpriseSkills)
    .where(eq(enterpriseSkills.tenantId, tenantId))
    .orderBy(desc(enterpriseSkills.updatedAt));
  return rows.map(rowToSkill);
}

export async function getSkill(id: string): Promise<SkillRecord | null> {
  const db = getIamDb();
  const tenantId = requiredTenantId();
  const rows = await db
    .select()
    .from(enterpriseSkills)
    .where(and(eq(enterpriseSkills.tenantId, tenantId), eq(enterpriseSkills.id, id)))
    .limit(1);
  return rows[0] ? rowToSkill(rows[0]) : null;
}

export async function createSkill(input: CreateSkillInput): Promise<SkillRecord> {
  const db = getIamDb();
  const tenantId = requiredTenantId();
  const slug = input.slug.trim();
  if (!slug) throw new Error("slug is required");
  const id = ulid();
  const now = new Date();
  await db.insert(enterpriseSkills).values({
    id,
    tenantId,
    slug,
    displayName: input.displayName?.trim() || slug,
    description: input.description ?? "",
    version: input.version?.trim() || "0.0.0",
    bundleUri: input.bundleUri ?? "",
    bundleDigest: input.bundleDigest ?? "",
    requiredCapabilities: assertCapabilityIds(input.requiredCapabilities ?? []),
    status: input.status ?? "active",
    createdAt: now,
    updatedAt: now,
  });
  const created = await getSkill(id);
  if (!created) throw new Error("create failed");
  return created;
}

export type SkillScanResult = {
  verdict: string;
  source: string;
  findings: unknown[];
  scannedBy: string;
};

/**
 * 写入一次扫描的结论。
 *
 * 单独一个函数而不是并进 updateSkill：扫描结论不是管理员随手能改的字段，它记录的是
 * 「某次扫描实际扫出了什么」。混进通用 PATCH 里，等于允许把 dangerous 手动改成 safe，
 * 而这一页上点一下就发给全公司了。
 */
export async function recordSkillScan(id: string, result: SkillScanResult): Promise<SkillRecord> {
  const db = getIamDb();
  const tenantId = requiredTenantId();
  await db
    .update(enterpriseSkills)
    .set({
      scanVerdict: result.verdict,
      scanSource: result.source,
      scanFindings: result.findings,
      scannedBy: result.scannedBy,
      scannedAt: new Date().toISOString(),
      updatedAt: new Date(),
    })
    .where(and(eq(enterpriseSkills.tenantId, tenantId), eq(enterpriseSkills.id, id)));
  const updated = await getSkill(id);
  if (!updated) throw new Error("skill not found");
  return updated;
}

export async function updateSkill(id: string, input: UpdateSkillInput): Promise<SkillRecord> {
  const db = getIamDb();
  const tenantId = requiredTenantId();
  const patch: Partial<typeof enterpriseSkills.$inferInsert> = { updatedAt: new Date() };
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.description !== undefined) patch.description = input.description;
  if (input.version !== undefined) patch.version = input.version;
  if (input.bundleUri !== undefined) patch.bundleUri = input.bundleUri;
  if (input.bundleDigest !== undefined) patch.bundleDigest = input.bundleDigest;
  if (input.requiredCapabilities !== undefined) {
    patch.requiredCapabilities = assertCapabilityIds(input.requiredCapabilities);
  }
  if (input.status !== undefined) patch.status = input.status;
  await db
    .update(enterpriseSkills)
    .set(patch)
    .where(and(eq(enterpriseSkills.tenantId, tenantId), eq(enterpriseSkills.id, id)));
  const updated = await getSkill(id);
  if (!updated) throw new Error("skill not found");
  return updated;
}

export async function deleteSkill(id: string): Promise<boolean> {
  const db = getIamDb();
  const tenantId = requiredTenantId();
  const deleted = await db
    .delete(enterpriseSkills)
    .where(and(eq(enterpriseSkills.tenantId, tenantId), eq(enterpriseSkills.id, id)))
    .returning({ id: enterpriseSkills.id });
  return deleted.length > 0;
}

async function loadPackRelations(packIds: readonly string[]): Promise<{
  members: Map<string, string[]>;
  assignments: Map<string, string[]>;
}> {
  const members = new Map<string, string[]>();
  const assignments = new Map<string, string[]>();
  if (packIds.length === 0) return { members, assignments };
  const db = getIamDb();
  const tenantId = requiredTenantId();

  const memberRows = await db
    .select()
    .from(enterpriseCapabilityPackMembers)
    .where(inArray(enterpriseCapabilityPackMembers.packId, [...packIds]));
  for (const row of memberRows) {
    const list = members.get(row.packId) ?? [];
    list.push(row.capabilityId);
    members.set(row.packId, list);
  }

  const assignmentRows = await db
    .select()
    .from(enterpriseCapabilityAssignments)
    .where(
      and(
        eq(enterpriseCapabilityAssignments.tenantId, tenantId),
        inArray(enterpriseCapabilityAssignments.packId, [...packIds])
      )
    );
  for (const row of assignmentRows) {
    const list = assignments.get(row.packId) ?? [];
    list.push(row.assignmentKey);
    assignments.set(row.packId, list);
  }
  return { members, assignments };
}

function rowToPack(
  row: typeof enterpriseCapabilityPacks.$inferSelect,
  capabilityIds: string[],
  assignmentKeys: string[]
): CapabilityPackRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    displayName: row.displayName ?? "",
    description: row.description ?? "",
    status: (row.status as CapabilityStatus) || "active",
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    capabilityIds,
    assignmentKeys,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function listCapabilityPacks(): Promise<CapabilityPackRecord[]> {
  const db = getIamDb();
  const tenantId = requiredTenantId();
  const rows = await db
    .select()
    .from(enterpriseCapabilityPacks)
    .where(eq(enterpriseCapabilityPacks.tenantId, tenantId))
    .orderBy(desc(enterpriseCapabilityPacks.updatedAt));
  const { members, assignments } = await loadPackRelations(rows.map((r) => r.id));
  return rows.map((row) =>
    rowToPack(row, (members.get(row.id) ?? []).sort(), (assignments.get(row.id) ?? []).sort())
  );
}

export async function getCapabilityPack(id: string): Promise<CapabilityPackRecord | null> {
  const db = getIamDb();
  const tenantId = requiredTenantId();
  const rows = await db
    .select()
    .from(enterpriseCapabilityPacks)
    .where(and(eq(enterpriseCapabilityPacks.tenantId, tenantId), eq(enterpriseCapabilityPacks.id, id)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const { members, assignments } = await loadPackRelations([row.id]);
  return rowToPack(row, (members.get(row.id) ?? []).sort(), (assignments.get(row.id) ?? []).sort());
}

async function replaceMembers(packId: string, capabilityIds: string[]): Promise<void> {
  const db = getIamDb();
  const now = new Date();
  await db
    .delete(enterpriseCapabilityPackMembers)
    .where(eq(enterpriseCapabilityPackMembers.packId, packId));
  if (capabilityIds.length === 0) return;
  await db.insert(enterpriseCapabilityPackMembers).values(
    capabilityIds.map((capabilityId) => ({ packId, capabilityId, createdAt: now, updatedAt: now }))
  );
}

async function replaceAssignments(packId: string, assignmentKeys: string[]): Promise<void> {
  const db = getIamDb();
  const tenantId = requiredTenantId();
  const now = new Date();
  await db
    .delete(enterpriseCapabilityAssignments)
    .where(
      and(
        eq(enterpriseCapabilityAssignments.tenantId, tenantId),
        eq(enterpriseCapabilityAssignments.packId, packId)
      )
    );
  if (assignmentKeys.length === 0) return;
  await db.insert(enterpriseCapabilityAssignments).values(
    assignmentKeys.map((assignmentKey) => ({
      tenantId,
      packId,
      assignmentKey,
      createdAt: now,
      updatedAt: now,
    }))
  );
}

export async function createCapabilityPack(
  input: CreateCapabilityPackInput
): Promise<CapabilityPackRecord> {
  const db = getIamDb();
  const tenantId = requiredTenantId();
  const slug = input.slug.trim();
  if (!slug) throw new Error("slug is required");
  const capabilityIds = assertCapabilityIds(input.capabilityIds ?? []);
  const assignmentKeys = normalizeAssignmentKeys(input.assignmentKeys ?? []);
  const id = ulid();
  const now = new Date();
  await db.insert(enterpriseCapabilityPacks).values({
    id,
    tenantId,
    slug,
    displayName: input.displayName?.trim() || slug,
    description: input.description ?? "",
    status: input.status ?? "active",
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  });
  await replaceMembers(id, capabilityIds);
  await replaceAssignments(id, assignmentKeys);
  const created = await getCapabilityPack(id);
  if (!created) throw new Error("create failed");
  return created;
}

export async function updateCapabilityPack(
  id: string,
  input: UpdateCapabilityPackInput
): Promise<CapabilityPackRecord> {
  const db = getIamDb();
  const tenantId = requiredTenantId();
  const existing = await getCapabilityPack(id);
  if (!existing) throw new Error("pack not found");

  const patch: Partial<typeof enterpriseCapabilityPacks.$inferInsert> = { updatedAt: new Date() };
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.description !== undefined) patch.description = input.description;
  if (input.status !== undefined) patch.status = input.status;
  if (input.metadata !== undefined) patch.metadata = input.metadata;
  await db
    .update(enterpriseCapabilityPacks)
    .set(patch)
    .where(and(eq(enterpriseCapabilityPacks.tenantId, tenantId), eq(enterpriseCapabilityPacks.id, id)));

  if (input.capabilityIds !== undefined) {
    await replaceMembers(id, assertCapabilityIds(input.capabilityIds));
  }
  if (input.assignmentKeys !== undefined) {
    await replaceAssignments(id, normalizeAssignmentKeys(input.assignmentKeys));
  }
  const updated = await getCapabilityPack(id);
  if (!updated) throw new Error("pack not found");
  return updated;
}

export async function deleteCapabilityPack(id: string): Promise<boolean> {
  const db = getIamDb();
  const tenantId = requiredTenantId();
  const deleted = await db
    .delete(enterpriseCapabilityPacks)
    .where(and(eq(enterpriseCapabilityPacks.tenantId, tenantId), eq(enterpriseCapabilityPacks.id, id)))
    .returning({ id: enterpriseCapabilityPacks.id });
  return deleted.length > 0;
}
