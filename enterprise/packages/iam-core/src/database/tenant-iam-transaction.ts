import { AsyncLocalStorage } from "node:async_hooks";
import { eq, sql } from "drizzle-orm";
import { tenants as pgTenants } from "@agenticx/db-schema/postgres";
import { tenants as mysqlTenants } from "@agenticx/db-schema/mysql";
import * as mysqlSchema from "@agenticx/db-schema/mysql";
import { drizzle } from "drizzle-orm/mysql2";
import { resolveDatabaseConfig } from "./config";
import { createPgDb, type PgIamDb } from "./postgres";
import { createMysqlPool, type MySqlDrizzleDb } from "./mysql";

type TransactionContext = {
  tenantId: string;
  dialect: "postgresql" | "mysql";
  db: PgIamDb | MySqlDrizzleDb;
  active: boolean;
};
const transactions = new AsyncLocalStorage<TransactionContext>();

export function getTenantIamTransaction(dialect: "postgresql" | "mysql"): PgIamDb | MySqlDrizzleDb | null {
  const context = transactions.getStore();
  if (!context) return null;
  if (!context.active || context.dialect !== dialect) throw new Error("Invalid IAM transaction context.");
  return context.db;
}

/** Serialize tenant identity mutations; all repositories in the callback share one connection. */
export async function withTenantIamTransaction<T>(tenantId: string, callback: () => Promise<T>): Promise<T> {
  if (!tenantId.trim()) throw new Error("IAM tenant is required.");
  const current = transactions.getStore();
  if (current) {
    if (!current.active || current.tenantId !== tenantId) throw new Error("Invalid IAM transaction context.");
    return callback();
  }
  const config = resolveDatabaseConfig();
  const run = async (dialect: TransactionContext["dialect"], db: TransactionContext["db"]) => {
    const context = { tenantId, dialect, db, active: true };
    try { return await transactions.run(context, callback); }
    finally { context.active = false; }
  };
  if (config.dialect === "postgresql") {
    return createPgDb(config).transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      const rows = await tx.select({ id: pgTenants.id }).from(pgTenants).where(eq(pgTenants.id, tenantId)).for("update");
      if (rows.length !== 1) throw new Error("IAM tenant not found.");
      return run("postgresql", tx as unknown as PgIamDb);
    });
  }
  // A dedicated pooled connection permits safe restoration of the session timeout.
  const connection = await (await createMysqlPool(config.url)).getConnection();
  let previousTimeout: number | null = null;
  let destroy = false;
  try {
    const [rows] = await connection.query<import("mysql2").RowDataPacket[]>("SELECT @@SESSION.innodb_lock_wait_timeout AS seconds");
    const value = Number(rows[0]?.seconds);
    if (!Number.isSafeInteger(value) || value < 1 || value > 1073741824) throw new Error("Invalid IAM lock timeout.");
    destroy = true;
    await connection.query("SET SESSION innodb_lock_wait_timeout = 5");
    previousTimeout = value;
    destroy = false;
    const db = drizzle(connection, { schema: mysqlSchema, mode: "default" });
    return await db.transaction(async (tx) => {
      const tenants = await tx.select({ id: mysqlTenants.id }).from(mysqlTenants).where(eq(mysqlTenants.id, tenantId)).for("update");
      if (tenants.length !== 1) throw new Error("IAM tenant not found.");
      return run("mysql", tx as unknown as MySqlDrizzleDb);
    });
  } finally {
    if (previousTimeout !== null) {
      try { await connection.query("SET SESSION innodb_lock_wait_timeout = ?", [previousTimeout]); }
      catch { destroy = true; }
    }
    if (destroy) connection.destroy(); else connection.release();
  }
}
