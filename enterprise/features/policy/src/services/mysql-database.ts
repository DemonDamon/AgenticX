import * as mysqlSchema from "@agenticx/db-schema/mysql";
import { resolveDatabaseConfig } from "@agenticx/iam-core";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql, { type Pool } from "mysql2/promise";

let pool: Pool | undefined;
let database: MySql2Database<typeof mysqlSchema> | undefined;

export function getPolicyMysqlDb(): MySql2Database<typeof mysqlSchema> {
  const config = resolveDatabaseConfig();
  if (config.dialect !== "mysql") throw new Error(`MySQL policy store cannot use ${config.dialect}`);
  if (!pool) {
    const parsed = new URL(config.url);
    pool = mysql.createPool({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ""),
      timezone: "Z",
      charset: "utf8mb4",
    });
  }
  database ??= drizzle(pool, { schema: mysqlSchema, mode: "default" });
  return database;
}
