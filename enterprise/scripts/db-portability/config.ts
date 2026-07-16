export type MigrateCliArgs = {
  dryRun: boolean;
  batchSize: number;
  reportPath: string;
  resume: boolean;
  forceEmptyTarget: boolean;
  sourceUrl: string;
  targetUrl: string;
};

export function parseMigrateArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): MigrateCliArgs {
  const dryRun = argv.includes("--dry-run");
  const resume = argv.includes("--resume");
  const forceEmptyTarget = argv.includes("--force-empty-target");
  let batchSize = 1000;
  let reportPath = ".runtime/db-migration-report.json";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--batch-size") {
      batchSize = Number(argv[++i]);
    } else if (a.startsWith("--batch-size=")) {
      batchSize = Number(a.split("=")[1]);
    } else if (a === "--report") {
      reportPath = argv[++i]!;
    } else if (a.startsWith("--report=")) {
      reportPath = a.slice("--report=".length);
    }
  }
  if (!Number.isFinite(batchSize) || batchSize < 1) {
    throw new Error(`Invalid --batch-size: ${batchSize}`);
  }
  const sourceUrl = (env.PG_SOURCE_DATABASE_URL || "").trim();
  const targetUrl = (env.MYSQL_TARGET_DATABASE_URL || "").trim();
  if (!sourceUrl) throw new Error("PG_SOURCE_DATABASE_URL is required");
  if (!targetUrl) throw new Error("MYSQL_TARGET_DATABASE_URL is required");
  if (!/^postgres(ql)?:\/\//i.test(sourceUrl)) {
    throw new Error("PG_SOURCE_DATABASE_URL must be a postgres(ql):// URL");
  }
  if (!/^mysql:\/\//i.test(targetUrl)) {
    throw new Error("MYSQL_TARGET_DATABASE_URL must be a mysql:// URL");
  }
  return { dryRun, batchSize, reportPath, resume, forceEmptyTarget, sourceUrl, targetUrl };
}
