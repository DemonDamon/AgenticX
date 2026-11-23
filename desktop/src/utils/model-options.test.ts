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
  resolveSessionBindingModel,
  resolveSubAgentModelSelection,
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

  it("keeps an explicit default model when it is in models[]", () => {
    const entry = { ...zhipu, model: "GLM-5.1", models: ["GLM-5", "GLM-5.1"] };
    expect(normalizeProviderEntry(entry).model).toBe("GLM-5.1");
  });

  it("coerces stale pane selections to a visible fallback", () => {
    const providers = { openai: openaiGateway, zhipu };
    expect(coerceSelectableModel(providers, "openai", "deepseek-r1", "openai")).toEqual({
      provider: "openai",
      model: "gpt-5-chat",
    });
  });

  it("allows baseUrl-only custom gateways in the model picker", () => {
    const intranet: ProviderEntry = {
      apiKey: "",
      baseUrl: "http://192.168.32.151:6821/aibox/v1",
      model: "some-model",
      models: ["some-model"],
      enabled: true,
      dropParams: false,
      interface: "openai",
    };
    expect(isModelSelectable("custom_openai_intranet", "some-model", { custom_openai_intranet: intranet })).toBe(true);
    const options = collectSelectableModelOptions({ custom_openai_intranet: intranet });
    expect(options).toHaveLength(1);
    expect(options[0]?.model).toBe("some-model");
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

  it("prefers global default over inherited pane snapshot when session metadata is empty", () => {
    const gateway: ProviderEntry = {
      ...openaiGateway,
      model: "glm-5.2",
      models: ["glm-4.5-air", "glm-5.2"],
    };
    expect(
      resolveSessionBindingModel({
        providers: { custom_openai_glm: gateway },
        sessionModelKnown: true,
        paneProvider: "custom_openai_glm",
        paneModel: "glm-4.5-air",
        defaultProvider: "custom_openai_glm",
        defaultModel: "glm-5.2",
      }),
    ).toEqual({ provider: "custom_openai_glm", model: "glm-5.2" });
  });

  it("preserves a manual pane pick during lazy session creation", () => {
    const gateway: ProviderEntry = {
      ...openaiGateway,
      model: "glm-5.2",
      models: ["glm-4.5-air", "glm-5.2"],
    };
    expect(
      resolveSessionBindingModel({
        providers: { custom_openai_glm: gateway },
        sessionModelKnown: false,
        paneProvider: "custom_openai_glm",
        paneModel: "glm-4.5-air",
        defaultProvider: "custom_openai_glm",
        defaultModel: "glm-5.2",
      }),
    ).toEqual({ provider: "custom_openai_glm", model: "glm-4.5-air" });
  });

  it("keeps an explicit session model ahead of a changed global default", () => {
    const gateway: ProviderEntry = {
      ...openaiGateway,
      model: "glm-5.2",
      models: ["glm-4.5-air", "glm-5.2"],
    };
    expect(
      resolveSessionBindingModel({
        providers: { custom_openai_glm: gateway },
        sessionModelKnown: true,
        sessionProvider: "custom_openai_glm",
        sessionModel: "glm-4.5-air",
        defaultProvider: "custom_openai_glm",
        defaultModel: "glm-5.2",
      }),
    ).toEqual({ provider: "custom_openai_glm", model: "glm-4.5-air" });
  });
});

describe("resolveSubAgentModelSelection", () => {
  const caixun = {
    apiKey: "k",
    baseUrl: "https://example.com/v1",
    model: "glm-5.3-flash",
    models: ["glm-5.3-flash", "deepseek-v4.1-flash"],
    enabled: true,
    dropParams: false,
    displayName: "彩讯",
  };

  it("maps harness provider + bare model onto a selectable catalog pair", () => {
    const resolved = resolveSubAgentModelSelection(
      "claude-code",
      "glm-5.3-flash",
      { 彩讯: caixun },
    );
    expect(resolved.selectable).toBe(true);
    expect(resolved.provider).toBe("彩讯");
    expect(resolved.model).toBe("glm-5.3-flash");
    expect(resolved.label).toContain("glm-5.3-flash");
    expect(resolved.label).not.toBe("");
  });

  it("keeps an already-selectable catalog pair", () => {
    const resolved = resolveSubAgentModelSelection("彩讯", "deepseek-v4.1-flash", {
      彩讯: caixun,
    });
    expect(resolved.selectable).toBe(true);
    expect(resolved.provider).toBe("彩讯");
    expect(resolved.model).toBe("deepseek-v4.1-flash");
    expect(resolved.label).toContain("彩讯");
    expect(resolved.label).toContain("deepseek-v4.1-flash");
  });

  it("falls back to bare model text when catalog has no match", () => {
    const resolved = resolveSubAgentModelSelection("claude-code", "mystery-model", {
      彩讯: caixun,
    });
    expect(resolved.selectable).toBe(false);
    expect(resolved.model).toBe("mystery-model");
    expect(resolved.label).toBe("mystery-model");
  });

  it("returns empty model when nothing is set", () => {
    const resolved = resolveSubAgentModelSelection("claude-code", "", { 彩讯: caixun });
    expect(resolved.model).toBe("");
    expect(resolved.selectable).toBe(false);
  });
});
