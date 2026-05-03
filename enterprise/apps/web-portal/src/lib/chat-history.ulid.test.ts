import { describe, expect, it } from "vitest";
import { isValidUlid } from "./chat-history";

describe("isValidUlid", () => {
  it("accepts valid crockford ulid", () => {
    expect(isValidUlid("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isValidUlid("01ARZ3NDEKTSV4RRFFQ69G5FA")).toBe(false);
  });

  it("rejects invalid first char", () => {
    expect(isValidUlid("81ARZ3NDEKTSV4RRFFQ69G5FA")).toBe(false);
  });
});
