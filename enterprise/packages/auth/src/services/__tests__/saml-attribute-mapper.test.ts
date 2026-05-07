import { describe, expect, it } from "vitest";
import { mapSamlProfileToIdentity } from "../saml-attribute-mapper";

const baseMapping = {
  email: "email",
  displayName: "displayName",
  firstName: "firstName",
  lastName: "lastName",
  dept: "department",
  roles: "roles",
  externalId: "uid",
};

describe("mapSamlProfileToIdentity", () => {
  it("normalizes email to lowercase and splits roles", () => {
    const identity = mapSamlProfileToIdentity(
      {
        nameID: "user-1",
        attributes: {
          email: ["Owner@AgenticX.Local"],
          displayName: "Owner",
          roles: "member, policy_admin admin",
          department: "Platform",
          uid: "uid-1",
        },
      },
      baseMapping
    );
    expect(identity.email).toBe("owner@agenticx.local");
    expect(identity.displayName).toBe("Owner");
    expect(identity.roleCodeHints).toEqual(["member", "policy_admin", "admin"]);
    expect(identity.deptHint).toBe("Platform");
    expect(identity.externalSubject).toBe("uid-1");
  });

  it("falls back to firstName + lastName when displayName missing", () => {
    const identity = mapSamlProfileToIdentity(
      {
        nameID: "user-2",
        attributes: {
          email: "alice@agenticx.local",
          firstName: "Alice",
          lastName: "Wong",
        },
      },
      baseMapping
    );
    expect(identity.displayName).toBe("Alice Wong");
  });

  it("falls back to email as displayName when no name attributes", () => {
    const identity = mapSamlProfileToIdentity(
      {
        nameID: "user-3",
        attributes: {
          email: "bob@agenticx.local",
        },
      },
      baseMapping
    );
    expect(identity.displayName).toBe("bob@agenticx.local");
  });

  it("throws saml.attribute_email_missing when no email value", () => {
    expect(() =>
      mapSamlProfileToIdentity(
        {
          nameID: "user-4",
          attributes: { displayName: "X" },
        },
        baseMapping
      )
    ).toThrowError(/saml\.attribute_email_missing/);
  });

  it("uses nameID as external subject when externalId attribute missing", () => {
    const identity = mapSamlProfileToIdentity(
      {
        nameID: "name-id-only",
        attributes: { email: "C@agenticx.local" },
      },
      { email: "email" }
    );
    expect(identity.externalSubject).toBe("name-id-only");
    expect(identity.email).toBe("c@agenticx.local");
  });

  it("supports case-insensitive attribute keys from IdP variations", () => {
    const identity = mapSamlProfileToIdentity(
      {
        nameID: "user-5",
        attributes: {
          EMAIL: "user5@agenticx.local",
          DisplayName: "User Five",
        },
      },
      { email: "email", displayName: "displayname" }
    );
    expect(identity.email).toBe("user5@agenticx.local");
    expect(identity.displayName).toBe("User Five");
  });
});
