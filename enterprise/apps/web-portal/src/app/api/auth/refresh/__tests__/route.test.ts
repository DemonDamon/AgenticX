import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshTokens = vi.fn();
const verifyAccessToken = vi.fn();
const cookieGet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookieGet }),
}));

vi.mock("../../../../../lib/auth-runtime", () => ({
  refreshTokens: (...args: unknown[]) => refreshTokens(...args),
  verifyAccessToken: (...args: unknown[]) => verifyAccessToken(...args),
}));

vi.mock("../../../../../lib/session", () => ({
  ACCESS_COOKIE: "agenticx_access_token",
  REFRESH_COOKIE: "agenticx_refresh_token",
  isAuthCookieSecure: () => false,
}));

import { ACCESS_COOKIE, REFRESH_COOKIE } from "../../../../../lib/session";
import { GET } from "../route";

const exp = 1_800_000_000;
const accessToken = `header.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.signature`;
const rotatedRefresh = "refresh-2";

describe("GET /api/auth/refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieGet.mockImplementation((name: string) =>
      name === REFRESH_COOKIE ? { value: "refresh-1" } : undefined,
    );
    refreshTokens.mockResolvedValue({
      accessToken,
      refreshToken: rotatedRefresh,
      tokenType: "Bearer",
      expiresInSeconds: 3600,
      mustChangePassword: false,
    });
    verifyAccessToken.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "user-1",
      email: "user@example.com",
      scopes: [],
      mustChangePassword: false,
      sessionId: "session-1",
    });
  });

  it("returns tenant, user, and expiry as JSON and writes the new cookies", async () => {
    const response = await GET(
      new Request("https://portal.example/api/auth/refresh?format=json"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: "00000",
      message: "ok",
      data: {
        tenantId: "tenant-1",
        userId: "user-1",
        expiresAt: new Date(exp * 1000).toISOString(),
      },
    });
    expect(response.cookies.get(ACCESS_COOKIE)?.value).toBe(accessToken);
    expect(response.cookies.get(REFRESH_COOKIE)?.value).toBe(rotatedRefresh);
    expect(refreshTokens).toHaveBeenCalledWith("refresh-1");
  });

  it("returns 401 when the refresh cookie is missing", async () => {
    cookieGet.mockReturnValue(undefined);
    const response = await GET(
      new Request("https://portal.example/api/auth/refresh?format=json"),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ code: "40101", message: "unauthorized" });
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it("returns 401 when refresh fails", async () => {
    refreshTokens.mockRejectedValue(new Error("Refresh session expired."));
    const response = await GET(
      new Request("https://portal.example/api/auth/refresh?format=json"),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ code: "40101", message: "unauthorized" });
  });
});
