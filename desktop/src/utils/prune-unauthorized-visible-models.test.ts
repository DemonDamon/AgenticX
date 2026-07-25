import { describe, expect, it, vi } from "vitest";
import {
  scanAndPruneUnauthorizedVisibleModels,
  stripUnauthorizedModelsFromEntry,
} from "./prune-unauthorized-visible-models";
import type { ProviderCatalogEntry } from "./model-options";

function entry(partial: Partial<ProviderCatalogEntry>): ProviderCatalogEntry {
  return {
    apiKey: "k",
    baseUrl: "https://example.com/v1",
    model: "",
    models: [],
    enabled: true,
    dropParams: false,
    ...partial,
  };
}

describe("stripUnauthorizedModelsFromEntry", () => {
  it("removes unauthorized ids and realigns default model", () => {
    const { entry: next, removed } = stripUnauthorizedModelsFromEntry(
      entry({
        model: "ZHIPU/GLM-5.2",
        models: ["ZHIPU/GLM-5.2", "minimax/MiniMax-M3", "Kimi/Kimi-K2.6"],
      }),
      ["ZHIPU/GLM-5.2", "Kimi/Kimi-K2.6"],
    );
    expect(removed).toEqual(["ZHIPU/GLM-5.2", "Kimi/Kimi-K2.6"]);
    expect(next.models).toEqual(["minimax/MiniMax-M3"]);
    expect(next.model).toBe("minimax/MiniMax-M3");
  });

  it("returns unchanged when nothing to remove", () => {
    const src = entry({ model: "a", models: ["a", "b"] });
    const { entry: next, removed } = stripUnauthorizedModelsFromEntry(src, ["z"]);
    expect(removed).toEqual([]);
    expect(next.models).toEqual(["a", "b"]);
    expect(next.model).toBe("a");
  });
});

describe("scanAndPruneUnauthorizedVisibleModels", () => {
  it("strips only unauthorized probe failures and persists other models", async () => {
    const healthCheck = vi.fn(async ({ model }: { model: string }) => {
      if (model === "ZHIPU/GLM-5.2" || model === "Kimi/Kimi-K2.6") {
        return { ok: false, reason: "unauthorized" as const };
      }
      if (model === "flaky") {
        return { ok: false, reason: "error" as const };
      }
      return { ok: true };
    });

    const result = await scanAndPruneUnauthorizedVisibleModels({
      providers: {
        custom_openai_moma: entry({
          model: "ZHIPU/GLM-5.2",
          models: ["ZHIPU/GLM-5.2", "minimax/MiniMax-M3", "Kimi/Kimi-K2.6", "flaky"],
        }),
        plain: entry({ apiKey: "", baseUrl: "", models: ["should-skip"] }),
      },
      healthCheck,
    });

    expect(result.removed).toEqual([
      { provider: "custom_openai_moma", model: "ZHIPU/GLM-5.2" },
      { provider: "custom_openai_moma", model: "Kimi/Kimi-K2.6" },
    ]);
    expect(result.changedProviderIds).toEqual(["custom_openai_moma"]);
    expect(result.providers.custom_openai_moma.models).toEqual([
      "minimax/MiniMax-M3",
      "flaky",
    ]);
    expect(result.providers.custom_openai_moma.model).toBe("minimax/MiniMax-M3");
    expect(result.providers.plain.models).toEqual(["should-skip"]);
    expect(healthCheck).toHaveBeenCalledTimes(4);
  });

  it("skips disabled providers", async () => {
    const healthCheck = vi.fn(async () => ({ ok: false, reason: "unauthorized" as const }));
    const result = await scanAndPruneUnauthorizedVisibleModels({
      providers: {
        off: entry({ enabled: false, models: ["x"] }),
      },
      healthCheck,
    });
    expect(healthCheck).not.toHaveBeenCalled();
    expect(result.removed).toEqual([]);
  });
});
