import { describe, expect, it } from "vitest";

import {
  assertScanAllowsPublish,
  shouldPushCatalogUpdateToTenant,
  skillShelfAllowsBootstrap,
  ShelfPublishError,
} from "@agenticx/config";

describe("ECP E2 shelf lifecycle acceptance (synthetic)", () => {
  it("draft tenant skill is excluded from bootstrap eligibility", () => {
    expect(skillShelfAllowsBootstrap("draft", "active")).toBe(false);
    expect(skillShelfAllowsBootstrap("published", "active")).toBe(true);
  });

  it("publish gate blocks dangerous and unscanned catalog versions", () => {
    expect(() => assertScanAllowsPublish("dangerous")).toThrow(ShelfPublishError);
    expect(() => assertScanAllowsPublish(null)).toThrow(/scan/i);
    expect(() => assertScanAllowsPublish("safe")).not.toThrow();
  });

  it("draft catalog edits do not push to granted tenants", () => {
    expect(shouldPushCatalogUpdateToTenant("granted", "draft")).toBe(false);
    expect(shouldPushCatalogUpdateToTenant("granted", "published")).toBe(true);
  });
});
