/**
 * Lists Enterprise schema capabilities for dialect compatibility tracking.
 * Run: pnpm -C enterprise db:compat:list
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, "../../packages/db-schema/src/schema");

const PG_ONLY = {
  jsonb: [] as string[],
  textArray: [] as string[],
  partialUnique: [] as string[],
  gin: [] as string[],
  identity: [] as string[],
  timestamptz: [] as string[],
};

const tables: string[] = [];

for (const file of readdirSync(schemaDir).filter((f) => f.endsWith(".ts") && f !== "index.ts")) {
  const content = readFileSync(join(schemaDir, file), "utf8");
  const tableMatches = [...content.matchAll(/export const (\w+)\s*=\s*pgTable\(/g)];
  for (const m of tableMatches) {
    tables.push(m[1]!);
  }
  if (/\bjsonb\b/.test(content)) PG_ONLY.jsonb.push(file);
  if (/text\([^)]*\)\.array\(|\.array\(\)/.test(content) || /text\(".*"\)\.array/.test(content)) {
    PG_ONLY.textArray.push(file);
  }
  if (/uniqueIndex\([^)]*\)\.on\([\s\S]*?\.where\(/.test(content) || /\.where\(sql`/.test(content)) {
    PG_ONLY.partialUnique.push(file);
  }
  if (/\.using\(["']gin["']\)|gin\(/i.test(content)) PG_ONLY.gin.push(file);
  if (/generatedAlwaysAsIdentity|GENERATED ALWAYS AS IDENTITY/i.test(content)) {
    PG_ONLY.identity.push(file);
  }
  if (/withTimezone:\s*true/.test(content)) PG_ONLY.timestamptz.push(file);
}

tables.sort();

const report = {
  tableCount: tables.length,
  tables,
  nonTableObjects: ["usage_records_daily_mv"],
  postgresqlOnlyCapabilities: {
    jsonb: [...new Set(PG_ONLY.jsonb)].sort(),
    textArray: [...new Set(PG_ONLY.textArray)].sort(),
    partialUnique: [...new Set(PG_ONLY.partialUnique)].sort(),
    gin: [...new Set(PG_ONLY.gin)].sort(),
    identity: [...new Set(PG_ONLY.identity)].sort(),
    timestamptz: [...new Set(PG_ONLY.timestamptz)].sort(),
    upsert: ["onConflictDoUpdate (Drizzle / PG)"],
    analyticFunctions: ["percentile_cont", "FILTER (WHERE …)", "date_trunc"],
  },
  expectedTableCount: 42,
};

console.log(JSON.stringify(report, null, 2));

if (report.tableCount !== 42) {
  console.error(`ERROR: expected 42 tables, found ${report.tableCount}`);
  process.exitCode = 1;
}
