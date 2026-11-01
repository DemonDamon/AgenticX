import { describe, expect, it } from "vitest";

import {
  DEFAULT_ECP_TENANT_DISTRIBUTION_POLICY,
  normalizeEcpTenantDistributionPolicy,
  normalizeExpertPackageManifest,
  resolveExpertPackageRevokeEffect,
} from "../ecp-expert-package";

describe("ecp-expert-package", () => {
  it("defaults install copy to off", () => {
    expect(DEFAULT_ECP_TENANT_DISTRIBUTION_POLICY.installCopyEnabled).toBe(false);
    expect(normalizeEcpTenantDistributionPolicy({})).toEqual({
      installCopyEnabled: false,
    });
    expect(normalizeEcpTenantDistributionPolicy({ installCopyEnabled: "true" })).toEqual({
      installCopyEnabled: false,
    });
  });

  it("parses manifest with skill and mcp members", () => {
    expect(
      normalizeExpertPackageManifest({
        members: [
          { kind: "skill", capabilityId: "skill:01ABCDEFGHJKMNPQRSTVWXYZA" },
          { kind: "skill", capabilityId: "skill:01BBBBBBBBBBBBBBBBBBBBBB" },
          { kind: "mcp", capabilityId: "mcp:01CCCCCCCCCCCCCCCCCCCCCC" },
        ],
      }),
    ).toEqual({
      members: [
        { kind: "skill", capabilityId: "skill:01ABCDEFGHJKMNPQRSTVWXYZA" },
        { kind: "skill", capabilityId: "skill:01BBBBBBBBBBBBBBBBBBBBBB" },
        { kind: "mcp", capabilityId: "mcp:01CCCCCCCCCCCCCCCCCCCCCC" },
      ],
    });
  });

  it("revoke retain keeps references and install copies", () => {
    expect(
      resolveExpertPackageRevokeEffect({
        installCopyEnabled: false,
        revokePolicy: "retain_stop_updates",
      }),
    ).toEqual({
      stopCatalogUpdates: true,
      disablePlatformReferences: false,
      disableInstallCopies: false,
    });
    expect(
      resolveExpertPackageRevokeEffect({
        installCopyEnabled: true,
        revokePolicy: "retain_stop_updates",
      }).disableInstallCopies,
    ).toBe(false);
  });

  it("revoke strip disables references and install copies", () => {
    expect(
      resolveExpertPackageRevokeEffect({
        installCopyEnabled: false,
        revokePolicy: "strip_bootstrap",
      }),
    ).toMatchObject({
      disablePlatformReferences: true,
      disableInstallCopies: true,
    });
  });
});
