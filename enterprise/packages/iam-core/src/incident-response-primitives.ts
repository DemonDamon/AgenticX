/**
 * SP5 incident-response：处置编排所需的数据原语（console 编排层调用）。
 * - disable_user 的持久化语义 = users.status='disabled'（可回滚：重新启用）
 * - 网关即时吊销需要 PAT hash（revokePat 只返回 record）
 * - disable_user 展开需要该用户的活跃 PAT 与登录会话列表
 */
import { apiTokens as patTable, authRefreshSessions, users as usersTable } from "@agenticx/db-schema";
import { and, eq } from "drizzle-orm";

import { getIamDb } from "./db";
import { resolveDatabaseConfig } from "./database/config";
import {
  apiTokens as mysqlPatTable,
  authRefreshSessions as mysqlAuthRefreshSessions,
  users as mysqlUsersTable,
} from "@agenticx/db-schema/mysql";
import { getMysqlRepositoryDb } from "./repos/mysql/db";

export async function getPatHash(id: number, tenantId: string): Promise<string | null> {
  if (resolveDatabaseConfig().dialect === "mysql") {
    const db = await getMysqlRepositoryDb();
    const [row] = await db
      .select({ tokenHash: mysqlPatTable.tokenHash })
      .from(mysqlPatTable)
      .where(and(eq(mysqlPatTable.id, id), eq(mysqlPatTable.tenantId, tenantId)))
      .limit(1);
    return row?.tokenHash ?? null;
  }
  const db = getIamDb();
  const [row] = await db
    .select({ tokenHash: patTable.tokenHash })
    .from(patTable)
    .where(and(eq(patTable.id, id), eq(patTable.tenantId, tenantId)))
    .limit(1);
  return row?.tokenHash ?? null;
}

/** 该用户的全部登录会话 id（disable_user 展开终止用）。 */
export async function listUserSessionIds(userId: string): Promise<string[]> {
  if (resolveDatabaseConfig().dialect === "mysql") {
    const db = await getMysqlRepositoryDb();
    const rows = await db
      .select({ sessionId: mysqlAuthRefreshSessions.sessionId })
      .from(mysqlAuthRefreshSessions)
      .where(eq(mysqlAuthRefreshSessions.userId, userId));
    return rows.map((r) => r.sessionId);
  }
  const db = getIamDb();
  const rows = await db
    .select({ sessionId: authRefreshSessions.sessionId })
    .from(authRefreshSessions)
    .where(eq(authRefreshSessions.userId, userId));
  return rows.map((r) => r.sessionId);
}

/** 用户禁用（可回滚：处置误伤对策——重新启用只回写 status）。返回是否生效。 */
export async function setUserStatusDisabled(tenantId: string, userId: string): Promise<boolean> {
  if (resolveDatabaseConfig().dialect === "mysql") {
    const db = await getMysqlRepositoryDb();
    const result = await db
      .update(mysqlUsersTable)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(and(eq(mysqlUsersTable.id, userId), eq(mysqlUsersTable.tenantId, tenantId)));
    return (result[0]?.affectedRows ?? 0) > 0;
  }
  const db = getIamDb();
  const rows = await db
    .update(usersTable)
    .set({ status: "disabled", updatedAt: new Date() })
    .where(and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId)))
    .returning({ id: usersTable.id });
  return rows.length > 0;
}

/** 终止登录会话的 refresh 侧（断 refresh 续命；access 侧由网关即时吊销）。 */
export async function deleteRefreshSessionBySessionId(sessionId: string): Promise<void> {
  if (resolveDatabaseConfig().dialect === "mysql") {
    const db = await getMysqlRepositoryDb();
    await db.delete(mysqlAuthRefreshSessions).where(eq(mysqlAuthRefreshSessions.sessionId, sessionId));
    return;
  }
  const db = getIamDb();
  await db.delete(authRefreshSessions).where(eq(authRefreshSessions.sessionId, sessionId));
}
