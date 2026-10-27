import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const createMaCredentialMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));
vi.mock("@agenticx/iam-core", () => {
  class MaCredentialIdentityConflictError extends Error {
    constructor() {
      super("conflict");
      this.name = "MaCredentialIdentityConflictError";
    }
  }
  class VaultCryptoUnavailableError extends Error {
    constructor() {
      super("crypto");
      this.name = "VaultCryptoUnavailableError";
    }
  }
  class MaVaultValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "MaVaultValidationError";
    }
  }
  return {
    MaCredentialIdentityConflictError,
    VaultCryptoUnavailableError,
    MaVaultValidationError,
    createMaCredential: (...args: unknown[]) => createMaCredentialMock(...args),
    listMaCredentials: vi.fn(),
    getMaCredential: vi.fn(),
    rotateMaCredential: vi.fn(),
    deleteMaCredential: vi.fn(),
    archiveMaCredential: vi.fn(),
  };
});

const { POST } = await import("../[vaultId]/credentials/route");

const VAULT_ID = "01BX5ZZKBKACTAV9WEVGEMMVSX";
const SECRET = "admin-secret-value-123456"; // gitleaks:allow

function request(body: unknown) {
  return new Request(`http://localhost/api/admin/ma-vaults/${VAULT_ID}/credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin ma-vaults routes", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    createMaCredentialMock.mockReset();
    process.env.DEFAULT_TENANT_ID = "tenant_test";
    requireAdminScopeMock.mockResolvedValue({ ok: true, session: { userId: "user_1", tenantId: "tenant_test" } });
  });

  it("returns 403 when the admin scope check fails", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 }),
    });
    const response = await POST(request({ auth: { type: "static_bearer" } }), { params: Promise.resolve({ vaultId: VAULT_ID }) });
    expect(response.status).toBe(403);
  });

  it("creates a credential without returning the secret", async () => {
    createMaCredentialMock.mockResolvedValue({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      tenantId: "tenant_test",
      vaultId: VAULT_ID,
      displayName: null,
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
      createdBy: "user_1",
      archivedAt: null,
      createdAt: "2026-10-25T08:00:00.000Z",
      updatedAt: "2026-10-25T08:00:00.000Z",
    });
    const response = await POST(
      request({ auth: { type: "static_bearer", mcp_server_url: "https://mcp.example.com/mcp", token: SECRET } }),
      { params: Promise.resolve({ vaultId: VAULT_ID }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { code: string; data: { credential: Record<string, unknown> } };
    expect(body.code).toBe("00000");
    expect(JSON.stringify(body.data.credential)).not.toContain(SECRET);
  });

  it("maps identity conflicts to the Chinese 409 message", async () => {
    const { MaCredentialIdentityConflictError } = await import("@agenticx/iam-core");
    createMaCredentialMock.mockRejectedValue(new MaCredentialIdentityConflictError());
    const response = await POST(request({ auth: { type: "bearer", host: "x.com", token: SECRET } }), {
      params: Promise.resolve({ vaultId: VAULT_ID }),
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { message: string };
    expect(body.message).toBe("该凭证库中已存在相同匹配目标的有效凭证");
  });

  it("maps missing master key to 503 and names MA_VAULT_MASTER_KEY", async () => {
    const { VaultCryptoUnavailableError } = await import("@agenticx/iam-core");
    createMaCredentialMock.mockRejectedValue(new VaultCryptoUnavailableError("crypto"));
    const response = await POST(request({ auth: { type: "bearer", host: "x.com", token: SECRET } }), {
      params: Promise.resolve({ vaultId: VAULT_ID }),
    });
    expect(response.status).toBe(503);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("MA_VAULT_MASTER_KEY");
  });
});
