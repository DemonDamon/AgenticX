import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyPatMock = vi.fn();
const touchPatLastUsedMock = vi.fn();
const listMaChannelsMock = vi.fn();
const createMaChannelMock = vi.fn();
const getMaChannelMock = vi.fn();
const updateMaChannelMock = vi.fn();
const deleteMaChannelMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@agenticx/iam-core", async () => {
  const actual = await vi.importActual<typeof import("@agenticx/iam-core")>("@agenticx/iam-core");
  return {
    ...actual,
    verifyPat: (...args: unknown[]) => verifyPatMock(...args),
    touchPatLastUsed: (...args: unknown[]) => touchPatLastUsedMock(...args),
    listMaChannels: (...args: unknown[]) => listMaChannelsMock(...args),
    createMaChannel: (...args: unknown[]) => createMaChannelMock(...args),
    getMaChannel: (...args: unknown[]) => getMaChannelMock(...args),
    updateMaChannel: (...args: unknown[]) => updateMaChannelMock(...args),
    deleteMaChannel: (...args: unknown[]) => deleteMaChannelMock(...args),
  };
});

const { POST, GET: list } = await import("../channels/route");

const CHANNEL_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const AGENT_ID = "01BX5ZZKBKACTAV9WEVGEMMVSX";
const VAULT_ID = "01C23456789ABCDEFGHJKMNPQR";
const CREDENTIAL_ID = "01D23456789ABCDEFGHJKMNPQR";

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

function channel(extra: Record<string, unknown> = {}) {
  return {
    id: CHANNEL_ID,
    tenantId: "tenant_pat",
    name: "项目助理",
    platform: "feishu",
    agentId: AGENT_ID,
    routing: "follow_latest",
    pinnedVersion: null,
    environmentId: null,
    appId: "cli_a1b2c3",
    credentialVaultId: VAULT_ID,
    credentialId: CREDENTIAL_ID,
    ownerUserId: "user_pat",
    config: { idle_reset_hours: 24, open_base_url: "https://open.feishu.cn" },
    enabled: true,
    revision: 1,
    createdBy: "user_pat",
    createdAt: "2026-10-25T00:00:00.000Z",
    updatedAt: "2026-10-25T00:00:00.000Z",
    connection: { status: "pending", lastError: null, lastEventAt: null, startedAt: null },
    ...extra,
  };
}

const body = {
  name: "项目助理",
  agent_id: AGENT_ID,
  app_id: "cli_a1b2c3",
  credential: { vault_id: VAULT_ID, credential_id: CREDENTIAL_ID },
};

describe("public channel routes", () => {
  beforeEach(() => {
    verifyPatMock.mockReset();
    touchPatLastUsedMock.mockReset();
    touchPatLastUsedMock.mockResolvedValue(undefined);
    listMaChannelsMock.mockReset();
    createMaChannelMock.mockReset();
    getMaChannelMock.mockReset();
    updateMaChannelMock.mockReset();
    deleteMaChannelMock.mockReset();
  });

  it("rejects a token without the channel scope", async () => {
    const response = await list(authed("http://localhost/api/ma/v1/channels", ["ma:agents:read"]));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("forbidden_scope");
  });

  it("creates a channel owned by the PAT user with a pending connection", async () => {
    createMaChannelMock.mockImplementation(async (_tenant: string, _body: Record<string, unknown>, userId: string) =>
      channel({ ownerUserId: userId, connection: undefined }),
    );
    getMaChannelMock.mockImplementation(async () => channel({ ownerUserId: "user_pat" }));
    const response = await POST(
      authed("http://localhost/api/ma/v1/channels", ["ma:channels:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { channel: Record<string, unknown> };
    expect(payload.channel.owner_user_id).toBe("user_pat");
    expect((payload.channel.connection as { status: string }).status).toBe("pending");
    const text = JSON.stringify(payload);
    expect(text).not.toContain("app_secret");
    expect(text).not.toContain("secret_value");
  });

  it("rejects a static bearer credential reference", async () => {
    const { MaChannelValidationError } = await import("@agenticx/iam-core");
    createMaChannelMock.mockRejectedValue(
      new MaChannelValidationError("credential: must reference an active environment_variable credential"),
    );
    const response = await POST(
      authed("http://localhost/api/ma/v1/channels", ["ma:channels:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain("environment_variable");
  });

  it("maps a duplicate app id and the 21st channel", async () => {
    const { MaChannelConflictError, MaChannelLimitError } = await import("@agenticx/iam-core");
    createMaChannelMock.mockRejectedValueOnce(new MaChannelConflictError("app_id is already bound to another channel"));
    const duplicate = await POST(
      authed("http://localhost/api/ma/v1/channels", ["ma:channels:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(duplicate.status).toBe(400);
    expect(((await duplicate.json()) as { error: { message: string } }).error.message).toBe(
      "app_id is already bound to another channel",
    );

    let count = 0;
    createMaChannelMock.mockImplementation(async () => {
      count += 1;
      if (count > 20) throw new MaChannelLimitError();
      return channel();
    });
    getMaChannelMock.mockResolvedValue(channel());
    for (let index = 0; index < 20; index += 1) {
      const ok = await POST(
        authed("http://localhost/api/ma/v1/channels", ["ma:channels:write"], {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      expect(ok.status).toBe(201);
    }
    const limited = await POST(
      authed("http://localhost/api/ma/v1/channels", ["ma:channels:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(limited.status).toBe(409);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe("channel_limit");
  });
});
