import { describe, expect, it } from "vitest";
import { stripEmptyAssistantMessages } from "./chat-completion-sanitize";

describe("stripEmptyAssistantMessages", () => {
  it("drops optimistic empty assistant placeholders", () => {
    const out = stripEmptyAssistantMessages([
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "" },
      { role: "assistant", content: "   " },
      { role: "assistant", content: null },
    ]);
    expect(out).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
    ]);
  });

  it("keeps assistant rows with non-empty content", () => {
    const out = stripEmptyAssistantMessages([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello there" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1]?.content).toBe("hello there");
  });

  it("keeps empty assistant when tool_calls are present", () => {
    const out = stripEmptyAssistantMessages([
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", type: "function", function: { name: "web_search", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "c1", content: "hits" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.tool_calls).toHaveLength(1);
  });
});
