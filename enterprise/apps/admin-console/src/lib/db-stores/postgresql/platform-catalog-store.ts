/**
 * admin-console · 平台能力目录与跨租户 grant/revoke（PG）
 */

import {
  assertScanAllowsPublish,
  isExpertPackageResourceType,
  isShelfPublished,
  normalizeExpertPackageManifest,
  type ScanVerdict,
  type ShelfStatus,
  ShelfPublishError,
} from "@agenticx/config";
import {
  enterpriseSkills,
  platformCatalogItemVersions,
  platformCatalogItems,
  tenantDistributionGrants,
} from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";

import {
  assertShelfPublishApproval,
  ApprovalRequiredError,
  consumeApprovalRequest,
} from "./ecp-approval-store";
import { applyExpertPackageRevoke, syncExpertPackageToTenant } from "./expert-package-sync";

export type CatalogItemStatus = "active" | "disabled";
export type GrantStatus = "granted" | "revoked";
export type RevokePolicy = "retain_stop_updates" | "strip_bootstrap";
export type SkillOrigin = "tenant" | "platform";

export { ShelfPublishError };
export { ApprovalRequiredError };

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
  shelfStatus: ShelfStatus;
  effectiveVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformCatalogVersionRecord {
  id: string;
  catalogItemId: string;
  version: string;
  bundleUri: string;
  bundleDigest: string;
  shelfStatus: ShelfStatus;
  scanVerdict: ScanVerdict;
  scanSource: string | null;
  scannedAt: string | null;
  scannedBy: string | null;
  scanFindings: unknown[];
  packManifest: Record<string, unknown>;
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
  packManifest?: Record<string, unknown>;
}

export interface UpdatePlatformCatalogItemInput {
  displayName?: string;
  description?: string;
  version?: string;
  bundleUri?: string;
  bundleDigest?: string;
  status?: CatalogItemStatus;
}

export interface CreateCatalogVersionInput {
  version: string;
  bundleUri?: string;
  bundleDigest?: string;
  packManifest?: Record<string, unknown>;
}

