import { describe, expect, it } from "vitest";
import { parseAssistantContent, recoverIncompleteCodeFences } from "./assistant-content";

describe("recoverIncompleteCodeFences", () => {
  it("fills code body from reasoning when visible output stops at opening fence", () => {
    const display = "示例：\n\n```cpp\n";
    const reasoning = "计划…\n\n```cpp\n#include <iostream>\n\nint main() {}\n```\n";
    expect(recoverIncompleteCodeFences(display, reasoning)).toBe(
      "示例：\n\n```cpp\n#include <iostream>\n\nint main() {}\n```"
    );
  });
});

describe("parseAssistantContent", () => {
  it("maps vendor think tags and recovers truncated code blocks", () => {
    const thinkOpen = "<" + "think" + ">";
    const thinkClose = "<" + "/" + "think" + ">";
    const parsed = parseAssistantContent({
      id: "m1",
      session_id: "s1",
      tenant_id: "t1",
      user_id: "u1",
      role: "assistant",
      content: `${thinkOpen}plan with \`\`\`cpp\n#include <iostream>\n\`\`\`${thinkClose}\n\n## Demo\n\n\`\`\`cpp\n`,
      created_at: "2026-05-21T00:00:00.000Z",
    });

    expect(parsed.displayContent).toContain("#include <iostream>");
    expect(parsed.displayContent).toContain("```");
    expect(parsed.reasoningContent).toContain("plan");
  });
});
