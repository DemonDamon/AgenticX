import * as mysqlSchema from "@agenticx/db-schema/mysql";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import type { DatabaseConfig } from "./config";
import type { QueryExecutor } from "./types";

/**
 * MySQL drizzle client — schema imported from @agenticx/db-schema/mysql once Phase 1 lands.
 * Soft-import mysql2 + drizzle-orm/mysql2 to keep package install-time optional until deps land.
 */

export type MySqlIamDbSchema = typeof mysqlSchema;
export type MySqlDrizzleDb = MySql2Database<MySqlIamDbSchema>;
export type MySqlIamDb = {
  dialect: "mysql";
  raw: MySqlDrizzleDb;
};

declare global {
  // eslint-disable-next-line no-var
  var __agenticxIamMysqlPool: import("mysql2/promise").Pool | undefined;
}

let mysqlDbSingleton: MySqlIamDb | null = null;

export async function createMysqlPool(url: string): Promise<import("mysql2/promise").Pool> {
  if (!globalThis.__agenticxIamMysqlPool) {
    const mysql = await import("mysql2/promise");
    // mysql2 accepts mysql:// URLs via uri option in recent versions; normalize to connection object.
    const parsed = new URL(url);
    globalThis.__agenticxIamMysqlPool = mysql.createPool({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, "") || undefined,
      waitForConnections: true,
      connectionLimit: 10,
      timezone: "Z",
      charset: "utf8mb4",
      dateStrings: false,
      enableKeepAlive: true,
    });
    // Force UTC session timezone on each connection.
    globalThis.__agenticxIamMysqlPool.on("connection", (conn) => {
      conn.query("SET time_zone = '+00:00'");
    });
  }
  return globalThis.__agenticxIamMysqlPool;
}

export async function createMysqlDb(
  config: Extract<DatabaseConfig, { dialect: "mysql" }>,
): Promise<MySqlIamDb> {
  if (!mysqlDbSingleton) {
    const pool = await createMysqlPool(config.url);
    mysqlDbSingleton = {
      dialect: "mysql",
      raw: drizzle(pool, { schema: mysqlSchema, mode: "default" }),
    };
  }
  return mysqlDbSingleton;
}

export function createMysqlQueryExecutor(db: MySqlIamDb): QueryExecutor {
  const drizzleDb = db.raw as {
    transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  return {
    dialect: "mysql",
    async transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
      return drizzleDb.transaction(async (txDb) => {
        const nested: QueryExecutor & { __mysqlDb?: unknown } = {
          dialect: "mysql",
          transaction: (inner) => Promise.resolve(inner(nested)),
        };
        nested.__mysqlDb = txDb;
        return fn(nested);
      });
    },
  };
}

export async function resetMysqlDatabaseForTests(): Promise<void> {
  mysqlDbSingleton = null;
  await globalThis.__agenticxIamMysqlPool?.end().catch(() => undefined);
  globalThis.__agenticxIamMysqlPool = undefined;
}

/** Internal: MySQL adapters may retrieve the underlying typed drizzle client. */
export function getMysqlDrizzle(db: MySqlIamDb | QueryExecutor): MySqlDrizzleDb {
  if ("raw" in db) return db.raw;
  if ("__mysqlDb" in db && (db as { __mysqlDb?: MySqlDrizzleDb }).__mysqlDb) {
    return (db as { __mysqlDb: MySqlDrizzleDb }).__mysqlDb;
  }
  throw new Error("MySQL drizzle client unavailable on QueryExecutor");
}
