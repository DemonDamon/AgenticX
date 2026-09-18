import { describe, expect, it } from "vitest";
import { maskSecretsForDisplay, maskToken } from "./secret-mask";
import { messagePlainTextForClipboard } from "./markdown-copy-format";

const WECHAT_ID = "BXPcHKWa2lF4qO0jVT1r5g";
const WECHAT_URL = `https://mp.weixin.qq.com/s/${WECHAT_ID}`;
const BARE_HIGH_ENTROPY = "AgxPatAbcdefghij123456";

describe("secret-mask", () => {
  it("keeps WeChat article id in https URL path (clickable / copyable)", () => {
    const raw = `罗列出jev的核心技术点：\n${WECHAT_URL}`;
    expect(maskSecretsForDisplay(raw)).toBe(raw);
    expect(maskSecretsForDisplay(raw)).not.toContain("*****");
  });

  it("keeps WeChat article id in markdown link and scheme-less URL", () => {
    const md = `[原文](${WECHAT_URL})`;
    const bare = `mp.weixin.qq.com/s/${WECHAT_ID}`;
    expect(maskSecretsForDisplay(md)).toBe(md);
    expect(maskSecretsForDisplay(bare)).toBe(bare);
  });

  it("still masks a bare high-entropy token that is not a URL path", () => {
    expect(maskSecretsForDisplay(BARE_HIGH_ENTROPY)).toBe(maskToken(BARE_HIGH_ENTROPY));
  });

  it("still masks known API keys even inside a URL query", () => {
    const key = "sk-proj-abcdefghijklmnopqrstuvwxyz12";
    const url = `https://example.com/callback?api_key=${key}`;
    const masked = maskSecretsForDisplay(url);
    expect(masked).not.toContain(key);
    expect(masked).toContain("https://example.com/callback?api_key=");
    expect(masked).toContain(maskToken(key));
  });

  it("still masks labeled secrets", () => {
    const raw = "api_key: hunter2secret";
    expect(maskSecretsForDisplay(raw)).toBe(`api_key: ${maskToken("hunter2secret")}`);
  });

  it("user-message clipboard keeps the public WeChat URL intact", () => {
    const content = `罗列出jev的核心技术点：\n${WECHAT_URL}`;
    expect(messagePlainTextForClipboard({ role: "user", content })).toBe(content);
  });
});
