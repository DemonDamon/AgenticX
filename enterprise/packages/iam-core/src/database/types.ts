import type { DatabaseDialect } from "./config";

/**
 * Dialect-neutral query executor surface.
 * Concrete Drizzle clients stay inside postgres.ts / mysql.ts adapters.
 */
export interface QueryExecutor {
  readonly dialect: DatabaseDialect;
  transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T>;
}

export type RepositoryRegistry = {
  readonly dialect: DatabaseDialect;
  readonly executor: QueryExecutor;
};
