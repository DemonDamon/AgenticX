import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ZHIPU_DOCUMENTED_VLM_MODELS,
  fetchUpstreamModels,
  isZhipuLike,
  mergeProviderCatalogExtras,
} from "./fetch-upstream-models";

describe("fetch-upstream-models catalog merge", () => {
  it("detects zhipu provider and bigmodel base URL", () => {
    expect(isZhipuLike("zhipu", "https://open.bigmodel.cn/api/paas/v4")).toBe(true);
    expect(isZhipuLike("custom", "https://open.bigmodel.cn/api/paas/v4")).toBe(true);
    expect(isZhipuLike("openai", "https://api.openai.com/v1")).toBe(false);
  });

  it("merges documented VLM SKUs when /models only returns text chat models", () => {
    const apiOnlyText = [
      "glm-4.6",
      "glm-4.7",
      "glm-5",
      "glm-5-turbo",
      "glm-5.1",
      "glm-5.2",
    ];
    const merged = mergeProviderCatalogExtras("zhipu", "https://open.bigmodel.cn/api/paas/v4", apiOnlyText);
    expect(merged).toEqual(expect.arrayContaining([...apiOnlyText, ...ZHIPU_DOCUMENTED_VLM_MODELS]));
    expect(merged).toContain("glm-4.6v");
    expect(merged.length).toBe(apiOnlyText.length + ZHIPU_DOCUMENTED_VLM_MODELS.length);
  });
});

describe("fetch-upstream-models context window detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("picks up max_model_len from a vLLM /models response", async () => {
    // 自部署 vLLM 的 --max-model-len 由显存决定，往往远低于模型架构支持的窗口，
    // 这是管理员最容易填错、也最该由上游直接回报的值。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "Qwen/Qwen3-32B", max_model_len: 32_768 },
              { id: "glm-5.2", max_model_len: 131_072 },
              { id: "no-window-reported" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const result = await fetchUpstreamModels({
      providerId: "custom_openai_local",
      apiKey: "sk-test",
      baseUrl: "http://127.0.0.1:8000/v1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models).toContain("Qwen/Qwen3-32B");
    expect(result.contextWindows).toEqual({
      "Qwen/Qwen3-32B": 32_768,
      "glm-5.2": 131_072,
    });
    // 上游没报窗口的模型不进表，留给运行时按模型名兜底。
    expect(result.contextWindows["no-window-reported"]).toBeUndefined();
  });

  it("still succeeds when the gateway reports no window at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ id: "gpt-4o" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const result = await fetchUpstreamModels({
      providerId: "openai",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models).toEqual(["gpt-4o"]);
    expect(result.contextWindows).toEqual({});
  });
});
