import { authRefreshSessions } from "@agenticx/db-schema";
import type { RefreshSession, RefreshTokenStore } from "@agenticx/auth";
import { eq } from "drizzle-orm";
import { getIamDb } from "./db";

export class PgRefreshTokenStore implements RefreshTokenStore {
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
    const rows = await db
      .select()
      .from(authRefreshSessions)
      .where(eq(authRefreshSessions.sessionId, sessionId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const expiresMs = row.expiresAt instanceof Date ? row.expiresAt.getTime() : new Date(row.expiresAt).getTime();
    if (expiresMs <= Date.now()) {
      await db.delete(authRefreshSessions).where(eq(authRefreshSessions.sessionId, sessionId));
      return null;
    }
    return {
      sessionId: row.sessionId,
      userId: row.userId,
      tenantId: row.tenantId,
      deptId: row.deptId ?? undefined,
      email: row.email,
      scopes: (row.scopesJson ?? []) as string[],
      expiresAt: expiresMs,
    };
  }

  public async delete(sessionId: string): Promise<void> {
    const db = getIamDb();
    await db.delete(authRefreshSessions).where(eq(authRefreshSessions.sessionId, sessionId));
  }
}
