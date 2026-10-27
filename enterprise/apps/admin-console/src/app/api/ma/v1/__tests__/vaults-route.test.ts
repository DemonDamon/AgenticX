import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyPatMock = vi.fn();
const touchPatLastUsedMock = vi.fn();
const listMaVaultsMock = vi.fn();
const createMaVaultMock = vi.fn();
const getMaVaultMock = vi.fn();
const listMaCredentialsMock = vi.fn();
const createMaCredentialMock = vi.fn();
const getMaCredentialMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@agenticx/iam-core", () => {
  class MaVaultNotFoundError extends Error {
    constructor() {
      super("missing");
      this.name = "MaVaultNotFoundError";
    }
  }
  class MaCredentialIdentityConflictError extends Error {
    constructor() {
      super("conflict");
      this.name = "MaCredentialIdentityConflictError";
    }
  }
  class MaVaultCredentialLimitError extends Error {
    constructor() {
      super("limit");
      this.name = "MaVaultCredentialLimitError";
    }
  }
  class MaVaultNotArchivedError extends Error {
    constructor() {
      super("not archived");
      this.name = "MaVaultNotArchivedError";
    }
  }
  class VaultCryptoUnavailableError extends Error {
    constructor() {
      super("crypto");
      this.name = "VaultCryptoUnavailableError";
    }
  }
  return {
    MaVaultNotFoundError,
    MaCredentialIdentityConflictError,
    MaVaultCredentialLimitError,
    MaVaultNotArchivedError,
    VaultCryptoUnavailableError,
    verifyPat: (...args: unknown[]) => verifyPatMock(...args),
    touchPatLastUsed: (...args: unknown[]) => touchPatLastUsedMock(...args),
    listMaVaults: (...args: unknown[]) => listMaVaultsMock(...args),
    createMaVault: (...args: unknown[]) => createMaVaultMock(...args),
    getMaVault: (...args: unknown[]) => getMaVaultMock(...args),
    listMaCredentials: (...args: unknown[]) => listMaCredentialsMock(...args),
    createMaCredential: (...args: unknown[]) => createMaCredentialMock(...args),
    getMaCredential: (...args: unknown[]) => getMaCredentialMock(...args),
  };
});

const { POST: createCredential } = await import("../vaults/[vaultId]/credentials/route");
const { GET: listCredentials } = await import("../vaults/[vaultId]/credentials/route");
const { GET: getCredential } = await import("../vaults/[vaultId]/credentials/[credentialId]/route");
const { GET: getVault } = await import("../vaults/[vaultId]/route");
const { POST: createVault } = await import("../vaults/route");

const VAULT_ID = "01BX5ZZKBKACTAV9WEVGEMMVSX";
const CRED_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const SECRET = "ghp_secret_value_123456"; // gitleaks:allow
const REFRESH = "refresh-secret-value-xyz";

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

function staticCredential() {
  return {
    id: CRED_ID,
    tenantId: "tenant_pat",
    vaultId: VAULT_ID,
    displayName: "GitHub MCP token",
    type: "static_bearer",
    identityKind: "mcp_server_url",
    identityKey: "https://mcp.example.com/mcp",
    publicConfig: {},
    secretFields: ["token"],
    hasSecret: true,
    status: "active",
    expiresAt: null,
    lastRotatedAt: null,
    lastResolvedAt: null,
    createdBy: "user_pat",
    archivedAt: null,
    createdAt: "2026-10-25T08:00:00.000Z",
    updatedAt: "2026-10-25T08:00:00.000Z",
  };
}

function oauthCredential() {
  return {
    ...staticCredential(),
    type: "mcp_oauth",
    secretFields: ["access_token", "refresh_token"],
    expiresAt: "2026-10-25T09:00:00.000Z",
    publicConfig: {
      refresh: {
        token_endpoint: "https://auth.example.com/token",
        client_id: "cid",
        scope: null,
        resource: null,
        token_endpoint_auth_type: "client_secret_post",
      },
    },
  };
}

