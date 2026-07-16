import { describe, expect, it } from "vitest";
import { parseMigrateArgs } from "../config";
import { EXPECTED_TABLE_COUNT, TABLE_MANIFEST } from "../table-manifest";
import { checksumRows } from "../checksum";
import {
  pgArrayToJsonArray,
  toBigIntString,
  toBool,
  toCanonicalJson,
  toUtcIsoMicros,
} from "../transforms";

describe("table manifest", () => {
  it("lists exactly 42 tables", () => {
    expect(TABLE_MANIFEST).toHaveLength(EXPECTED_TABLE_COUNT);
    expect(new Set(TABLE_MANIFEST).size).toBe(EXPECTED_TABLE_COUNT);
  });
});

describe("parseMigrateArgs", () => {
  it("requires source and target URLs", () => {
    expect(() => parseMigrateArgs([], {})).toThrow(/PG_SOURCE_DATABASE_URL/);
  });

  it("parses flags", () => {
    const args = parseMigrateArgs(["--dry-run", "--batch-size", "50", "--report", "/tmp/r.json"], {
      PG_SOURCE_DATABASE_URL: "postgresql://u:p@h/db",
      MYSQL_TARGET_DATABASE_URL: "mysql://u:p@h/db",
    });
    expect(args.dryRun).toBe(true);
    expect(args.batchSize).toBe(50);
    expect(args.reportPath).toBe("/tmp/r.json");
  });
});

describe("transforms", () => {
  it("canonicalizes JSON ignoring key order", () => {
    expect(toCanonicalJson({ b: 1, a: 2 })).toBe(toCanonicalJson({ a: 2, b: 1 }));
  });

  it("handles chinese + emoji in json", () => {
    const s = toCanonicalJson({ name: "张三🚀" });
    expect(s).toContain("张三");
    expect(s).toContain("🚀");
  });

  it("normalizes timestamps to UTC micros", () => {
    const a = toUtcIsoMicros("2026-03-08T01:30:00.123Z");
    const b = toUtcIsoMicros(new Date("2026-03-08T01:30:00.123Z"));
    expect(a).toBe(b);
    expect(a?.endsWith("Z")).toBe(true);
  });

  it("supports bigint beyond MAX_SAFE_INTEGER", () => {
    expect(toBigIntString("9007199254740993")).toBe("9007199254740993");
  });

  it("maps booleans explicitly", () => {
    expect(toBool(1)).toBe(true);
    expect(toBool(0)).toBe(false);
    expect(toBool("t")).toBe(true);
  });

  it("converts pg text[] literal", () => {
    expect(pgArrayToJsonArray("{a,b}")).toBe(JSON.stringify(["a", "b"]));
  });
});

describe("checksum", () => {
  it("is stable under row reordering", () => {
    const rows = [
      { id: "2", name: "b" },
      { id: "1", name: "a" },
    ];
    const rev = [
      { id: "1", name: "a" },
      { id: "2", name: "b" },
    ];
    expect(checksumRows(rows, ["id"])).toBe(checksumRows(rev, ["id"]));
  });

  it("redacts sensitive columns", () => {
    const a = checksumRows([{ id: "1", password_hash: "secret" }], ["id"]);
    const b = checksumRows([{ id: "1", password_hash: "other" }], ["id"]);
    expect(a).toBe(b);
  });
});
