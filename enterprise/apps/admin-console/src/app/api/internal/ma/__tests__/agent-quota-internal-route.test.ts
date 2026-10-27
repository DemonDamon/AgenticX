import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetMaInternalTokenCacheForTests } from "../../../../../lib/ma/internal-auth";

const readEffectiveAgentQuota = vi.fn();

vi.mock("../../../../../lib/metering-service", () => ({
  readEffectiveAgentQuota: (...args: unknown[]) => readEffectiveAgentQuota(...args),
}));

const { GET } = await import("../agent-quotas/effective/route");

const TENANT = "01J00000000000000000000001";
const AGENT = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const USER = "01ARZ3NDEKTSV4RRFFQ69G5FB0";

function authed(url: string, token = "ma-token") { // gitleaks:allow
  return new Request(url, { headers: { authorization: `Bearer ${token}` } });
}

function rule(subject: "user" | "default") {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FC0",
    tenantId: TENANT,
    agentId: AGENT,
    subject,
    userId: subject === "user" ? USER : null,
    dailyTokens: 0,
    weeklyTokens: 0,
    monthlyTokens: 200000,
    createdBy: null,
    createdAt: "2026-10-26T00:00:00.000Z",
    updatedAt: "2026-10-26T00:00:00.000Z",
  };
}

describe("effective agent quota", () => {
  beforeEach(() => {
    __resetMaInternalTokenCacheForTests();
    vi.stubEnv("MA_INTERNAL_TOKEN", "ma-token");
    vi.stubEnv("MA_INTERNAL_TOKEN_FILE", "");
    vi.stubEnv("GATEWAY_INTERNAL_TOKEN", "");
    readEffectiveAgentQuota.mockReset();
  });

  it("rejects a bad token", async () => {
    const response = await GET(
      authed(
        `https://admin.example.com/api/internal/ma/agent-quotas/effective?tenant_id=${TENANT}&agent_id=${AGENT}&user_id=${USER}`,
        "nope",
      ),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("prefers the user rule", async () => {
    readEffectiveAgentQuota.mockResolvedValue(rule("user"));
    const response = await GET(
      authed(
        `https://admin.example.com/api/internal/ma/agent-quotas/effective?tenant_id=${TENANT}&agent_id=${AGENT}&user_id=${USER}`,
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      quota: {
        source: "user",
        rule_id: "01ARZ3NDEKTSV4RRFFQ69G5FC0",
        daily_tokens: 0,
        weekly_tokens: 0,
        monthly_tokens: 200000,
      },
    });
  });

  it("falls back to the default rule", async () => {
    readEffectiveAgentQuota.mockResolvedValue(rule("default"));
    const response = await GET(
      authed(
        `https://admin.example.com/api/internal/ma/agent-quotas/effective?tenant_id=${TENANT}&agent_id=${AGENT}&user_id=${USER}`,
      ),
    );
    await expect(response.json()).resolves.toMatchObject({ quota: { source: "default" } });
  });

  it("returns null when nothing matches", async () => {
    readEffectiveAgentQuota.mockResolvedValue(null);
    const response = await GET(
      authed(
        `https://admin.example.com/api/internal/ma/agent-quotas/effective?tenant_id=${TENANT}&agent_id=${AGENT}&user_id=${USER}`,
      ),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ quota: null });
  });
});
