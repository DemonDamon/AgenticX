import { describe, expect, it } from "vitest";
import {
  shouldDropDuplicateUserSend,
  shouldSuppressDuplicatePendingUserEcho,
} from "./send-dedupe";

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

describe("shouldSuppressDuplicatePendingUserEcho", () => {
  it("suppresses when last user bubble matches and no assistant yet", () => {
    expect(
      shouldSuppressDuplicatePendingUserEcho(
        [{ role: "user", content: "你好" }],
        "你好",
      ),
    ).toBe(true);
  });

  it("allows when assistant already replied", () => {
    expect(
      shouldSuppressDuplicatePendingUserEcho(
        [
          { role: "user", content: "你好" },
          { role: "assistant", content: "你好！" },
        ],
        "你好",
      ),
    ).toBe(false);
  });

  it("ignores tool rows when finding tail", () => {
    expect(
      shouldSuppressDuplicatePendingUserEcho(
        [
          { role: "user", content: "你好" },
          { role: "tool", content: "精简模式提示" },
        ],
        "你好",
      ),
    ).toBe(true);
  });
});
