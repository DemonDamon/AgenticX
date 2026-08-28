import { resolveDatabaseConfig } from "@agenticx/iam-core";
import { Pool, type PoolClient } from "pg";
import type { SqlClient, SqlResult } from "../chat-history/sql-store";
import { SqlCollabRoomStore } from "./sql-store";

declare global {
  var __agenticxPortalCollabRoomPgPool: Pool | undefined;
}

function pool(): Pool {
  const config = resolveDatabaseConfig();
  if (config.dialect !== "postgresql") {
    throw new Error(`PostgreSQL collab-room adapter cannot use ${config.dialect}`);
  }
  globalThis.__agenticxPortalCollabRoomPgPool ??= new Pool({
    connectionString: config.url,
    max: 5,
  });
  return globalThis.__agenticxPortalCollabRoomPgPool;
}

function pgClient(client?: PoolClient): SqlClient {
  return {
    async query(statement, params): Promise<SqlResult> {
      const result = await (client ?? pool()).query(statement, params);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.rowCount ?? 0,
      };
    },
    async transaction<T>(callback: (tx: SqlClient) => Promise<T>): Promise<T> {
      const connection = await pool().connect();
      try {
        await connection.query("begin");
        const value = await callback(pgClient(connection));
        await connection.query("commit");
        return value;
      } catch (error) {
        await connection.query("rollback");
        throw error;
      } finally {
        connection.release();
      }
    },
    async close(): Promise<void> {
      if (!client) {
        await globalThis.__agenticxPortalCollabRoomPgPool?.end();
        globalThis.__agenticxPortalCollabRoomPgPool = undefined;
      }
    },
  };
}

export const postgresqlCollabRoomStore = new SqlCollabRoomStore("postgresql", pgClient());
