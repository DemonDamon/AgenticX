import type { RefreshSession, RefreshTokenStore } from "@agenticx/auth";
import { resolveDatabaseConfig } from "./database/config";
import { MysqlRefreshTokenStore } from "./repos/mysql/refresh-token-store";
import { PostgresqlRefreshTokenStore } from "./repos/postgresql/refresh-token-store";

/**
 * Compatibility facade. The historical export name remains public, while the
 * concrete store now follows DATABASE_URL's resolved dialect.
 */
export class PgRefreshTokenStore implements RefreshTokenStore {
  private readonly delegate: RefreshTokenStore =
    resolveDatabaseConfig().dialect === "mysql"
      ? new MysqlRefreshTokenStore()
      : new PostgresqlRefreshTokenStore();

  public async set(session: RefreshSession): Promise<void> {
    await this.delegate.set(session);
  }

  public async get(sessionId: string): Promise<RefreshSession | null> {
    return this.delegate.get(sessionId);
  }

  public async delete(sessionId: string): Promise<void> {
    await this.delegate.delete(sessionId);
  }
}
