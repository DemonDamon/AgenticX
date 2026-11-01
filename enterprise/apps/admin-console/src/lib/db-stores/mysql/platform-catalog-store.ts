/**
 * admin-console · 平台能力目录与跨租户 grant/revoke（MySQL）
 */

import {
  enterpriseSkills,
  platformCatalogItems,
  tenantDistributionGrants,
} from "@agenticx/db-schema/mysql";
import { getAdminMysqlDb } from "./database";
import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";

export type CatalogItemStatus = "active" | "disabled";
export type GrantStatus = "granted" | "revoked";
export type RevokePolicy = "retain_stop_updates" | "strip_bootstrap";
export type SkillOrigin = "tenant" | "platform";

export class PlatformSkillMetadataReadonlyError extends Error {
  constructor(message = "platform-origin skill metadata is read-only") {
    super(message);
    this.name = "PlatformSkillMetadataReadonlyError";
  }
}

export interface PlatformCatalogItemRecord {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  resourceType: string;
  version: string;
  bundleUri: string;
  bundleDigest: string;
  status: CatalogItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TenantDistributionGrantRecord {
  id: string;
  catalogItemId: string;
  tenantId: string;
  status: GrantStatus;
  revokePolicy: RevokePolicy | null;
  grantedAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlatformCatalogItemInput {
  slug: string;
  displayName?: string;
  description?: string;
  resourceType?: string;
  version?: string;
  bundleUri?: string;
  bundleDigest?: string;
  status?: CatalogItemStatus;
}

export interface UpdatePlatformCatalogItemInput {
  displayName?: string;
  description?: string;
  version?: string;
  bundleUri?: string;
  bundleDigest?: string;
  status?: CatalogItemStatus;
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowToCatalog(row: typeof platformCatalogItems.$inferSelect): PlatformCatalogItemRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName ?? "",
    description: row.description ?? "",
    resourceType: row.resourceType,
    version: row.version,
    bundleUri: row.bundleUri ?? "",
    bundleDigest: row.bundleDigest ?? "",
    status: (row.status as CatalogItemStatus) || "active",
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function rowToGrant(row: typeof tenantDistributionGrants.$inferSelect): TenantDistributionGrantRecord {
  return {
    id: row.id,
    catalogItemId: row.catalogItemId,
    tenantId: row.tenantId,
    status: (row.status as GrantStatus) || "granted",
    revokePolicy: (row.revokePolicy as RevokePolicy | null) ?? null,
    grantedAt: row.grantedAt,
    revokedAt: row.revokedAt ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function isPlatformOriginSkill(origin: string | null | undefined): boolean {
  return origin === "platform";
}

async function findTenantSkillByCatalogId(tenantId: string, catalogItemId: string) {
  const db = getAdminMysqlDb();
  const rows = await db
    .select()
    .from(enterpriseSkills)
    .where(
      and(
        eq(enterpriseSkills.tenantId, tenantId),
        eq(enterpriseSkills.platformCatalogItemId, catalogItemId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function upsertTenantSkillFromCatalog(
  tenantId: string,
  catalog: PlatformCatalogItemRecord,
): Promise<string> {
  const db = getAdminMysqlDb();
  const now = new Date();
  const existing = await findTenantSkillByCatalogId(tenantId, catalog.id);
  if (existing) {
    await db
      .update(enterpriseSkills)
      .set({
        slug: catalog.slug,
        displayName: catalog.displayName || catalog.slug,
        description: catalog.description,
        version: catalog.version,
        bundleUri: catalog.bundleUri,
        bundleDigest: catalog.bundleDigest,
        origin: "platform",
        platformCatalogItemId: catalog.id,
        status: catalog.status === "disabled" ? "disabled" : "active",
        updatedAt: now,
      })
      .where(eq(enterpriseSkills.id, existing.id));
    return existing.id;
  }
  const id = ulid();
  await db.insert(enterpriseSkills).values({
    id,
    tenantId,
    slug: catalog.slug,
    displayName: catalog.displayName || catalog.slug,
    description: catalog.description,
    version: catalog.version,
    bundleUri: catalog.bundleUri,
    bundleDigest: catalog.bundleDigest,
    requiredCapabilities: [],
    origin: "platform",
    platformCatalogItemId: catalog.id,
    status: catalog.status === "disabled" ? "disabled" : "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function syncCatalogItemToActiveGrants(catalogItemId: string): Promise<void> {
  const catalog = await getCatalogItem(catalogItemId);
  if (!catalog) return;
  const db = getAdminMysqlDb();
  const grants = await db
    .select()
    .from(tenantDistributionGrants)
    .where(
      and(
        eq(tenantDistributionGrants.catalogItemId, catalogItemId),
        eq(tenantDistributionGrants.status, "granted"),
      ),
    );
  for (const grant of grants) {
    await upsertTenantSkillFromCatalog(grant.tenantId, catalog);
  }
}

export async function listCatalogItems(): Promise<PlatformCatalogItemRecord[]> {
  const db = getAdminMysqlDb();
  const rows = await db
    .select()
    .from(platformCatalogItems)
    .orderBy(desc(platformCatalogItems.updatedAt));
  return rows.map(rowToCatalog);
}

export async function getCatalogItem(id: string): Promise<PlatformCatalogItemRecord | null> {
  const db = getAdminMysqlDb();
  const rows = await db
    .select()
    .from(platformCatalogItems)
    .where(eq(platformCatalogItems.id, id))
    .limit(1);
  return rows[0] ? rowToCatalog(rows[0]) : null;
}

export async function createCatalogItem(
  input: CreatePlatformCatalogItemInput,
): Promise<PlatformCatalogItemRecord> {
  const db = getAdminMysqlDb();
  const slug = input.slug.trim();
  if (!slug) throw new Error("slug is required");
  const id = ulid();
  const now = new Date();
  await db.insert(platformCatalogItems).values({
    id,
    slug,
    displayName: input.displayName?.trim() || slug,
    description: input.description ?? "",
    resourceType: input.resourceType?.trim() || "skill",
    version: input.version?.trim() || "0.0.0",
    bundleUri: input.bundleUri ?? "",
    bundleDigest: input.bundleDigest ?? "",
    status: input.status ?? "active",
    createdAt: now,
    updatedAt: now,
  });
  const created = await getCatalogItem(id);
  if (!created) throw new Error("create failed");
  return created;
}

export async function updateCatalogItem(
  id: string,
  input: UpdatePlatformCatalogItemInput,
): Promise<PlatformCatalogItemRecord> {
  const db = getAdminMysqlDb();
  const existing = await getCatalogItem(id);
  if (!existing) throw new Error("catalog item not found");
  const patch: Partial<typeof platformCatalogItems.$inferInsert> = { updatedAt: new Date() };
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.description !== undefined) patch.description = input.description;
  if (input.version !== undefined) patch.version = input.version;
  if (input.bundleUri !== undefined) patch.bundleUri = input.bundleUri;
  if (input.bundleDigest !== undefined) patch.bundleDigest = input.bundleDigest;
  if (input.status !== undefined) patch.status = input.status;
  await db.update(platformCatalogItems).set(patch).where(eq(platformCatalogItems.id, id));
  await syncCatalogItemToActiveGrants(id);
  const updated = await getCatalogItem(id);
  if (!updated) throw new Error("catalog item not found");
  return updated;
}

export async function listGrantsForCatalogItem(
  catalogItemId: string,
): Promise<TenantDistributionGrantRecord[]> {
  const db = getAdminMysqlDb();
  const rows = await db
    .select()
    .from(tenantDistributionGrants)
    .where(eq(tenantDistributionGrants.catalogItemId, catalogItemId))
    .orderBy(desc(tenantDistributionGrants.updatedAt));
  return rows.map(rowToGrant);
}

export async function grantCatalogToTenant(
  catalogItemId: string,
  tenantId: string,
): Promise<{ grant: TenantDistributionGrantRecord; skillId: string }> {
  const catalog = await getCatalogItem(catalogItemId);
  if (!catalog) throw new Error("catalog item not found");
  const db = getAdminMysqlDb();
  const nowIso = new Date().toISOString();
  const now = new Date();
  const existing = await db
    .select()
    .from(tenantDistributionGrants)
    .where(
      and(
        eq(tenantDistributionGrants.catalogItemId, catalogItemId),
        eq(tenantDistributionGrants.tenantId, tenantId),
      ),
    )
    .limit(1);
  let grantId: string;
  if (existing[0]) {
    grantId = existing[0].id;
    await db
      .update(tenantDistributionGrants)
      .set({
        status: "granted",
        revokePolicy: null,
        grantedAt: nowIso,
        revokedAt: null,
        updatedAt: now,
      })
      .where(eq(tenantDistributionGrants.id, grantId));
  } else {
    grantId = ulid();
    await db.insert(tenantDistributionGrants).values({
      id: grantId,
      catalogItemId,
      tenantId,
      status: "granted",
      grantedAt: nowIso,
      createdAt: now,
      updatedAt: now,
    });
  }
  const skillId = await upsertTenantSkillFromCatalog(tenantId, catalog);
  const grantRows = await db
    .select()
    .from(tenantDistributionGrants)
    .where(eq(tenantDistributionGrants.id, grantId))
    .limit(1);
  if (!grantRows[0]) throw new Error("grant failed");
  return { grant: rowToGrant(grantRows[0]), skillId };
}

export async function revokeCatalogFromTenant(
  catalogItemId: string,
  tenantId: string,
  policy: RevokePolicy = "retain_stop_updates",
): Promise<TenantDistributionGrantRecord> {
  const db = getAdminMysqlDb();
  const rows = await db
    .select()
    .from(tenantDistributionGrants)
    .where(
      and(
        eq(tenantDistributionGrants.catalogItemId, catalogItemId),
        eq(tenantDistributionGrants.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!rows[0] || rows[0].status !== "granted") {
    throw new Error("active grant not found");
  }
  const nowIso = new Date().toISOString();
  const now = new Date();
  await db
    .update(tenantDistributionGrants)
    .set({
      status: "revoked",
      revokePolicy: policy,
      revokedAt: nowIso,
      updatedAt: now,
    })
    .where(eq(tenantDistributionGrants.id, rows[0].id));

  if (policy === "strip_bootstrap") {
    const skill = await findTenantSkillByCatalogId(tenantId, catalogItemId);
    if (skill) {
      await db
        .update(enterpriseSkills)
        .set({ status: "disabled", updatedAt: now })
        .where(eq(enterpriseSkills.id, skill.id));
    }
  }

  const updated = await db
    .select()
    .from(tenantDistributionGrants)
    .where(eq(tenantDistributionGrants.id, rows[0].id))
    .limit(1);
  if (!updated[0]) throw new Error("revoke failed");
  return rowToGrant(updated[0]);
}

/** 测试与 E2E：按租户列出 skill 行（含 origin）。 */
export async function listTenantSkillsForTest(tenantId: string) {
  const db = getAdminMysqlDb();
  return db
    .select({
      id: enterpriseSkills.id,
      tenantId: enterpriseSkills.tenantId,
      slug: enterpriseSkills.slug,
      origin: enterpriseSkills.origin,
      platformCatalogItemId: enterpriseSkills.platformCatalogItemId,
      version: enterpriseSkills.version,
      bundleDigest: enterpriseSkills.bundleDigest,
      status: enterpriseSkills.status,
    })
    .from(enterpriseSkills)
    .where(eq(enterpriseSkills.tenantId, tenantId));
}

export async function tenantHasGrantedCatalogSkill(
  tenantId: string,
  catalogItemId: string,
): Promise<boolean> {
  const skill = await findTenantSkillByCatalogId(tenantId, catalogItemId);
  return Boolean(skill);
}

export async function isCatalogUpdateVisibleToTenant(
  tenantId: string,
  catalogItemId: string,
  nextDigest: string,
): Promise<boolean> {
  const db = getAdminMysqlDb();
  const grant = await db
    .select()
    .from(tenantDistributionGrants)
    .where(
      and(
        eq(tenantDistributionGrants.catalogItemId, catalogItemId),
        eq(tenantDistributionGrants.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!grant[0] || grant[0].status !== "granted") {
    const skill = await findTenantSkillByCatalogId(tenantId, catalogItemId);
    if (!skill) return false;
    return skill.bundleDigest === nextDigest;
  }
  const skill = await findTenantSkillByCatalogId(tenantId, catalogItemId);
  return skill?.bundleDigest === nextDigest;
}
