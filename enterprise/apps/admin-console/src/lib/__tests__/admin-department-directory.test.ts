import { describe, expect, it } from "vitest";
import {
  emptyAdminDepartmentDirectory,
  resolveAdminDepartmentLabel,
} from "../admin-department-directory";

describe("admin department directory labels", () => {
  it("resolves a department dimension to its readable path", () => {
    const directory = emptyAdminDepartmentDirectory();
    directory.byId.set("dept-1", "研发 / 平台");

    expect(resolveAdminDepartmentLabel(directory, "dept-1")).toBe("研发 / 平台");
  });

  it("keeps unknown IDs visible and labels an empty dimension", () => {
    const directory = emptyAdminDepartmentDirectory();

    expect(resolveAdminDepartmentLabel(directory, "legacy-dept")).toBe("legacy-dept");
    expect(resolveAdminDepartmentLabel(directory, null)).toBe("—");
    expect(resolveAdminDepartmentLabel(directory, null, "No department")).toBe("No department");
  });
});
