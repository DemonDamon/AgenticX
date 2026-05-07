import { describe, expect, it } from "vitest";
import { pickPreferredSsoProvider } from "../admin-sso-provider-options";

describe("admin sso provider selection", () => {
  it("prefers oidc provider when available", () => {
    const selected = pickPreferredSsoProvider([
      { id: "saml-1", name: "SAML", protocol: "saml" },
      { id: "oidc-1", name: "OIDC", protocol: "oidc" },
    ]);

    expect(selected?.id).toBe("oidc-1");
    expect(selected?.protocol).toBe("oidc");
  });

  it("falls back to first provider when oidc is absent", () => {
    const selected = pickPreferredSsoProvider([
      { id: "saml-1", name: "SAML 1", protocol: "saml" },
      { id: "saml-2", name: "SAML 2", protocol: "saml" },
    ]);

    expect(selected?.id).toBe("saml-1");
    expect(selected?.protocol).toBe("saml");
  });
});
