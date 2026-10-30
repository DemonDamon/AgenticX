import { describe, expect, it } from "vitest";
import { createDefaultAuthStrategyRegistry } from "../registry";

describe("AuthStrategyRegistry", () => {
  it("lists default strategies", () => {
    const registry = createDefaultAuthStrategyRegistry();
    const ids = registry.list().map((s) => s.id).sort();
    expect(ids).toEqual(["fake-customer-iam", "keycloak", "oidc", "saml"]);
  });

  it("throws on unknown strategy", () => {
    const registry = createDefaultAuthStrategyRegistry();
    expect(() => registry.get("nope")).toThrow(/unknown auth strategy/);
  });

  it("builds keycloak realm endpoints", () => {
    const strategy = createDefaultAuthStrategyRegistry().get("keycloak");
    const endpoints = strategy.resolveEndpoints?.({
      baseUrl: "https://sso.example.com",
      realm: "agx",
    });
    expect(endpoints).toEqual({
      issuer: "https://sso.example.com/realms/agx",
      authorizationUrl: "https://sso.example.com/realms/agx/protocol/openid-connect/auth",
    });
  });

  it("registers a custom B-layer strategy", () => {
    const registry = createDefaultAuthStrategyRegistry();
    registry.register({
      id: "customer-x-iam",
      protocol: "custom",
      resolveEndpoints: () => ({ authorizationUrl: "https://iam.example.invalid/authorize" }),
    });
    expect(registry.get("customer-x-iam").protocol).toBe("custom");
  });

  it("fake-customer-iam pluggability: register → resolve → protocol", () => {
    const registry = createDefaultAuthStrategyRegistry();
    const fake = registry.get("fake-customer-iam");
    expect(fake.id).toBe("fake-customer-iam");
    expect(fake.protocol).toBe("custom");
    const endpoints = fake.resolveEndpoints?.({
      authorizationUrl: "https://fake-iam.example.invalid/authorize",
    });
    expect(endpoints?.authorizationUrl).toBe("https://fake-iam.example.invalid/authorize");
  });

});
