import { describe, expect, it } from "vitest";

import {
  normalizeCredentialCreate,
  normalizeCredentialPatch,
  normalizeHost,
  normalizeMcpServerUrl,
  validateSecretName,
  MaVaultValidationError,
} from "../ma-vault-validate";

const TOKEN = "tok-abcdefgh"; // gitleaks:allow

function authBody(auth: Record<string, unknown>, displayName?: string | null) {
  return displayName === undefined ? { auth } : { display_name: displayName, auth };
}

describe("ma vault validate", () => {
  it("normalizes MCP server URLs and rejects unsafe forms", () => {
    expect(normalizeMcpServerUrl("https://MCP.Example.com:443/mcp/")).toBe("https://mcp.example.com/mcp");
    expect(normalizeMcpServerUrl("https://x.com/")).toBe("https://x.com");
    expect(normalizeMcpServerUrl("https://x.com:8443/a")).toBe("https://x.com:8443/a");
    for (const raw of ["http://x.com", "https://u:p@x.com", "https://x.com/?a=1", "https://x.com/#f", "https://例子.com"]) { // gitleaks:allow
      expect(() => normalizeMcpServerUrl(raw)).toThrow(MaVaultValidationError);
    }
  });

  it("normalizes hosts and secret names", () => {
    expect(normalizeHost("*.Example.com", { allowWildcard: true })).toBe("*.example.com");
    for (const raw of ["*", "*.com", "x.com:443", "https://x.com"]) {
      expect(() => normalizeHost(raw, { allowWildcard: true })).toThrow(MaVaultValidationError);
    }
    expect(() => normalizeHost("*.x.com", { allowWildcard: false })).toThrow(MaVaultValidationError);
    expect(validateSecretName("EXAMPLE_API_KEY")).toBe("EXAMPLE_API_KEY");
    for (const raw of ["path", "PATH", "LD_PRELOAD", "AGX_X", "1ABC"]) {
      expect(() => validateSecretName(raw)).toThrow(MaVaultValidationError);
    }
  });

  it("accepts the four credential types and rejects unsafe auth", () => {
    const staticBearer = normalizeCredentialCreate(
      authBody({ type: "static_bearer", mcp_server_url: "https://mcp.example.com/mcp/", token: TOKEN }),
    );
    expect(staticBearer.identityKind).toBe("mcp_server_url");
    expect(staticBearer.identityKey).toBe("https://mcp.example.com/mcp");
    expect(staticBearer.publicConfig).toEqual({});
    expect(staticBearer.secrets).toEqual({ token: TOKEN });

    const bearer = normalizeCredentialCreate(authBody({ type: "bearer", host: "Docs.Example.com.", token: TOKEN }));
    expect(bearer.identityKind).toBe("host");
    expect(bearer.identityKey).toBe("docs.example.com");
    expect(bearer.secrets).toEqual({ token: TOKEN });

    const oauth = normalizeCredentialCreate(
      authBody({ type: "mcp_oauth", mcp_server_url: "https://mcp.example.com", access_token: TOKEN }),
    );
    expect(oauth.identityKind).toBe("mcp_server_url");
    expect(oauth.secrets).toEqual({ access_token: TOKEN });
    expect(oauth.expiresAt).toBeNull();
    expect(oauth.publicConfig).toEqual({});

    const env = normalizeCredentialCreate(
      authBody({
        type: "environment_variable",
        secret_name: "EXAMPLE_API_KEY",
        secret_value: TOKEN,
        networking: { type: "limited", allowed_hosts: ["API.Example.com", "api.example.com"] },
      }),
    );
    expect(env.identityKind).toBe("secret_name");
    expect(env.identityKey).toBe("EXAMPLE_API_KEY");
    expect(env.publicConfig).toEqual({ networking: { type: "limited", allowed_hosts: ["api.example.com"] } });
    expect(env.secrets).toEqual({ secret_value: TOKEN });

    expect(() =>
      normalizeCredentialCreate(authBody({ type: "environment_variable", secret_name: "EXAMPLE_API_KEY", secret_value: TOKEN })),
    ).toThrow(/^auth\.networking:/);

    expect(() =>
      normalizeCredentialCreate(
        authBody({
          type: "environment_variable",
          secret_name: "EXAMPLE_API_KEY",
          secret_value: TOKEN,
          networking: { type: "limited", allowed_hosts: Array.from({ length: 17 }, (_, i) => `h${i}.example.com`) },
        }),
      ),
    ).toThrow(MaVaultValidationError);

    expect(() =>
      normalizeCredentialCreate(
        authBody({
          type: "environment_variable",
          secret_name: "EXAMPLE_API_KEY",
          secret_value: TOKEN,
          networking: { type: "unrestricted", allowed_hosts: ["api.example.com"] },
        }),
      ),
    ).toThrow(MaVaultValidationError);

    expect(() =>
      normalizeCredentialCreate(authBody({ type: "static_bearer", mcp_server_url: "https://x.com", token: "Bearer tok-abcdefgh" })), // gitleaks:allow
    ).toThrow(/must not include the "Bearer " prefix/);

    expect(() =>
      normalizeCredentialCreate(authBody({ type: "static_bearer", mcp_server_url: "https://x.com", token: "abcd${cred:X}ef" })), // gitleaks:allow
    ).toThrow(MaVaultValidationError);

    expect(() =>
      normalizeCredentialCreate(
        authBody({
          type: "mcp_oauth",
          mcp_server_url: "https://x.com",
          access_token: TOKEN,
          refresh: {
            token_endpoint: "https://auth.example.com/token",
            client_id: "cid",
            refresh_token: "refresh-token-1", // gitleaks:allow
            token_endpoint_auth: { type: "none" },
          },
        }),
      ),
    ).toThrow("auth.expires_at: required when refresh is configured");

    expect(() =>
      normalizeCredentialCreate(
        authBody({
          type: "mcp_oauth",
          mcp_server_url: "https://x.com",
          access_token: TOKEN,
          expires_at: "2026-10-25T09:00:00.000Z",
          refresh: {
            token_endpoint: "https://auth.example.com/token",
            client_id: "cid",
            refresh_token: "refresh-token-1", // gitleaks:allow
            token_endpoint_auth: { type: "none", client_secret: "secret-value" }, // gitleaks:allow
          },
        }),
      ),
    ).toThrow(MaVaultValidationError);

    expect(() => normalizeCredentialCreate(authBody({ type: "bearer", host: "x.com", token: TOKEN, foo: 1 }))).toThrow(
      "auth.foo: unknown field",
    );
  });

  it("patch", () => {
    const bearer = { type: "bearer" as const, publicConfig: {} };
    expect(() => normalizeCredentialPatch(bearer, { auth: { type: "bearer", host: "other.example.com", token: TOKEN } })).toThrow(
      /is immutable/,
    );
    expect(() => normalizeCredentialPatch(bearer, { auth: { type: "static_bearer", token: TOKEN } })).toThrow(
      "auth.type: must equal the credential type",
    );
    expect(normalizeCredentialPatch(bearer, { auth: { type: "bearer", token: "rotated-token" } }).secrets).toEqual({ // gitleaks:allow
      token: "rotated-token", // gitleaks:allow
    });

    const oauth = {
      type: "mcp_oauth" as const,
      publicConfig: {
        refresh: {
          token_endpoint: "https://auth.example.com/token",
          client_id: "cid",
          scope: null,
          resource: null,
          token_endpoint_auth_type: "client_secret_basic",
        },
      },
    };
    const cleared = normalizeCredentialPatch(oauth, { auth: { type: "mcp_oauth", refresh: null } });
    expect(cleared.clearSecrets).toEqual(expect.arrayContaining(["refresh_token", "client_secret"]));
    expect(cleared.publicConfigPatch.refresh).toBeNull();
    expect(() =>
      normalizeCredentialPatch(oauth, { auth: { type: "mcp_oauth", refresh: { client_id: "other" } } }),
    ).toThrow("auth.refresh.client_id: is immutable");
    expect(() => normalizeCredentialPatch(bearer, { auth: { type: "bearer" } })).toThrow("request: nothing to update");
  });
});
