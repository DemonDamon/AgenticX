import { describe, expect, it } from "vitest";
import { sessionCreateAvatarId } from "./session-create-avatar";

describe("sessionCreateAvatarId", () => {
  it("keeps group and automation prefixes", () => {
    expect(sessionCreateAvatarId("group:g1")).toBe("group:g1");
    expect(sessionCreateAvatarId("automation:t1")).toBe("automation:t1");
  });

  it("keeps normal avatar ids and drops empty", () => {
    expect(sessionCreateAvatarId("av1")).toBe("av1");
    expect(sessionCreateAvatarId(null)).toBeUndefined();
    expect(sessionCreateAvatarId("")).toBeUndefined();
    expect(sessionCreateAvatarId("  ")).toBeUndefined();
  });
});
