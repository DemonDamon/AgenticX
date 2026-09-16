import { resolveDatabaseConfig } from "@agenticx/iam-core";
import type { AuditActor, AuditStore } from "../types";
import { MysqlAuditStore, verifyGatewayAuditChain as verifyMysqlGatewayAuditChain } from "./mysql-store";
import { PgAuditStore, verifyGatewayAuditChain as verifyPgGatewayAuditChain } from "./pg-store";

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

/** Full-table chain verify for the configured dialect (PG and MySQL both persist gateway_audit_events). */
export async function verifyConfiguredAuditChain(actor: AuditActor, tenantId: string) {
  const config = resolveDatabaseConfig();
  switch (config.dialect) {
    case "postgresql":
      return verifyPgGatewayAuditChain(actor, tenantId);
    case "mysql":
      return verifyMysqlGatewayAuditChain(actor, tenantId);
    default: {
      const exhaustive: never = config;
      throw new Error(`Unsupported database config: ${JSON.stringify(exhaustive)}`);
    }
  }
}
