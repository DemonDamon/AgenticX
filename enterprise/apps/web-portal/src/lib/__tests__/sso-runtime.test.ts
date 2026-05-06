import { describe, expect, it } from "vitest";
import { parseSsoProviders } from "../sso-provider-options";
import { resolveReturnToOrDefault } from "../sso-return-to";

describe("parseSsoProviders", () => {
  it("parses provider list from env-like string", () => {
    const providers = parseSsoProviders("default:Keycloak, azure:Azure AD");
    expect(providers).toEqual([
      { id: "default", name: "Keycloak" },
      { id: "azure", name: "Azure AD" },
    ]);
  });

  it("returns empty list for blank source", () => {
    expect(parseSsoProviders("")).toEqual([]);
    expect(parseSsoProviders(undefined)).toEqual([]);
  });
});

describe("resolveReturnToOrDefault", () => {
  it("falls back for unsafe or missing returnTo", () => {
    expect(resolveReturnToOrDefault(null)).toBe("/workspace");
    expect(resolveReturnToOrDefault("https://evil.example.com")).toBe("/workspace");
    expect(resolveReturnToOrDefault("//evil")).toBe("/workspace");
  });
});
