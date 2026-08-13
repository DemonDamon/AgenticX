import { describe, expect, it } from "vitest";
import {
  PORTAL_CAPABILITY_SYSTEM_HINT,
  PORTAL_PRODUCT_NAME,
  isPortalCapabilityQuestion,
  withPortalCapabilityContext,
} from "./portal-capabilities";

describe("portal capability context", () => {
  it("answers product identity and supported document capabilities without a model id", () => {
    expect(PORTAL_CAPABILITY_SYSTEM_HINT).toContain(PORTAL_PRODUCT_NAME);
    expect(PORTAL_CAPABILITY_SYSTEM_HINT).toContain("DOC/DOCX");
    expect(PORTAL_CAPABILITY_SYSTEM_HINT).toContain("PDF");
    expect(PORTAL_CAPABILITY_SYSTEM_HINT).not.toContain("glm-");
    expect(PORTAL_CAPABILITY_SYSTEM_HINT).not.toContain("gpt-");
  });

  it("adds the context once and preserves an existing system prompt", () => {
    const messages = withPortalCapabilityContext([
      { role: "system", content: "tenant prompt" },
      { role: "user", content: "你是谁" },
    ]);
    expect(messages).toHaveLength(2);
    expect(String(messages[0]?.content)).toContain(PORTAL_PRODUCT_NAME);
    expect(String(messages[0]?.content)).toContain("tenant prompt");
    expect(withPortalCapabilityContext(messages)).toEqual(messages);
  });

  it("recognizes capability questions by shape while leaving action requests alone", () => {
    expect(isPortalCapabilityQuestion("你现在能看 Word 版么")).toBe(true);
    expect(isPortalCapabilityQuestion("和创智派支持上传 PDF 吗")).toBe(true);
    expect(isPortalCapabilityQuestion("现在有联网功能吗")).toBe(true);
    expect(isPortalCapabilityQuestion("你有什么功能？")).toBe(true);
    expect(isPortalCapabilityQuestion("你能帮我写一封请假邮件吗")).toBe(false);
    expect(isPortalCapabilityQuestion("这篇论文的作者是谁")).toBe(false);
  });
});
