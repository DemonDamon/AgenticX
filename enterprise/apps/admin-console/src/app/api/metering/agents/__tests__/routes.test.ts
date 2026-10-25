import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const store = new Map<string, Record<string, unknown>>();

const mocks = vi.hoisted(() => ({
  requireAdminScope: vi.fn(),
  listMaAgentQuotas: vi.fn(),
  upsertMaAgentQuota: vi.fn(),
  deleteMaAgentQuota: vi.fn(),
  getEffectiveMaAgentQuota: vi.fn(),
}));

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => mocks.requireAdminScope(...args),
}));

vi.mock("@agenticx/iam-core", async () => {
  const actual = await vi.importActual<typeof import("@agenticx/iam-core")>("@agenticx/iam-core");
  return {
    ...actual,
    listMaAgentQuotas: (...args: unknown[]) => mocks.listMaAgentQuotas(...args),
    upsertMaAgentQuota: (...args: unknown[]) => mocks.upsertMaAgentQuota(...args),
    deleteMaAgentQuota: (...args: unknown[]) => mocks.deleteMaAgentQuota(...args),
    getEffectiveMaAgentQuota: (...args: unknown[]) => mocks.getEffectiveMaAgentQuota(...args),
  };
});

const AGENT = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const USER = "01ARZ3NDEKTSV4RRFFQ69G5FB0";

function allow(scopes: string[]) {
  mocks.requireAdminScope.mockImplementation(async (required: string[]) => {
    if (required.some((scope) => !scopes.includes(scope))) {
      return {
        ok: false as const,
        response: NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 }),
      };
    }
    return {
      ok: true as const,
      session: { email: "admin@example.com", userId: "admin-user", tenantId: "tenant-a" },
    };
  });
}

describe("agent metering routes", () => {
  beforeEach(() => {
    store.clear();
    mocks.requireAdminScope.mockReset();
    mocks.listMaAgentQuotas.mockReset();
    mocks.upsertMaAgentQuota.mockReset();
    mocks.deleteMaAgentQuota.mockReset();
    allow(["metering:read", "metering:manage"]);
    mocks.upsertMaAgentQuota.mockImplementation(async (tenant: string, body: Record<string, unknown>, actor: string) => {
      const { normalizeAgentQuotaInput } = await import("@agenticx/iam-core");
      const input = normalizeAgentQuotaInput(body);
      const subjectKey = input.subject === "default" ? "default" : `user:${input.userId}`;
      const key = `${tenant}|${input.agentId}|${subjectKey}`;
      const existing = store.get(key);
      const now = "2026-10-26T00:00:00.000Z";
      const row = {
        id: (existing?.id as string | undefined) ?? `01ARZ3NDEKTSV4RRFFQ69G5F${store.size.toString(36).padStart(2, "0")}`.slice(0, 26),
        tenantId: tenant,
        agentId: input.agentId,
        subject: input.subject,
        userId: input.userId,
        dailyTokens: input.dailyTokens,
        weeklyTokens: input.weeklyTokens,
        monthlyTokens: input.monthlyTokens,
        createdBy: actor,
        createdAt: (existing?.createdAt as string | undefined) ?? now,
        updatedAt: now,
      };
      store.set(key, row);
      return row;
    });
  });

  it("rejects usage queries without metering:read", async () => {
    allow([]);
    const { POST } = await import("../usage/route");
    const response = await POST(
      new Request("https://admin.example.com/api/metering/agents/usage", {
        method: "POST",
        body: JSON.stringify({ group_by: ["agent"] }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects an unknown group", async () => {
    const { POST } = await import("../usage/route");
    const response = await POST(
      new Request("https://admin.example.com/api/metering/agents/usage", {
        method: "POST",
        body: JSON.stringify({ group_by: ["cost"] }),
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "40001" });
  });

  it("rejects a quota whose three limits are zero", async () => {
    const { PUT } = await import("../quotas/route");
    const response = await PUT(
      new Request("https://admin.example.com/api/metering/agents/quotas", {
        method: "PUT",
        body: JSON.stringify({
          agent_id: AGENT,
          subject: "default",
          daily_tokens: 0,
          weekly_tokens: 0,
          monthly_tokens: 0,
        }),
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "40001" });
  });

  it("rejects a user subject without user_id", async () => {
    const { PUT } = await import("../quotas/route");
    const response = await PUT(
      new Request("https://admin.example.com/api/metering/agents/quotas", {
        method: "PUT",
        body: JSON.stringify({
          agent_id: AGENT,
          subject: "user",
          daily_tokens: 1,
          weekly_tokens: 0,
          monthly_tokens: 0,
        }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; message: string };
    expect(body.code).toBe("40001");
    expect(body.message).toContain("user_id");
  });

  it("returns the quota record keys and updates the same subject in place", async () => {
    const { PUT } = await import("../quotas/route");
    const first = await PUT(
      new Request("https://admin.example.com/api/metering/agents/quotas", {
        method: "PUT",
        body: JSON.stringify({
          agent_id: AGENT,
          subject: "user",
          user_id: USER,
          daily_tokens: 1,
          weekly_tokens: 2,
          monthly_tokens: 3,
        }),
      }),
    );
    expect(first.status).toBe(200);
    const created = (await first.json()) as { data: { rule: Record<string, unknown> } };
    expect(Object.keys(created.data.rule).sort()).toEqual(
      [
        "agent_id",
        "created_at",
        "daily_tokens",
        "id",
        "monthly_tokens",
        "subject",
        "updated_at",
        "user_id",
        "weekly_tokens",
      ].sort(),
    );
    const second = await PUT(
      new Request("https://admin.example.com/api/metering/agents/quotas", {
        method: "PUT",
        body: JSON.stringify({
          agent_id: AGENT,
          subject: "user",
          user_id: USER,
          daily_tokens: 9,
          weekly_tokens: 0,
          monthly_tokens: 0,
        }),
      }),
    );
    const updated = (await second.json()) as { data: { rule: { id: string; daily_tokens: number } } };
    expect(updated.data.rule.id).toBe(created.data.rule.id);
    expect(updated.data.rule.daily_tokens).toBe(9);
  });

  it("returns 404 when the quota id is missing", async () => {
    const { MaAgentQuotaNotFoundError } = await import("@agenticx/iam-core");
    mocks.deleteMaAgentQuota.mockRejectedValue(new MaAgentQuotaNotFoundError());
    const { DELETE } = await import("../quotas/[quotaId]/route");
    const response = await DELETE(new Request("https://admin.example.com/api/metering/agents/quotas/missing"), {
      params: Promise.resolve({ quotaId: "missing" }),
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "40401", message: "quota rule not found" });
  });

  it("requires metering:manage for writes", async () => {
    allow(["metering:read"]);
    const { PUT } = await import("../quotas/route");
    const response = await PUT(
      new Request("https://admin.example.com/api/metering/agents/quotas", {
        method: "PUT",
        body: JSON.stringify({
          agent_id: AGENT,
          subject: "default",
          daily_tokens: 1,
          weekly_tokens: 0,
          monthly_tokens: 0,
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.requireAdminScope).toHaveBeenCalledWith(["metering:manage"]);
  });
});
