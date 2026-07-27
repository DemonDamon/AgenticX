import { beforeEach, describe, expect, it, vi } from "vitest";

const createPat = vi.fn();
const loginAndGetIdentity = vi.fn();

vi.mock("@agenticx/iam-core", () => ({
  createPat: (...args: unknown[]) => createPat(...args),
}));

vi.mock("../../../../../../lib/auth-runtime", () => ({
  loginAndGetIdentity: (...args: unknown[]) => loginAndGetIdentity(...args),
}));

describe("POST /api/desktop/auth/token", () => {
  beforeEach(() => {
    createPat.mockReset();
    loginAndGetIdentity.mockReset();
  });

  it("issues PAT with workspace:chat and desktop:managed scopes", async () => {
    loginAndGetIdentity.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "user-1",
      deptId: "dept-1",
      email: "alice@example.invalid",
      displayName: "Alice",
    });
    createPat.mockResolvedValue({
      token: "agx-pat-test",
      record: { id: 9 },
    });

    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/desktop/auth/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "alice@example.invalid",
          password: "secret",
          deviceName: "Near",
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(createPat).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ["workspace:chat", "desktop:managed"],
        tenantId: "tenant-1",
        userId: "user-1",
      }),
    );
  });
});
