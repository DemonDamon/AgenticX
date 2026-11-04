import { describe, expect, it } from "vitest";
import type { ProviderCatalogEntry } from "./model-options";
import {
  CLAUDE_LIVE_SETTINGS_PROVIDER_ID,
  coerceModelForHarness,
  collectHarnessModelOptions,
  enrichHarnessModelOptionsWithClaudeLive,
  evaluateModelForHarness,
  isModelAvailableForHarness,
  resolveActiveHarnessId,
  resolveFallbackModelForHarness,
} from "./harness-model-compat";

const KEY = "test-key";

const zhipu: ProviderCatalogEntry = {
  apiKey: KEY,
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  model: "glm-5.1",
  models: ["glm-5.1", "glm-5.2"],
  enabled: true,
  dropParams: false,
};

const bailian: ProviderCatalogEntry = {
  apiKey: KEY,
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: "qwen-plus",
  models: ["qwen-plus", "text-embedding-v4"],
  enabled: true,
  dropParams: false,
};

const ollama: ProviderCatalogEntry = {
  apiKey: "",
  baseUrl: "http://127.0.0.1:11434",
  model: "llama3.2",
  models: ["llama3.2"],
  enabled: true,
  dropParams: false,
  interface: "ollama",
};

const providers = { zhipu, bailian, ollama };

describe("harness-model-compat", () => {
  it("resolves pane harness; null/empty is builtin; undefined falls back to preferred", () => {
    expect(resolveActiveHarnessId("codex", "claude-code")).toBe("codex");
    expect(resolveActiveHarnessId(null, "claude-code")).toBe("python-agent");
    expect(resolveActiveHarnessId("", null)).toBe("python-agent");
    expect(resolveActiveHarnessId(undefined, "claude-code")).toBe("claude-code");
  });

  it("keeps full selectable catalog for builtin harness", () => {
    const rows = collectHarnessModelOptions(providers, "python-agent");
    expect(rows.every((r) => r.available)).toBe(true);
    expect(rows.map((r) => `${r.provider}:${r.model}`)).toEqual([
      "zhipu:glm-5.1",
      "zhipu:glm-5.2",
      "bailian:qwen-plus",
      "bailian:text-embedding-v4",
      "ollama:llama3.2",
    ]);
  });

  it("allows non-Anthropic chat ids for claude-code (BYOS opaque --model)", () => {
    expect(isModelAvailableForHarness("claude-code", "zhipu", "glm-5.1", providers)).toBe(true);
    expect(isModelAvailableForHarness("claude-code", "bailian", "qwen-plus", providers)).toBe(true);
  });

  it("disables embedding models for native-model harnesses", () => {
    const verdict = evaluateModelForHarness(
      "claude-code",
      "bailian",
      "text-embedding-v4",
      providers,
    );
    expect(verdict).toEqual({ available: false, reason: "embedding_unsupported" });
    expect(isModelAvailableForHarness("codex", "bailian", "text-embedding-v4", providers)).toBe(false);
    expect(isModelAvailableForHarness("opencode", "bailian", "text-embedding-v4", providers)).toBe(false);
  });

  it("disables ollama for claude-code and codex but not opencode", () => {
    expect(evaluateModelForHarness("claude-code", "ollama", "llama3.2", providers)).toEqual({
      available: false,
      reason: "ollama_unsupported",
    });
    expect(isModelAvailableForHarness("codex", "ollama", "llama3.2", providers)).toBe(false);
    expect(isModelAvailableForHarness("opencode", "ollama", "llama3.2", providers)).toBe(true);
  });

  it("disables all models for harnesses without a native model option", () => {
    const rows = collectHarnessModelOptions(providers, "codebuddy");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => !r.available && r.reason === "harness_no_model_option")).toBe(true);
  });

  it("falls back when current selection is invalid for the new harness", () => {
    // Embedding selected + switch to claude-code → same-provider chat model.
    expect(coerceModelForHarness(providers, "claude-code", "bailian", "text-embedding-v4")).toEqual({
      provider: "bailian",
      model: "qwen-plus",
    });
    // Ollama selected + switch to codex → same-provider unavailable, first available overall.
    expect(coerceModelForHarness(providers, "codex", "ollama", "llama3.2", "ollama")).toEqual({
      provider: "zhipu",
      model: "glm-5.1",
    });
    // Stays when still valid.
    expect(coerceModelForHarness(providers, "claude-code", "zhipu", "glm-5.2")).toEqual({
      provider: "zhipu",
      model: "glm-5.2",
    });
  });

  it("returns null fallback when nothing is available (codebuddy)", () => {
    expect(resolveFallbackModelForHarness(providers, "codebuddy")).toBeNull();
  });

  it("enriches claude-code catalog with live settings aliases not in providers", () => {
    const base = collectHarnessModelOptions(providers, "claude-code");
    const enriched = enrichHarnessModelOptionsWithClaudeLive(
      base,
      "claude-code",
      ["glm-5.3-flash", "glm-5.1", "glm-5.1", "haiku-live"],
    );
    const live = enriched.filter((r) => r.provider === CLAUDE_LIVE_SETTINGS_PROVIDER_ID);
    // glm-5.1 already in zhipu catalog → not duplicated as live row
    expect(live.map((r) => r.model).sort()).toEqual(["glm-5.3-flash", "haiku-live"].sort());
    expect(live.every((r) => r.available)).toBe(true);
    // builtin must not gain live rows
    expect(
      enrichHarnessModelOptionsWithClaudeLive(base, "python-agent", ["haiku-live"]),
    ).toEqual(base);
  });

  it("marks live settings ids available only under claude-code", () => {
    expect(
      evaluateModelForHarness(
        "claude-code",
        CLAUDE_LIVE_SETTINGS_PROVIDER_ID,
        "haiku-live",
        providers,
      ),
    ).toEqual({ available: true });
    expect(
      isModelAvailableForHarness(
        "codex",
        CLAUDE_LIVE_SETTINGS_PROVIDER_ID,
        "haiku-live",
        providers,
      ),
    ).toBe(false);
    expect(
      coerceModelForHarness(
        providers,
        "claude-code",
        CLAUDE_LIVE_SETTINGS_PROVIDER_ID,
        "haiku-live",
      ),
    ).toEqual({
      provider: CLAUDE_LIVE_SETTINGS_PROVIDER_ID,
      model: "haiku-live",
    });
  });
});
