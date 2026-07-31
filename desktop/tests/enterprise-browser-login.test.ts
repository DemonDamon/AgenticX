import { describe, expect, it } from "vitest";
import {
  computePollMaxTicks,
  enterpriseFetchErrorMessage,
  isVerificationUrlSameOrigin,
  parseDeviceInitPayload,
  validatePortalOriginForBrowserLogin,
} from "../electron/enterprise-browser-login";

describe("enterprise-browser-login helpers", () => {
  it("accepts localhost http and rejects remote http", () => {
    expect(validatePortalOriginForBrowserLogin("http://localhost:3000").ok).toBe(true);
    expect(validatePortalOriginForBrowserLogin("http://127.0.0.1:3000").ok).toBe(true);
    expect(validatePortalOriginForBrowserLogin("https://portal.example.com").ok).toBe(true);
    expect(validatePortalOriginForBrowserLogin("http://portal.example.com").ok).toBe(false);
  });

  it("requires verification URL same origin under /auth/desktop", () => {
    expect(
      isVerificationUrlSameOrigin(
        "http://localhost:3000",
        "http://localhost:3000/auth/desktop?device=abc",
      ),
    ).toBe(true);
    expect(
      isVerificationUrlSameOrigin(
        "http://localhost:3000",
        "https://evil.example.com/auth/desktop?device=abc",
      ),
    ).toBe(false);
    expect(
      isVerificationUrlSameOrigin("http://localhost:3000", "http://localhost:3000/auth?device=abc"),
    ).toBe(false);
    expect(
      isVerificationUrlSameOrigin(
        "http://127.0.0.1:3000",
        "http://localhost:3000/auth/desktop?device=abc",
      ),
    ).toBe(true);
  });

  it("computes poll ticks from ttl and interval", () => {
    expect(computePollMaxTicks(600, 2500)).toBe(Math.ceil(600_000 / 2500) + 2);
  });

  it("parses device init payload without logging secrets in assertions path", () => {
    const parsed = parseDeviceInitPayload({
      deviceId: "d1",
      deviceSecret: "s1",
      verificationUrl: "http://localhost:3000/auth/desktop?device=d1",
      expiresIn: 600,
      pollIntervalMs: 2500,
    });
    expect(parsed?.deviceId).toBe("d1");
    expect(parsed?.deviceSecret).toBe("s1");
  });

  it("maps TLS / timeout / generic fetch failures to readable Chinese copy", () => {
    const tlsErr = new TypeError("fetch failed");
    (tlsErr as Error & { cause?: Error }).cause = Object.assign(
      new Error("Hostname/IP does not match certificate's altnames: Host: test.pal.example.com"),
      { code: "ERR_TLS_CERT_ALTNAME_INVALID" },
    );
    expect(enterpriseFetchErrorMessage(tlsErr)).toBe(
      "无法连接组织地址：HTTPS 证书无效或与域名不匹配，请联系运维。",
    );

    const timeoutErr = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    expect(enterpriseFetchErrorMessage(timeoutErr)).toBe("连接组织地址超时");

    const bareFetch = new TypeError("fetch failed");
    expect(enterpriseFetchErrorMessage(bareFetch)).toContain("网络或 HTTPS 校验失败");
  });
});
