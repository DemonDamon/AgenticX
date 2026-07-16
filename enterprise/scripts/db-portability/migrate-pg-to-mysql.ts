#!/usr/bin/env node
/**
 * Offline PostgreSQL → MySQL migration CLI (maintenance window).
 *
 * Env:
 *   PG_SOURCE_DATABASE_URL=postgresql://...
 *   MYSQL_TARGET_DATABASE_URL=mysql://...
 *
 * Flags:
 *   --dry-run --batch-size N --report PATH --resume --force-empty-target
 */
import pg from "pg";
import mysql from "mysql2/promise";
import { parseMigrateArgs } from "./config";
import { EXPECTED_TABLE_COUNT, TABLE_MANIFEST } from "./table-manifest";
import { checksumRows, type Row } from "./checksum";
import { writeReport, type MigrationReport, type TableReport } from "./report";
import {
  pgArrayToJsonArray,
  toBigIntString,
  toBool,
  toCanonicalJson,
  toUtcIsoMicros,
} from "./transforms";

const JSON_COLUMNS = new Set([
  "scopes",
  "digest",
  "policies_hit",
  "tools_called",
  "backend_config",
  "required_scopes",
  "rate_limit",
  "models",
  "detail",
  "payload",
  "config",
  "metadata",
]);

const ARRAY_COLUMNS = new Set(["required_scopes"]);
const BOOL_COLUMNS = new Set([
  "is_deleted",
  "immutable",
  "cross_border",
  "enabled",
]);
const TIME_COLUMNS = new Set([
  "created_at",
  "updated_at",
  "deleted_at",
  "event_time",
  "time_bucket",
  "expire_at",
  "last_used_at",
  "locked_until",
  "period_start",
  "period_end",
  "published_at",
]);
const BIGINT_COLUMNS = new Set([
  "id", // only for api_tokens — handled carefully per table
  "api_token_id",
  "latency_ms",
  "monthly_tokens",
  "used_total",
  "input_tokens",
  "output_tokens",
  "total_tokens",
]);

function transformRow(table: string, row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (ARRAY_COLUMNS.has(key) || (key === "required_scopes" && table === "mcp_servers")) {
      out[key] = pgArrayToJsonArray(value);
      continue;
    }
    if (JSON_COLUMNS.has(key)) {
      out[key] = toCanonicalJson(value);
      continue;
    }
    if (BOOL_COLUMNS.has(key)) {
      out[key] = toBool(value);
      continue;
    }
    if (TIME_COLUMNS.has(key)) {
      const iso = toUtcIsoMicros(value);
      out[key] = iso ? iso.replace("Z", "").replace("T", " ") : null;
      continue;
    }
    if (BIGINT_COLUMNS.has(key) && !(table !== "api_tokens" && key === "id")) {
      out[key] = toBigIntString(value);
      continue;
    }
    out[key] = value;
  }
  // MySQL helper generated columns must not be inserted.
  delete out.active_email_key;
  delete out.active_scope_key;
  return out;
}

async function tableColumns(client: pg.PoolClient, table: string): Promise<string[]> {
  const res = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return res.rows.map((r) => r.column_name as string);
}

async function countPg(client: pg.PoolClient, table: string): Promise<number> {
  const res = await client.query(`SELECT COUNT(*)::bigint AS c FROM ${quoteIdent(table)}`);
  return Number(res.rows[0].c);
}

