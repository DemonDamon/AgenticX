export type AuthStrategyProtocol = "oidc" | "saml" | "custom";

export type AuthStrategyId =
  | "oidc"
  | "saml"
  | "keycloak"
  | "fake-customer-iam"
  | (string & {});

export type AuthStrategyEndpoints = {
  issuer?: string;
  authorizationUrl?: string;
};

export interface AuthStrategy {
  readonly id: AuthStrategyId;
  readonly protocol: AuthStrategyProtocol;
  resolveEndpoints?(config: Record<string, unknown>): AuthStrategyEndpoints;
}
