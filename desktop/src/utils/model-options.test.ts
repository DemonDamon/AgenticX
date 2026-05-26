import { describe, expect, it } from "vitest";
import type { ProviderEntry } from "../store";
import {
  coerceSelectableModel,
  collectSelectableModelOptions,
  isModelInProviderCatalog,
  isModelSelectable,
  listProviderVisibleModelIds,
  normalizeProviderEntry,
  reconcilePaneModelsWithSettings,
} from "./model-options";

const TEST_PROVIDER_KEY = ["place", "holder"].join("");

const openaiGateway: ProviderEntry = {
  apiKey: TEST_PROVIDER_KEY,
  baseUrl: "http://47.251.106.113:3010/v1",
  model: "deepseek-r1",
  models: ["gpt-5-chat", "gpt-4.1"],
  enabled: true,
  dropParams: false,
};

const zhipu: ProviderEntry = {
  apiKey: TEST_PROVIDER_KEY,
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  model: "GLM-5",
  models: ["GLM-5", "GLM-5.1"],
  enabled: true,
  dropParams: false,
};

describe("model-options", () => {
  it("treats visible models[] as the catalog when non-empty", () => {
    expect(listProviderVisibleModelIds(openaiGateway)).toEqual(["gpt-5-chat", "gpt-4.1"]);
    expect(isModelInProviderCatalog("openai", "deepseek-r1", { openai: openaiGateway })).toBe(false);
    expect(isModelInProviderCatalog("openai", "gpt-4.1", { openai: openaiGateway })).toBe(true);
  });

  it("normalizes stale provider.model when models[] is authoritative", () => {
    expect(normalizeProviderEntry(openaiGateway).model).toBe("gpt-5-chat");
  });

  it("coerces stale pane selections to a visible fallback", () => {
    const providers = { openai: openaiGateway, zhipu };
    expect(coerceSelectableModel(providers, "openai", "deepseek-r1", "openai")).toEqual({
      provider: "openai",
      model: "gpt-5-chat",
    });
  });

  it("collects only selectable provider/model pairs", () => {
    const options = collectSelectableModelOptions({
      openai: openaiGateway,
      zhipu,
      disabled: { ...zhipu, enabled: false },
    });
    expect(options.map((row) => `${row.provider}:${row.model}`)).toEqual([
      "openai:gpt-5-chat",
      "openai:gpt-4.1",
      "zhipu:GLM-5",
      "zhipu:GLM-5.1",
    ]);
    expect(isModelSelectable("openai", "deepseek-r1", { openai: openaiGateway })).toBe(false);
  });

  it("reconciles all panes and active model state", () => {
    const providers = { openai: openaiGateway, zhipu };
    const result = reconcilePaneModelsWithSettings({
      panes: [
        { id: "pane-a", modelProvider: "openai", modelName: "deepseek-r1" },
        { id: "pane-b", modelProvider: "zhipu", modelName: "GLM-5.1" },
      ],
      activePaneId: "pane-a",
      activeProvider: "openai",
      activeModel: "deepseek-r1",
      providers,
    });
    expect(result.changedPaneIds).toEqual(["pane-a"]);
    expect(result.activeChanged).toBe(true);
    expect(result.activeProvider).toBe("openai");
    expect(result.activeModel).toBe("gpt-5-chat");
    expect(result.panes[0]).toMatchObject({ modelProvider: "openai", modelName: "gpt-5-chat" });
    expect(result.panes[1]).toMatchObject({ modelProvider: "zhipu", modelName: "GLM-5.1" });
  });
});
