import { describe, expect, it } from "vitest";
import {
  MAX_MODEL_CONTEXT_WINDOW,
  MIN_MODEL_CONTEXT_WINDOW,
  extractOllamaContextWindow,
  extractUpstreamContextWindow,
  normalizeContextWindow,
} from "./model-context-window";

describe("normalizeContextWindow", () => {
  it("accepts admin input as number or numeric string", () => {
    expect(normalizeContextWindow(128_000)).toBe(128_000);
    expect(normalizeContextWindow("128000")).toBe(128_000);
    expect(normalizeContextWindow(" 262144 ")).toBe(262_144);
    expect(normalizeContextWindow(131_072.9)).toBe(131_072);
  });

  it("rejects values that would silently break a session", () => {
    // 未填写 / 填废话 → undefined，交给运行时兜底，而不是把窗口压成不可用的小值。
    for (const bad of [undefined, null, "", "abc", NaN, 0, -1, MIN_MODEL_CONTEXT_WINDOW - 1]) {
      expect(normalizeContextWindow(bad)).toBeUndefined();
    }
    expect(normalizeContextWindow(MAX_MODEL_CONTEXT_WINDOW + 1)).toBeUndefined();
    expect(normalizeContextWindow(MIN_MODEL_CONTEXT_WINDOW)).toBe(MIN_MODEL_CONTEXT_WINDOW);
    expect(normalizeContextWindow(MAX_MODEL_CONTEXT_WINDOW)).toBe(MAX_MODEL_CONTEXT_WINDOW);
  });
});

describe("extractUpstreamContextWindow", () => {
  it("reads vLLM max_model_len — the authoritative value for self-hosted endpoints", () => {
    expect(
      extractUpstreamContextWindow({ id: "Qwen/Qwen3-32B", max_model_len: 32_768 }),
    ).toBe(32_768);
  });

  it("reads the other common OpenAI-compatible spellings", () => {
    expect(extractUpstreamContextWindow({ id: "x", context_length: 200_000 })).toBe(200_000);
    expect(extractUpstreamContextWindow({ id: "x", max_context_length: 65_536 })).toBe(65_536);
    expect(
      extractUpstreamContextWindow({ id: "x", model_info: { max_input_tokens: 128_000 } }),
    ).toBe(128_000);
  });

  it("returns undefined when the gateway reports nothing usable", () => {
    expect(extractUpstreamContextWindow({ id: "x" })).toBeUndefined();
    expect(extractUpstreamContextWindow({ id: "x", max_model_len: 0 })).toBeUndefined();
    expect(extractUpstreamContextWindow({ id: "x", model_info: null })).toBeUndefined();
    expect(extractUpstreamContextWindow({ id: "x", context_length: "unlimited" })).toBeUndefined();
  });
});

describe("extractOllamaContextWindow", () => {
  it("finds the arch-prefixed context_length key", () => {
    expect(
      extractOllamaContextWindow({
        model_info: { "qwen3.context_length": 40_960, "qwen3.embedding_length": 5120 },
      }),
    ).toBe(40_960);
  });

  it("ignores payloads without a context_length entry", () => {
    expect(extractOllamaContextWindow({ model_info: { "llama.embedding_length": 4096 } })).toBeUndefined();
    expect(extractOllamaContextWindow({})).toBeUndefined();
  });
});
