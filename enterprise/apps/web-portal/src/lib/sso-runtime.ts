import "server-only";
import { OidcClientService, type OidcProviderConfig, registerOidcDiscoveryDegradedReporter } from "@agenticx/auth";
import { decryptSecret } from "@agenticx/auth";
import { getSsoProviderByProviderId, insertAuditEvent } from "@agenticx/iam-core";
export { resolveReturnToOrDefault } from "./sso-return-to";

export type SsoProviderOption = {
  id: string;
  name: string;
};

export function parseSsoProviders(raw: string | undefined): SsoProviderOption[] {
  const source = raw?.trim();
  if (!source) return [];
  return source
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [id, ...rest] = item.split(":");
      const providerId = id?.trim() ?? "";
      const name = rest.join(":").trim() || providerId;
      return providerId ? { id: providerId, name } : null;
    })
    .filter((item): item is SsoProviderOption => Boolean(item));
}

export function getPortalSsoProviderOptions(): SsoProviderOption[] {
  return parseSsoProviders(process.env.NEXT_PUBLIC_SSO_PROVIDERS);
}

function envKey(providerId: string, suffix: string): string {
  const normalized = providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return `SSO_OIDC_${normalized}_${suffix}`;
}

function asClaimString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function requiredEnv(providerId: string, suffix: string): string {
  const value = process.env[envKey(providerId, suffix)]?.trim();
  if (!value) {
    throw new Error("oidc.provider_not_configured");
  }
  if (suffix === "ISSUER" && isExampleIssuer(value)) {
    throw new Error("oidc.provider_not_configured");
  }
  return value;
}

function optionalEnv(providerId: string, suffix: string): string | undefined {
  return process.env[envKey(providerId, suffix)]?.trim() || undefined;
}

function isExampleIssuer(value: string): boolean {
  try {
    return new URL(value).hostname === "idp.example.com";
  } catch {
    return false;
  }
}

export function getPortalSsoProviderConfig(providerId: string): OidcProviderConfig {
  const scopesRaw = optionalEnv(providerId, "SCOPES");
  const scopes = scopesRaw
    ? scopesRaw
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    : ["openid", "profile", "email"];

  return {
    providerId,
    issuer: requiredEnv(providerId, "ISSUER"),
    clientId: requiredEnv(providerId, "CLIENT_ID"),
    clientSecret: optionalEnv(providerId, "CLIENT_SECRET"),
    redirectUri: requiredEnv(providerId, "REDIRECT_URI"),
    scopes,
    claimMapping: {
      email: optionalEnv(providerId, "CLAIM_EMAIL") ?? "email",
      name: optionalEnv(providerId, "CLAIM_NAME") ?? "name",
      dept: optionalEnv(providerId, "CLAIM_DEPT") ?? "department",
      roles: optionalEnv(providerId, "CLAIM_ROLES") ?? "roles",
      externalId: optionalEnv(providerId, "CLAIM_EXTERNAL_ID") ?? "sub",
    },
  };
}

export async function getPortalSsoProviderConfigServer(providerId: string): Promise<OidcProviderConfig> {
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  const secretKey = process.env.SSO_PROVIDER_SECRET_KEY?.trim();
  if (tenantId) {
    const dbProvider = await getSsoProviderByProviderId(tenantId, providerId);
    if (dbProvider) {
      if (!dbProvider.enabled) {
        throw new Error("oidc.provider_disabled");
      }
      return {
        providerId: dbProvider.providerId,
        issuer: dbProvider.issuer,
        clientId: dbProvider.clientId,
        clientSecret:
          dbProvider.clientSecretEncrypted && secretKey
            ? decryptSecret(dbProvider.clientSecretEncrypted, secretKey)
            : undefined,
        redirectUri: dbProvider.redirectUri,
        scopes: dbProvider.scopes,
        claimMapping: {
          email: asClaimString(dbProvider.claimMapping.email, "email"),
          name: asClaimString(dbProvider.claimMapping.name, "name"),
          dept: asClaimString(dbProvider.claimMapping.dept, "department"),
          roles: asClaimString(dbProvider.claimMapping.roles, "roles"),
          externalId: asClaimString(dbProvider.claimMapping.externalId, "sub"),
        },
      };
    }
  }
  return getPortalSsoProviderConfig(providerId);
}

let singleton: OidcClientService | null = null;

export function getOidcClientService(): OidcClientService {
  singleton ??= new OidcClientService();
  return singleton;
}

(() => {
  if (typeof globalThis === "undefined") return;
  const g = globalThis as typeof globalThis & { __agxOidcDiscoveryRep?: boolean };
  if (g.__agxOidcDiscoveryRep) return;
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim();
  if (!tenantId) return;
  g.__agxOidcDiscoveryRep = true;
  registerOidcDiscoveryDegradedReporter(async (detail) => {
    if (!process.env.DATABASE_URL?.trim()) return;
    try {
      await insertAuditEvent({
        tenantId,
        actorUserId: null,
        eventType: "auth.sso.discovery_degraded",
        targetKind: "sso_provider",
        targetId: detail.providerId,
        detail: { issuer: detail.issuer, consecutiveStaleCount: detail.consecutiveStaleCount },
      });
    } catch (err) {
      console.error("[sso] discovery_degraded audit failed:", err);
    }
  });
})();