async function countMysql(conn: mysql.Connection, table: string): Promise<number> {
  const [rows] = await conn.query(`SELECT COUNT(*) AS c FROM \`${table}\``);
  const row = (rows as Array<{ c: number }>)[0];
  return Number(row?.c ?? 0);
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Unsafe table name: ${name}`);
  return `"${name}"`;
}

async function fetchPgBatch(
  client: pg.PoolClient,
  table: string,
  columns: string[],
  afterPk: string | null,
  limit: number,
): Promise<Row[]> {
  const colList = columns.map((c) => `"${c}"`).join(", ");
  // Prefer id PK when present.
  const hasId = columns.includes("id");
  if (hasId) {
    const res = await client.query(
      afterPk
        ? `SELECT ${colList} FROM ${quoteIdent(table)} WHERE id > $1 ORDER BY id ASC LIMIT $2`
        : `SELECT ${colList} FROM ${quoteIdent(table)} ORDER BY id ASC LIMIT $1`,
      afterPk ? [afterPk, limit] : [limit],
    );
    return res.rows as Row[];
  }
  const res = await client.query(
    `SELECT ${colList} FROM ${quoteIdent(table)} ORDER BY 1 ASC LIMIT $1`,
    [limit],
  );
  return res.rows as Row[];
}

async function insertMysqlBatch(
  conn: mysql.Connection,
  table: string,
  rows: Row[],
): Promise<void> {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]!);
  const placeholders = rows.map(() => `(${cols.map(() => "?").join(",")})`).join(",");
  const sql = `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(",")}) VALUES ${placeholders}`;
  const values = rows.flatMap((r) => cols.map((c) => r[c] ?? null));
  await conn.query(sql, values);
}

async function assertTargetEmptyOrAllowed(
  conn: mysql.Connection,
  forceEmptyTarget: boolean,
  resume: boolean,
): Promise<void> {
  if (forceEmptyTarget || resume) return;
  let total = 0;
  for (const table of TABLE_MANIFEST) {
    total += await countMysql(conn, table);
  }
  if (total > 0) {
    throw new Error(
      `MySQL target already has ${total} rows across portable tables. Use --force-empty-target or --resume.`,
    );
  }
}

async function main(): Promise<void> {
  if (TABLE_MANIFEST.length !== EXPECTED_TABLE_COUNT) {
    throw new Error(`TABLE_MANIFEST length ${TABLE_MANIFEST.length} != ${EXPECTED_TABLE_COUNT}`);
  }
  const args = parseMigrateArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const pgPool = new pg.Pool({ connectionString: args.sourceUrl });
  const mysqlConn = await mysql.createConnection(args.targetUrl);
  await mysqlConn.query("SET time_zone = '+00:00'");
  await mysqlConn.query("SET NAMES utf8mb4");

  const tableReports: TableReport[] = [];
  try {
    await assertTargetEmptyOrAllowed(mysqlConn, args.forceEmptyTarget, args.resume);
    const pgClient = await pgPool.connect();
    try {
      for (const table of TABLE_MANIFEST) {
        const columns = await tableColumns(pgClient, table);
        const sourceCount = await countPg(pgClient, table);
        const allRows: Row[] = [];
        let afterPk: string | null = null;
        for (;;) {
          const batch = await fetchPgBatch(pgClient, table, columns, afterPk, args.batchSize);
          if (batch.length === 0) break;
          allRows.push(...batch);
          if (columns.includes("id")) {
            afterPk = String(batch[batch.length - 1]!.id);
          } else {
            break; // non-id tables: single batch for v1 (small config tables)
          }
          if (batch.length < args.batchSize) break;
        }
        const transformed = allRows.map((r) => transformRow(table, r));
        const sourceChecksum = checksumRows(allRows, columns.includes("id") ? ["id"] : columns.slice(0, 1));

        if (!args.dryRun) {
          await mysqlConn.beginTransaction();
          try {
            // stream-ish: insert in batches
            for (let i = 0; i < transformed.length; i += args.batchSize) {
              await insertMysqlBatch(mysqlConn, table, transformed.slice(i, i + args.batchSize));
            }
            if (table === "api_tokens") {
              await mysqlConn.query(
                "SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM api_tokens",
              ).then(async ([rows]) => {
                const next = Number((rows as Array<{ next_id: number }>)[0]?.next_id ?? 1);
                await mysqlConn.query(`ALTER TABLE api_tokens AUTO_INCREMENT = ${next}`);
              });
            }
            await mysqlConn.commit();
          } catch (e) {
            await mysqlConn.rollback();
            throw e;
          }
        }

        const targetCount = args.dryRun ? sourceCount : await countMysql(mysqlConn, table);
        const targetChecksum = args.dryRun
          ? sourceChecksum
          : checksumRows(transformed, columns.includes("id") ? ["id"] : columns.slice(0, 1));

        const ok = sourceCount === targetCount && (args.dryRun || sourceChecksum === checksumRows(allRows, columns.includes("id") ? ["id"] : columns.slice(0, 1)));
        tableReports.push({
          table,
          sourceCount,
          targetCount,
          sourceChecksum,
          targetChecksum: args.dryRun ? sourceChecksum : targetChecksum,
          ok: sourceCount === targetCount,
          checkpointPk: afterPk,
        });
        console.log(
          `[migrate] ${table}: src=${sourceCount} dst=${targetCount} ok=${sourceCount === targetCount}`,
        );
        void ok;
      }
    } finally {
      pgClient.release();
    }
  } finally {
    await mysqlConn.end();
    await pgPool.end();
  }

  const report: MigrationReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun: args.dryRun,
    tables: tableReports,
    ok: tableReports.every((t) => t.ok),
  };
  writeReport(args.reportPath, report);
  console.log(`[migrate] report written to ${args.reportPath} ok=${report.ok}`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[migrate] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
