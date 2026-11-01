/**
 * ECP E5 · PG 铜管 fixture（grant → assign → bootstrap 读路径）
 *
 * 前置：`DATABASE_URL` 已指向已 migrate 的库；测试用例自行设置租户 env。
 */
import {
  CATALOG_RESOURCE_EXPERT_PACKAGE,
  CATALOG_RESOURCE_SKILL,
} from "@agenticx/config";
import {
  departments,
  enterpriseSkills,
  mcpServers,
  organizations,
  tenants,
} from "@agenticx/db-schema";
import { getIamDb } from "@agenticx/iam-core";
import { ulid } from "ulid";

import { createSkill, getCapabilityPack, updateCapabilityPack } from "../../capability-packs-store";
import { updateEcpTenantDistributionPolicy } from "../../ecp-tenant-settings-store";
import {
  createCatalogItem,
  createCatalogVersion,
  grantCatalogToTenant,
  publishCatalogVersion,
  recordCatalogVersionScan,
  revokeCatalogFromTenant,
  isCatalogUpdateVisibleToTenant,
  listTenantSkillsForTest,
} from "../../platform-catalog-store";
import { listTenantPacksForTest } from "../../db-stores/postgresql/expert-package-sync";

export type EcpE5FixtureIds = {
  platformTenantId: string;
  tenantA: string;
  tenantB: string;
  deptD: string;
  orgA: string;
  platformSkill1: string;
  platformSkill2: string;
  platformMcp: string;
  catalogSkillId: string;
  catalogExpertId: string;
};

const RUN = ulid().slice(0, 8).toLowerCase();

export async function seedEcpE5PgFixture(): Promise<EcpE5FixtureIds> {
  const db = getIamDb();
  const now = new Date();

  const platformTenantId = ulid();
  const tenantA = ulid();
  const tenantB = ulid();
  const orgA = ulid();
  const deptD = ulid();

  await db.insert(tenants).values([
    {
      id: platformTenantId,
      code: `ecp-platform-${RUN}`,
      name: "ECP Platform Template",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: tenantA,
      code: `ecp-tenant-a-${RUN}`,
      name: "ECP Tenant A",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: tenantB,
      code: `ecp-tenant-b-${RUN}`,
      name: "ECP Tenant B",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.insert(organizations).values({
    id: orgA,
    tenantId: tenantA,
    name: `ECP Org A ${RUN}`,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(departments).values({
    id: deptD,
    tenantId: tenantA,
    orgId: orgA,
    parentId: null,
    name: "Dept D",
    path: "/Dept D/",
    createdAt: now,
    updatedAt: now,
  });

  process.env.ECP_PLATFORM_TENANT_ID = platformTenantId;
  process.env.DEFAULT_TENANT_ID = platformTenantId;

  const platformSkill1 = (
    await createSkill({
      slug: `ecp-s1-${RUN}`,
      displayName: "ECP Skill One",
      version: "1.0.0",
      bundleDigest: "digest-s1-v1",
    })
  ).id;
  const platformSkill2 = (
    await createSkill({
      slug: `ecp-s2-${RUN}`,
      displayName: "ECP Skill Two",
      version: "1.0.0",
      bundleDigest: "digest-s2-v1",
    })
  ).id;

  const mcpId = ulid();
  await db.insert(mcpServers).values({
    id: mcpId,
    tenantId: platformTenantId,
    name: `ecp-mcp-${RUN}`,
    displayName: "ECP MCP",
    transport: "stdio",
    backendType: "external",
    backendConfig: {},
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  const platformMcp = mcpId;

  process.env.DEFAULT_TENANT_ID = tenantA;

  const manifest = {
    members: [
      { kind: "skill", capabilityId: `skill:${platformSkill1}` },
      { kind: "skill", capabilityId: `skill:${platformSkill2}` },
      { kind: "mcp", capabilityId: `mcp:${platformMcp}` },
    ],
  };

  const skillCatalog = await createCatalogItem({
    slug: `ecp-pack-s-${RUN}`,
    displayName: "ECP Skill Pack S",
    resourceType: CATALOG_RESOURCE_SKILL,
    version: "1.0.0",
    bundleDigest: "digest-catalog-s-v1",
  });
  const skillVersion = skillCatalog.effectiveVersionId;
  if (!skillVersion) throw new Error("skill catalog missing initial version");
  await recordCatalogVersionScan(skillVersion, {
    verdict: "safe",
    source: "ecp-e5-fixture",
    findings: [],
    scannedBy: "ecp-e5-test",
  });
  await publishCatalogVersion(skillCatalog.id, skillVersion, platformTenantId);

  const expertCatalog = await createCatalogItem({
    slug: `ecp-pack-e-${RUN}`,
    displayName: "ECP Expert E",
    resourceType: CATALOG_RESOURCE_EXPERT_PACKAGE,
    version: "1.0.0",
    packManifest: manifest,
  });
  const expertVersion = expertCatalog.effectiveVersionId;
  if (!expertVersion) throw new Error("expert catalog missing initial version");
  await recordCatalogVersionScan(expertVersion, {
    verdict: "safe",
    source: "ecp-e5-fixture",
    findings: [],
    scannedBy: "ecp-e5-test",
  });
  await publishCatalogVersion(expertCatalog.id, expertVersion, platformTenantId);

  return {
    platformTenantId,
    tenantA,
    tenantB,
    deptD,
    orgA,
    platformSkill1,
    platformSkill2,
    platformMcp,
    catalogSkillId: skillCatalog.id,
    catalogExpertId: expertCatalog.id,
  };
}

export async function publishCatalogFlow(
  catalogItemId: string,
  version: string,
  digest: string,
  operatorTenantId: string,
  packManifest?: Record<string, unknown>,
) {
  const ver = await createCatalogVersion(catalogItemId, {
    version,
    bundleDigest: digest,
    packManifest,
  });
  await recordCatalogVersionScan(ver.id, {
    verdict: "safe",
    source: "ecp-e5-fixture",
    findings: [],
    scannedBy: "ecp-e5-test",
  });
  await publishCatalogVersion(catalogItemId, ver.id, operatorTenantId);
  return ver.id;
}

export {
  grantCatalogToTenant,
  revokeCatalogFromTenant,
  isCatalogUpdateVisibleToTenant,
  listTenantSkillsForTest,
  listTenantPacksForTest,
  updateEcpTenantDistributionPolicy,
  getCapabilityPack,
  updateCapabilityPack,
};
