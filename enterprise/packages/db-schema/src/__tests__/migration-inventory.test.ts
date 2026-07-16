import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const drizzleDir = join(root, "drizzle");
const journalPath = join(drizzleDir, "meta/_journal.json");

const KNOWN_ORPHANS = [
  "0016_mcp_hosting.sql",
  "0025_enterprise_runtime_mcp_servers.sql",
] as const;

describe("postgresql migration inventory", () => {
  it("journal has exactly 28 entries and must not be renumbered", () => {
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      dialect: string;
      entries: Array<{ tag: string; idx: number }>;
    };
    expect(journal.dialect).toBe("postgresql");
    expect(journal.entries).toHaveLength(28);
    expect(journal.entries.map((e) => e.idx)).toEqual([...Array(28).keys()]);
  });

  it("disk has 30 SQL files including two known orphans", () => {
    const sqlFiles = readdirSync(drizzleDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(sqlFiles).toHaveLength(30);

    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const journalTags = new Set(journal.entries.map((e) => `${e.tag}.sql`));

    for (const orphan of KNOWN_ORPHANS) {
      expect(sqlFiles).toContain(orphan);
      expect(journalTags.has(orphan)).toBe(false);
    }

    const untracked = sqlFiles.filter((f) => !journalTags.has(f));
    expect(untracked.sort()).toEqual([...KNOWN_ORPHANS].sort());
  });

  it("forbids porting orphan SQL files into MySQL migration chain", () => {
    // Contract for Phase 1+: MySQL baseline must not include these filenames.
    const forbidden: readonly string[] = [...KNOWN_ORPHANS];
    expect(forbidden).toContain("0016_mcp_hosting.sql");
    expect(forbidden).toContain("0025_enterprise_runtime_mcp_servers.sql");
    expect(forbidden).not.toContain("0027_mcp_hosting.sql");
    expect(forbidden).not.toContain("0028_enterprise_runtime_mcp_servers.sql");
  });
});
