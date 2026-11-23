import { describe, expect, it } from "vitest";
import { mapClaimsToAuthUser, OidcClaimError, resolveOidcIdentitySubject } from "../oidc-claims";

describe("mapClaimsToAuthUser", () => {
  it("maps default claims with role array", () => {
    const mapped = mapClaimsToAuthUser({
      sub: "oidc-sub-1",
      email: "Owner@AgenticX.Local",
      name: "Seed Owner",
      roles: ["member", "admin"],
    });

    expect(mapped.email).toBe("owner@agenticx.local");
    expect(mapped.displayName).toBe("Seed Owner");
    expect(mapped.externalId).toBe("oidc-sub-1");
    expect(mapped.roleCodeHints).toEqual(["member", "admin"]);
  });

  it("supports nested and custom claim paths", () => {
    const mapped = mapClaimsToAuthUser(
      {
        sub: "oidc-sub-2",
        profile: { primaryEmail: "ops@agenticx.local", nickname: "Ops Team" },
        "https://schemas.example.com/roles": "auditor,policy_admin",
      },
      {
        email: "profile.primaryEmail",
        name: "profile.nickname",
        roles: "https://schemas.example.com/roles",
      }
    );

    expect(mapped.email).toBe("ops@agenticx.local");
    expect(mapped.displayName).toBe("Ops Team");
    expect(mapped.roleCodeHints).toEqual(["auditor", "policy_admin"]);
  });

  it("throws when email claim missing", () => {
    expect(() =>
      mapClaimsToAuthUser({
        sub: "oidc-sub-3",
      })
    ).toThrow(OidcClaimError);
  });

  it("throws when email claim is not a string (FR-C1.2)", () => {
    expect(() =>
      mapClaimsToAuthUser({
        sub: "oidc-sub-4",
        email: 12345,
      })
    ).toThrow(OidcClaimError);
  });
});


describe("verified OIDC identity evidence", () => {
  it.each([[true, true], [false, false], ["TRUE", true], ["false", false], [null, null], [1, null], ["yes", null], [undefined, null]])("maps explicit email verification %j", (value, expected) => {
    expect(mapClaimsToAuthUser({ sub: "stable", email: "one@example.test", email_verified: value }).emailVerified).toBe(expected);
  });
  it("does not apply standard email verification to a custom email mapping", () => {
    const claims = { sub: "stable", email: "owner@example.test", email_verified: true, profile: { login: "other@example.test", verified: true } };
    expect(mapClaimsToAuthUser(claims, { email: "profile.login" }).emailVerified).toBeNull();
    expect(mapClaimsToAuthUser(claims, { email: "profile.login", emailVerified: "profile.verified" }).emailVerified).toBe(true);
  });
  it("does not verify a fallback email absent from the asserted claim", () => {
    expect(mapClaimsToAuthUser({ sub: "stable", email_verified: true }, {}, { email: "fallback@example.test" }).emailVerified).toBeNull();
  });
  it("takes stable subject from the raw token independently of externalId mapping", () => {
    const claims = { sub: "Stable", employee: "variable", email: "one@example.test" };
    expect(mapClaimsToAuthUser(claims, { externalId: "employee" }).externalId).toBe("variable");
    expect(resolveOidcIdentitySubject(claims)).toBe("Stable");
    for (const sub of [null, undefined, "", " Stable", "Stable ", 42, "x".repeat(256)]) {
      expect(() => resolveOidcIdentitySubject({ sub })).toThrow("oidc.invalid_subject");
    }
  });
});
