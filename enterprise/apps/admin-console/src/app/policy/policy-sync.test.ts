import { describe, expect, it } from "vitest";
import { matchesPublishedSnapshot } from "./policy-sync";

describe("matchesPublishedSnapshot", () => {
  const published = { id: "publish-7", version: 7 };

  it("matches only the exact publish id and version", () => {
    expect(matchesPublishedSnapshot(published, { publishId: "publish-7", version: 7 })).toBe(true);
  });

  it("rejects a stale version even when publish id matches", () => {
    expect(matchesPublishedSnapshot(published, { publishId: "publish-7", version: 6 })).toBe(false);
  });

  it("rejects a different publish id even when version matches", () => {
    expect(matchesPublishedSnapshot(published, { publishId: "publish-6", version: 7 })).toBe(false);
  });

  it("rejects missing publish or gateway tenant metadata", () => {
    expect(matchesPublishedSnapshot(null, { publishId: "publish-7", version: 7 })).toBe(false);
    expect(matchesPublishedSnapshot(published, null)).toBe(false);
  });
});
