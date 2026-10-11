import { describe, expect, it } from "vitest";
import { resolveDeptDefaultModel } from "../dept-default-model";

describe("resolveDeptDefaultModel", () => {
  it("returns the leaf default when it is still allowed", () => {
    expect(
      resolveDeptDefaultModel({
        effectiveModelIds: ["a/b", "c/d"],
        defaultsLeafToRoot: ["a/b", "c/d"],
      }),
    ).toBe("a/b");
  });

  it("falls through to the parent when the leaf default was clipped", () => {
    expect(
      resolveDeptDefaultModel({
        effectiveModelIds: ["c/d"],
        defaultsLeafToRoot: ["a/b", "c/d"],
      }),
    ).toBe("c/d");
  });

  it("returns null when no default remains in the effective set", () => {
    expect(
      resolveDeptDefaultModel({
        effectiveModelIds: ["c/d"],
        defaultsLeafToRoot: ["a/b", "e/f"],
      }),
    ).toBeNull();
  });

  it("skips blank defaults", () => {
    expect(
      resolveDeptDefaultModel({
        effectiveModelIds: ["c/d"],
        defaultsLeafToRoot: ["  ", null, "c/d"],
      }),
    ).toBe("c/d");
  });
});
