import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetMaInternalTokenCacheForTests } from "../../../../../lib/ma/internal-auth";

const listSchedulesMock = vi.fn();
const listWebhooksMock = vi.fn();
const listExpiringMock = vi.fn();
const autoDisableMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@agenticx/iam-core", () => ({
  listEnabledMaSchedulesForRuntime: (...args: unknown[]) => listSchedulesMock(...args),
  listEnabledMaWebhooksForRuntime: (...args: unknown[]) => listWebhooksMock(...args),
  listExpiringMaCredentials: (...args: unknown[]) => listExpiringMock(...args),
  autoDisableMaWebhook: (...args: unknown[]) => autoDisableMock(...args),
}));

const { GET: schedules } = await import("../schedules/route");
const { GET: webhooks } = await import("../webhooks/route");
const { GET: expiring } = await import("../credentials/expiring/route");
const { POST: autoDisable } = await import("../webhooks/[webhookId]/auto-disable/route");

const SECRET = "whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // gitleaks:allow
const WEBHOOK_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function withToken(url: string, token = "ma-token") { // gitleaks:allow
  return new Request(url, { headers: { authorization: `Bearer ${token}` } });
}

describe("internal schedule and webhook routes", () => {
  beforeEach(() => {
    __resetMaInternalTokenCacheForTests();
    vi.stubEnv("MA_INTERNAL_TOKEN", "ma-token");
    vi.stubEnv("MA_INTERNAL_TOKEN_FILE", "");
    listSchedulesMock.mockReset();
    listWebhooksMock.mockReset();
    listExpiringMock.mockReset();
    autoDisableMock.mockReset();
  });

  it("rejects the wrong internal token", async () => {
    const response = await schedules(withToken("http://localhost/api/internal/ma/schedules", "nope"));
    expect(response.status).toBe(401);
  });

  it("returns enabled schedules across tenants and disabled ids", async () => {
    listSchedulesMock.mockResolvedValue({
      enabled: [
        {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          tenantId: "tenant_a",
          name: "甲",
          description: null,
          agentId: "01BX5ZZKBKACTAV9WEVGEMMVSX",
          versionPolicy: "follow_routing",
          pinnedVersion: null,
          environmentId: null,
          cron: "0 9 * * 1-5",
          timezone: "Asia/Shanghai",
          inputTemplate: "hi",
          vaultIds: [],
          resources: [],
          runAsUserId: "user_a",
          enabled: true,
          revision: 2,
          misfireGraceSeconds: 300,
          manualRunRequestedAt: "2026-10-25T01:00:00.000Z",
          createdBy: "user_a",
          createdAt: "2026-10-25T00:00:00.000Z",
          updatedAt: "2026-10-25T00:00:00.000Z",
        },
        {
          id: "01C23456789ABCDEFGHJKMNPQR",
          tenantId: "tenant_b",
          name: "乙",
          description: null,
          agentId: "01BX5ZZKBKACTAV9WEVGEMMVSX",
          versionPolicy: "pinned",
          pinnedVersion: 4,
          environmentId: null,
          cron: "*/15 * * * *",
          timezone: "UTC",
          inputTemplate: "hi",
          vaultIds: [],
          resources: [],
          runAsUserId: "user_b",
          enabled: true,
          revision: 1,
          misfireGraceSeconds: 300,
          manualRunRequestedAt: null,
          createdBy: "user_b",
          createdAt: "2026-10-25T00:00:00.000Z",
          updatedAt: "2026-10-25T00:00:00.000Z",
        },
      ],
      disabledIds: ["01D23456789ABCDEFGHJKMNPQR"],
    });
    const response = await schedules(withToken("http://localhost/api/internal/ma/schedules"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: Array<Record<string, unknown>>;
      disabled_ids: string[];
    };
    expect(payload.data.map((item) => item.tenant_id)).toEqual(["tenant_a", "tenant_b"]);
    expect(payload.disabled_ids).toEqual(["01D23456789ABCDEFGHJKMNPQR"]);
    expect(payload.data[0]?.manual_run_requested_at).toBe("2026-10-25T01:00:00.000Z");
    expect(payload.data[0]).not.toHaveProperty("next_run_at");
    expect(payload.data[0]).not.toHaveProperty("last_run");
  });

  it("returns the plaintext signing secret with no-store", async () => {
    listWebhooksMock.mockResolvedValue([
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        tenantId: "tenant_a",
        url: "https://hooks.example.com/ma",
        eventTypes: ["session.idle"],
        agentIds: [],
        sources: [],
        includeResultText: true,
        signingSecret: SECRET,
      },
    ]);
    const response = await webhooks(withToken("http://localhost/api/internal/ma/webhooks"));
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = (await response.json()) as { data: Array<{ signing_secret: string }> };
    expect(payload.data[0]?.signing_secret).toBe(SECRET);
    expect(payload.data[0]).toHaveProperty("failure_reset_at", null);
  });

  it("returns failure_reset_at on the internal webhook list", async () => {
    listWebhooksMock.mockResolvedValue([
      {
        id: WEBHOOK_ID,
        tenantId: "tenant_a",
        url: "https://hooks.example.com/ma",
        eventTypes: ["session.idle"],
        agentIds: [],
        sources: [],
        includeResultText: false,
        failureResetAt: "2026-10-26T03:00:00.000Z",
        signingSecret: SECRET,
      },
    ]);
    const response = await webhooks(withToken("http://localhost/api/internal/ma/webhooks"));
    const payload = (await response.json()) as { data: Array<{ failure_reset_at: string | null }> };
    expect(payload.data[0]?.failure_reset_at).toBe("2026-10-26T03:00:00.000Z");
  });

  it("rejects auto-disable without an internal token", async () => {
    const response = await autoDisable(
      new Request(`http://localhost/api/internal/ma/webhooks/${WEBHOOK_ID}/auto-disable`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: "tenant_a", reason: "consecutive_failures" }),
      }),
      { params: Promise.resolve({ webhookId: WEBHOOK_ID }) },
    );
    expect(response.status).toBe(401);
    expect(autoDisableMock).not.toHaveBeenCalled();
  });

  it("auto-disables a webhook when the internal token is valid", async () => {
    autoDisableMock.mockResolvedValue(true);
    const response = await autoDisable(
      new Request(`http://localhost/api/internal/ma/webhooks/${WEBHOOK_ID}/auto-disable`, {
        method: "POST",
        headers: { authorization: "Bearer ma-token", "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: "tenant_a", reason: "gone" }),
      }),
      { params: Promise.resolve({ webhookId: WEBHOOK_ID }) },
    );
    expect(response.status).toBe(200);
    expect(autoDisableMock).toHaveBeenCalledWith("tenant_a", WEBHOOK_ID, "gone");
    expect(await response.json()).toEqual({ data: { disabled: true } });
  });

  it("forwards a 72 hour window and rejects within_hours=0", async () => {
    const inside = {
      tenantId: "tenant_a",
      vaultId: "01BX5ZZKBKACTAV9WEVGEMMVSX",
      credentialId: "01C23456789ABCDEFGHJKMNPQR",
      credentialType: "static_bearer",
      displayName: "mcp",
      expiresAt: "2026-10-26T00:00:00.000Z",
    };
    listExpiringMock.mockImplementation(async (hours: number) => {
      expect(hours).toBe(72);
      return [inside];
    });
    const response = await expiring(withToken("http://localhost/api/internal/ma/credentials/expiring?within_hours=72"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: Array<{ credential_id: string; expires_at: string }> };
    expect(payload.data).toEqual([
      {
        tenant_id: inside.tenantId,
        vault_id: inside.vaultId,
        credential_id: inside.credentialId,
        credential_type: inside.credentialType,
        display_name: inside.displayName,
        expires_at: inside.expiresAt,
      },
    ]);
    const rejected = await expiring(withToken("http://localhost/api/internal/ma/credentials/expiring?within_hours=0"));
    expect(rejected.status).toBe(400);
  });
});
