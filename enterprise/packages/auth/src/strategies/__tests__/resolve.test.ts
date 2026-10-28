import { describe, expect, it } from "vitest";
import { createDefaultAuthStrategyRegistry } from "../registry";
import { applyStrategyEndpoints, resolveAuthStrategyId } from "../resolve";

describe("resolveAuthStrategyId", () => {
  it("prefers explicit strategyId", () => {
    expect(
      resolveAuthStrategyId({ strategyId: "keycloak", protocol: "saml", providerId: "x" }),
    ).toBe("keycloak");
  });

  it("maps saml protocol", () => {
    expect(resolveAuthStrategyId({ protocol: "saml" })).toBe("saml");
  });

  it("hints keycloak from providerId", () => {
    expect(resolveAuthStrategyId({ providerId: "corp-keycloak" })).toBe("keycloak");
  });

  it("defaults to oidc", () => {
    expect(resolveAuthStrategyId({ providerId: "entra" })).toBe("oidc");
  });
});

describe("applyStrategyEndpoints", () => {
  it("fills keycloak issuer from baseUrl+realm when issuer empty", () => {
    const strategy = createDefaultAuthStrategyRegistry().get("keycloak");
    const merged = applyStrategyEndpoints(strategy, {
      baseUrl: "https://idp.example.org",
      realm: "agenticx",
    });
    expect(merged.issuer).toBe("https://idp.example.org/realms/agenticx");
    expect(merged.authorizationUrl).toContain("/protocol/openid-connect/auth");
  });

  it("does not overwrite existing issuer", () => {
    const strategy = createDefaultAuthStrategyRegistry().get("keycloak");
    const merged = applyStrategyEndpoints(strategy, {
      issuer: "https://already.set/realms/x",
      baseUrl: "https://idp.example.org",
      realm: "agenticx",
    });
    expect(merged.issuer).toBe("https://already.set/realms/x");
  });
});
