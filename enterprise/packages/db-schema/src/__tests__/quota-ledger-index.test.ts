import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableConfig as pgConfig } from "drizzle-orm/pg-core";
import { getTableConfig as mysqlConfig } from "drizzle-orm/mysql-core";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";
import { gatewayQuotaLedger as pgLedger } from "../schema/quota-pool";
import { gatewayQuotaLedger as mysqlLedger } from "../mysql-schema/quota-pool";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const indexName = "gateway_quota_ledger_request_idx";
const columns = ["tenant_id", "scope_type", "scope_id", "period", "request_id", "event"];
describe("quota receipt request lookup index", () => {
  it("defines the same request/event suffix in both schemas", () => {
    for (const table of [pgConfig(pgLedger), mysqlConfig(mysqlLedger)]) {
      const index = table.indexes.find((entry) => entry.config.name === indexName);
      expect(index).toBeDefined();
      expect(index?.config.columns.map((column) => "name" in column ? column.name : "expression")).toEqual(columns);
      expect(table.indexes.some((entry) => entry.config.name === "gateway_quota_ledger_scope_idx")).toBe(true);
    }
  });
  it.each([
    ["drizzle", "0076_gateway_quota_ledger_request_index", 75],
    ["drizzle-mysql", "0050_gateway_quota_ledger_request_index", 50],
  ] as const)("loads the incremental upgrade through the real %s journal reader", (folder, tag, idx) => {
    const directory = join(root, folder);
    const journal = JSON.parse(readFileSync(join(directory, "meta/_journal.json"), "utf8"));
    const entry = journal.entries.find((value: { tag: string }) => value.tag === tag);
    expect(entry.idx).toBe(idx);
    const previousIdentityTimestamp = folder === "drizzle" ? 1793868000000 : 1793868000001;
    expect(entry.when).toBeGreaterThan(previousIdentityTimestamp);
    for (let i = 1; i < journal.entries.length; i++) {
      expect(journal.entries[i].when).toBeGreaterThan(journal.entries[i - 1].when);
    }

    const loaded = readMigrationFiles({ migrationsFolder: directory });
    const migration = loaded.find((value) => value.folderMillis === entry.when);
    const sql = migration?.sql.join(" ").replace(/["`]/g, "");
    expect(sql).toContain(`CREATE INDEX ${folder === "drizzle" ? "IF NOT EXISTS " : ""}${indexName}`);
    expect(sql?.replace(/\s/g, "")).toContain(`(${columns.join(",")})`);
    expect(sql).not.toMatch(/DROP|DELETE|UPDATE|ALTER TABLE/i);
  });
});
