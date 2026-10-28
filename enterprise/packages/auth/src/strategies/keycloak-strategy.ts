import type { AuthStrategy, AuthStrategyEndpoints } from "./types";

function trimSlash(url: string): string {
  let out = url;
  while (out.endsWith("/")) {
    out = out.slice(0, -1);
  }
  return out;
}

/** Keycloak is OIDC with realm-scoped discovery defaults. */
export const keycloakStrategy: AuthStrategy = {
  id: "keycloak",
  protocol: "oidc",
  resolveEndpoints(config): AuthStrategyEndpoints {
    const base =
      typeof config.baseUrl === "string"
        ? config.baseUrl
        : typeof config.issuer === "string"
          ? config.issuer
          : "";
    const realm = typeof config.realm === "string" ? config.realm : "";
    if (!base || !realm) {
      const issuer = typeof config.issuer === "string" ? config.issuer : undefined;
      return { issuer };
    }
    const issuer = `${trimSlash(base)}/realms/${encodeURIComponent(realm)}`;
    return {
      issuer,
      authorizationUrl: `${issuer}/protocol/openid-connect/auth`,
    };
  },
};
