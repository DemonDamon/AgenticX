import { describe, expect, it } from "vitest";
import { modelPrefillsThinkTag, modelTakesThinkingToggle } from "../model-reasoning";

describe("model reasoning families", () => {
  it("matches a prefilling family across separators and ignores a longer version", () => {
    const env = { AGENTICX_THINK_PREFILL_MODELS: "qwen3.8" };
    expect(modelPrefillsThinkTag("vendor/Qwen3.8-27b", env)).toBe(true);
    expect(modelPrefillsThinkTag("qwen3.81", env)).toBe(false);
    expect(modelTakesThinkingToggle("glm-5.2", { AGENTICX_THINKING_TOGGLE_MODELS: "glm5.2" })).toBe(true);
  });
});
