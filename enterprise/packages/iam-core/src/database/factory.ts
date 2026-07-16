import { resolveDatabaseConfig, type DatabaseConfig } from "./config";
import { createPgDb, createPgQueryExecutor, resetPgDatabaseForTests } from "./postgres";
import { createMysqlDb, createMysqlQueryExecutor, resetMysqlDatabaseForTests } from "./mysql";
import type { QueryExecutor, RepositoryRegistry } from "./types";

let registrySingleton: RepositoryRegistry | null = null;
let configSingleton: DatabaseConfig | null = null;

export async function createRepositoryRegistry(
  config: DatabaseConfig = resolveDatabaseConfig(),
): Promise<RepositoryRegistry> {
  switch (config.dialect) {
    case "postgresql": {
      const db = createPgDb(config);
      return {
        dialect: "postgresql",
        executor: createPgQueryExecutor(db),
      };
    }
    case "mysql": {
      const db = await createMysqlDb(config);
      return {
        dialect: "mysql",
        executor: createMysqlQueryExecutor(db),
      };
    }
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unsupported database config: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export async function getRepositoryRegistry(): Promise<RepositoryRegistry> {
  const config = resolveDatabaseConfig();
  if (
    !registrySingleton ||
    !configSingleton ||
    configSingleton.dialect !== config.dialect ||
    configSingleton.url !== config.url
  ) {
    registrySingleton = await createRepositoryRegistry(config);
    configSingleton = config;
  }
  return registrySingleton;
}

export function getQueryExecutorSync(): QueryExecutor {
  if (!registrySingleton) {
    throw new Error(
      "Repository registry not initialized. Call await getRepositoryRegistry() during startup.",
    );
  }
  return registrySingleton.executor;
}

export async function __resetDatabaseForTests(): Promise<void> {
  registrySingleton = null;
  configSingleton = null;
  resetPgDatabaseForTests();
  await resetMysqlDatabaseForTests();
}
