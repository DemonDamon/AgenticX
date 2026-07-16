/**
 * IAM database entrypoint.
 *
 * Prefer `resolveDatabaseConfig` / `getRepositoryRegistry` for new code.
 * `getIamDb()` remains for PostgreSQL adapters during dual-dialect migration
 * and is deprecated for business/API layers after Phase 4.
 */
import { resolveDatabaseConfig } from "./database/config";
import {
  createPgDb,
  createPgPool,
  pgSchema,
  resetPgDatabaseForTests,
  type PgIamDb,
  type PgIamDbSchema,
} from "./database/postgres";

export type IamDbSchema = PgIamDbSchema;
/** @deprecated Prefer dialect-neutral RepositoryRegistry / QueryExecutor. */
export type IamDb = PgIamDb;

export { resolveDatabaseConfig } from "./database/config";
export type { DatabaseConfig, DatabaseDialect } from "./database/config";
export type { QueryExecutor, RepositoryRegistry } from "./database/types";
export {
  createRepositoryRegistry,
  getRepositoryRegistry,
  getQueryExecutorSync,
  __resetDatabaseForTests,
} from "./database/factory";
export { createMysqlDb, type MySqlIamDb } from "./database/mysql";

/** @deprecated Use createPgPool via database/postgres internally. */
export function getIamPool() {
  const config = resolveDatabaseConfig();
  if (config.dialect !== "postgresql") {
    throw new Error(
      `getIamPool() is PostgreSQL-only; current dialect=${config.dialect}. Use getRepositoryRegistry().`,
    );
  }
  return createPgPool(config.url);
}

/** @deprecated Prefer getRepositoryRegistry(); PostgreSQL adapter internal use only. */
export function getIamDb(): IamDb {
  const config = resolveDatabaseConfig();
  if (config.dialect !== "postgresql") {
    throw new Error(
      `getIamDb() is PostgreSQL-only; current dialect=${config.dialect}. Use getRepositoryRegistry().`,
    );
  }
  return createPgDb(config);
}

/** Test-only: release pools */
export function __resetIamDbForTests(): void {
  resetPgDatabaseForTests();
}

export { pgSchema as schema };
