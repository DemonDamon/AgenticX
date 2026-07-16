import { resolveDatabaseConfig } from "@agenticx/iam-core";
import { MysqlPolicyStore } from "./mysql-store";
import { PgPolicyStore } from "./pg-store";

export type PolicyStore = PgPolicyStore | MysqlPolicyStore;

export function createPolicyStore(): PolicyStore {
  const config = resolveDatabaseConfig();
  switch (config.dialect) {
    case "postgresql":
      return new PgPolicyStore();
    case "mysql":
      return new MysqlPolicyStore();
    default: {
      const exhaustive: never = config;
      throw new Error(`Unsupported database config: ${JSON.stringify(exhaustive)}`);
    }
  }
}
