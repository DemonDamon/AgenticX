import { describe, expect, it } from "vitest";

import {
  DEFAULT_ECP_TENANT_DISTRIBUTION_POLICY,
  normalizeExpertPackageManifest,
  resolveExpertPackageRevokeEffect,
} from "@agenticx/config";

import {
  shouldPushCatalogUpdateToTenant,
  tenantSkillStatusAfterRevoke,
} from "../platform-catalog-distribution";

describe("ECP E4 expert package synthetic acceptance", () => {
  const manifest = normalizeExpertPackageManifest({
    members: [
      { kind: "skill", capabilityId: "skill:01SKILLAAAAAAAAAAAAAAAAA" },
      { kind: "skill", capabilityId: "skill:01SKILLBBBBBBBBBBBBBBBBB" },
      { kind: "mcp", capabilityId: "mcp:01MCPCCCCCCCCCCCCCCCCCCCC" },
    ],
  });

  it("expert package manifest requires 2 skills and 1 mcp", () => {
    expect(manifest.members.filter((m) => m.kind === "skill")).toHaveLength(2);
    expect(manifest.members.filter((m) => m.kind === "mcp")).toHaveLength(1);
  });

  it("default distribution remains grant-only (install copy off)", () => {
    expect(DEFAULT_ECP_TENANT_DISTRIBUTION_POLICY.installCopyEnabled).toBe(false);
  });

  it("revoke retain keeps tenant-visible copies for grant-only mode", () => {
    expect(
      resolveExpertPackageRevokeEffect({
        installCopyEnabled: false,
        revokePolicy: "retain_stop_updates",
      }).disableInstallCopies,
    ).toBe(false);
    expect(shouldPushCatalogUpdateToTenant("revoked")).toBe(false);
    expect(tenantSkillStatusAfterRevoke("retain_stop_updates")).toBe("active");
  });

  it("revoke strip differs when install copy enabled vs grant-only", () => {
    const grantOnly = resolveExpertPackageRevokeEffect({
      installCopyEnabled: false,
      revokePolicy: "strip_bootstrap",
    });
    const installCopy = resolveExpertPackageRevokeEffect({
      installCopyEnabled: true,
      revokePolicy: "strip_bootstrap",
    });
    expect(grantOnly.disablePlatformReferences).toBe(true);
    expect(installCopy.disableInstallCopies).toBe(true);
    expect(tenantSkillStatusAfterRevoke("strip_bootstrap")).toBe("disabled");
  });
});
