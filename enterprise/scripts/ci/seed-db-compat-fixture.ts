/**
 * Minimal fixture seeder for CI dialect matrix.
 * Relies on db:seed having already created the default tenant/admin.
 */
async function main() {
  const dialect = (process.env.DATABASE_DIALECT || "").trim();
  const url = (process.env.DATABASE_URL || "").trim();
  if (!dialect || !url) {
    throw new Error("DATABASE_DIALECT and DATABASE_URL required");
  }
  console.log(`[seed-db-compat-fixture] dialect=${dialect} ok (uses existing migrate/seed)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
