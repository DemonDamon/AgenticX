import { describe, expect, it } from "vitest";
import type { Message } from "../../store";
import { buildToolCardTitle } from "./ToolCallCard";

function toolMessage(overrides?: Partial<Message>): Message {
  return {
    id: "m1",
    role: "assistant",
    content: "tool call",
    toolName: "video_understand",
    toolArgs: { path: "/x/y/a.mp4" },
    ...overrides,
  };
}

describe("buildToolCardTitle", () => {
  it("renders friendly title for video_understand with file name", () => {
    expect(buildToolCardTitle(toolMessage())).toBe("理解视频 a.mp4");
  });

  it("falls back when path is missing", () => {
    expect(buildToolCardTitle(toolMessage({ toolArgs: {} }))).toBe("理解视频");
  });
});
