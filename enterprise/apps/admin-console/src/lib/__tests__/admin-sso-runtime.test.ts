import { describe, expect, it } from "vitest";
import { parseSsoProviders } from "../admin-sso-provider-options";

describe("parseSsoProviders", () => {
  it("parses provider options", () => {
    expect(parseSsoProviders("default:Keycloak,entra:Azure Entra")).toEqual([
      { id: "default", name: "Keycloak" },
      { id: "entra", name: "Azure Entra" },
    ]);
  });
});
