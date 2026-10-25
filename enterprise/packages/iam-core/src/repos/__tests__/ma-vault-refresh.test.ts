import { describe, expect, it, vi } from "vitest";

import { refreshMcpOAuthIfNeeded, resolveVaultBundle, type MaCredential } from "../ma-vaults";

const NOW = new Date("2026-10-25T00:00:00.000Z");
const REFRESH = {
  token_endpoint: "https://auth.example.com/token",
  client_id: "cid",
  scope: null,
  resource: null,
  token_endpoint_auth_type: "client_secret_basic" as const,
};

function cred(expiresAt: string, authType: "client_secret_basic" | "client_secret_post" | "none" = "client_secret_basic") {
  return {
    type: "mcp_oauth" as const,
    publicConfig: { refresh: { ...REFRESH, token_endpoint_auth_type: authType } },
    expiresAt,
  };
}

const secrets = { access_token: "at1", refresh_token: "rt1", client_secret: "cs" };

describe("refreshMcpOAuthIfNeeded", () => {
  it("does not refresh when expiry is 10 minutes away", async () => {
    const fetchImpl = vi.fn();
    const outcome = await refreshMcpOAuthIfNeeded(cred(new Date(NOW.getTime() + 600_000).toISOString()), secrets, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(outcome.refreshed).toBe(false);
    expect(outcome.secrets).toEqual(secrets);
  });

  it("refreshes with client_secret_basic inside the 5 minute window", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      void init;
      return new Response(JSON.stringify({ access_token: "at2", expires_in: 3600, refresh_token: "rt2" }), { status: 200 });
    });
    const outcome = await refreshMcpOAuthIfNeeded(cred(new Date(NOW.getTime() + 120_000).toISOString()), secrets, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from("cid:cs").toString("base64")}`);
    expect(String(init?.body)).toContain("grant_type=refresh_token&refresh_token=rt1");
    expect(outcome.secrets.access_token).toBe("at2");
    expect(outcome.secrets.refresh_token).toBe("rt2");
    expect(outcome.expiresAt).toBe(new Date(NOW.getTime() + 3600_000).toISOString());
  });

  it("treats a string expires_in as failure and keeps secrets", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: "at2", expires_in: "3600" }), { status: 200 }));
    const outcome = await refreshMcpOAuthIfNeeded(cred(new Date(NOW.getTime() + 120_000).toISOString()), secrets, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
    });
    expect(outcome.failed).toBe(true);
    expect(outcome.secrets).toEqual(secrets);
  });

  it("reports status 0 when fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const outcome = await refreshMcpOAuthIfNeeded(cred(new Date(NOW.getTime() + 30_000).toISOString()), secrets, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
    });
    expect(outcome.failed).toBe(true);
    expect(outcome.status).toBe(0);
    expect(outcome.secrets).toEqual(secrets);
  });

  it("posts client credentials without an Authorization header", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      void init;
      return new Response(JSON.stringify({ access_token: "at2", expires_in: 60 }), { status: 200 });
    });
    await refreshMcpOAuthIfNeeded(cred(new Date(NOW.getTime() + 10_000).toISOString(), "client_secret_post"), secrets, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => NOW,
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(String(init?.body)).toContain("client_id=cid");
    expect(String(init?.body)).toContain("client_secret=cs");
  });
});

describe("resolveVaultBundle ordering", () => {
  it("orders credentials by vault then creation time and keeps secrets out of the audit detail", async () => {
    const token = "sek-token-value"; // gitleaks:allow
    const envSecret = "sek-env-value"; // gitleaks:allow
    const vaultA = "01JVAULTA000000000000000A";
    const vaultB = "01JVAULTB000000000000000B";
    const insertAudit = vi.fn();
    const row = (id: string, createdAt: string, type: MaCredential["type"], plain: Record<string, string>, identityKey: string): MaCredential & {
      secretCiphertext: string;
      wrappedDek: string;
      kekId: string;
    } => ({
      id,
      tenantId: "T",
      vaultId: vaultA,
      displayName: null,
      type,
      identityKind: type === "environment_variable" ? "secret_name" : "mcp_server_url",
      identityKey,
      publicConfig: type === "environment_variable" ? { networking: { type: "limited", allowed_hosts: ["api.example.com"] } } : {},
      secretFields: Object.keys(plain),
      hasSecret: true,
      status: "active",
      expiresAt: null,
      lastRotatedAt: null,
      lastResolvedAt: null,
      createdBy: null,
      archivedAt: null,
      createdAt,
      updatedAt: createdAt,
      secretCiphertext: JSON.stringify(plain),
      wrappedDek: "wrapped",
      kekId: "kek",
    });
    const bundle = await resolveVaultBundle(
      { tenantId: "T", sessionId: "01JSESSION0000000000000001", sessionUserId: "01JUSER0000000000000000001", vaultIds: [vaultA, vaultB] },
      {
        now: () => NOW,
        findVault: async (_tenantId, id) => (id === vaultB ? { id, status: "archived" } : { id, status: "active" }),
        listActiveCredentials: async () => [
          row("01JCRED0000000000000000002", "2026-10-25T00:00:02.000Z", "environment_variable", { secret_value: envSecret }, "EXAMPLE_API_KEY"),
          row("01JCRED0000000000000000001", "2026-10-25T00:00:01.000Z", "static_bearer", { token }, "https://mcp.example.com/mcp"),
        ],
        openPayload: (sealed) => JSON.parse(sealed.ciphertext) as Record<string, string>,
        writeRefreshed: async () => undefined,
        touchResolved: async () => undefined,
        insertAudit,
      },
    );
    expect(bundle.credentials.map((item) => item.credential_id)).toEqual(["01JCRED0000000000000000001", "01JCRED0000000000000000002"]);
    expect(bundle.skipped).toEqual([{ vault_id: vaultB, reason: "archived" }]);
    expect(JSON.stringify(bundle.auditDetail)).not.toContain(token);
    expect(JSON.stringify(bundle.auditDetail)).not.toContain(envSecret);
    expect(insertAudit).not.toHaveBeenCalled();
  });
});
