import { describe, expect, it } from "vitest";
import {
  pricePerMillion,
  providerModelPricingKey,
  resolveProviderModelPricing,
  syncPricingToProviderCatalog,
  updateProviderModelPrice,
  type PricingConfig,
} from "../model-pricing";

const BASE: PricingConfig = {
  version: "v1",
  default: { input: 0.000001, output: 0.000002 },
  models: {
    shared: [{ input: 0.000003, output: 0.000004 }],
    stale: [{ input: 99, output: 99 }],
  },
  updatedAt: "2026-08-15T00:00:00.000Z",
};

describe("provider model pricing", () => {
  it("uses provider/model identity while retaining legacy model fallback", () => {
    expect(providerModelPricingKey("moonshot", "shared")).toBe("moonshot/shared");
    expect(pricePerMillion(resolveProviderModelPricing(BASE, "moonshot", "shared"), "input")).toBe(3);

    const changed = updateProviderModelPrice(BASE, "moonshot", "shared", "input", 8.5);
    expect(pricePerMillion(resolveProviderModelPricing(changed, "moonshot", "shared"), "input")).toBe(8.5);
    expect(pricePerMillion(resolveProviderModelPricing(changed, "other", "shared"), "input")).toBe(3);
  });

  it("syncs prices to real provider models and removes stale manual catalog rows", () => {
    const synced = syncPricingToProviderCatalog(BASE, [
      { id: "moonshot", models: [{ name: "shared" }, { name: "kimi-new" }] },
      { id: "private", models: [{ name: "shared" }] },
    ]);
    expect(Object.keys(synced.models)).toEqual(["moonshot/shared", "moonshot/kimi-new", "private/shared"]);
    expect(synced.models.stale).toBeUndefined();
    expect(synced.models["moonshot/kimi-new"]?.[0]?.inputPerM).toBe(1);
  });
});
