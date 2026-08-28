import { resolveDatabaseConfig } from "@agenticx/iam-core";
import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import type { SqlClient, SqlResult } from "../chat-history/sql-store";
import { SqlCollabRoomStore } from "./sql-store";

declare global {
  var __agenticxPortalCollabRoomMysqlPool: Pool | undefined;
}

function pool(): Pool {
  const config = resolveDatabaseConfig();
  if (config.dialect !== "mysql") {
    throw new Error(`MySQL collab-room adapter cannot use ${config.dialect}`);
  }
  if (!globalThis.__agenticxPortalCollabRoomMysqlPool) {
    const parsed = new URL(config.url);
    globalThis.__agenticxPortalCollabRoomMysqlPool = mysql.createPool({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ""),
      connectionLimit: 10,
      waitForConnections: true,
      queueLimit: 40,
      connectTimeout: 10_000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
      timezone: "Z",
      charset: "utf8mb4",
    });
  }
  return globalThis.__agenticxPortalCollabRoomMysqlPool;
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
        await globalThis.__agenticxPortalCollabRoomMysqlPool?.end();
        globalThis.__agenticxPortalCollabRoomMysqlPool = undefined;
      }
    },
  };
}

export const mysqlCollabRoomStore = new SqlCollabRoomStore("mysql", mysqlClient());
