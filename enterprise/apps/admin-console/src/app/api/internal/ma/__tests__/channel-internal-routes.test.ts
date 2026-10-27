import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetMaInternalTokenCacheForTests } from "../../../../../lib/ma/internal-auth";

const listMock = vi.fn();
const readMock = vi.fn();
const insertAuditEventMock = vi.fn();
const openMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@agenticx/iam-core", async () => {
  const actual = await vi.importActual<typeof import("@agenticx/iam-core")>("@agenticx/iam-core");
  return {
    ...actual,
    listEnabledMaChannelsForRuntime: (...args: unknown[]) => listMock(...args),
    readMaChannelAppSecret: (...args: unknown[]) => readMock(...args),
    insertAuditEvent: (...args: unknown[]) => insertAuditEventMock(...args),
    openSecretPayload: (...args: unknown[]) => openMock(...args),
    channelCredentialAudit: actual.channelCredentialAudit,
  };
});

const { GET: list } = await import("../channels/route");
const { POST } = await import("../channels/[channelId]/credential/route");

const CHANNEL_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const TENANT = "tenant_a";
const VAULT = "01BX5ZZKBKACTAV9WEVGEMMVSX";
const CREDENTIAL = "01C23456789ABCDEFGHJKMNPQR";
const SECRET = "feishu-app-secret-value"; // gitleaks:allow

function withToken(url: string, token = "ma-token", body?: unknown) { // gitleaks:allow
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("internal channel routes", () => {
  beforeEach(() => {
    __resetMaInternalTokenCacheForTests();
    vi.stubEnv("MA_INTERNAL_TOKEN", "ma-token");
    vi.stubEnv("MA_INTERNAL_TOKEN_FILE", "");
    listMock.mockReset();
    readMock.mockReset();
    insertAuditEventMock.mockReset();
    insertAuditEventMock.mockResolvedValue(undefined);
    openMock.mockReset();
  });

  it("rejects the wrong internal token", async () => {
    const response = await list(withToken("http://localhost/api/internal/ma/channels", "nope"));
    expect(response.status).toBe(401);
  });

  it("returns the app secret only after a credential resolve audit", async () => {
    readMock.mockResolvedValue({
      appId: "cli_a1b2c3",
      vaultId: VAULT,
      credentialId: CREDENTIAL,
      sealed: { ciphertext: "cipher", wrappedDek: "dek", kekId: "kek" },
    });
    openMock.mockReturnValue({ secret_value: SECRET });
    const response = await POST(withToken(`http://localhost/api/internal/ma/channels/${CHANNEL_ID}/credential`, "ma-token", { tenant_id: TENANT }), {
      params: Promise.resolve({ channelId: CHANNEL_ID }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ app_id: "cli_a1b2c3", app_secret: SECRET });
    expect(insertAuditEventMock).toHaveBeenCalledTimes(1);
    const audit = insertAuditEventMock.mock.calls[0]?.[0] as {
      eventType: string;
      detail: Record<string, unknown>;
    };
    expect(audit.eventType).toBe("ma.channel.credential_resolve");
    expect(JSON.stringify(audit.detail)).not.toContain(SECRET);

    insertAuditEventMock.mockRejectedValueOnce(new Error("audit down"));
    const failed = await POST(
      withToken(`http://localhost/api/internal/ma/channels/${CHANNEL_ID}/credential`, "ma-token", { tenant_id: TENANT }),
      { params: Promise.resolve({ channelId: CHANNEL_ID }) },
    );
    expect(failed.status).toBe(500);
    const failedBody = JSON.stringify(await failed.json());
    expect(failedBody).not.toContain(SECRET);
    expect(failedBody).not.toContain("app_secret");
  });

  it("hides a disabled channel and an archived credential", async () => {
    const { MaChannelCredentialUnavailableError, MaChannelNotFoundError } = await import("@agenticx/iam-core");
    readMock.mockRejectedValueOnce(new MaChannelCredentialUnavailableError());
    const archived = await POST(
      withToken(`http://localhost/api/internal/ma/channels/${CHANNEL_ID}/credential`, "ma-token", { tenant_id: TENANT }),
      { params: Promise.resolve({ channelId: CHANNEL_ID }) },
    );
    expect(archived.status).toBe(409);
    expect(((await archived.json()) as { error: { code: string } }).error.code).toBe("channel_credential_unavailable");

    readMock.mockRejectedValueOnce(new MaChannelNotFoundError());
    const disabled = await POST(
      withToken(`http://localhost/api/internal/ma/channels/${CHANNEL_ID}/credential`, "ma-token", { tenant_id: TENANT }),
      { params: Promise.resolve({ channelId: CHANNEL_ID }) },
    );
    expect(disabled.status).toBe(404);
    expect(((await disabled.json()) as { error: { code: string } }).error.code).toBe("channel_not_found");
  });
});
