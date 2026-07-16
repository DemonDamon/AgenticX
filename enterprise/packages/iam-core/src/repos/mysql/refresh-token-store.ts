import type { RefreshSession, RefreshTokenStore } from "@agenticx/auth";
import { authRefreshSessions } from "@agenticx/db-schema/mysql";
import { eq } from "drizzle-orm";

import { getMysqlRepositoryDb } from "./db";

function normalizeScopes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export class MysqlRefreshTokenStore implements RefreshTokenStore {
  public async set(session: RefreshSession): Promise<void> {
    const db = await getMysqlRepositoryDb();
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
      .onDuplicateKeyUpdate({
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
    const db = await getMysqlRepositoryDb();
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
      scopes: normalizeScopes(row.scopesJson),
      expiresAt,
    };
  }

  public async delete(sessionId: string): Promise<void> {
    const db = await getMysqlRepositoryDb();
    await db
      .delete(authRefreshSessions)
      .where(eq(authRefreshSessions.sessionId, sessionId));
  }
}
