import { describe, expect, it } from "vitest";
import { buildNormalizedSsoLoginInput } from "../sso-sign-in-policy";

describe("normalized SSO email evidence", () => {
  it("preserves explicit OIDC verification and stable subject", () => {
    const input = buildNormalizedSsoLoginInput({ audience: "portal", protocol: "oidc", providerId: "corp", issuer: "https://identity.example.test", identity: { externalSubject: "Stable", email: "one@example.test", emailVerified: false, rawAttributes: {} } });
    expect(input.emailVerified).toBe(false);
    expect(input.externalSubject).toBe("Stable");
  });
  it("keeps absent SAML verification unknown without inventing ownership evidence", () => {
    expect(buildNormalizedSsoLoginInput({ audience: "admin", protocol: "saml", providerId: "corp", issuer: null, identity: { externalSubject: "transient", email: "one@example.test", rawAttributes: {} } }).emailVerified).toBeNull();
  });
});
