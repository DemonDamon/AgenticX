import type { AuthStrategy } from "./types";

export type ResolveAuthStrategyIdInput = {
  strategyId?: string | null;
  protocol?: string | null;
  providerId?: string | null;
};

/**
 * Pick a registered strategy id for SSO runtime wiring.
 * Precedence: explicit strategyId → protocol saml → providerId hints keycloak → oidc.
 */
export function resolveAuthStrategyId(input: ResolveAuthStrategyIdInput): string {
  const explicit = input.strategyId?.trim();
  if (explicit) return explicit;

  const protocol = input.protocol?.trim().toLowerCase();
  if (protocol === "saml") return "saml";
  if (protocol === "custom") return "fake-customer-iam";

  const providerId = input.providerId?.trim().toLowerCase() ?? "";
  if (providerId.includes("keycloak")) return "keycloak";

  return "oidc";
}

/**
 * Merge strategy.resolveEndpoints into a config blob.
 * Fills empty issuer / authorizationUrl; does not overwrite a non-empty issuer.
 */
export function applyStrategyEndpoints(
  strategy: AuthStrategy,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };
  if (!strategy.resolveEndpoints) return next;

  const endpoints = strategy.resolveEndpoints(config);
  const currentIssuer =
    typeof next.issuer === "string" && next.issuer.trim() ? next.issuer.trim() : "";
  if (!currentIssuer && typeof endpoints.issuer === "string" && endpoints.issuer.trim()) {
    next.issuer = endpoints.issuer;
  }
  if (
    typeof endpoints.authorizationUrl === "string" &&
    endpoints.authorizationUrl.trim() &&
    !(typeof next.authorizationUrl === "string" && next.authorizationUrl.trim())
  ) {
    next.authorizationUrl = endpoints.authorizationUrl;
  }
  return next;
}
