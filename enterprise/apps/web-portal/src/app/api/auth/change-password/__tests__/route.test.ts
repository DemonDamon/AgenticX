import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionFromCookies = vi.fn();
const completeRequiredPasswordChange = vi.fn();

vi.mock("../../../../../lib/session", () => ({
  ACCESS_COOKIE: "agx_access",
  REFRESH_COOKIE: "agx_refresh",
  getSessionFromCookies: (...args: unknown[]) => getSessionFromCookies(...args),
  isAuthCookieSecure: () => false,
  passwordChangeRequiredResponse: () => Response.json(
    { code: "40302", message: "password_change_required" },
    { status: 403 },
  ),
}));

vi.mock("../../../../../lib/auth-runtime", () => ({
  completeRequiredPasswordChange: (...args: unknown[]) => completeRequiredPasswordChange(...args),
}));

describe("POST /api/auth/change-password", () => {
  beforeEach(() => {
    getSessionFromCookies.mockReset();
    completeRequiredPasswordChange.mockReset();
  });

  it("returns 401 without an authenticated session", async () => {
    getSessionFromCookies.mockResolvedValue(null);
    const { POST } = await import("../route");

    const response = await POST(new Request("http://localhost/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPassword: "Replacement-password-2!" }),
    }));

    expect(response.status).toBe(401);
    expect(completeRequiredPasswordChange).not.toHaveBeenCalled();
  });

  it("only accepts a session that is pending a password change", async () => {
    getSessionFromCookies.mockResolvedValue({
      userId: "u1",
      tenantId: "t1",
      email: "member@example.com",
      scopes: [],
      sessionId: "s1",
      mustChangePassword: false,
    });
    const { POST } = await import("../route");

    const response = await POST(new Request("http://localhost/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPassword: "Replacement-password-2!" }),
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "40302",
      message: "password_change_required",
    });
  });

  it("rejects a short replacement password", async () => {
    const session = {
      userId: "u1",
      tenantId: "t1",
      email: "member@example.com",
      scopes: [],
      sessionId: "s1",
      mustChangePassword: true,
    };
    getSessionFromCookies.mockResolvedValue(session);
    const { POST } = await import("../route");

    const response = await POST(new Request("http://localhost/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPassword: "short" }),
    }));

    expect(response.status).toBe(400);
    expect(completeRequiredPasswordChange).not.toHaveBeenCalled();
  });

  it("rotates both auth cookies after a successful replacement", async () => {
    const session = {
      userId: "u1",
      tenantId: "t1",
      email: "member@example.com",
      scopes: [],
      sessionId: "s1",
      mustChangePassword: true,
    };
    getSessionFromCookies.mockResolvedValue(session);
    completeRequiredPasswordChange.mockResolvedValue({
      accessToken: "next-access",
      refreshToken: "next-refresh",
      tokenType: "Bearer",
      expiresInSeconds: 3600,
      mustChangePassword: false,
    });
    const { POST } = await import("../route");

    const response = await POST(new Request("http://localhost/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPassword: "Replacement-password-2!" }),
    }));

    expect(response.status).toBe(200);
    expect(completeRequiredPasswordChange).toHaveBeenCalledWith(session, "Replacement-password-2!");
    expect(response.headers.get("set-cookie")).toContain("agx_access=next-access");
    expect(response.headers.get("set-cookie")).toContain("agx_refresh=next-refresh");
  });
});
