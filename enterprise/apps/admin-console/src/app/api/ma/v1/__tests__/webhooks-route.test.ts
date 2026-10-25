import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyPatMock = vi.fn();
const touchPatLastUsedMock = vi.fn();
const createMaWebhookMock = vi.fn();
const listMaWebhooksMock = vi.fn();
const getMaWebhookMock = vi.fn();
const rotateMaWebhookSecretMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@agenticx/iam-core", async () => {
  const actual = await vi.importActual<typeof import("@agenticx/iam-core")>("@agenticx/iam-core");
  return {
    ...actual,
    verifyPat: (...args: unknown[]) => verifyPatMock(...args),
    touchPatLastUsed: (...args: unknown[]) => touchPatLastUsedMock(...args),
    createMaWebhook: (...args: unknown[]) => createMaWebhookMock(...args),
    listMaWebhooks: (...args: unknown[]) => listMaWebhooksMock(...args),
    getMaWebhook: (...args: unknown[]) => getMaWebhookMock(...args),
    rotateMaWebhookSecret: (...args: unknown[]) => rotateMaWebhookSecretMock(...args),
  };
});

const { POST } = await import("../webhooks/route");
const { GET } = await import("../webhooks/[webhookId]/route");
const { POST: rotate } = await import("../webhooks/[webhookId]/rotate_secret/route");

const WEBHOOK_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function authed(url: string, scopes: string[], init?: RequestInit) {
  verifyPatMock.mockResolvedValue({
    id: 7,
    tenantId: "tenant_pat",
    userId: "user_pat",
    deptId: null,
    scopes,
    status: "active",
  });
  const headers = new Headers(init?.headers);
  headers.set("authorization", "Bearer agx-pat-test");
  return new Request(url, { ...init, headers });
}

function webhook(extra: Record<string, unknown> = {}) {
  return {
    id: WEBHOOK_ID,
    tenantId: "tenant_pat",
    name: "通知",
    url: "https://hooks.example.com/ma",
    eventTypes: ["session.idle"],
    agentIds: [],
    sources: [],
    includeResultText: false,
    enabled: true,
    secretRotatedAt: "2026-10-25T00:00:00.000Z",
    createdBy: "user_pat",
    createdAt: "2026-10-25T00:00:00.000Z",
    updatedAt: "2026-10-25T00:00:00.000Z",
    ...extra,
  };
}

describe("public webhook routes", () => {
  beforeEach(() => {
    verifyPatMock.mockReset();
    touchPatLastUsedMock.mockReset();
    touchPatLastUsedMock.mockResolvedValue(undefined);
    createMaWebhookMock.mockReset();
    listMaWebhooksMock.mockReset();
    getMaWebhookMock.mockReset();
    rotateMaWebhookSecretMock.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv("MA_VAULT_MASTER_KEY", "unit-test-master-key-32b-minimum");
  });

  it("returns a signing secret once and omits it afterwards", async () => {
    const { generateSigningSecret, normalizeWebhookInput, sealSecretPayload } = await import("@agenticx/iam-core");
    createMaWebhookMock.mockImplementation(async (_tenant: string, body: Record<string, unknown>) => {
      const input = normalizeWebhookInput(body, "create");
      if (!process.env.MA_VAULT_MASTER_KEY) sealSecretPayload({ signing_secret: "x" });
      return { webhook: webhook({ name: input.name, url: input.url, eventTypes: input.eventTypes }), signingSecret: generateSigningSecret() };
    });
    const created = await POST(
      authed("http://localhost/api/ma/v1/webhooks", ["ma:webhooks:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "通知", url: "https://hooks.example.com/ma", event_types: ["session.idle"] }),
      }),
    );
    expect(created.status).toBe(201);
    const payload = (await created.json()) as { webhook: Record<string, unknown>; signing_secret: string };
    expect(payload.signing_secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    getMaWebhookMock.mockResolvedValue(webhook());
    const fetched = await GET(authed(`http://localhost/api/ma/v1/webhooks/${WEBHOOK_ID}`, ["ma:webhooks:read"]), {
      params: Promise.resolve({ webhookId: WEBHOOK_ID }),
    });
    const detail = (await fetched.json()) as { webhook: Record<string, unknown> };
    const keys = Object.keys(detail.webhook);
    expect(keys).not.toContain("signing_secret");
    expect(keys).not.toContain("secret_ciphertext");
    expect(keys).not.toContain("wrapped_dek");
  });

  it("rotates to a different secret", async () => {
    const { generateSigningSecret } = await import("@agenticx/iam-core");
    const first = generateSigningSecret();
    const second = generateSigningSecret();
    rotateMaWebhookSecretMock.mockResolvedValue({ webhook: webhook(), signingSecret: second });
    const response = await rotate(
      authed(`http://localhost/api/ma/v1/webhooks/${WEBHOOK_ID}/rotate_secret`, ["ma:webhooks:write"], { method: "POST" }),
      { params: Promise.resolve({ webhookId: WEBHOOK_ID }) },
    );
    const payload = (await response.json()) as { signing_secret: string };
    expect(payload.signing_secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(payload.signing_secret).not.toBe(first);
    expect(payload.signing_secret).toBe(second);
  });

  it("rejects empty or unknown event types and credentialed urls", async () => {
    const { normalizeWebhookInput, MaWebhookValidationError } = await import("@agenticx/iam-core");
    createMaWebhookMock.mockImplementation(async (_tenant: string, body: Record<string, unknown>) => {
      normalizeWebhookInput(body, "create");
      throw new MaWebhookValidationError("unreachable");
    });
    for (const eventTypes of [[], ["session.started"]]) {
      const response = await POST(
        authed("http://localhost/api/ma/v1/webhooks", ["ma:webhooks:write"], {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "通知", url: "https://hooks.example.com/ma", event_types: eventTypes }),
        }),
      );
      expect(response.status).toBe(400);
    }
    const credentialed = await POST(
      authed("http://localhost/api/ma/v1/webhooks", ["ma:webhooks:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "通知",
          url: "https://u:p@x.example.com/h", // gitleaks:allow
          event_types: ["session.idle"],
        }),
      }),
    );
    expect(credentialed.status).toBe(400);
  });

  it("maps a missing master key to vault_crypto_unavailable", async () => {
    const { normalizeWebhookInput, sealSecretPayload } = await import("@agenticx/iam-core");
    vi.stubEnv("MA_VAULT_MASTER_KEY", "");
    createMaWebhookMock.mockImplementation(async (_tenant: string, body: Record<string, unknown>) => {
      normalizeWebhookInput(body, "create");
      sealSecretPayload({ signing_secret: "x" });
      throw new Error("unreachable");
    });
    const response = await POST(
      authed("http://localhost/api/ma/v1/webhooks", ["ma:webhooks:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "通知", url: "https://hooks.example.com/ma", event_types: ["session.failed"] }),
      }),
    );
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("vault_crypto_unavailable");
  });
});
