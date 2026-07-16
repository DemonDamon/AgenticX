import type { RefreshSession, RefreshTokenStore } from "@agenticx/auth";
import { authRefreshSessions } from "@agenticx/db-schema";
import { eq } from "drizzle-orm";

import { getIamDb } from "../../db";

export class PostgresqlRefreshTokenStore implements RefreshTokenStore {
  public async set(session: RefreshSession): Promise<void> {
    const db = getIamDb();
    await db
      .insert(authRefreshSessions)
      .values({
        sessionId: session.sessionId,
        userId: session.userId,
        tenantId: session.tenantId,
        deptId: session.deptId ?? null,
        email: session.email,
        scopesJson: session.scopes,
        expiresAt: new Date(session.expiresAt),
      })
      .onConflictDoUpdate({
        target: authRefreshSessions.sessionId,
        set: {
          userId: session.userId,
          tenantId: session.tenantId,
          deptId: session.deptId ?? null,
          email: session.email,
          scopesJson: session.scopes,
          expiresAt: new Date(session.expiresAt),
        },
      });
  }

  public async get(sessionId: string): Promise<RefreshSession | null> {
    const db = getIamDb();
    const [row] = await db
      .select()
      .from(authRefreshSessions)
      .where(eq(authRefreshSessions.sessionId, sessionId))
      .limit(1);
    if (!row) return null;
    const expiresAt = row.expiresAt.getTime();
    if (expiresAt <= Date.now()) {
      await this.delete(sessionId);
      return null;
    }
    return {
      sessionId: row.sessionId,
      userId: row.userId,
      tenantId: row.tenantId,
      deptId: row.deptId ?? undefined,
      email: row.email,
      scopes: Array.isArray(row.scopesJson) ? row.scopesJson.map(String) : [],
      expiresAt,
    };
  }

  public async delete(sessionId: string): Promise<void> {
    await getIamDb()
      .delete(authRefreshSessions)
      .where(eq(authRefreshSessions.sessionId, sessionId));
  }
}