export type CatalogVersionScanResult = {
  verdict: string;
  source: string;
  findings: unknown[];
  scannedBy: string;
};

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
    shelfStatus: (row.shelfStatus as ShelfStatus) || "draft",
    effectiveVersionId: row.effectiveVersionId ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function rowToVersion(
  row: typeof platformCatalogItemVersions.$inferSelect,
): PlatformCatalogVersionRecord {
  return {
    id: row.id,
    catalogItemId: row.catalogItemId,
    version: row.version,
    bundleUri: row.bundleUri ?? "",
    bundleDigest: row.bundleDigest ?? "",
    shelfStatus: (row.shelfStatus as ShelfStatus) || "draft",
    scanVerdict: (row.scanVerdict as ScanVerdict) ?? null,
    scanSource: row.scanSource ?? null,
    scannedAt: row.scannedAt ?? null,
    scannedBy: row.scannedBy ?? null,
    scanFindings: Array.isArray(row.scanFindings) ? row.scanFindings : [],
    packManifest: (row.packManifest as Record<string, unknown>) ?? {},
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

function tenantSkillStatusFromCatalog(catalog: PlatformCatalogItemRecord): "active" | "disabled" {
  if (!isShelfPublished(catalog.shelfStatus)) return "disabled";
  return catalog.status === "disabled" ? "disabled" : "active";
}

async function findTenantSkillByCatalogId(tenantId: string, catalogItemId: string) {
  const db = getIamDb();
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
  const db = getIamDb();
  const now = new Date();
  const tenantStatus = tenantSkillStatusFromCatalog(catalog);
  const tenantShelf: ShelfStatus = isShelfPublished(catalog.shelfStatus) ? "published" : "draft";
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
        shelfStatus: tenantShelf,
        status: tenantStatus,
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
    shelfStatus: tenantShelf,
    status: tenantStatus,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function syncCatalogItemToActiveGrants(catalogItemId: string): Promise<void> {
  const catalog = await getCatalogItem(catalogItemId);
  if (!catalog || catalog.shelfStatus === "draft") return;
  const db = getIamDb();
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
    if (isExpertPackageResourceType(catalog.resourceType)) {
      await syncExpertPackageToTenant(grant.tenantId, catalog);
    } else {
      await upsertTenantSkillFromCatalog(grant.tenantId, catalog);
    }
  }
}

async function applyEffectiveVersionToCatalogItem(
  catalogItemId: string,
  version: PlatformCatalogVersionRecord,
): Promise<void> {
  const db = getIamDb();
  await db
    .update(platformCatalogItems)
    .set({
      version: version.version,
      bundleUri: version.bundleUri,
      bundleDigest: version.bundleDigest,
      effectiveVersionId: version.id,
      updatedAt: new Date(),
    })
    .where(eq(platformCatalogItems.id, catalogItemId));
}

export async function listCatalogItems(): Promise<PlatformCatalogItemRecord[]> {
  const db = getIamDb();
  const rows = await db
    .select()
    .from(platformCatalogItems)
    .orderBy(desc(platformCatalogItems.updatedAt));
  return rows.map(rowToCatalog);
}

export async function getCatalogItem(id: string): Promise<PlatformCatalogItemRecord | null> {
  const db = getIamDb();
  const rows = await db
    .select()
    .from(platformCatalogItems)
    .where(eq(platformCatalogItems.id, id))
    .limit(1);
  return rows[0] ? rowToCatalog(rows[0]) : null;
}

export async function listCatalogVersions(catalogItemId: string): Promise<PlatformCatalogVersionRecord[]> {
  const db = getIamDb();
  const rows = await db
    .select()
    .from(platformCatalogItemVersions)
    .where(eq(platformCatalogItemVersions.catalogItemId, catalogItemId))
    .orderBy(desc(platformCatalogItemVersions.updatedAt));
  return rows.map(rowToVersion);
}

export async function getCatalogVersion(versionId: string): Promise<PlatformCatalogVersionRecord | null> {
  const db = getIamDb();
  const rows = await db
    .select()
    .from(platformCatalogItemVersions)
    .where(eq(platformCatalogItemVersions.id, versionId))
    .limit(1);
  return rows[0] ? rowToVersion(rows[0]) : null;
}

export async function createCatalogItem(
  input: CreatePlatformCatalogItemInput,
): Promise<PlatformCatalogItemRecord> {
  const db = getIamDb();
  const slug = input.slug.trim();
  if (!slug) throw new Error("slug is required");
  const id = ulid();
  const versionId = ulid();
  const version = input.version?.trim() || "0.0.0";
  const now = new Date();
  const manifest =
    input.resourceType?.trim() === "expert_package" && input.packManifest
      ? input.packManifest
      : {};
  if (input.resourceType?.trim() === "expert_package") {
    if (!input.packManifest) {
      throw new Error("expert_package requires packManifest");
    }
    normalizeExpertPackageManifest(input.packManifest);
  }
  await db.insert(platformCatalogItems).values({
    id,
    slug,
    displayName: input.displayName?.trim() || slug,
    description: input.description ?? "",
    resourceType: input.resourceType?.trim() || "skill",
    version,
    bundleUri: input.bundleUri ?? "",
    bundleDigest: input.bundleDigest ?? "",
    status: input.status ?? "active",
    shelfStatus: "draft",
    effectiveVersionId: versionId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(platformCatalogItemVersions).values({
    id: versionId,
    catalogItemId: id,
    version,
    bundleUri: input.bundleUri ?? "",
    bundleDigest: input.bundleDigest ?? "",
    shelfStatus: "draft",
    packManifest: manifest,
    createdAt: now,
    updatedAt: now,
  });
  const created = await getCatalogItem(id);
  if (!created) throw new Error("create failed");
  return created;
}

export async function createCatalogVersion(
  catalogItemId: string,
  input: CreateCatalogVersionInput,
): Promise<PlatformCatalogVersionRecord> {
  const item = await getCatalogItem(catalogItemId);
  if (!item) throw new Error("catalog item not found");
  const version = input.version.trim();
  if (!version) throw new Error("version is required");
  const db = getIamDb();
  const id = ulid();
  const now = new Date();
  const manifest = input.packManifest ?? {};
  if (isExpertPackageResourceType(item.resourceType) && input.packManifest) {
    normalizeExpertPackageManifest(input.packManifest);
  }
  await db.insert(platformCatalogItemVersions).values({
    id,
    catalogItemId,
    version,
    bundleUri: input.bundleUri ?? "",
    bundleDigest: input.bundleDigest ?? "",
    shelfStatus: "draft",
    packManifest: manifest,
    createdAt: now,
    updatedAt: now,
  });
  const created = await getCatalogVersion(id);
  if (!created) throw new Error("create version failed");
  return created;
}

export async function recordCatalogVersionScan(
  versionId: string,
  result: CatalogVersionScanResult,
): Promise<PlatformCatalogVersionRecord> {
  const db = getIamDb();
  await db
    .update(platformCatalogItemVersions)
    .set({
      scanVerdict: result.verdict,
      scanSource: result.source,
      scanFindings: result.findings,
      scannedBy: result.scannedBy,
      scannedAt: new Date().toISOString(),
      updatedAt: new Date(),
    })
    .where(eq(platformCatalogItemVersions.id, versionId));
  const updated = await getCatalogVersion(versionId);
  if (!updated) throw new Error("catalog version not found");
  return updated;
}

export async function publishCatalogVersion(
  catalogItemId: string,
  versionId: string,
  operatorTenantId?: string,
): Promise<{ item: PlatformCatalogItemRecord; version: PlatformCatalogVersionRecord }> {
  const version = await getCatalogVersion(versionId);
  if (!version || version.catalogItemId !== catalogItemId) {
    throw new Error("catalog version not found");
  }
  assertScanAllowsPublish(version.scanVerdict);
  const tenantId =
    operatorTenantId?.trim() || process.env.DEFAULT_TENANT_ID?.trim() || "default";
  const approval = await assertShelfPublishApproval({
    tenantId,
    resourceType: "platform_catalog_version",
    resourceId: versionId,
    action: "shelf_publish",
  });
  const db = getIamDb();
  const now = new Date();
  await db
    .update(platformCatalogItemVersions)
    .set({ shelfStatus: "published", updatedAt: now })
    .where(eq(platformCatalogItemVersions.id, versionId));
  await db
    .update(platformCatalogItems)
    .set({
      shelfStatus: "published",
      effectiveVersionId: versionId,
      version: version.version,
      bundleUri: version.bundleUri,
      bundleDigest: version.bundleDigest,
      updatedAt: now,
    })
    .where(eq(platformCatalogItems.id, catalogItemId));
  await syncCatalogItemToActiveGrants(catalogItemId);
  const item = await getCatalogItem(catalogItemId);
  const publishedVersion = await getCatalogVersion(versionId);
  if (!item || !publishedVersion) throw new Error("publish failed");
  if (approval) {
    await consumeApprovalRequest(approval.id);
  }
  return { item, version: publishedVersion };
}

export async function setEffectiveCatalogVersion(
  catalogItemId: string,
  versionId: string,
): Promise<PlatformCatalogItemRecord> {
  const version = await getCatalogVersion(versionId);
  if (!version || version.catalogItemId !== catalogItemId) {
    throw new Error("catalog version not found");
  }
  if (!isShelfPublished(version.shelfStatus)) {
    throw new ShelfPublishError("only published versions can be set as effective");
  }
  await applyEffectiveVersionToCatalogItem(catalogItemId, version);
  await syncCatalogItemToActiveGrants(catalogItemId);
  const item = await getCatalogItem(catalogItemId);
  if (!item) throw new Error("catalog item not found");
  return item;
}

export async function deprecateCatalogItem(id: string): Promise<PlatformCatalogItemRecord> {
  const db = getIamDb();
  const now = new Date();
  await db
    .update(platformCatalogItems)
    .set({ shelfStatus: "deprecated", status: "disabled", updatedAt: now })
    .where(eq(platformCatalogItems.id, id));
  await syncCatalogItemToActiveGrants(id);
  const item = await getCatalogItem(id);
  if (!item) throw new Error("catalog item not found");
  return item;
}

export async function updateCatalogItem(
  id: string,
  input: UpdatePlatformCatalogItemInput,
): Promise<PlatformCatalogItemRecord> {
  const db = getIamDb();
  const existing = await getCatalogItem(id);
  if (!existing) throw new Error("catalog item not found");
  const patch: Partial<typeof platformCatalogItems.$inferInsert> = { updatedAt: new Date() };
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.description !== undefined) patch.description = input.description;
  if (input.status !== undefined) patch.status = input.status;
  if (!isShelfPublished(existing.shelfStatus)) {
    if (input.version !== undefined) patch.version = input.version;
    if (input.bundleUri !== undefined) patch.bundleUri = input.bundleUri;
    if (input.bundleDigest !== undefined) patch.bundleDigest = input.bundleDigest;
  }
  await db.update(platformCatalogItems).set(patch).where(eq(platformCatalogItems.id, id));

  if (!isShelfPublished(existing.shelfStatus) && existing.effectiveVersionId) {
    const versionPatch: Partial<typeof platformCatalogItemVersions.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (input.version !== undefined) versionPatch.version = input.version;
    if (input.bundleUri !== undefined) versionPatch.bundleUri = input.bundleUri;
    if (input.bundleDigest !== undefined) versionPatch.bundleDigest = input.bundleDigest;
    await db
      .update(platformCatalogItemVersions)
      .set(versionPatch)
      .where(eq(platformCatalogItemVersions.id, existing.effectiveVersionId));
  }

  if (isShelfPublished(existing.shelfStatus)) {
    await syncCatalogItemToActiveGrants(id);
  }
  const updated = await getCatalogItem(id);
  if (!updated) throw new Error("catalog item not found");
  return updated;
}

export async function listGrantsForCatalogItem(
  catalogItemId: string,
): Promise<TenantDistributionGrantRecord[]> {
  const db = getIamDb();
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
): Promise<{ grant: TenantDistributionGrantRecord; skillId?: string; packId?: string }> {
  const catalog = await getCatalogItem(catalogItemId);
  if (!catalog) throw new Error("catalog item not found");
  if (!isShelfPublished(catalog.shelfStatus)) {
    throw new ShelfPublishError("catalog item must be published before grant");
  }
  const db = getIamDb();
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
  const skillId = isExpertPackageResourceType(catalog.resourceType)
    ? undefined
    : await upsertTenantSkillFromCatalog(tenantId, catalog);
  const packSync = isExpertPackageResourceType(catalog.resourceType)
    ? await syncExpertPackageToTenant(tenantId, catalog)
    : undefined;
  const grantRows = await db
    .select()
    .from(tenantDistributionGrants)
    .where(eq(tenantDistributionGrants.id, grantId))
    .limit(1);
  if (!grantRows[0]) throw new Error("grant failed");
  return {
    grant: rowToGrant(grantRows[0]),
    skillId,
    packId: packSync?.packId,
  };
}

export async function revokeCatalogFromTenant(
  catalogItemId: string,
  tenantId: string,
  policy: RevokePolicy = "retain_stop_updates",
): Promise<TenantDistributionGrantRecord> {
  const db = getIamDb();
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
    const catalog = await getCatalogItem(catalogItemId);
    if (catalog && isExpertPackageResourceType(catalog.resourceType)) {
      await applyExpertPackageRevoke(tenantId, catalogItemId, policy);
    } else {
      const skill = await findTenantSkillByCatalogId(tenantId, catalogItemId);
      if (skill) {
        await db
          .update(enterpriseSkills)
          .set({ status: "disabled", updatedAt: now })
          .where(eq(enterpriseSkills.id, skill.id));
      }
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
  const db = getIamDb();
  return db
    .select({
      id: enterpriseSkills.id,
      tenantId: enterpriseSkills.tenantId,
      slug: enterpriseSkills.slug,
      origin: enterpriseSkills.origin,
      platformCatalogItemId: enterpriseSkills.platformCatalogItemId,
      version: enterpriseSkills.version,
      bundleDigest: enterpriseSkills.bundleDigest,
      shelfStatus: enterpriseSkills.shelfStatus,
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
  const catalog = await getCatalogItem(catalogItemId);
  if (!catalog || !isShelfPublished(catalog.shelfStatus)) {
    const skill = await findTenantSkillByCatalogId(tenantId, catalogItemId);
    if (!skill) return false;
    return skill.bundleDigest === nextDigest;
  }
  const db = getIamDb();
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
