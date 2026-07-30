import type { AuthUser } from "@agenticx/auth";
import { describe, expect, it } from "vitest";
import { buildPortalTokenContext } from "./portal-auth-token-context";

describe("buildPortalTokenContext", () => {
  it("keeps identity and password-change state while omitting expanded scopes", () => {
    const user: AuthUser = {
      id: "user-1",
      tenantId: "tenant-1",
      deptId: "dept-1",
      email: "admin@example.com",
      displayName: "Admin",
      passwordHash: "hash",
      mustChangePassword: true,
      status: "active",
      failedLoginCount: 0,
      lockedUntil: null,
      scopes: ["admin:enter", "workspace:chat"],
    };

    expect(buildPortalTokenContext(user, "session-1")).toEqual({
      userId: "user-1",
      tenantId: "tenant-1",
      deptId: "dept-1",
      email: "admin@example.com",
      scopes: [],
      mustChangePassword: true,
      sessionId: "session-1",
    });
  });
});
