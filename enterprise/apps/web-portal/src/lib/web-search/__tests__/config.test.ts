import { afterEach, describe, expect, it } from "vitest";
import { resolvePageFetchConfig } from "../config";

const ENV_KEYS = [
  "PAGE_FETCH_BACKENDS",
  "PAGE_FETCH_JINA_API_KEY",
  "PAGE_FETCH_FIRECRAWL_API_KEY",
  "PAGE_FETCH_ARCHIVE",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe("resolvePageFetchConfig", () => {
  it("defaults to native,jina with archive on when no tenant/env", () => {
    const cfg = resolvePageFetchConfig(null);
    expect(cfg.backends).toEqual(["native", "jina"]);
    expect(cfg.archivePages).toBe(true);
  });

  it("honors PAGE_FETCH_BACKENDS=jina", () => {
    process.env.PAGE_FETCH_BACKENDS = "jina";
    expect(resolvePageFetchConfig(null).backends).toEqual(["jina"]);
  });

  it("drops illegal names and keeps valid ones", () => {
    process.env.PAGE_FETCH_BACKENDS = "bogus,native";
    expect(resolvePageFetchConfig(null).backends).toEqual(["native"]);
  });

  it("falls back to default chain when all names illegal", () => {
    process.env.PAGE_FETCH_BACKENDS = "bogus";
    expect(resolvePageFetchConfig(null).backends).toEqual(["native", "jina"]);
  });

  it("disables archive when PAGE_FETCH_ARCHIVE=0", () => {
    process.env.PAGE_FETCH_ARCHIVE = "0";
    expect(resolvePageFetchConfig(null).archivePages).toBe(false);
  });

  it("prefers tenant row over env", () => {
    process.env.PAGE_FETCH_BACKENDS = "native";
    process.env.PAGE_FETCH_ARCHIVE = "0";
    process.env.PAGE_FETCH_JINA_API_KEY = "env-key";
    const cfg = resolvePageFetchConfig({
      enabled: true,
      provider: "duckduckgo",
      apiKey: "",
      maxResults: 8,
      pageFetchBackends: "jina,firecrawl",
      pageFetchJinaApiKey: "tenant-jina",
      archivePages: true,
    });
    expect(cfg.backends).toEqual(["jina", "firecrawl"]);
    expect(cfg.archivePages).toBe(true);
    expect(cfg.apiKeys.jina).toBe("tenant-jina");
  });
});
