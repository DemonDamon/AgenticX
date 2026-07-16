import { resolveDatabaseConfig } from "@agenticx/iam-core";
import type { AuditStore } from "../types";
import { MysqlAuditStore } from "./mysql-store";
import { PgAuditStore } from "./pg-store";

export function createAuditStore(): AuditStore {
  const config = resolveDatabaseConfig();
  switch (config.dialect) {
    case "postgresql":
      return new PgAuditStore();
    case "mysql":
      return new MysqlAuditStore();
    default: {
      const exhaustive: never = config;
      throw new Error(`Unsupported database config: ${JSON.stringify(exhaustive)}`);
    }
  }
}
