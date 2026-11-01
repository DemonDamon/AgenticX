import { resolveDatabaseConfig } from "@agenticx/iam-core";
import { describe, expect, it } from "vitest";

import { createCapabilityPack } from "../capability-packs-store";
import {
  grantCatalogToTenant,
  listTenantSkillsForTest,
  revokeCatalogFromTenant,
} from "../platform-catalog-store";
import {
  listPackMembersForTest,
  listTenantPacksForTest,
} from "../db-stores/postgresql/expert-package-sync";
import { seedEcpE5PgFixture } from "./fixtures/ecp-e5-pg-fixture";

const pgReady = Boolean(process.env.DATABASE_URL?.trim());

describe.skipIf(!pgReady)("ECP skill grant → assigned pack membership (PG)", () => {
  it("grant catalog skill adds tenant skill to packs already assigned (bootstrap path)", async () => {
    if (resolveDatabaseConfig().dialect !== "postgresql") {
      return;
    }

    const fx = await seedEcpE5PgFixture();
    process.env.DEFAULT_TENANT_ID = fx.tenantA;
    process.env.ECP_PLATFORM_TENANT_ID = fx.platformTenantId;

    const tenantPack = await createCapabilityPack({
      slug: `ecp-all-${fx.tenantA.slice(0, 6)}`,
      displayName: "All members",
      assignmentKeys: ["all"],
      capabilityIds: [],
    });

    await grantCatalogToTenant(fx.catalogSkillId, fx.tenantA);

    const skills = await listTenantSkillsForTest(fx.tenantA);
    const granted = skills.find((s) => s.platformCatalogItemId === fx.catalogSkillId);
    expect(granted?.status).toBe("active");
    if (!granted) throw new Error("granted skill row missing");

    const members = await listPackMembersForTest(tenantPack.id);
    expect(members).toContain(`skill:${granted.id}`);

    const expertPacks = (await listTenantPacksForTest(fx.tenantA)).filter(
      (p) => p.platformCatalogItemId != null,
    );
    for (const expertPack of expertPacks) {
      const expertMembers = await listPackMembersForTest(expertPack.id);
      expect(expertMembers).not.toContain(`skill:${granted.id}`);
    }
  });

  it("strip_bootstrap revoke disables skill so bootstrap reader would omit it", async () => {
    if (resolveDatabaseConfig().dialect !== "postgresql") {
      return;
    }

    const fx = await seedEcpE5PgFixture();
    process.env.DEFAULT_TENANT_ID = fx.tenantA;
    process.env.ECP_PLATFORM_TENANT_ID = fx.platformTenantId;

    await createCapabilityPack({
      slug: `ecp-all-revoke-${fx.tenantA.slice(0, 6)}`,
      displayName: "All members",
      assignmentKeys: ["all"],
      capabilityIds: [],
    });

    await grantCatalogToTenant(fx.catalogSkillId, fx.tenantA);
    await revokeCatalogFromTenant(fx.catalogSkillId, fx.tenantA, "strip_bootstrap");

    const skills = await listTenantSkillsForTest(fx.tenantA);
    const granted = skills.find((s) => s.platformCatalogItemId === fx.catalogSkillId);
    expect(granted?.status).toBe("disabled");
  });
});
