import { afterEach, describe, expect, it } from "vitest";
import { resolveWebSearchConfig } from "../web-search/config";
import {
  DEFAULT_MAX_SEARCH_CALLS,
  isValidMaxSearchCalls,
  normalizeMaxSearchCalls,
} from "../web-search/search-call-budget";

const ENV_KEYS = [
  "WEB_SEARCH_PROVIDER",
  "WEB_SEARCH_API_KEY",
  "WEB_SEARCH_MAX_RESULTS",
  "WEB_SEARCH_PROVIDERS_JSON",
  "WEB_SEARCH_PRIMARY_PROVIDER_ID",
] as const;

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
    expect(cfg.maxSearchCalls).toBe(DEFAULT_MAX_SEARCH_CALLS);
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
    expect(defaults.maxSearchCalls).toBe(DEFAULT_MAX_SEARCH_CALLS);
  });

  it("resolves a bounded tenant search-call budget and safely defaults legacy or corrupt values", () => {
    const base = {
      enabled: true,
      provider: "duckduckgo",
      apiKey: "",
      maxResults: 50,
    };

    expect(resolveWebSearchConfig({ ...base, maxSearchCalls: 1 }).maxSearchCalls).toBe(1);
    expect(resolveWebSearchConfig({ ...base, maxSearchCalls: 5 }).maxSearchCalls).toBe(5);
    expect(resolveWebSearchConfig(base).maxSearchCalls).toBe(DEFAULT_MAX_SEARCH_CALLS);
    expect(resolveWebSearchConfig({ ...base, maxSearchCalls: 6 }).maxSearchCalls).toBe(
      DEFAULT_MAX_SEARCH_CALLS,
    );
    expect(resolveWebSearchConfig({ ...base, maxSearchCalls: 1.5 }).maxSearchCalls).toBe(
      DEFAULT_MAX_SEARCH_CALLS,
    );
  });

  it("exposes strict validation separately from fail-safe runtime normalization", () => {
    expect(isValidMaxSearchCalls(1)).toBe(true);
    expect(isValidMaxSearchCalls(5)).toBe(true);
    expect(isValidMaxSearchCalls(0)).toBe(false);
    expect(isValidMaxSearchCalls(6)).toBe(false);
    expect(isValidMaxSearchCalls(2.5)).toBe(false);
    expect(isValidMaxSearchCalls("3")).toBe(false);
    expect(normalizeMaxSearchCalls(6)).toBe(DEFAULT_MAX_SEARCH_CALLS);
    expect(normalizeMaxSearchCalls(undefined)).toBe(DEFAULT_MAX_SEARCH_CALLS);
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

  it("loads an ordered provider pool without a provider-name allowlist", () => {
    process.env.WEB_SEARCH_PROVIDERS_JSON = JSON.stringify([
      {
        id: "customer-search-primary",
        adapter: "future-adapter",
        displayName: "Customer primary",
        apiKey: "key-a",
        enabled: true,
        priority: 0,
      },
      {
        id: "customer-search-secondary",
        adapter: "another-adapter",
        displayName: "Customer secondary",
        apiKey: "key-b",
        enabled: true,
        priority: 1,
      },
    ]);

    const cfg = resolveWebSearchConfig(null);
    expect(cfg.providers?.map((provider) => provider.id)).toEqual([
      "customer-search-primary",
      "customer-search-secondary",
    ]);
    expect(cfg.provider).toBe("future-adapter");
  });
});
