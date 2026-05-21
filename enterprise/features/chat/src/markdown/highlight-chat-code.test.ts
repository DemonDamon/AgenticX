import { describe, expect, it } from "vitest";
import { highlightChatCode } from "./highlight-chat-code";

describe("highlightChatCode", () => {
  it("highlights rust keywords and strings", () => {
    const html = highlightChatCode('fn main() {\n    println!("Hello");\n}', "rust");
    expect(html).toContain('class="token keyword"');
    expect(html).toContain('class="token string"');
  });
});
