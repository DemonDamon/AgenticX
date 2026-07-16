import { Pool } from "pg";

export type SqlQueryResult = {
  rows: Record<string, unknown>[];
  rowCount: number;
};

export interface SqlExecutor {
  query(statement: string, params?: unknown[]): Promise<SqlQueryResult>;
}

export type MeteringSqlBuilder = {
  dialect: "postgresql" | "mysql";
  placeholder(index: number): string;
  dateBucket(granularity: "hour" | "day", column: string): string;
  text(column: string): string;
  bigint(expression: string): string;
  decimal(expression: string): string;
  now(): string;
  insertIgnore(column: string): string;
};

export function createPostgresqlExecutor(connectionString: string): SqlExecutor {
  const pool = new Pool({ connectionString });
  return {
    async query(statement, params) {
      const result = await pool.query(statement, params);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.rowCount ?? 0,
      };
    },
  };
}

export const postgresqlMeteringSql: MeteringSqlBuilder = {
  dialect: "postgresql",
  placeholder: (index) => `$${index}`,
  dateBucket: (granularity, column) => `date_trunc('${granularity}', ${column})`,
  text: (column) => `${column}::text`,
  bigint: (expression) => `${expression}::bigint`,
  decimal: (expression) => `${expression}::numeric(18,8)`,
  now: () => "now()",
  insertIgnore: (column) => `on conflict (${column}) do nothing`,
};
