#!/usr/bin/env node
/**
 * Dialect-aware migrate entry: selects drizzle PG or MySQL config from DATABASE_DIALECT / URL.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function resolveDialect() {
  const explicit = (process.env.DATABASE_DIALECT || "").trim().toLowerCase();
  const url = (process.env.DATABASE_URL || "").trim();
  if (explicit === "mysql" || explicit === "postgresql") return explicit;
  if (/^mysql:\/\//i.test(url)) return "mysql";
  if (/^postgres(ql)?:\/\//i.test(url)) return "postgresql";
  return "postgresql";
}

const dialect = resolveDialect();
const config =
  dialect === "mysql" ? "drizzle.mysql.config.ts" : "drizzle.pg.config.ts";

console.log(`[db:migrate] dialect=${dialect} config=${config}`);

const result = spawnSync(
  "pnpm",
  ["exec", "drizzle-kit", "migrate", "--config", config],
  { cwd: root, stdio: "inherit", env: process.env },
);

process.exit(result.status ?? 1);
