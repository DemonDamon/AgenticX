import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasEveryScope, hasSomeScope } from "@agenticx/iam-core/scope-registry";

const mocks = vi.hoisted(() => ({ current: vi.fn(), verify: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "still-valid-cookie" }) }) }));
vi.mock("../admin-session", () => ({ ADMIN_SESSION_COOKIE: "admin_session", verifyAdminSessionToken: mocks.verify }));
vi.mock("@agenticx/iam-core", () => ({ getAdminUser: mocks.current, hasEveryScope, hasSomeScope }));
import { requireAdminScope, requireAdminSomeScope } from "../admin-auth";

const session = { userId: "actor", tenantId: "tenant", email: "actor@example.invalid" };
describe("administrative guards consult the current account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockReturnValue(session);
    mocks.current.mockResolvedValue({ ...session, status: "active", scopes: ["role:create", "user:update"] });
  });
  it("allows current active accounts with the required permission", async () => {
    expect((await requireAdminScope(["role:create"])).ok).toBe(true);
    expect((await requireAdminSomeScope(["user:update", "role:read"])).ok).toBe(true);
    expect(mocks.current).toHaveBeenCalledWith("tenant", "actor");
  });
  it.each(["disabled", "locked"])("rejects %s accounts despite a still-valid cookie and retained roles", async (status) => {
    mocks.current.mockResolvedValue({ ...session, status, scopes: ["*"] });
    for (const result of [await requireAdminScope(["role:create"]), await requireAdminSomeScope(["user:update"])]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(403);
    }
  });
  it("rejects deleted or missing accounts even if the cookie still verifies", async () => {
    mocks.current.mockResolvedValue(null);
    const result = await requireAdminScope(["role:create"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });
  it("uses current permissions instead of the signed session snapshot", async () => {
    mocks.current.mockResolvedValue({ ...session, status: "active", scopes: [] });
    expect((await requireAdminScope(["role:create"])).ok).toBe(false);
    expect((await requireAdminSomeScope(["user:update"])).ok).toBe(false);
  });
  it("does not query accounts for an unauthenticated request", async () => {
    mocks.verify.mockReturnValue(null);
    const result = await requireAdminScope(["role:create"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    expect(mocks.current).not.toHaveBeenCalled();
  });
});
