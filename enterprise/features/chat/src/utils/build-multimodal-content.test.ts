import { describe, expect, it } from "vitest";
import { buildOpenAIMessageContent } from "./build-multimodal-content";

describe("buildOpenAIMessageContent", () => {
  it("returns plain text when no attachments", () => {
    expect(buildOpenAIMessageContent("hello")).toBe("hello");
  });

  it("builds multimodal parts with text and image", () => {
    const result = buildOpenAIMessageContent("describe", [
      { name: "a.png", mime_type: "image/png", data_url: "data:image/png;base64,abc" },
    ]);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
    ]);
  });

  it("allows image-only messages", () => {
    const result = buildOpenAIMessageContent("", [
      { name: "a.png", mime_type: "image/png", data_url: "data:image/png;base64,abc" },
    ]);
    expect(result).toEqual([{ type: "image_url", image_url: { url: "data:image/png;base64,abc" } }]);
  });
});
