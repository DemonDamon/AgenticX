import { describe, expect, it } from "vitest";
import {
  assertCapabilityIds,
  normalizeAssignmentKeys,
} from "../db-stores/postgresql/capability-packs-store";

const ULID_A = "01JQMZ8K3N4P5Q6R7S8T9VWXYZ";
const ULID_B = "01JQMZ8K3N4P5Q6R7S8T9VWXY0";

describe("assertCapabilityIds", () => {
  it("keeps valid ids and drops duplicates", () => {
    expect(
      assertCapabilityIds([`mcp:${ULID_A}`, `skill:${ULID_B}`, `mcp:${ULID_A}`, "  "]),
    ).toEqual([`mcp:${ULID_A}`, `skill:${ULID_B}`]);
  });

  it("rejects a name-shaped id instead of silently dropping it", () => {
    // 静默丢弃会让管理员以为已经把这个能力加进包里了。
    expect(() => assertCapabilityIds(["mcp:market-data"])).toThrow(/invalid capability id/);
    expect(() => assertCapabilityIds(["market-data"])).toThrow(/invalid capability id/);
    expect(() => assertCapabilityIds([`other:${ULID_A}`])).toThrow(/invalid capability id/);
  });

  it("accepts an empty list", () => {
    expect(assertCapabilityIds([])).toEqual([]);
  });
});

describe("normalizeAssignmentKeys", () => {
  it("trims, dedupes and preserves the all/dept/user shapes", () => {
    expect(
      normalizeAssignmentKeys(["all", " dept:d1 ", "dept:d1", ULID_A, "", "   "]),
    ).toEqual(["all", "dept:d1", ULID_A]);
  });
});
