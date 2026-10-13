import { describe, expect, it } from "vitest";
import {
  formatCapabilityId,
  groupCapabilityIdsByKind,
  isCapabilityId,
  parseCapabilityId,
} from "../capability-id";

const ULID_A = "01JQMZ8K3N4P5Q6R7S8T9VWXYZ";
const ULID_B = "01JQMZ8K3N4P5Q6R7S8T9VWXY0";

describe("formatCapabilityId", () => {
  it("builds the prefixed form used everywhere else", () => {
    expect(formatCapabilityId("mcp", ULID_A)).toBe(`mcp:${ULID_A}`);
    expect(formatCapabilityId("skill", ULID_A)).toBe(`skill:${ULID_A}`);
  });

  it("uppercases a lowercase ULID rather than minting a second spelling", () => {
    expect(formatCapabilityId("mcp", ULID_A.toLowerCase())).toBe(`mcp:${ULID_A}`);
  });

  it("refuses anything that is not a ULID", () => {
    // 用 name/slug 当 id 正是这里要挡住的：改名会让所有引用指空。
    expect(() => formatCapabilityId("mcp", "market-data")).toThrow();
    expect(() => formatCapabilityId("mcp", "")).toThrow();
    expect(() => formatCapabilityId("nope" as "mcp", ULID_A)).toThrow();
  });

  it("accepts a legacy std-base32 mcp_servers id", () => {
    // 连接器网关曾用 RFC 4648 base32 写主键（含 I/L/O/U）。这已是行主键，不是可改的名字。
    const legacy = "JIAHGIWLGRVNU42IBEQ7HGYMP4";
    expect(formatCapabilityId("mcp", legacy.toLowerCase())).toBe(`mcp:${legacy}`);
    expect(parseCapabilityId(`mcp:${legacy}`)).toEqual({ kind: "mcp", rowId: legacy });
  });
});

describe("parseCapabilityId", () => {
  it("round-trips what formatCapabilityId produced", () => {
    expect(parseCapabilityId(formatCapabilityId("skill", ULID_B))).toEqual({
      kind: "skill",
      rowId: ULID_B,
    });
  });

  it("returns null for junk instead of inventing a capability", () => {
    for (const bad of ["", "mcp", "mcp:", ":ULID", "mcp:market-data", "other:" + ULID_A, "mcp/" + ULID_A]) {
      expect(parseCapabilityId(bad)).toBeNull();
      expect(isCapabilityId(bad)).toBe(false);
    }
  });
});

describe("groupCapabilityIdsByKind", () => {
  it("splits ids so each table is queried once, dropping unparseable entries", () => {
    expect(
      groupCapabilityIdsByKind([
        `mcp:${ULID_A}`,
        `skill:${ULID_B}`,
        `mcp:${ULID_A}`,
        "garbage",
      ]),
    ).toEqual({ mcp: [ULID_A], skill: [ULID_B], feature: [] });
  });

  it("returns every bucket even when empty", () => {
    expect(groupCapabilityIdsByKind([])).toEqual({ mcp: [], skill: [], feature: [] });
  });
});
