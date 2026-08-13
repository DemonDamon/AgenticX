import { describe, expect, it } from "vitest";
import {
  PORTAL_CAPABILITY_SYSTEM_HINT,
  PORTAL_PRODUCT_NAME,
  withPortalCapabilityContext,
} from "./portal-capabilities";

describe("portal capability context", () => {
  it("answers product identity and supported document capabilities without a model id", () => {
    expect(PORTAL_CAPABILITY_SYSTEM_HINT).toContain(PORTAL_PRODUCT_NAME);
    expect(PORTAL_CAPABILITY_SYSTEM_HINT).toContain("DOC/DOCX");
    expect(PORTAL_CAPABILITY_SYSTEM_HINT).toContain("PDF");
    expect(PORTAL_CAPABILITY_SYSTEM_HINT).toContain("HTTP(S)");
    expect(PORTAL_CAPABILITY_SYSTEM_HINT).toContain("按用户问题提取相关段落");
    expect(PORTAL_CAPABILITY_SYSTEM_HINT).toContain("不能一概声称");
    expect(PORTAL_CAPABILITY_SYSTEM_HINT).toContain("只有收到本轮检索或直读证据");
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

});
