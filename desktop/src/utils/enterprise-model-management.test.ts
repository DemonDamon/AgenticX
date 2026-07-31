import { describe, expect, it } from "vitest";
import { isEnterpriseModelManagementLocked } from "./enterprise-model-management";

describe("isEnterpriseModelManagementLocked", () => {
  it("allows local model management without a remembered organization", () => {
    expect(isEnterpriseModelManagementLocked({ loggedIn: false, baseUrl: "" })).toBe(false);
  });

  it("locks local model creation while an organization awaits login", () => {
    expect(
      isEnterpriseModelManagementLocked({ loggedIn: false, baseUrl: "https://portal.example.com" }),
    ).toBe(true);
  });

  it("allows managed model management after enterprise login", () => {
    expect(
      isEnterpriseModelManagementLocked({ loggedIn: true, baseUrl: "https://portal.example.com" }),
    ).toBe(false);
  });
});
