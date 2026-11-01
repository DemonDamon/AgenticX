import { describe, expect, it } from "vitest";

import {
  shouldPushCatalogUpdateToTenant,
  tenantSeesCatalogSkill,
  tenantSkillStatusAfterRevoke,
} from "../platform-catalog-distribution";

describe("ECP E1 two-tenant distribution (synthetic)", () => {
  const TENANT_A = "01TENANTAAAAAAAAAAAAAAAAAA";
  const TENANT_B = "01TENANTBBBBBBBBBBBBBBBBBB";

  it("grant only A: B does not see catalog skill row", () => {
    const skillOwnerTenant: string | null = TENANT_A;
    expect(tenantSeesCatalogSkill(TENANT_A, skillOwnerTenant)).toBe(true);
    expect(tenantSeesCatalogSkill(TENANT_B, skillOwnerTenant)).toBe(false);
  });

  it("revoke A with retain_stop_updates: stop catalog push but keep active copy", () => {
    expect(shouldPushCatalogUpdateToTenant("revoked")).toBe(false);
    expect(tenantSkillStatusAfterRevoke("retain_stop_updates")).toBe("active");
  });

  it("revoke with strip_bootstrap removes skill from bootstrap via disabled status", () => {
    expect(tenantSkillStatusAfterRevoke("strip_bootstrap")).toBe("disabled");
  });

  it("granted tenant receives catalog updates only when published", () => {
    expect(shouldPushCatalogUpdateToTenant("granted", "published")).toBe(true);
    expect(shouldPushCatalogUpdateToTenant("granted", "draft")).toBe(false);
    expect(shouldPushCatalogUpdateToTenant("granted")).toBe(true);
  });
});
