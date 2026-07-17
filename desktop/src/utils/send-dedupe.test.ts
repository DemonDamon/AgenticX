import { describe, expect, it } from "vitest";
import type { MessageAttachment } from "../store";
import {
  shouldDropDuplicateUserSend,
  shouldSuppressDuplicatePendingUserEcho,
} from "./send-dedupe";

const referenceAttachment = (sourcePath: string): MessageAttachment => ({
  name: "context.md",
  mimeType: "text/markdown",
  size: 10,
  sourcePath,
  referenceToken: true,
  composerRefLabel: "context.md",
});

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

  it("suppresses a pending canonical-path row when composer text uses its short label", () => {
    const path = "/Users/demo/project/context.md";
    const persistedAttachments = [
      {
        ...referenceAttachment(path),
        mimeType: "application/octet-stream",
        size: 12,
      },
    ];
    const composerAttachments = [referenceAttachment(path)];
    expect(
      shouldSuppressDuplicatePendingUserEcho(
        [{ role: "user", content: `检查 @${path}`, attachments: persistedAttachments }],
        "检查 @context.md",
        composerAttachments,
      ),
    ).toBe(true);
  });

  it("allows the same canonical reference after an assistant reply", () => {
    const path = "/Users/demo/project/context.md";
    const attachments = [referenceAttachment(path)];
    expect(
      shouldSuppressDuplicatePendingUserEcho(
        [
          { role: "user", content: `检查 @${path}`, attachments },
          { role: "assistant", content: "已完成" },
        ],
        "检查 @context.md",
        attachments,
      ),
    ).toBe(false);
  });

  it("allows the same pending text when attachment identities differ", () => {
    const first = [referenceAttachment("/Users/demo/project-a/context.md")];
    const second = [referenceAttachment("/Users/demo/project-b/context.md")];
    expect(
      shouldSuppressDuplicatePendingUserEcho(
        [{ role: "user", content: "请检查附件", attachments: first }],
        "请检查附件",
        second,
      ),
    ).toBe(false);
  });

  it("does not dedupe weak same-name uploads that lack a stable source identity", () => {
    const first: MessageAttachment[] = [
      { name: "notes.txt", mimeType: "text/plain", size: 10 },
    ];
    const second: MessageAttachment[] = [
      { name: "notes.txt", mimeType: "text/plain", size: 20 },
    ];
    expect(
      shouldSuppressDuplicatePendingUserEcho(
        [{ role: "user", content: "请检查附件", attachments: first }],
        "请检查附件",
        second,
      ),
    ).toBe(false);
  });

  it("allows a same-text pending row when both client turn ids are different", () => {
    expect(
      shouldSuppressDuplicatePendingUserEcho(
        [
          {
            role: "user",
            content: "继续",
            metadata: { client_turn_id: "turn-old" },
          },
        ],
        "继续",
        undefined,
        "turn-new",
      ),
    ).toBe(false);
  });

  it("suppresses a duplicate pending row when client turn ids are identical", () => {
    expect(
      shouldSuppressDuplicatePendingUserEcho(
        [
          {
            role: "user",
            content: "继续",
            metadata: { client_turn_id: "turn-same" },
          },
        ],
        "继续",
        undefined,
        "turn-same",
      ),
    ).toBe(true);
  });
});
