import { describe, expect, it } from "vitest";

import {
  ApprovalRequiredError,
  assertPublishApprovalGate,
  DEFAULT_ECP_TENANT_DISTRIBUTION_POLICY,
  evaluateAutoScanStep,
  normalizeExpertPackageManifest,
  resolveExpertPackageRevokeEffect,
  skillShelfAllowsBootstrap,
} from "@agenticx/config";

import {
  shouldPushCatalogUpdateToTenant,
  tenantSeesCatalogSkill,
  tenantSkillStatusAfterRevoke,
} from "../platform-catalog-distribution";

/**
 * Master §8 · e2e-enterprise-capability-platform — 合成闭环（无 PG）
 */
describe("ECP E5 e2e-enterprise-capability-platform (synthetic)", () => {
  const TENANT_A = "01TENANTAAAAAAAAAAAAAAAAAA";
  const TENANT_B = "01TENANTBBBBBBBBBBBBBBBBBB";
  const DEPT_D = "01DEPTDDDDDDDDDDDDDDDDDDDD";

  const expertManifest = normalizeExpertPackageManifest({
    members: [
      { kind: "skill", capabilityId: "skill:01SKILLAAAAAAAAAAAAAAAAA" },
      { kind: "skill", capabilityId: "skill:01SKILLBBBBBBBBBBBBBBBBB" },
      { kind: "mcp", capabilityId: "mcp:01MCPCCCCCCCCCCCCCCCCCCCC" },
    ],
  });

  it("step 1–2: draft not injectable; published + scan allows bootstrap", () => {
    expect(skillShelfAllowsBootstrap("draft", "active")).toBe(false);
    expect(skillShelfAllowsBootstrap("published", "active")).toBe(true);
    expect(evaluateAutoScanStep("safe").status).toBe("passed");
    expect(evaluateAutoScanStep(null).status).toBe("failed");
  });

  it("step 3: grant only tenant A — B does not see catalog owner row", () => {
    expect(tenantSeesCatalogSkill(TENANT_A, TENANT_A)).toBe(true);
    expect(tenantSeesCatalogSkill(TENANT_B, TENANT_A)).toBe(false);
  });

  it("step 4: secondary assign to dept D — key intersection (portal/bootstrap)", () => {
    const assignmentKeys = [`dept:${DEPT_D}`];
    const keysMemberInD = ["all", "01USERINDDDDDDDDDDDDDDDDD", `dept:${DEPT_D}`];
    const keysOutsider = ["all", "01USEROUTSIDDDDDDDDDDDDDD"];
    const packVisible = (userKeys: string[]) =>
      assignmentKeys.some((key) => userKeys.includes(key));
    expect(packVisible(keysMemberInD)).toBe(true);
    expect(packVisible(keysOutsider)).toBe(false);
  });

  it("step 5: approval gate blocks publish until approved", () => {
    expect(() =>
      assertPublishApprovalGate({
        presetSlug: "enterprise_admin_platform",
        requestStatus: "pending",
        consumedAt: null,
      }),
    ).toThrow(ApprovalRequiredError);
  });

  it("step 6: revoke default retain_stop_updates — stop updates, keep active copy", () => {
    expect(shouldPushCatalogUpdateToTenant("revoked", "published")).toBe(false);
    expect(tenantSkillStatusAfterRevoke("retain_stop_updates")).toBe("active");
    const effect = resolveExpertPackageRevokeEffect({
      installCopyEnabled: false,
      revokePolicy: "retain_stop_updates",
    });
    expect(effect.stopCatalogUpdates).toBe(true);
    expect(effect.disableInstallCopies).toBe(false);
  });

  it("step 7: install_copy off vs on revoke matrix", () => {
    const grantOnlyRetain = resolveExpertPackageRevokeEffect({
      installCopyEnabled: false,
      revokePolicy: "retain_stop_updates",
    });
    const grantOnlyStrip = resolveExpertPackageRevokeEffect({
      installCopyEnabled: false,
      revokePolicy: "strip_bootstrap",
    });
    const copyOnStrip = resolveExpertPackageRevokeEffect({
      installCopyEnabled: true,
      revokePolicy: "strip_bootstrap",
    });
    expect(grantOnlyRetain.disablePlatformReferences).toBe(false);
    expect(grantOnlyStrip.disablePlatformReferences).toBe(true);
    expect(copyOnStrip.disableInstallCopies).toBe(true);
    expect(DEFAULT_ECP_TENANT_DISTRIBUTION_POLICY.installCopyEnabled).toBe(false);
  });

  it("expert package E manifest shape (2 skill + 1 mcp)", () => {
    expect(expertManifest.members.filter((m) => m.kind === "skill")).toHaveLength(2);
    expect(expertManifest.members.filter((m) => m.kind === "mcp")).toHaveLength(1);
  });
});
