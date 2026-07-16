import mysql from "mysql2/promise";
import type { MeteringSqlBuilder, SqlExecutor, SqlQueryResult } from "./postgresql";

function dollarToQuestion(sql: string): string {
  return sql.replace(/\$(\d+)/g, "?");
}

export function createMysqlExecutor(connectionString: string): SqlExecutor {
  const parsed = new URL(connectionString);
  const pool = mysql.createPool({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, "") || undefined,
    timezone: "Z",
    charset: "utf8mb4",
  });
  return {
    async query(statement, params): Promise<SqlQueryResult> {
      const [rows] = await pool.query(dollarToQuestion(statement), params ?? []);
      const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
      return { rows: list, rowCount: list.length };
    },
  };
}

export const mysqlMeteringSql: MeteringSqlBuilder = {
  dialect: "mysql",
  placeholder: () => "?",
  dateBucket: (granularity, column) =>
    granularity === "hour"
      ? `DATE_FORMAT(${column}, '%Y-%m-%d %H:00:00')`
      : `DATE_FORMAT(${column}, '%Y-%m-%d 00:00:00')`,
  text: (column) => `CAST(${column} AS CHAR)`,
  bigint: (expression) => `CAST(${expression} AS SIGNED)`,
  decimal: (expression) => `CAST(${expression} AS DECIMAL(18,8))`,
  now: () => "UTC_TIMESTAMP(6)",
  insertIgnore: () => "on duplicate key update id = id",
};
