import { afterEach, describe, expect, it } from "vitest";
import { buildBrowserShareUrl, buildShareUrl } from "./share-url";

const previousBaseUrl = process.env.WEB_PORTAL_PUBLIC_BASE_URL;

afterEach(() => {
  if (previousBaseUrl === undefined) delete process.env.WEB_PORTAL_PUBLIC_BASE_URL;
  else process.env.WEB_PORTAL_PUBLIC_BASE_URL = previousBaseUrl;
});

describe("share URL", () => {
  it("uses the configured employee-reachable portal origin", () => {
    expect(
      buildShareUrl("/share/token-1", "http://127.0.0.1:3000/api/chat/shares", {
        WEB_PORTAL_PUBLIC_BASE_URL: "https://portal.example.com/",
      }),
    ).toBe("https://portal.example.com/share/token-1");
  });

  it("falls back to the request origin for local or proxied requests", () => {
    expect(buildShareUrl("/share/token-2", "https://portal.example.com/api/chat/shares", {})).toBe(
      "https://portal.example.com/share/token-2",
    );
  });

  it("rejects non-http public origins", () => {
    expect(() =>
      buildShareUrl("/share/token-3", "http://localhost:3000/api/chat/shares", {
        WEB_PORTAL_PUBLIC_BASE_URL: "file:///tmp/portal",
      }),
    ).toThrow("must use http or https");
  });

  it("copies the share path onto the current browser origin", () => {
    expect(buildBrowserShareUrl("/share/token-4", "https://test.pal.cmccfund.com:3000")).toBe(
      "https://test.pal.cmccfund.com:3000/share/token-4",
    );
  });

  it("does not keep a server-side internal origin when copying in the browser", () => {
    const apiShareUrl = buildShareUrl("/share/token-5", "http://192.168.16.66/api/chat/shares", {
      WEB_PORTAL_PUBLIC_BASE_URL: "http://192.168.16.66",
    });
    expect(apiShareUrl).toBe("http://192.168.16.66/share/token-5");
    expect(buildBrowserShareUrl("/share/token-5", "https://test.pal.cmccfund.com:3000")).toBe(
      "https://test.pal.cmccfund.com:3000/share/token-5",
    );
  });
});
