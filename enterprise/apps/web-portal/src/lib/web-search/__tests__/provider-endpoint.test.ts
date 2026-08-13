import { afterEach, describe, expect, it } from "vitest";
import {
  isBlockedWebSearchAddress,
  normalizeWebSearchEndpoint,
  normalizeWebSearchResultUrl,
  resolveSafeWebSearchEndpoint,
} from "../provider-endpoint";

const ORIGINAL_ALLOWLIST = process.env.WEB_SEARCH_CUSTOM_ENDPOINT_HOSTS;

describe("custom web-search endpoint policy", () => {
  afterEach(() => {
    if (ORIGINAL_ALLOWLIST === undefined) delete process.env.WEB_SEARCH_CUSTOM_ENDPOINT_HOSTS;
    else process.env.WEB_SEARCH_CUSTOM_ENDPOINT_HOSTS = ORIGINAL_ALLOWLIST;
  });

  it("accepts public HTTPS endpoints and normalizes the URL", () => {
    expect(normalizeWebSearchEndpoint(" https://1.1.1.1/search ")).toBe(
      "https://1.1.1.1/search",
    );
  });

  it("returns a pinned address for literal public provider endpoints", async () => {
    await expect(
      resolveSafeWebSearchEndpoint("https://1.1.1.1/search"),
    ).resolves.toMatchObject({
      url: "https://1.1.1.1/search",
      hostname: "1.1.1.1",
      address: "1.1.1.1",
    });
  });

  it("accepts public result links but rejects private result links", () => {
    expect(normalizeWebSearchResultUrl("https://example.com/article#part")).toBe(
      "https://example.com/article",
    );
    expect(() => normalizeWebSearchResultUrl("http://10.0.0.1/private")).toThrow();
  });

  it.each([
    "http://search.example/api",
    "https://user:pass@search.example/api",
    "https://localhost/api",
    "https://127.0.0.1/api",
    "https://[::1]/api",
    "https://[::ffff:7f00:1]/api",
    "https://169.254.169.254/latest/meta-data",
    "https://service.internal/api",
  ])("rejects unsafe endpoint %s", (endpoint) => {
    expect(() => normalizeWebSearchEndpoint(endpoint)).toThrow();
  });

  it("blocks private, loopback, link-local and reserved DNS answers", () => {
    expect(isBlockedWebSearchAddress("10.0.0.1")).toBe(true);
    expect(isBlockedWebSearchAddress("100.64.0.1")).toBe(true);
    expect(isBlockedWebSearchAddress("172.16.1.1")).toBe(true);
    expect(isBlockedWebSearchAddress("192.168.1.1")).toBe(true);
    expect(isBlockedWebSearchAddress("::1")).toBe(true);
    expect(isBlockedWebSearchAddress("fd00::1")).toBe(true);
    expect(isBlockedWebSearchAddress("::ffff:7f00:1")).toBe(true);
    expect(isBlockedWebSearchAddress("1.1.1.1")).toBe(false);
    expect(isBlockedWebSearchAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("permits an explicitly allowlisted private deployment host", () => {
    process.env.WEB_SEARCH_CUSTOM_ENDPOINT_HOSTS = "search.internal";
    expect(normalizeWebSearchEndpoint("https://search.internal/api")).toBe(
      "https://search.internal/api",
    );
  });
});
