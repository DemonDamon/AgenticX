import { describe, expect, it, vi } from "vitest";
import { refreshGatewayBearer } from "./gateway-auth-refresh";

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
