import { describe, expect, it } from "vitest";
import { parseProvidersPayload } from "./providers-payload";
import { shouldDisableSamlHealthCheck, shouldDisableSamlToggle } from "./saml-ui-guards";

describe("sso settings providers payload parsing", () => {
  it("uses samlGloballyDisabled from providers API response", () => {
    const parsed = parseProvidersPayload({
      data: {
        providers: [{ id: "p1", protocol: "oidc" }],
        samlGloballyDisabled: true,
      },
    });
    expect(parsed.samlGloballyDisabled).toBe(true);
    expect(parsed.providers).toHaveLength(1);
  });
});

describe("sso settings SAML disable semantics", () => {
  it("global SAML disabled still allows disabling an enabled SAML provider", () => {
    const item = { protocol: "saml" as const, enabled: true };
    expect(shouldDisableSamlToggle(item, true)).toBe(false);
  });

  it("global SAML disabled blocks enabling a disabled SAML provider", () => {
    const item = { protocol: "saml" as const, enabled: false };
    expect(shouldDisableSamlToggle(item, true)).toBe(true);
  });

  it("global SAML disabled blocks SAML health checks", () => {
    const item = { protocol: "saml" as const };
    expect(shouldDisableSamlHealthCheck(item, true)).toBe(true);
  });
});
