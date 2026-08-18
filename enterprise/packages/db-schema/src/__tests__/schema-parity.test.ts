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

  it("mirrors all 56 PostgreSQL tables in MySQL", () => {
    expect(pgTables.size).toBe(56);
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
      "0002_desktop_device_auth.sql",
      "0003_enterprise_runtime_web_search.sql",
      "0004_web_search_max_results_default.sql",
      "0005_enterprise_runtime_deep_research.sql",
      "0006_deep_research_enabled_default_true.sql",
      "0007_enterprise_chat_artifacts.sql",
      "0008_chat_sessions_pinned_at.sql",
      "0009_user_password_change_required.sql",
      "0010_chat_history_operations.sql",
      "0011_enterprise_chat_attachments.sql",
      "0012_chat_share_snapshots.sql",
      "0013_enterprise_deep_research_runs.sql",
      "0014_chat_artifacts_content_mediumtext.sql",
      "0015_chat_messages_content_mediumtext.sql",
      "0016_web_search_provider_pool.sql",
      "0017_web_search_call_budget.sql",
      "0018_deep_research_provider_budget.sql",
      "0019_deep_research_run_coordination.sql",
      "0020_web_search_daily_provider_quota.sql",
      "0021_calculator_enabled.sql",
      "0022_gateway_audit_trace_id.sql",
      "0023_portal_request_logs.sql",
      "0024_deep_research_runs_trace_id.sql",
      "0025_portal_request_logs_mode.sql",
      "0026_portal_request_logs_session_idx.sql",
      "0027_enterprise_capability_packs.sql",
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
      expect.objectContaining({ idx: 2, tag: "0002_desktop_device_auth" }),
      expect.objectContaining({ idx: 3, tag: "0003_enterprise_runtime_web_search" }),
      expect.objectContaining({ idx: 4, tag: "0004_web_search_max_results_default" }),
      expect.objectContaining({ idx: 5, tag: "0005_enterprise_runtime_deep_research" }),
      expect.objectContaining({ idx: 6, tag: "0006_deep_research_enabled_default_true" }),
      expect.objectContaining({ idx: 7, tag: "0007_enterprise_chat_artifacts" }),
      expect.objectContaining({ idx: 8, tag: "0008_chat_sessions_pinned_at" }),
      expect.objectContaining({ idx: 9, tag: "0009_user_password_change_required" }),
      expect.objectContaining({ idx: 10, tag: "0010_chat_history_operations" }),
      expect.objectContaining({ idx: 11, tag: "0011_enterprise_chat_attachments" }),
      expect.objectContaining({ idx: 12, tag: "0012_chat_share_snapshots" }),
      expect.objectContaining({ idx: 13, tag: "0013_enterprise_deep_research_runs" }),
      expect.objectContaining({ idx: 14, tag: "0014_chat_artifacts_content_mediumtext" }),
      expect.objectContaining({ idx: 15, tag: "0015_chat_messages_content_mediumtext" }),
      expect.objectContaining({ idx: 16, tag: "0016_web_search_provider_pool" }),
      expect.objectContaining({ idx: 17, tag: "0017_web_search_call_budget" }),
      expect.objectContaining({ idx: 18, tag: "0018_deep_research_provider_budget" }),
      expect.objectContaining({ idx: 19, tag: "0019_deep_research_run_coordination" }),
      expect.objectContaining({ idx: 20, tag: "0020_web_search_daily_provider_quota" }),
      expect.objectContaining({ idx: 21, tag: "0021_calculator_enabled" }),
      expect.objectContaining({ idx: 22, tag: "0022_gateway_audit_trace_id" }),
      expect.objectContaining({ idx: 23, tag: "0023_portal_request_logs" }),
      expect.objectContaining({ idx: 24, tag: "0024_deep_research_runs_trace_id" }),
      expect.objectContaining({ idx: 25, tag: "0025_portal_request_logs_mode" }),
      expect.objectContaining({ idx: 26, tag: "0026_portal_request_logs_session_idx" }),
      expect.objectContaining({ idx: 27, tag: "0027_enterprise_capability_packs" }),
    ]);
    expect(readdirSync(migrationDir)).not.toContain("0016_mcp_hosting.sql");
    expect(readdirSync(migrationDir)).not.toContain(
      "0025_enterprise_runtime_mcp_servers.sql",
    );
  });
});
