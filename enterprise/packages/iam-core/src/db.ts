import {
  auditEvents,
  departments,
  gatewayAuditEvents,
  organizations,
  roles,
  ssoProviders,
  userRoles,
  users,
} from "@agenticx/db-schema";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const schema = { users, departments, organizations, roles, userRoles, ssoProviders, auditEvents, gatewayAuditEvents };

export type IamDbSchema = typeof schema;

/** Root DB 与 `transaction` 回调内的 client 同一类型，便于跨事务复用 repo 逻辑 */
export type IamDb = NodePgDatabase<IamDbSchema>;

declare global {
  var __agenticxIamPgPool: Pool | undefined;
}

function getDatabaseUrl(): string {
  const configured = process.env.DATABASE_URL?.trim();
  const raw =
    configured ||
    (process.env.NODE_ENV !== "production" ? "postgresql://postgres:postgres@127.0.0.1:5432/agenticx" : "");
  if (!raw) throw new Error("DATABASE_URL is not configured");
  if (/sslmode=/i.test(raw)) return raw;
  const joiner = raw.includes("?") ? "&" : "?";
  return `${raw}${joiner}sslmode=disable`;
}

export function getIamPool(): Pool {
  if (!globalThis.__agenticxIamPgPool) {
    globalThis.__agenticxIamPgPool = new Pool({ connectionString: getDatabaseUrl(), max: 10 });
  }
  return globalThis.__agenticxIamPgPool;
}

let dbSingleton: IamDb | null = null;

export function getIamDb(): IamDb {
  if (!dbSingleton) {
    dbSingleton = drizzle(getIamPool(), { schema });
  }
  return dbSingleton;
}

/** Test-only: release pool */
export function __resetIamDbForTests(): void {
  dbSingleton = null;
  void globalThis.__agenticxIamPgPool?.end().catch(() => undefined);
  globalThis.__agenticxIamPgPool = undefined;
}
