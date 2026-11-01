/**
 * ECP E4 · 专家包 grant/revoke 与租户 Pack 物化（PG）
 */

import {
  isExpertPackageResourceType,
  normalizeExpertPackageManifest,
  parseCapabilityId,
  type ExpertPackageManifest,
} from "@agenticx/config";
import {
  enterpriseCapabilityPackMembers,
  enterpriseCapabilityPacks,
  enterpriseSkills,
  mcpServers,
  platformCatalogItemVersions,
} from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";

import { getEcpTenantDistributionPolicy } from "./ecp-tenant-settings-store";
import type {
  PlatformCatalogItemRecord,
  RevokePolicy,
} from "./platform-catalog-store";

function platformTenantId(): string {
  const fromEnv = process.env.ECP_PLATFORM_TENANT_ID?.trim() || process.env.DEFAULT_TENANT_ID?.trim();
  if (!fromEnv) throw new Error("ECP_PLATFORM_TENANT_ID or DEFAULT_TENANT_ID is required");
  return fromEnv;
}

export async function loadEffectiveExpertManifest(
  catalog: PlatformCatalogItemRecord,
): Promise<ExpertPackageManifest | null> {
  if (!isExpertPackageResourceType(catalog.resourceType)) return null;
  if (!catalog.effectiveVersionId) return null;
  const db = getIamDb();
  const rows = await db
    .select({ packManifest: platformCatalogItemVersions.packManifest })
    .from(platformCatalogItemVersions)
    .where(eq(platformCatalogItemVersions.id, catalog.effectiveVersionId))
    .limit(1);
  const raw = rows[0]?.packManifest ?? {};
  return normalizeExpertPackageManifest(raw);
}

