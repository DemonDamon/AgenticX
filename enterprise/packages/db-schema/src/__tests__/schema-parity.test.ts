import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as mysqlSchema from "../mysql-schema";
import * as postgresSchema from "../schema";

type LogicalColumn = {
  name: string;
  notNull: boolean;
  type: string;
};

type LogicalTable = {
  name: string;
  columns: Map<string, LogicalColumn>;
};

const MYSQL_HELPER_COLUMNS = new Set(["active_email_key", "active_scope_key"]);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function logicalType(column: { dataType: string; columnType: string }): string {
  // Normalize dialect physical differences into logical types.
  if (column.dataType === "date") return "datetime";
  if (column.dataType === "boolean") return "boolean";
  if (column.dataType === "json") return "json";
  if (column.dataType === "array") return "json"; // PG text[] ↔ MySQL json
  return column.dataType;
}

function collectTables(schema: Record<string, unknown>): Map<string, LogicalTable> {
  const tables = new Map<string, LogicalTable>();
  for (const value of Object.values(schema)) {
    if (!is(value, Table)) continue;
    const name = getTableName(value);
    const columns = new Map(
      Object.values(getTableColumns(value)).map((column) => [
        column.name,
        {
          name: column.name,
          notNull: column.notNull,
          type: logicalType(column),
        },
      ]),
    );
    tables.set(name, { name, columns });
  }
  return tables;
}

describe("postgresql/mysql schema parity", () => {
  const pgTables = collectTables(postgresSchema);
  const mysqlTables = collectTables(mysqlSchema);

  it("mirrors all 42 PostgreSQL tables in MySQL", () => {
    expect(pgTables.size).toBe(42);
    expect([...mysqlTables.keys()].sort()).toEqual([...pgTables.keys()].sort());
  });

  it("keeps logical columns, nullability, and data types aligned", () => {
    const failures: string[] = [];
    for (const [tableName, pgTable] of pgTables) {
      const mysqlTable = mysqlTables.get(tableName);
      if (!mysqlTable) {
        failures.push(`${tableName}: missing MySQL table`);
        continue;
      }

      const mysqlColumns = new Map(
        [...mysqlTable.columns].filter(([name]) => !MYSQL_HELPER_COLUMNS.has(name)),
      );
      if ([...pgTable.columns.keys()].sort().join(",") !== [...mysqlColumns.keys()].sort().join(",")) {
        failures.push(`${tableName}: column names differ`);
        continue;
      }

      for (const [columnName, pgColumn] of pgTable.columns) {
        const mysqlColumn = mysqlColumns.get(columnName);
        if (!mysqlColumn) continue;
        if (pgColumn.notNull !== mysqlColumn.notNull) {
          failures.push(`${tableName}.${columnName}: nullability differs`);
        }
        if (pgColumn.type !== mysqlColumn.type) {
          failures.push(
            `${tableName}.${columnName}: logical type differs (${pgColumn.type} vs ${mysqlColumn.type})`,
          );
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

describe("mysql baseline migration inventory", () => {
  const migrationDir = join(packageRoot, "drizzle-mysql");
  const baselinePath = join(migrationDir, "0000_mysql_baseline.sql");

  it("contains the baseline plus incremental migrations", () => {
    const sqlFiles = readdirSync(migrationDir).filter((name) => name.endsWith(".sql"));
    expect(sqlFiles.sort()).toEqual([
      "0000_mysql_baseline.sql",
      "0001_audit_checksum_payload.sql",
    ]);

    const sql = readFileSync(baselinePath, "utf8");
    expect(sql.match(/CREATE TABLE `/g)).toHaveLength(42);
    expect(sql).toContain("CREATE OR REPLACE VIEW `usage_records_daily_mv`");
    expect(sql).not.toMatch(/MATERIALIZED\s+VIEW/i);
  });

  it("tracks MySQL migrations and excludes PostgreSQL orphan migrations", () => {
    const journal = JSON.parse(
      readFileSync(join(migrationDir, "meta/_journal.json"), "utf8"),
    ) as {
      dialect: string;
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.dialect).toBe("mysql");
    expect(journal.entries).toEqual([
      expect.objectContaining({ idx: 0, tag: "0000_mysql_baseline" }),
      expect.objectContaining({ idx: 1, tag: "0001_audit_checksum_payload" }),
    ]);
    expect(readdirSync(migrationDir)).not.toContain("0016_mcp_hosting.sql");
    expect(readdirSync(migrationDir)).not.toContain(
      "0025_enterprise_runtime_mcp_servers.sql",
    );
  });
});
