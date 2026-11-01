import { describe, expect, it } from "vitest";

import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";

function stringLeaves(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
    stringLeaves(item, prefix ? `${prefix}.${key}` : key),
  );
}

describe("ecp platformCatalog messages", () => {
  it("keeps en/zh platformCatalog key trees aligned", () => {
    const enKeys = stringLeaves(en.pages.admin.capabilityPacks.ecp.platformCatalog).sort();
    const zhKeys = stringLeaves(zh.pages.admin.capabilityPacks.ecp.platformCatalog).sort();
    expect(enKeys).toEqual(zhKeys);
    expect(enKeys).toContain("grant");
    expect(enKeys).toContain("revoke");
  });
});
