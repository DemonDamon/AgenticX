import { describe, expect, it } from "vitest";
import { emptyAdminUserDirectory, resolveAdminUserLabel } from "../admin-user-directory";

describe("admin user directory labels", () => {
  it("prefers the tenant display name by user id", () => {
    const directory = emptyAdminUserDirectory();
    directory.byId.set("user-1", "张三");
    directory.byEmail.set("user@example.com", "邮箱名");

    expect(resolveAdminUserLabel(directory, "user-1", "user@example.com")).toBe("张三");
  });

  it("falls back from email to id when the directory has no match", () => {
    const directory = emptyAdminUserDirectory();

    expect(resolveAdminUserLabel(directory, "missing", "user@example.com")).toBe("user@example.com");
    expect(resolveAdminUserLabel(directory, "missing", null)).toBe("missing");
    expect(resolveAdminUserLabel(directory, null, null)).toBe("—");
  });
});
