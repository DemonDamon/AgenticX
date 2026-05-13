import { describe, expect, it } from "vitest";
import { getEffectiveUserScopes } from "../auth-scopes";

describe("auth scopes normalization", () => {
  it("falls back to default chat scopes when scopes are empty", () => {
    expect(getEffectiveUserScopes([])).toEqual(["workspace:chat", "user:read"]);
  });

  it("falls back to default chat scopes when scopes are missing", () => {
    expect(getEffectiveUserScopes(undefined)).toEqual(["workspace:chat", "user:read"]);
  });

  it("keeps configured scopes when provided", () => {
    expect(getEffectiveUserScopes(["workspace:chat", "audit:read"])).toEqual([
      "workspace:chat",
      "audit:read",
    ]);
  });
});