describe("public ma vault routes", () => {
  beforeEach(() => {
    verifyPatMock.mockReset();
    touchPatLastUsedMock.mockReset();
    touchPatLastUsedMock.mockResolvedValue(undefined);
    listMaVaultsMock.mockReset();
    createMaVaultMock.mockReset();
    getMaVaultMock.mockReset();
    listMaCredentialsMock.mockReset();
    createMaCredentialMock.mockReset();
    getMaCredentialMock.mockReset();
  });

  it("POST credentials does not echo the secret and reports has_secret", async () => {
    createMaCredentialMock.mockResolvedValue(staticCredential());
    const response = await createCredential(
      authed(`http://localhost/api/ma/v1/vaults/${VAULT_ID}/credentials`, ["ma:vaults:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auth: { type: "static_bearer", mcp_server_url: "https://mcp.example.com/mcp", token: SECRET } }),
      }),
      { params: Promise.resolve({ vaultId: VAULT_ID }) },
    );
    expect(response.status).toBe(201);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain(SECRET);
    expect(text).toContain('"has_secret":true');
  });

  it("GET list and detail omit secrets", async () => {
    listMaCredentialsMock.mockResolvedValue([staticCredential()]);
    getMaCredentialMock.mockResolvedValue(staticCredential());
    const list = await listCredentials(
      authed(`http://localhost/api/ma/v1/vaults/${VAULT_ID}/credentials`, ["ma:vaults:read"]),
      { params: Promise.resolve({ vaultId: VAULT_ID }) },
    );
    const detail = await getCredential(
      authed(`http://localhost/api/ma/v1/vaults/${VAULT_ID}/credentials/${CRED_ID}`, ["ma:vaults:read"]),
      { params: Promise.resolve({ vaultId: VAULT_ID, credentialId: CRED_ID }) },
    );
    expect(JSON.stringify(await list.json())).not.toContain(SECRET);
    expect(JSON.stringify(await detail.json())).not.toContain(SECRET);
  });

  it("mcp_oauth records expose has_refresh_token and not the refresh token", async () => {
    createMaCredentialMock.mockResolvedValue(oauthCredential());
    const response = await createCredential(
      authed(`http://localhost/api/ma/v1/vaults/${VAULT_ID}/credentials`, ["ma:vaults:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auth: {
            type: "mcp_oauth",
            mcp_server_url: "https://mcp.example.com",
            access_token: SECRET,
            refresh: { refresh_token: REFRESH },
          },
        }),
      }),
      { params: Promise.resolve({ vaultId: VAULT_ID }) },
    );
    const text = JSON.stringify(await response.json());
    expect(text).toContain('"has_refresh_token":true');
    expect(text).not.toContain(REFRESH);
    expect(text).not.toContain(SECRET);
  });

  it("missing token is 401 and read scope cannot create", async () => {
    const missing = await createCredential(
      new Request(`http://localhost/api/ma/v1/vaults/${VAULT_ID}/credentials`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auth: { type: "static_bearer" } }),
      }),
      { params: Promise.resolve({ vaultId: VAULT_ID }) },
    );
    expect(missing.status).toBe(401);
    const forbidden = await createCredential(
      authed(`http://localhost/api/ma/v1/vaults/${VAULT_ID}/credentials`, ["ma:vaults:read"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auth: { type: "static_bearer" } }),
      }),
      { params: Promise.resolve({ vaultId: VAULT_ID }) },
    );
    expect(forbidden.status).toBe(403);
    const body = (await forbidden.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden_scope");
  });

  it("rejects unknown top-level fields", async () => {
    const response = await createVault(
      authed("http://localhost/api/ma/v1/vaults", ["ma:vaults:write"], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: "vault", x: 1 }),
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toBe("unknown field: x");
  });

  it("error mapping", async () => {
    const { MaVaultNotFoundError, MaCredentialIdentityConflictError, MaVaultCredentialLimitError, MaVaultNotArchivedError, VaultCryptoUnavailableError } =
      await import("@agenticx/iam-core");
    const cases = [
      [new MaVaultNotFoundError(), 404, "vault_not_found"],
      [new MaCredentialIdentityConflictError(), 409, "credential_identity_conflict"],
      [new MaVaultCredentialLimitError(), 409, "vault_credential_limit"],
      [new MaVaultNotArchivedError(), 409, "vault_not_archived"],
      [new VaultCryptoUnavailableError("crypto"), 503, "vault_crypto_unavailable"],
    ] as const;
    for (const [error, status, code] of cases) {
      getMaVaultMock.mockRejectedValueOnce(error);
      const response = await getVault(authed(`http://localhost/api/ma/v1/vaults/${VAULT_ID}`, ["ma:vaults:read"]), {
        params: Promise.resolve({ vaultId: VAULT_ID }),
      });
      expect(response.status).toBe(status);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe(code);
    }
  });
});
