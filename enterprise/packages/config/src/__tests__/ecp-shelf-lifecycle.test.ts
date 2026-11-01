import { describe, expect, it } from "vitest";

import {
  assertScanAllowsPublish,
  legacyCatalogStatusToShelf,
  shouldPushCatalogUpdateToTenant,
  ShelfPublishError,
  skillShelfAllowsBootstrap,
} from "../ecp-shelf-lifecycle";

describe("ecp-shelf-lifecycle", () => {
  it("draft skills are not bootstrap-eligible", () => {
    expect(skillShelfAllowsBootstrap("draft", "active")).toBe(false);
    expect(skillShelfAllowsBootstrap("published", "active")).toBe(true);
    expect(skillShelfAllowsBootstrap("published", "disabled")).toBe(false);
  });

  it("publish requires scan and rejects dangerous", () => {
    expect(() => assertScanAllowsPublish(null)).toThrow(ShelfPublishError);
    expect(() => assertScanAllowsPublish("dangerous")).toThrow(/dangerous/i);
    expect(() => assertScanAllowsPublish("safe")).not.toThrow();
    expect(() => assertScanAllowsPublish("caution")).not.toThrow();
  });

  it("catalog sync only when grant active and shelf published", () => {
    expect(shouldPushCatalogUpdateToTenant("granted", "published")).toBe(true);
    expect(shouldPushCatalogUpdateToTenant("granted", "draft")).toBe(false);
    expect(shouldPushCatalogUpdateToTenant("revoked", "published")).toBe(false);
  });

  it("maps legacy catalog active/disabled to shelf", () => {
    expect(legacyCatalogStatusToShelf("active")).toBe("published");
    expect(legacyCatalogStatusToShelf("disabled")).toBe("deprecated");
    expect(legacyCatalogStatusToShelf("unknown")).toBe("draft");
  });
});
