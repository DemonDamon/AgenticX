import { describe, expect, it } from "vitest";

import { orderSearchProvidersByRole } from "./provider-roles";

describe("orderSearchProvidersByRole", () => {
  it("puts the persisted primary provider before the fallback", () => {
    const providers = [
      { id: "provider-a", label: "A" },
      { id: "provider-b", label: "B" },
    ];

    expect(orderSearchProvidersByRole(providers, "provider-b")).toEqual([
      { id: "provider-b", label: "B" },
      { id: "provider-a", label: "A" },
    ]);
    expect(providers.map((provider) => provider.id)).toEqual(["provider-a", "provider-b"]);
  });

  it("keeps stable order when the primary is already first or unavailable", () => {
    const providers = [{ id: "provider-a" }, { id: "provider-b" }];

    expect(orderSearchProvidersByRole(providers, "provider-a")).toEqual(providers);
    expect(orderSearchProvidersByRole(providers, "missing")).toEqual(providers);
  });
});
