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
  it("journal has exactly 48 entries and must not be renumbered", () => {
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      dialect: string;
      entries: Array<{ tag: string; idx: number }>;
    };
    expect(journal.dialect).toBe("postgresql");
    expect(journal.entries).toHaveLength(48);
    expect(journal.entries.map((e) => e.idx)).toEqual([...Array(48).keys()]);
    expect(journal.entries.slice(-3).map((e) => e.tag)).toEqual([
      "0046_enterprise_capability_packs",
      "0047_enterprise_user_groups",
      "0048_enterprise_user_opt_outs",
    ]);
  });

  it("disk has 50 SQL files including two known orphans", () => {
    const sqlFiles = readdirSync(drizzleDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(sqlFiles).toHaveLength(50);

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

  it("never creates transitional capability tables", () => {
    const forbidden = [
      "enterprise_capability_opt_outs",
      "enterprise_feature_assignments",
    ];
    const sqlDirs = [drizzleDir, join(root, "drizzle-mysql")];
    const hits: string[] = [];
    for (const dir of sqlDirs) {
      for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
        const body = readFileSync(join(dir, name), "utf8");
        for (const table of forbidden) {
          if (body.includes(table)) hits.push(`${name}: ${table}`);
        }
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("creates enterprise_skills scan columns in the first capability migration", () => {
    const pg = readFileSync(join(drizzleDir, "0046_enterprise_capability_packs.sql"), "utf8");
    const mysql = readFileSync(
      join(root, "drizzle-mysql", "0020_enterprise_capability_packs.sql"),
      "utf8",
    );
    for (const sql of [pg, mysql]) {
      expect(sql).toContain("scan_verdict");
      expect(sql).toContain("scan_findings");
      expect(sql).not.toMatch(/\bALTER TABLE\b/i);
    }
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