async function findTenantPackByCatalog(tenantId: string, catalogItemId: string) {
  const db = getIamDb();
  const rows = await db
    .select()
    .from(enterpriseCapabilityPacks)
    .where(
      and(
        eq(enterpriseCapabilityPacks.tenantId, tenantId),
        eq(enterpriseCapabilityPacks.platformCatalogItemId, catalogItemId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function resolveSkillMemberForTenant(
  tenantId: string,
  platformCapabilityId: string,
  installCopyEnabled: boolean,
): Promise<string> {
  const parsed = parseCapabilityId(platformCapabilityId);
  if (!parsed || parsed.kind !== "skill") {
    throw new Error(`invalid skill capability id: ${platformCapabilityId}`);
  }
  const platformSkillId = parsed.rowId;
  const db = getIamDb();
  const platformRows = await db
    .select()
    .from(enterpriseSkills)
    .where(
      and(eq(enterpriseSkills.tenantId, platformTenantId()), eq(enterpriseSkills.id, platformSkillId)),
    )
    .limit(1);
  const template = platformRows[0];
  if (!template) throw new Error(`platform skill not found: ${platformSkillId}`);

  if (installCopyEnabled) {
    const copyKey = platformCapabilityId;
    const existing = await db
      .select()
      .from(enterpriseSkills)
      .where(
        and(eq(enterpriseSkills.tenantId, tenantId), eq(enterpriseSkills.installCopyOf, copyKey)),
      )
      .limit(1);
    if (existing[0]) return existing[0].id;
    const id = ulid();
    const now = new Date();
    await db.insert(enterpriseSkills).values({
      id,
      tenantId,
      slug: `${template.slug}-copy`,
      displayName: template.displayName || template.slug,
      description: template.description ?? "",
      version: template.version,
      bundleUri: template.bundleUri ?? "",
      bundleDigest: template.bundleDigest ?? "",
      requiredCapabilities: template.requiredCapabilities ?? [],
      origin: "tenant",
      installCopyOf: copyKey,
      shelfStatus: template.shelfStatus,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  const existingPlatform = await db
    .select()
    .from(enterpriseSkills)
    .where(
      and(
        eq(enterpriseSkills.tenantId, tenantId),
        eq(enterpriseSkills.origin, "platform"),
        eq(enterpriseSkills.slug, template.slug),
      ),
    )
    .limit(1);
  if (existingPlatform[0]) {
    await db
      .update(enterpriseSkills)
      .set({
        displayName: template.displayName || template.slug,
        description: template.description ?? "",
        version: template.version,
        bundleUri: template.bundleUri ?? "",
        bundleDigest: template.bundleDigest ?? "",
        requiredCapabilities: template.requiredCapabilities ?? [],
        shelfStatus: template.shelfStatus,
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(enterpriseSkills.id, existingPlatform[0].id));
    return existingPlatform[0].id;
  }
  const id = ulid();
  const now = new Date();
  await db.insert(enterpriseSkills).values({
    id,
    tenantId,
    slug: template.slug,
    displayName: template.displayName || template.slug,
    description: template.description ?? "",
    version: template.version,
    bundleUri: template.bundleUri ?? "",
    bundleDigest: template.bundleDigest ?? "",
    requiredCapabilities: template.requiredCapabilities ?? [],
    origin: "platform",
    shelfStatus: template.shelfStatus,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function resolveMcpMemberForTenant(
  tenantId: string,
  platformCapabilityId: string,
): Promise<string> {
  const parsed = parseCapabilityId(platformCapabilityId);
  if (!parsed || parsed.kind !== "mcp") {
    throw new Error(`invalid mcp capability id: ${platformCapabilityId}`);
  }
  const platformMcpId = parsed.rowId;
  const db = getIamDb();
  const platformRows = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.tenantId, platformTenantId()), eq(mcpServers.id, platformMcpId)))
    .limit(1);
  const template = platformRows[0];
  if (!template) throw new Error(`platform mcp not found: ${platformMcpId}`);

  const existing = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.tenantId, tenantId), eq(mcpServers.name, template.name)))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const id = ulid();
  const now = new Date();
  await db.insert(mcpServers).values({
    id,
    tenantId,
    name: template.name,
    displayName: template.displayName,
    transport: template.transport,
    backendType: template.backendType,
    backendConfig: template.backendConfig ?? {},
    requiredScopes: template.requiredScopes ?? [],
    status: template.status,
    rateLimit: template.rateLimit ?? {},
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function replacePackMembers(packId: string, capabilityIds: string[]): Promise<void> {
  const db = getIamDb();
  const now = new Date();
  await db
    .delete(enterpriseCapabilityPackMembers)
    .where(eq(enterpriseCapabilityPackMembers.packId, packId));
  if (capabilityIds.length === 0) return;
  await db.insert(enterpriseCapabilityPackMembers).values(
    capabilityIds.map((capabilityId) => ({
      packId,
      capabilityId,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

export async function syncExpertPackageToTenant(
  tenantId: string,
  catalog: PlatformCatalogItemRecord,
): Promise<{ packId: string; capabilityIds: string[] }> {
  const manifest = await loadEffectiveExpertManifest(catalog);
  if (!manifest) throw new Error("expert package manifest missing");
  const policy = await getEcpTenantDistributionPolicy(tenantId);
  const resolved: string[] = [];
  for (const member of manifest.members) {
    if (member.kind === "skill") {
      const skillId = await resolveSkillMemberForTenant(
        tenantId,
        member.capabilityId,
        policy.installCopyEnabled,
      );
      resolved.push(`skill:${skillId}`);
    } else {
      const mcpId = await resolveMcpMemberForTenant(tenantId, member.capabilityId);
      resolved.push(`mcp:${mcpId}`);
    }
  }

  const db = getIamDb();
  const now = new Date();
  const existing = await findTenantPackByCatalog(tenantId, catalog.id);
  let packId: string;
  if (existing) {
    packId = existing.id;
    await db
      .update(enterpriseCapabilityPacks)
      .set({
        slug: catalog.slug,
        displayName: catalog.displayName || catalog.slug,
        description: catalog.description,
        status: "active",
        origin: "platform",
        updatedAt: now,
      })
      .where(eq(enterpriseCapabilityPacks.id, packId));
  } else {
    packId = ulid();
    await db.insert(enterpriseCapabilityPacks).values({
      id: packId,
      tenantId,
      slug: catalog.slug,
      displayName: catalog.displayName || catalog.slug,
      description: catalog.description,
      status: "active",
      origin: "platform",
      platformCatalogItemId: catalog.id,
      metadata: { distributionMode: policy.installCopyEnabled ? "install_copy" : "grant_reference" },
      createdAt: now,
      updatedAt: now,
    });
  }
  await replacePackMembers(packId, resolved);
  return { packId, capabilityIds: resolved };
}

export async function applyExpertPackageRevoke(
  tenantId: string,
  catalogItemId: string,
  policy: RevokePolicy,
): Promise<void> {
  if (policy !== "strip_bootstrap") return;
  const db = getIamDb();
  const now = new Date();
  const pack = await findTenantPackByCatalog(tenantId, catalogItemId);
  if (!pack) return;

  await db
    .update(enterpriseCapabilityPacks)
    .set({ status: "disabled", updatedAt: now })
    .where(eq(enterpriseCapabilityPacks.id, pack.id));

  const memberRows = await db
    .select({ capabilityId: enterpriseCapabilityPackMembers.capabilityId })
    .from(enterpriseCapabilityPackMembers)
    .where(eq(enterpriseCapabilityPackMembers.packId, pack.id));

  for (const row of memberRows) {
    if (row.capabilityId.startsWith("skill:")) {
      const skillId = row.capabilityId.slice("skill:".length);
      await db
        .update(enterpriseSkills)
        .set({ status: "disabled", updatedAt: now })
        .where(and(eq(enterpriseSkills.tenantId, tenantId), eq(enterpriseSkills.id, skillId)));
    }
    if (row.capabilityId.startsWith("mcp:")) {
      const mcpId = row.capabilityId.slice("mcp:".length);
      await db
        .update(mcpServers)
        .set({ status: "disabled", updatedAt: now })
        .where(and(eq(mcpServers.tenantId, tenantId), eq(mcpServers.id, mcpId)));
    }
  }
}

export async function listTenantPacksForTest(tenantId: string) {
  const db = getIamDb();
  return db
    .select({
      id: enterpriseCapabilityPacks.id,
      slug: enterpriseCapabilityPacks.slug,
      origin: enterpriseCapabilityPacks.origin,
      platformCatalogItemId: enterpriseCapabilityPacks.platformCatalogItemId,
      status: enterpriseCapabilityPacks.status,
      metadata: enterpriseCapabilityPacks.metadata,
    })
    .from(enterpriseCapabilityPacks)
    .where(eq(enterpriseCapabilityPacks.tenantId, tenantId));
}
