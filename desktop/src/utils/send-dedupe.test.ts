import { describe, expect, it } from "vitest";
import { shouldDropDuplicateUserSend } from "./send-dedupe";

describe("shouldDropDuplicateUserSend", () => {
  it("drops same session+text within window", () => {
    const entry = { sessionId: "a", text: "hello", at: 1000 };
    expect(shouldDropDuplicateUserSend(entry, "a", "hello", 2500)).toBe(true);
  });

  it("allows after window elapsed", () => {
    const entry = { sessionId: "a", text: "hello", at: 1000 };
    expect(shouldDropDuplicateUserSend(entry, "a", "hello", 3100)).toBe(false);
  });

  it("allows different session", () => {
    const entry = { sessionId: "a", text: "hello", at: 1000 };
    expect(shouldDropDuplicateUserSend(entry, "b", "hello", 1500)).toBe(false);
  });

  it("allows different text", () => {
    const entry = { sessionId: "a", text: "hello", at: 1000 };
    expect(shouldDropDuplicateUserSend(entry, "a", "world", 1500)).toBe(false);
  });
});
