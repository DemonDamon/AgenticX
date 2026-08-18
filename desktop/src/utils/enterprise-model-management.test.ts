import { describe, expect, it } from "vitest";
import { isEnterpriseModelManagementLocked } from "./enterprise-model-management";

describe("isEnterpriseModelManagementLocked", () => {
  it("allows local model management without a remembered organization", () => {
    expect(isEnterpriseModelManagementLocked({ loggedIn: false, baseUrl: "" })).toBe(false);
  });

  it("keeps local model management available while an organization awaits login", () => {
    expect(
      isEnterpriseModelManagementLocked({ loggedIn: false, baseUrl: "https://portal.example.com" }),
    ).toBe(false);
  });

  it("locks self-managed model credentials after enterprise login", () => {
    expect(
      isEnterpriseModelManagementLocked({ loggedIn: true, baseUrl: "https://portal.example.com" }),
    ).toBe(true);
  });
});
