import { describe, expect, it } from "vitest";
import {
  MAX_MODEL_CONTEXT_WINDOW,
  MIN_MODEL_CONTEXT_WINDOW,
  modelContextWindowKey,
  sanitizeModelContextWindowOverrides,
} from "../electron/model-context-window-overrides";

describe("modelContextWindowKey", () => {
  it("builds the key from the provider and model actually used by the request", () => {
    expect(modelContextWindowKey("custom_openai_local", "glm-5.2")).toBe("custom_openai_local/glm-5.2");
    // 托管厂商下发的模型 id 本身带斜杠，键保持完整不做拆分。
    expect(modelContextWindowKey("enterprise", "zhipu/glm-5.2")).toBe("enterprise/zhipu/glm-5.2");
  });

  it("returns an empty key when either half is missing", () => {
    expect(modelContextWindowKey("", "glm-5.2")).toBe("");
    expect(modelContextWindowKey("openai", "  ")).toBe("");
  });
});

describe("sanitizeModelContextWindowOverrides", () => {
  it("keeps usable entries and coerces numeric strings", () => {
    expect(
      sanitizeModelContextWindowOverrides({
        "custom_openai_local/glm-5.2": 128_000,
        "ollama/qwen3:32b": "32768",
      }),
    ).toEqual({
      "custom_openai_local/glm-5.2": 128_000,
      "ollama/qwen3:32b": 32_768,
    });
  });

  it("drops values that would break a session rather than persisting them", () => {
    expect(
      sanitizeModelContextWindowOverrides({
        zero: 0,
        negative: -1,
        tooSmall: MIN_MODEL_CONTEXT_WINDOW - 1,
        tooBig: MAX_MODEL_CONTEXT_WINDOW + 1,
        notANumber: "abc",
        nested: { a: 1 },
        "  ": 128_000,
        ok: MIN_MODEL_CONTEXT_WINDOW,
      }),
    ).toEqual({ ok: MIN_MODEL_CONTEXT_WINDOW });
  });

  it("returns an empty map for non-object input", () => {
    for (const bad of [undefined, null, "x", 3, [1, 2]]) {
      expect(sanitizeModelContextWindowOverrides(bad)).toEqual({});
    }
  });
});
