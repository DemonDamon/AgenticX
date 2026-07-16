import * as mysqlSchema from "@agenticx/db-schema/mysql";
import { resolveDatabaseConfig } from "@agenticx/iam-core";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql, { type Pool } from "mysql2/promise";

declare global {
  var __agenticxAdminMysqlPool: Pool | undefined;
}

let database: MySql2Database<typeof mysqlSchema> | undefined;

export function getAdminMysqlDb(): MySql2Database<typeof mysqlSchema> {
  const config = resolveDatabaseConfig();
  if (config.dialect !== "mysql") {
    throw new Error(`MySQL admin store cannot use ${config.dialect}`);
  }
  if (!globalThis.__agenticxAdminMysqlPool) {
    const parsed = new URL(config.url);
    globalThis.__agenticxAdminMysqlPool = mysql.createPool({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ""),
      connectionLimit: 10,
      timezone: "Z",
      charset: "utf8mb4",
    });
  }
  database ??= drizzle(globalThis.__agenticxAdminMysqlPool, {
    schema: mysqlSchema,
    mode: "default",
  });
  return database;
}

export async function resetAdminMysqlDbForTests(): Promise<void> {
  database = undefined;
  await globalThis.__agenticxAdminMysqlPool?.end();
  globalThis.__agenticxAdminMysqlPool = undefined;
}
