import { resolveDatabaseConfig } from "@agenticx/iam-core";
import { Pool as PgPool } from "pg";
import mysql from "mysql2/promise";

export type BillingSqlExecutor = {
  dialect: "postgresql" | "mysql";
  query: <T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: T[]; rowCount: number }>;
};

function bindMysqlParams(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
  const ordered: unknown[] = [];
  const statement = sql.replace(/\$(\d+)/g, (_match, rawIndex: string) => {
    ordered.push(params[Number(rawIndex) - 1]);
    return "?";
  });
  return { sql: statement, params: ordered };
}

export function createBillingSqlExecutor(connectionString?: string): BillingSqlExecutor {
  const config = resolveDatabaseConfig({
    DATABASE_URL: connectionString ?? process.env.DATABASE_URL,
    DATABASE_DIALECT: process.env.DATABASE_DIALECT,
    NODE_ENV: process.env.NODE_ENV,
  });

  if (config.dialect === "postgresql") {
    const pool = new PgPool({ connectionString: config.url });
    return {
      dialect: "postgresql",
      async query(text, params = []) {
        const result = await pool.query(text, params);
        return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
      },
    };
  }

  const parsed = new URL(config.url);
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
    dialect: "mysql",
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
      const bound = bindMysqlParams(text, params);
      const [rows] = await pool.query(bound.sql, bound.params);
      const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
      return { rows: list as T[], rowCount: list.length };
    },
  };
}

export function jsonParam(dialect: "postgresql" | "mysql", placeholder: string): string {
  return dialect === "postgresql" ? `${placeholder}::jsonb` : `CAST(${placeholder} AS JSON)`;
}

export function returningStar(dialect: "postgresql" | "mysql"): string {
  // MySQL callers must re-select by PK after write; keep empty fragment.
  return dialect === "postgresql" ? " returning *" : "";
}

export function nowExpr(dialect: "postgresql" | "mysql"): string {
  return dialect === "postgresql" ? "now()" : "UTC_TIMESTAMP(6)";
}
