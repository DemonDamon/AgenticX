import { describe, expect, it } from "vitest";
import { resolveSendSessionId } from "./send-lock";

describe("resolveSendSessionId", () => {
  it("locked id wins even when pane shows another session", () => {
    expect(resolveSendSessionId("A", "B")).toBe("A");
  });
  it("falls back to live pane sid when no lock (composer / lazy)", () => {
    expect(resolveSendSessionId(undefined, "B")).toBe("B");
    expect(resolveSendSessionId("", "B")).toBe("B");
  });
  it("returns empty when neither present (lazy create path)", () => {
    expect(resolveSendSessionId(undefined, undefined)).toBe("");
    expect(resolveSendSessionId(" ", " ")).toBe("");
  });
});
