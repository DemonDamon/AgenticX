import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  isLegacyQuotaImportTenant,
  migrateLegacyQuotasIfNeeded,
  resolveRuntimeAdminDir,
} from "../runtime-legacy-migrate";

const originalLegacyTenantId = process.env.ENTERPRISE_LEGACY_TENANT_ID;
const originalDefaultTenantId = process.env.DEFAULT_TENANT_ID;

describe("resolveRuntimeAdminDir", () => {
  let tmpDir = "";

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = "";
    delete process.env.ENTERPRISE_ADMIN_RUNTIME_DIR;
    if (originalLegacyTenantId === undefined) delete process.env.ENTERPRISE_LEGACY_TENANT_ID;
    else process.env.ENTERPRISE_LEGACY_TENANT_ID = originalLegacyTenantId;
    if (originalDefaultTenantId === undefined) delete process.env.DEFAULT_TENANT_ID;
    else process.env.DEFAULT_TENANT_ID = originalDefaultTenantId;
  });

  it("imports the global legacy quota file for only its designated tenant", () => {
    process.env.DEFAULT_TENANT_ID = "tenant-default";
    expect(isLegacyQuotaImportTenant("tenant-default")).toBe(true);
    expect(isLegacyQuotaImportTenant("tenant-other")).toBe(false);

    process.env.ENTERPRISE_LEGACY_TENANT_ID = "tenant-legacy";
    expect(isLegacyQuotaImportTenant("tenant-default")).toBe(false);
    expect(isLegacyQuotaImportTenant("tenant-legacy")).toBe(true);
  });

  it("skips quota migration before database access for a non-designated tenant", async () => {
    process.env.DEFAULT_TENANT_ID = "tenant-default";

    await expect(
      migrateLegacyQuotasIfNeeded("tenant-other", "/path/that/does/not/exist"),
    ).resolves.toMatchObject({
      action: "skipped",
      count: 0,
      reason: expect.stringContaining("designated legacy tenant"),
    });
  });

  it("honors ENTERPRISE_ADMIN_RUNTIME_DIR", () => {
    process.env.ENTERPRISE_ADMIN_RUNTIME_DIR = "/tmp/custom-runtime";
    expect(resolveRuntimeAdminDir("/any/cwd")).toBe("/tmp/custom-runtime");
  });

  it("finds .runtime/admin from enterprise root and app cwd", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-runtime-root-"));
    const runtimeDir = path.join(tmpDir, ".runtime", "admin");
    fs.mkdirSync(runtimeDir, { recursive: true });

    expect(resolveRuntimeAdminDir(tmpDir)).toBe(runtimeDir);
    expect(resolveRuntimeAdminDir(path.join(tmpDir, "apps", "web-portal"))).toBe(runtimeDir);
  });
});
