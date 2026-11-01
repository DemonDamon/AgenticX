import { resolveAssignmentKeysForUser, resolveDatabaseConfig } from "@agenticx/iam-core";
import { describe, expect, it } from "vitest";

import {
  grantCatalogToTenant,
  isCatalogUpdateVisibleToTenant,
  listTenantPacksForTest,
  listTenantSkillsForTest,
  publishCatalogFlow,
  revokeCatalogFromTenant,
  seedEcpE5PgFixture,
  updateEcpTenantDistributionPolicy,
  getCapabilityPack,
  updateCapabilityPack,
} from "./fixtures/ecp-e5-pg-fixture";

const pgReady = Boolean(process.env.DATABASE_URL?.trim());

describe.skipIf(!pgReady)("ECP E5 PG copper-pipe · e2e-enterprise-capability-platform", () => {
  it("grant → dept assign → revoke retain + install_copy matrix", async () => {
    if (resolveDatabaseConfig().dialect !== "postgresql") {
      return;
    }

    const fx = await seedEcpE5PgFixture();
    process.env.DEFAULT_TENANT_ID = fx.tenantA;

    await grantCatalogToTenant(fx.catalogSkillId, fx.tenantA);
    await grantCatalogToTenant(fx.catalogExpertId, fx.tenantA);

    const skillsB = await listTenantSkillsForTest(fx.tenantB);
    expect(skillsB.some((s) => s.platformCatalogItemId === fx.catalogSkillId)).toBe(false);

    const skillsA = await listTenantSkillsForTest(fx.tenantA);
    expect(skillsA.some((s) => s.platformCatalogItemId === fx.catalogSkillId)).toBe(true);

    const packsA = await listTenantPacksForTest(fx.tenantA);
    const expertPack = packsA.find((p) => p.platformCatalogItemId === fx.catalogExpertId);
    expect(expertPack?.origin).toBe("platform");
    expect(expertPack?.id).toBeTruthy();
    if (!expertPack) throw new Error("expert pack missing");

    await updateCapabilityPack(expertPack.id, {
      assignmentKeys: [`dept:${fx.deptD}`],
    });
    const packAfterAssign = await getCapabilityPack(expertPack.id);
    expect(packAfterAssign?.assignmentKeys).toEqual([`dept:${fx.deptD}`]);

    const keysInDept = await resolveAssignmentKeysForUser(fx.tenantA, "01USER", undefined, fx.deptD);
    const keysNoDept = await resolveAssignmentKeysForUser(fx.tenantA, "01USER", undefined, null);
    expect(keysInDept).toContain(`dept:${fx.deptD}`);
    expect(keysNoDept).not.toContain(`dept:${fx.deptD}`);
    const visibleInDept = packAfterAssign!.assignmentKeys.some((k) => keysInDept.includes(k));
    const visibleOutside = packAfterAssign!.assignmentKeys.some((k) => keysNoDept.includes(k));
    expect(visibleInDept).toBe(true);
    expect(visibleOutside).toBe(false);

    const digestBefore = skillsA.find((s) => s.platformCatalogItemId === fx.catalogSkillId)?.bundleDigest;
    await revokeCatalogFromTenant(fx.catalogSkillId, fx.tenantA, "retain_stop_updates");
    await publishCatalogFlow(
      fx.catalogSkillId,
      "2.0.0",
      "digest-catalog-s-v2",
      fx.platformTenantId,
    );

    const stillOldDigest = await isCatalogUpdateVisibleToTenant(
      fx.tenantA,
      fx.catalogSkillId,
      digestBefore ?? "",
    );
    expect(stillOldDigest).toBe(true);
    const wouldSeeNew = await isCatalogUpdateVisibleToTenant(
      fx.tenantA,
      fx.catalogSkillId,
      "digest-catalog-s-v2",
    );
    expect(wouldSeeNew).toBe(false);

    await updateEcpTenantDistributionPolicy(fx.tenantA, { installCopyEnabled: true });
    await grantCatalogToTenant(fx.catalogExpertId, fx.tenantA);
    const skillsCopy = await listTenantSkillsForTest(fx.tenantA);
    expect(skillsCopy.some((s) => s.installCopyOf != null && String(s.installCopyOf).startsWith("skill:"))).toBe(
      true,
    );

    await revokeCatalogFromTenant(fx.catalogExpertId, fx.tenantA, "strip_bootstrap");
    const packsDisabled = await listTenantPacksForTest(fx.tenantA);
    const disabledPack = packsDisabled.find((p) => p.platformCatalogItemId === fx.catalogExpertId);
    expect(disabledPack?.status).toBe("disabled");
  });
});
