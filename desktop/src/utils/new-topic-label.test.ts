import { describe, expect, it } from "vitest";

import { NEW_TOPIC_INHERITS_CONTEXT, newTopicTriggerLabel } from "./new-topic-label";

describe("newTopicTriggerLabel", () => {
  it("describes a new conversation with the current assistant", () => {
    expect(newTopicTriggerLabel({ displayName: "和创智派", isGroup: false })).toBe(
      "与和创智派新建对话",
    );
    expect(newTopicTriggerLabel({ displayName: "数字专家", isGroup: false })).toBe(
      "与数字专家新建对话",
    );
  });

  it("describes a new conversation inside the current group", () => {
    expect(newTopicTriggerLabel({ displayName: "项目群聊", isGroup: true })).toBe(
      "在项目群聊中新建对话",
    );
  });

  it("falls back to a generic label when the display name is empty", () => {
    expect(newTopicTriggerLabel({ displayName: "  ", isGroup: false })).toBe("新建对话");
  });

  it("always starts with a fresh context from the toolbar", () => {
    expect(NEW_TOPIC_INHERITS_CONTEXT).toBe(false);
  });
});
