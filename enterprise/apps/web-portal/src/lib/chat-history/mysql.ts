import { resolveDatabaseConfig } from "@agenticx/iam-core";
import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import {
  SqlChatHistoryStore,
  type SqlClient,
  type SqlResult,
} from "./sql-store";

declare global {
  var __agenticxPortalChatMysqlPool: Pool | undefined;
}

function pool(): Pool {
  const config = resolveDatabaseConfig();
  if (config.dialect !== "mysql") {
    throw new Error(`MySQL chat-history adapter cannot use ${config.dialect}`);
  }
  if (!globalThis.__agenticxPortalChatMysqlPool) {
    const parsed = new URL(config.url);
    globalThis.__agenticxPortalChatMysqlPool = mysql.createPool({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ""),
      connectionLimit: 5,
      timezone: "Z",
      charset: "utf8mb4",
    });
  }
  return globalThis.__agenticxPortalChatMysqlPool;
}

function mysqlClient(connection?: PoolConnection): SqlClient {
  return {
    async query(statement, params): Promise<SqlResult> {
      const [result] = await (connection ?? pool()).query<RowDataPacket[] | ResultSetHeader>(
        statement,
        params,
      );
      if (Array.isArray(result)) {
        return { rows: result as Record<string, unknown>[], rowCount: result.length };
      }
      return { rows: [], rowCount: result.affectedRows };
    },
    async transaction<T>(callback: (tx: SqlClient) => Promise<T>): Promise<T> {
      const conn = await pool().getConnection();
      try {
        await conn.beginTransaction();
        const value = await callback(mysqlClient(conn));
        await conn.commit();
        return value;
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    },
    async close(): Promise<void> {
      if (!connection) {
        await globalThis.__agenticxPortalChatMysqlPool?.end();
        globalThis.__agenticxPortalChatMysqlPool = undefined;
      }
    },
  };
}

export const mysqlChatHistoryStore = new SqlChatHistoryStore("mysql", mysqlClient());
