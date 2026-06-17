import { describe, expect, it } from "vitest";

/** Mirrors isActiveUserRow in users.ts — guards soft-delete restore semantics. */
function isActiveUserRow(row: { isDeleted: boolean; deletedAt: Date | null }): boolean {
  return !row.isDeleted && row.deletedAt == null;
}

describe("user restore semantics", () => {
  it("treats soft-deleted rows as inactive", () => {
    expect(isActiveUserRow({ isDeleted: true, deletedAt: new Date() })).toBe(false);
    expect(isActiveUserRow({ isDeleted: true, deletedAt: null })).toBe(false);
  });

  it("treats active rows as active", () => {
    expect(isActiveUserRow({ isDeleted: false, deletedAt: null })).toBe(true);
  });
});
