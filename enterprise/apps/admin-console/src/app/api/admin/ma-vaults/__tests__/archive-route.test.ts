import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const archiveMaVaultMock = vi.fn();
const emitMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));
vi.mock("../../../../../lib/ma/webhook-events", () => ({
  emitMaResourceEvent: (...args: unknown[]) => emitMock(...args),
}));
vi.mock("@agenticx/iam-core", () => {
  class MaVaultNotFoundError extends Error {
    constructor(message = "凭证库不存在") {
      super(message);
      this.name = "MaVaultNotFoundError";
    }
  }
  return {
    MaVaultNotFoundError,
    archiveMaVault: (...args: unknown[]) => archiveMaVaultMock(...args),
  };
});

const { POST } = await import("../[vaultId]/archive/route");

const VAULT_ID = "01BX5ZZKBKACTAV9WEVGEMMVSX";

describe("admin vault archive route", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    archiveMaVaultMock.mockReset();
    emitMock.mockReset();
    process.env.DEFAULT_TENANT_ID = "tenant_test";
    requireAdminScopeMock.mockResolvedValue({ ok: true, session: { userId: "user_1", tenantId: "tenant_test" } });
  });

  it("emits vault.archived after archive succeeds", async () => {
    archiveMaVaultMock.mockResolvedValue({ id: VAULT_ID });
    const response = await POST(new Request(`http://localhost/api/admin/ma-vaults/${VAULT_ID}/archive`, { method: "POST" }), {
      params: Promise.resolve({ vaultId: VAULT_ID }),
    });
    expect(response.status).toBe(200);
    expect(archiveMaVaultMock).toHaveBeenCalledWith("tenant_test", VAULT_ID, "user_1");
    expect(emitMock).toHaveBeenCalledWith({
      tenantId: "tenant_test",
      type: "vault.archived",
      resourceId: VAULT_ID,
    });
  });

  it("does not emit when archive throws", async () => {
    const { MaVaultNotFoundError } = await import("@agenticx/iam-core");
    archiveMaVaultMock.mockRejectedValue(new MaVaultNotFoundError());
    const response = await POST(new Request("http://localhost"), { params: Promise.resolve({ vaultId: VAULT_ID }) });
    expect(response.status).toBe(404);
    expect(emitMock).not.toHaveBeenCalled();
  });
});
