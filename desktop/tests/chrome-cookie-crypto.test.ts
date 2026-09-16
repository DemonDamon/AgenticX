import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  chromeExpiryToUnixSeconds,
  cookieUrlFromHost,
  decryptChromeCookieValue,
  deriveChromeAesKeyMac,
  mapCookieSameSite,
  shouldSkipHostKey,
} from "../electron/chrome-cookie-crypto";

function encryptMacChromeValue(plain: string, password: string): Buffer {
  const key = deriveChromeAesKeyMac(password);
  const iv = Buffer.alloc(16, 0x20);
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  const body = Buffer.concat([Buffer.alloc(32, 0), Buffer.from(plain, "utf8")]);
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  return Buffer.concat([Buffer.from("v10"), encrypted]);
}

describe("decryptChromeCookieValue", () => {
  it("decrypts a macOS v10 cookie with the 32-byte prefix", () => {
    const blob = encryptMacChromeValue("session-token-abc", "test-password");
    const key = deriveChromeAesKeyMac("test-password");
    expect(decryptChromeCookieValue(blob, key, "darwin")).toBe("session-token-abc");
  });

  it("returns empty for unknown prefixes that are not printable", () => {
    expect(decryptChromeCookieValue(Buffer.from([0x01, 0x02, 0x03, 0x04]), Buffer.alloc(16), "darwin")).toBe(
      "",
    );
  });
});

describe("cookieUrlFromHost", () => {
  it("strips leading dot and uses https when secure", () => {
    expect(cookieUrlFromHost(".feishu.cn", "/", true)).toBe("https://feishu.cn/");
    expect(cookieUrlFromHost("accounts.feishu.cn", "/accounts", false)).toBe(
      "http://accounts.feishu.cn/accounts",
    );
  });
});

describe("chromeExpiryToUnixSeconds", () => {
  it("converts Chromium epoch and ignores session cookies", () => {
    expect(chromeExpiryToUnixSeconds(0)).toBeUndefined();
    // 2026-01-01T00:00:00Z in Chrome microseconds
    const unix = Date.UTC(2026, 0, 1) / 1000;
    const chrome = (unix * 1000 + 11_644_473_600_000) * 1000;
    expect(chromeExpiryToUnixSeconds(chrome)).toBe(unix);
  });
});

describe("mapCookieSameSite / shouldSkipHostKey", () => {
  it("maps Chromium same-site integers", () => {
    expect(mapCookieSameSite(0)).toBe("no_restriction");
    expect(mapCookieSameSite(1)).toBe("lax");
    expect(mapCookieSameSite(2)).toBe("strict");
    expect(mapCookieSameSite(-1)).toBe("unspecified");
  });

  it("skips extension and empty hosts", () => {
    expect(shouldSkipHostKey("")).toBe(true);
    expect(shouldSkipHostKey("chrome-extension://abc")).toBe(true);
    expect(shouldSkipHostKey(".feishu.cn")).toBe(false);
  });
});
