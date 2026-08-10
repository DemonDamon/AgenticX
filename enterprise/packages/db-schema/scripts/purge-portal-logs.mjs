#!/usr/bin/env node
/**
 * Batch-delete portal_request_logs older than PORTAL_LOG_RETENTION_DAYS (default 14).
 * Usage: node ./scripts/purge-portal-logs.mjs [--dry-run]
 */
import { createPool as createMysqlPool } from "mysql2/promise";
import pg from "pg";
import { pgSeedClientOptions } from "./pg-seed-client-config.mjs";

const BATCH = 5000;
const SLEEP_MS = 50;

function resolveDialect() {
  const explicit = (process.env.DATABASE_DIALECT || "").trim().toLowerCase();
  const url = (process.env.DATABASE_URL || "").trim();
  if (explicit === "mysql" || explicit === "postgresql") return explicit;
  if (/^mysql:\/\//i.test(url)) return "mysql";
  if (/^postgres(ql)?:\/\//i.test(url)) return "postgresql";
  return "postgresql";
}

function retentionDays() {
  const raw = Number(process.env.PORTAL_LOG_RETENTION_DAYS ?? "14");
  if (!Number.isFinite(raw) || raw <= 0) return 14;
  return Math.floor(raw);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function purgePostgres(url, days, dryRun) {
  const client = new pg.Client(pgSeedClientOptions(url));
  await client.connect();
  try {
    const countRes = await client.query(
      `SELECT count(*)::int AS n FROM portal_request_logs WHERE log_time < now() - ($1::text || ' days')::interval`,
      [String(days)],
    );
    const toDelete = Number(countRes.rows[0]?.n ?? 0);
    console.log(`[purge-portal-logs] dialect=postgresql retention_days=${days} candidates=${toDelete}${dryRun ? " (dry-run)" : ""}`);
    if (dryRun || toDelete === 0) return toDelete;

    let deleted = 0;
    while (true) {
      const res = await client.query(
        `WITH doomed AS (
           SELECT id FROM portal_request_logs
           WHERE log_time < now() - ($1::text || ' days')::interval
           LIMIT $2
         )
         DELETE FROM portal_request_logs p
         USING doomed d
         WHERE p.id = d.id
         RETURNING p.id`,
        [String(days), BATCH],
      );
      const n = res.rowCount ?? 0;
      deleted += n;
      if (n === 0) break;
      await sleep(SLEEP_MS);
    }
    console.log(`[purge-portal-logs] deleted=${deleted}`);
    return deleted;
  } finally {
    await client.end();
  }
}

async function purgeMysql(url, days, dryRun) {
  const pool = createMysqlPool(url);
  try {
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS n FROM portal_request_logs WHERE log_time < (UTC_TIMESTAMP(6) - INTERVAL ? DAY)`,
      [days],
    );
    const toDelete = Number(countRows[0]?.n ?? 0);
    console.log(`[purge-portal-logs] dialect=mysql retention_days=${days} candidates=${toDelete}${dryRun ? " (dry-run)" : ""}`);
    if (dryRun || toDelete === 0) return toDelete;

    let deleted = 0;
    while (true) {
      const [result] = await pool.query(
        `DELETE FROM portal_request_logs
         WHERE log_time < (UTC_TIMESTAMP(6) - INTERVAL ? DAY)
         LIMIT ?`,
        [days, BATCH],
      );
      const n = Number(result?.affectedRows ?? 0);
      deleted += n;
      if (n === 0) break;
      await sleep(SLEEP_MS);
    }
    console.log(`[purge-portal-logs] deleted=${deleted}`);
    return deleted;
  } finally {
    await pool.end();
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const dialect = resolveDialect();
  const days = retentionDays();
  const url =
    (process.env.DATABASE_URL || "").trim() ||
    (dialect === "mysql"
      ? "mysql://root:root@127.0.0.1:3306/agenticx"
      : "postgresql://postgres:postgres@127.0.0.1:5432/agenticx");

  if (dialect === "mysql") {
    await purgeMysql(url, days, dryRun);
  } else {
    await purgePostgres(url, days, dryRun);
  }
}

main().catch((error) => {
  console.error("[purge-portal-logs] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
