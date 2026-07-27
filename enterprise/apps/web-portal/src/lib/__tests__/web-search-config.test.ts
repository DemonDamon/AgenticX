import { afterEach, describe, expect, it } from "vitest";
import { resolveWebSearchConfig } from "../web-search/config";

const ENV_KEYS = ["WEB_SEARCH_PROVIDER", "WEB_SEARCH_API_KEY", "WEB_SEARCH_MAX_RESULTS"] as const;

describe("resolveWebSearchConfig", () => {
  afterEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  it("prefers tenant pg row over env", () => {
    process.env.WEB_SEARCH_PROVIDER = "tavily";
    process.env.WEB_SEARCH_API_KEY = "env-key";
    const cfg = resolveWebSearchConfig({
      enabled: true,
      provider: "bocha",
      apiKey: "tenant-key",
      maxResults: 8,
    });
    expect(cfg.provider).toBe("bocha");
    expect(cfg.apiKey).toBe("tenant-key");
    expect(cfg.maxResults).toBe(8);
  });

  it("falls back to env then defaults when tenant is null", () => {
    process.env.WEB_SEARCH_PROVIDER = "tavily";
    process.env.WEB_SEARCH_API_KEY = "env-key";
    process.env.WEB_SEARCH_MAX_RESULTS = "7";
    const cfg = resolveWebSearchConfig(null);
    expect(cfg.provider).toBe("tavily");
    expect(cfg.apiKey).toBe("env-key");
    expect(cfg.maxResults).toBe(7);

    for (const key of ENV_KEYS) delete process.env[key];
    const defaults = resolveWebSearchConfig(null);
    expect(defaults.provider).toBe("duckduckgo");
    expect(defaults.enabled).toBe(true);
    expect(defaults.maxResults).toBe(50);
  });

  it("keeps enabled=false from tenant (admin closed)", () => {
    const cfg = resolveWebSearchConfig({
      enabled: false,
      provider: "duckduckgo",
      apiKey: "",
      maxResults: 5,
    });
    expect(cfg.enabled).toBe(false);
  });
});
