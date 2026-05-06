import { describe, expect, it } from "vitest";
import { mapClaimsToAuthUser, OidcClaimError } from "../oidc-claims";

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
