import { describe, expect, it } from "vitest";
import { defaultUrlTransform } from "react-markdown";
import {
  ARTIFACT_HREF_PREFIX,
  assistantUrlTransform,
} from "./assistant-markdown-components";

describe("assistantUrlTransform", () => {
  it("keeps artifact: hrefs that defaultUrlTransform would strip", () => {
    const href = `${ARTIFACT_HREF_PREFIX}art-final-123`;
    expect(defaultUrlTransform(href)).toBe("");
    expect(assistantUrlTransform(href)).toBe(href);
  });

  it("still allows https urls", () => {
    expect(assistantUrlTransform("https://example.com/a")).toBe(
      "https://example.com/a",
    );
  });

  it("still strips other unknown protocols", () => {
    expect(assistantUrlTransform("javascript:alert(1)")).toBe("");
  });
});
