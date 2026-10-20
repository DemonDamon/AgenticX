import { describe, expect, it, vi } from "vitest";
import { hasGatewayBearerLifetime, refreshGatewayBearer } from "./gateway-auth-refresh";

function token(expSeconds: number): string {
  return `header.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url")}.signature`;
}

describe("hasGatewayBearerLifetime", () => {
  const now = Date.parse("2026-10-20T08:00:00.000Z");

  it("accepts a token that outlives the required window and rejects one that only meets it", () => {
    expect(hasGatewayBearerLifetime(token(Math.floor((now + 30 * 60_000) / 1000)), 27 * 60_000, now)).toBe(true);
    expect(hasGatewayBearerLifetime(token(Math.floor((now + 20 * 60_000) / 1000)), 27 * 60_000, now)).toBe(false);
    expect(hasGatewayBearerLifetime(token(Math.floor((now + 27 * 60_000) / 1000)), 27 * 60_000, now)).toBe(false);
  });

  it("fails closed for opaque tokens and non-numeric exp", () => {
    expect(hasGatewayBearerLifetime("opaque-token", 60_000, now)).toBe(false);
    expect(
      hasGatewayBearerLifetime(
        `header.${Buffer.from('{"exp":"later"}').toString("base64url")}.signature`,
        60_000,
        now,
      ),
    ).toBe(false);
  });
});

describe("refreshGatewayBearer", () => {
  it("updates authorization when refresh returns a token", async () => {
    const headers: Record<string, string> = {
      authorization: "Bearer expired",
      "x-user-id": "u1",
    };
    const ok = await refreshGatewayBearer({
      headers,
      refreshAccessToken: async () => ({ accessToken: "fresh-token" }),
    });
    expect(ok).toBe(true);
    expect(headers.authorization).toBe("Bearer fresh-token");
    expect(headers["x-user-id"]).toBe("u1");
  });

  it("leaves headers unchanged when refresh returns null", async () => {
    const headers: Record<string, string> = { authorization: "Bearer old" };
    const ok = await refreshGatewayBearer({
      headers,
      refreshAccessToken: async () => null,
    });
    expect(ok).toBe(false);
    expect(headers.authorization).toBe("Bearer old");
  });

  it("leaves headers unchanged when refresh throws", async () => {
    const headers: Record<string, string> = { authorization: "Bearer old" };
    const refreshAccessToken = vi.fn(async () => {
      throw new Error("refresh failed");
    });
    const ok = await refreshGatewayBearer({ headers, refreshAccessToken });
    expect(ok).toBe(false);
    expect(headers.authorization).toBe("Bearer old");
    expect(refreshAccessToken).toHaveBeenCalledOnce();
  });
});
