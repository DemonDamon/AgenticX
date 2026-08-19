import { describe, expect, it } from "vitest";
import type { ProviderEntry } from "../store";
import { applyGlobalDefaultModelChoice } from "./default-model-setting";

function provider(model: string, models: string[]): ProviderEntry {
  return {
    apiKey: "",
    baseUrl: "",
    model,
    models,
    enabled: true,
    dropParams: false,
  };
}

describe("applyGlobalDefaultModelChoice", () => {
  it("changes only the selected provider model without mutating the saved snapshot", () => {
    const saved = {
      alpha: provider("a-1", ["a-1", "a-2"]),
      beta: provider("b-1", ["b-1", "b-2"]),
    };

    const result = applyGlobalDefaultModelChoice(saved, "beta", "b-2");

    expect(result?.defaultProvider).toBe("beta");
    expect(result?.providers.beta.model).toBe("b-2");
    expect(result?.providers.alpha).toBe(saved.alpha);
    expect(saved.beta.model).toBe("b-1");
  });

  it("rejects providers or models outside the saved catalog", () => {
    const saved = { alpha: provider("a-1", ["a-1"]) };

    expect(applyGlobalDefaultModelChoice(saved, "missing", "a-1")).toBeNull();
    expect(applyGlobalDefaultModelChoice(saved, "alpha", "not-visible")).toBeNull();
    expect(applyGlobalDefaultModelChoice(saved, "", "a-1")).toBeNull();
  });

  it("accepts the persisted single-model fallback used by custom providers", () => {
    const saved = { custom: provider("custom-model", []) };

    const result = applyGlobalDefaultModelChoice(saved, "custom", "custom-model");

    expect(result?.defaultProvider).toBe("custom");
    expect(result?.providers.custom.model).toBe("custom-model");
  });
});
