import { describe, expect, it } from "vitest";
import { shouldOfferSessionRemember } from "./confirm-remember";

describe("shouldOfferSessionRemember", () => {
  it("offers for low-risk tool confirms", () => {
    expect(shouldOfferSessionRemember({ tool: "file_write", risk: "low" })).toBe(true);
  });

  it.each(["high", "medium", "destructive", "computer_use", "policy", undefined, ""])(
    "does not offer for risk=%s",
    (risk) => {
      expect(shouldOfferSessionRemember({ tool: "file_write", risk })).toBe(false);
    },
  );

  it("does not offer without context or tool name", () => {
    expect(shouldOfferSessionRemember(undefined)).toBe(false);
    expect(shouldOfferSessionRemember({ risk: "low" })).toBe(false);
  });
});
