import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveRuntimeAdminDir } from "../runtime-legacy-migrate";

describe("resolveRuntimeAdminDir", () => {
  let tmpDir = "";

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = "";
    delete process.env.ENTERPRISE_ADMIN_RUNTIME_DIR;
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
