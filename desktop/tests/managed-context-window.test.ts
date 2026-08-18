import { describe, expect, it } from "vitest";
import { resolveManagedContextWindow } from "../src/utils/managed-context-window";

const providers = {
  enterprise: {
    modelCatalog: [
      { id: "zhipu/glm-5.2", provider: "zhipu", providerLabel: "智谱", model: "glm-5.2", label: "GLM-5.2", contextWindow: 128_000 },
      { id: "zhipu/glm-5.1", provider: "zhipu", providerLabel: "智谱", model: "glm-5.1", label: "GLM-5.1" },
    ],
  },
  openai: { modelCatalog: undefined },
};

describe("resolveManagedContextWindow", () => {
  it("returns the admin-declared window for a managed model", () => {
    expect(resolveManagedContextWindow(providers, "enterprise", "zhipu/glm-5.2")).toBe(128_000);
  });

  it("returns undefined when the admin left it on auto", () => {
    // 未声明时不带该字段，由后端按模型名兜底，而不是在这里猜一个值。
    expect(resolveManagedContextWindow(providers, "enterprise", "zhipu/glm-5.1")).toBeUndefined();
  });

  it("returns undefined for self-configured providers and unknown models", () => {
    expect(resolveManagedContextWindow(providers, "openai", "gpt-4o")).toBeUndefined();
    expect(resolveManagedContextWindow(providers, "enterprise", "zhipu/not-in-catalog")).toBeUndefined();
    expect(resolveManagedContextWindow(providers, "missing-provider", "x")).toBeUndefined();
    expect(resolveManagedContextWindow(undefined, "enterprise", "zhipu/glm-5.2")).toBeUndefined();
    expect(resolveManagedContextWindow(providers, "enterprise", "")).toBeUndefined();
  });

  it("ignores unusable declared values", () => {
    const broken = {
      enterprise: {
        modelCatalog: [
          { id: "a/b", provider: "a", providerLabel: "A", model: "b", label: "B", contextWindow: 0 },
          { id: "c/d", provider: "c", providerLabel: "C", model: "d", label: "D", contextWindow: Number.NaN },
        ],
      },
    };
    expect(resolveManagedContextWindow(broken, "enterprise", "a/b")).toBeUndefined();
    expect(resolveManagedContextWindow(broken, "enterprise", "c/d")).toBeUndefined();
  });
});
