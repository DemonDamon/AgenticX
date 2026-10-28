import type { AuthStrategy } from "./types";

export const oidcStrategy: AuthStrategy = {
  id: "oidc",
  protocol: "oidc",
  resolveEndpoints(config) {
    const issuer = typeof config.issuer === "string" ? config.issuer : undefined;
    return { issuer };
  },
};
