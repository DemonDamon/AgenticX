import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetMaInternalTokenCacheForTests } from "../../../../../lib/ma/internal-auth";

const validateVaultIdsMock = vi.fn();
const getMaSessionMock = vi.fn();
const resolveVaultBundleMock = vi.fn();
const insertAuditEventMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@agenticx/iam-core", () => ({
  validateVaultIds: (...args: unknown[]) => validateVaultIdsMock(...args),
  getMaSession: (...args: unknown[]) => getMaSessionMock(...args),
  resolveVaultBundle: (...args: unknown[]) => resolveVaultBundleMock(...args),
  insertAuditEvent: (...args: unknown[]) => insertAuditEventMock(...args),
}));

const { POST: validate } = await import("../vaults/validate/route");
const { POST: resolve } = await import("../vault-resolve/route");

const TENANT = "tenant_test";
const SESSION = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const VAULT_A = "01BX5ZZKBKACTAV9WEVGEMMVSX";
const VAULT_B = "01C23456789ABCDEFGHJKMNPQR";
const SECRET = "sek-plaintext-token"; // gitleaks:allow

function withToken(url: string, body: unknown, token = "ma-token") { // gitleaks:allow
  return new Request(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("internal vault routes", () => {
  beforeEach(() => {
    __resetMaInternalTokenCacheForTests();
    vi.stubEnv("MA_INTERNAL_TOKEN", "ma-token");
    vi.stubEnv("MA_INTERNAL_TOKEN_FILE", "");
    vi.stubEnv("MA_VAULT_RESOLVE_ENABLED", "1");
    validateVaultIdsMock.mockReset();
    getMaSessionMock.mockReset();
    resolveVaultBundleMock.mockReset();
    insertAuditEventMock.mockReset();
    insertAuditEventMock.mockResolvedValue(undefined);
  });

  it("validate", async () => {
    const missing = await validate(new Request("http://localhost/api/internal/ma/vaults/validate", { method: "POST", body: "{}" }));
    expect(missing.status).toBe(401);
    const tooMany = await validate(
      withToken("http://localhost/api/internal/ma/vaults/validate", { tenant_id: TENANT, vault_ids: Array.from({ length: 21 }, (_, i) => `id-${i}`) }),
    );
    expect(tooMany.status).toBe(400);
    validateVaultIdsMock.mockResolvedValue([
      { id: VAULT_A, status: "active" },
      { id: VAULT_B, status: "missing" },
    ]);
    const response = await validate(
      withToken("http://localhost/api/internal/ma/vaults/validate", { tenant_id: TENANT, vault_ids: [VAULT_A, VAULT_B] }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      vaults: [
        { id: VAULT_A, status: "active" },
        { id: VAULT_B, status: "missing" },
      ],
    });
    expect(validateVaultIdsMock).toHaveBeenCalledWith(TENANT, [VAULT_A, VAULT_B]);
  });

  it("resolve", async () => {
    const base = { tenant_id: TENANT, session_id: SESSION, vault_ids: [VAULT_A] };
    getMaSessionMock.mockResolvedValueOnce(null);
    const missing = await resolve(withToken("http://localhost/api/internal/ma/vault-resolve", base));
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("session_not_found");

    getMaSessionMock.mockResolvedValueOnce({ status: "archived", archivedAt: null, vaultIds: [VAULT_A], createdByUserId: null });
    const archived = await resolve(withToken("http://localhost/api/internal/ma/vault-resolve", base));
    expect(archived.status).toBe(409);
    expect(((await archived.json()) as { error: { code: string } }).error.code).toBe("session_terminated");

    getMaSessionMock.mockResolvedValueOnce({ status: "idle", archivedAt: null, vaultIds: [VAULT_B], createdByUserId: null });
    const subset = await resolve(withToken("http://localhost/api/internal/ma/vault-resolve", base));
    expect(subset.status).toBe(400);

    vi.stubEnv("MA_VAULT_RESOLVE_ENABLED", "0");
    const disabled = await resolve(withToken("http://localhost/api/internal/ma/vault-resolve", base));
    expect(disabled.status).toBe(503);
    vi.stubEnv("MA_VAULT_RESOLVE_ENABLED", "1");

    getMaSessionMock.mockResolvedValue({
      status: "idle",
      archivedAt: null,
      vaultIds: [VAULT_A, VAULT_B],
      createdByUserId: "01CUSER0000000000000000001",
    });
    resolveVaultBundleMock.mockResolvedValue({
      session_id: SESSION,
      resolved_at: "2026-10-25T08:00:00.000Z",
      credentials: [
        { credential_id: "c1", vault_id: VAULT_A, vault_index: 0, type: "static_bearer", display_name: null, mcp_server_url: "https://mcp.example.com/mcp", token: SECRET },
        { credential_id: "c2", vault_id: VAULT_A, vault_index: 0, type: "environment_variable", display_name: null, secret_name: "EXAMPLE_API_KEY", secret_value: "sek-env", networking: { type: "limited", allowed_hosts: ["api.example.com"] } },
      ],
      skipped: [{ vault_id: VAULT_B, reason: "archived" }],
      auditDetail: {
        caller: "agent-runtime",
        session_user_id: "01CUSER0000000000000000001",
        vault_ids: [VAULT_A, VAULT_B],
        credential_ids: ["c1", "c2"],
        types: { static_bearer: 1, environment_variable: 1 },
        skipped: [{ vault_id: VAULT_B, reason: "archived" }],
        refreshed: [],
        refresh_failed: [],
      },
    });
    const ok = await resolve(withToken("http://localhost/api/internal/ma/vault-resolve", { ...base, vault_ids: [VAULT_A, VAULT_B] }));
    expect(ok.status).toBe(200);
    const payload = (await ok.json()) as { credentials: Array<{ credential_id: string }>; skipped: unknown[] };
    expect(payload.credentials.map((item) => item.credential_id)).toEqual(["c1", "c2"]);
    expect(payload.skipped).toEqual([{ vault_id: VAULT_B, reason: "archived" }]);
    expect(insertAuditEventMock).toHaveBeenCalledTimes(1);
    const audit = insertAuditEventMock.mock.calls[0]?.[0] as {
      eventType: string;
      targetKind: string;
      targetId: string;
      actorUserId: null;
      detail: Record<string, unknown>;
    };
    expect(audit.eventType).toBe("ma.vault.resolve");
    expect(audit.targetKind).toBe("ma_session");
    expect(audit.targetId).toBe(SESSION);
    expect(audit.actorUserId).toBeNull();
    expect(JSON.stringify(audit.detail)).not.toContain(SECRET);
    expect(JSON.stringify(audit.detail)).not.toContain("sek-env");

    insertAuditEventMock.mockRejectedValueOnce(new Error("audit down"));
    const failed = await resolve(withToken("http://localhost/api/internal/ma/vault-resolve", { ...base, vault_ids: [VAULT_A, VAULT_B] }));
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain(SECRET);
    expect(NextResponse).toBeTruthy();
  });
});
