#!/usr/bin/env node
/**
 * Dialect-aware seed: dispatches to PostgreSQL or MySQL seed script.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));

function resolveDialect() {
  const explicit = (process.env.DATABASE_DIALECT || "").trim().toLowerCase();
  const url = (process.env.DATABASE_URL || "").trim();
  if (explicit === "mysql" || explicit === "postgresql") return explicit;
  if (/^mysql:\/\//i.test(url)) return "mysql";
  return "postgresql";
}

const dialect = resolveDialect();
const script =
  dialect === "mysql"
    ? join(scriptsDir, "db-seed-mysql.mjs")
    : join(scriptsDir, "db-seed.mjs");

console.log(`[db:seed] dialect=${dialect} script=${script}`);
const result = spawnSync(process.execPath, [script], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
