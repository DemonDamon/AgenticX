import { describe, expect, it } from "vitest";

import { ApprovalRequiredError } from "../ecp-approval-workflow";
import { ExpertPackageManifestError } from "../ecp-expert-package";
import { ShelfPublishError } from "../ecp-shelf-lifecycle";
import { ECP_ERROR_CODES, resolveEcpErrorCode } from "../ecp-errors";

describe("resolveEcpErrorCode", () => {
  it("maps known ECP exception classes", () => {
    expect(resolveEcpErrorCode(new ApprovalRequiredError())).toBe(
      ECP_ERROR_CODES.APPROVAL_REQUIRED,
    );
    expect(resolveEcpErrorCode(new ShelfPublishError("scan"))).toBe(
      ECP_ERROR_CODES.SHELF_PUBLISH_BLOCKED,
    );
    expect(resolveEcpErrorCode(new ExpertPackageManifestError("bad"))).toBe(
      ECP_ERROR_CODES.EXPERT_PACKAGE_MANIFEST_INVALID,
    );
  });

  it("maps platform tenant misconfiguration messages", () => {
    expect(
      resolveEcpErrorCode(new Error("ECP_PLATFORM_TENANT_ID or DEFAULT_TENANT_ID is required")),
    ).toBe(ECP_ERROR_CODES.PLATFORM_TENANT_UNCONFIGURED);
  });
});
