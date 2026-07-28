import { describe, expect, it } from "vitest";
import { parseAssistantContent, recoverIncompleteCodeFences, stripModelCitationTags, stripPlaceholderCitationMarkers } from "./assistant-content";

describe("recoverIncompleteCodeFences", () => {
  it("fills code body from reasoning when visible output stops at opening fence", () => {
    const display = "示例：\n\n```cpp\n";
    const reasoning = "计划…\n\n```cpp\n#include <iostream>\n\nint main() {}\n```\n";
    expect(recoverIncompleteCodeFences(display, reasoning)).toBe(
      "示例：\n\n```cpp\n#include <iostream>\n\nint main() {}\n```"
    );
  });
});

describe("stripPlaceholderCitationMarkers", () => {
  it("removes [N] placeholder and attachment boilerplate prefix", () => {
    const raw =
      "[N] 技术方案原文\n- 文档内容基于提供的附件：方案.md\n\n## 摘要";
    expect(stripPlaceholderCitationMarkers(raw)).toBe("技术方案原文\n方案.md\n\n## 摘要");
  });
});

describe("stripModelCitationTags", () => {
  it("removes citation xml wrappers from assistant text", () => {
    const raw =
      "[N] 技术方案原文\n<citations> - 文档内容基于提供的附件：方案.md </citations>\n\n## 摘要\n正文";
    expect(stripModelCitationTags(raw)).toBe(
      "[N] 技术方案原文\n - 文档内容基于提供的附件：方案.md \n\n## 摘要\n正文",
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

  it("strips citation tags from visible assistant content", () => {
    const parsed = parseAssistantContent({
      id: "m2",
      session_id: "s1",
      tenant_id: "t1",
      user_id: "u1",
      role: "assistant",
      content: "摘要\n<citations>附件说明</citations>",
      created_at: "2026-05-21T00:00:00.000Z",
    });
    expect(parsed.displayContent).toBe("摘要\n附件说明");
    expect(parsed.displayContent).not.toContain("<citations>");
  });
});
