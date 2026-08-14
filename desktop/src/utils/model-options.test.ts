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

  it("keeps complete enterprise managed model ids when switching", () => {
    const enterprise: ProviderEntry = {
      apiKey: TEST_PROVIDER_KEY,
      baseUrl: "https://portal.example.com/api/desktop/v1",
      model: "openai-main/gpt-4o",
      models: ["openai-main/gpt-4o", "chinamobile/kimi/kimi-k3"],
      enabled: true,
      dropParams: true,
      interface: "openai",
      managed: true,
    };
    const providers = { enterprise };

    expect(
      collectSelectableModelOptions(providers).map((row) => row.model),
    ).toEqual(["openai-main/gpt-4o", "chinamobile/kimi/kimi-k3"]);
    expect(
      coerceSelectableModel(
        providers,
        "enterprise",
        "chinamobile/kimi/kimi-k3",
        "enterprise",
      ),
    ).toEqual({
      provider: "enterprise",
      model: "chinamobile/kimi/kimi-k3",
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
