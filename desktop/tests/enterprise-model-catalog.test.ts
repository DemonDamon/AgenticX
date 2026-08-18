import { describe, expect, it } from "vitest";
import { normalizeEnterpriseModelCatalog } from "../electron/enterprise-model-catalog";

describe("enterprise model catalog", () => {
  it("keeps provider metadata returned by bootstrap", () => {
    expect(
      normalizeEnterpriseModelCatalog([
        {
          id: "chinamobile/kimi/kimi-k3",
          provider: "chinamobile",
          providerLabel: "移动云",
          model: "kimi/kimi-k3",
          label: "Kimi K3",
          route: "private-cloud",
          isDefault: true,
          capabilities: ["chat", "reasoning"],
        },
      ]),
    ).toEqual([
      {
        id: "chinamobile/kimi/kimi-k3",
        provider: "chinamobile",
        providerLabel: "移动云",
        model: "kimi/kimi-k3",
        label: "Kimi K3",
        route: "private-cloud",
        isDefault: true,
        capabilities: ["chat", "reasoning"],
      },
    ]);
  });

  it("upgrades legacy string ids into provider groups without re-login", () => {
    expect(
      normalizeEnterpriseModelCatalog([
        "chinamobile/kimi/kimi-k3",
        "moma/Qwen/Qwen3.6-Plus",
        "Kimi/Kimi-K2.6",
      ]),
    ).toMatchObject([
      { provider: "chinamobile", providerLabel: "移动云", model: "kimi/kimi-k3" },
      { provider: "moma", providerLabel: "MOMA", model: "Qwen/Qwen3.6-Plus" },
      { provider: "Kimi", providerLabel: "月之暗面", model: "Kimi-K2.6" },
    ]);
  });

  it("drops malformed and duplicate catalog entries", () => {
    expect(
      normalizeEnterpriseModelCatalog([
        null,
        {},
        { id: "moma/model-a", provider: "moma" },
        { id: "moma/model-a", providerLabel: "duplicate" },
      ]),
    ).toHaveLength(1);
  });
});

describe("enterprise model catalog context window", () => {
  it("keeps the admin-declared window and accepts the snake_case wire name", () => {
    const [camel, snake] = normalizeEnterpriseModelCatalog([
      { id: "zhipu/glm-5.2", contextWindow: 128_000 },
      { id: "zhipu/glm-5.1", context_window: 200_000 },
    ]);
    expect(camel?.contextWindow).toBe(128_000);
    expect(snake?.contextWindow).toBe(200_000);
  });

  it("omits the field when unset or unusable, so the backend heuristic stays in charge", () => {
    const [none, zero, text] = normalizeEnterpriseModelCatalog([
      { id: "a/b" },
      { id: "c/d", contextWindow: 0 },
      { id: "e/f", contextWindow: "128000" },
    ]);
    expect(none).not.toHaveProperty("contextWindow");
    expect(zero).not.toHaveProperty("contextWindow");
    expect(text).not.toHaveProperty("contextWindow");
  });
});
