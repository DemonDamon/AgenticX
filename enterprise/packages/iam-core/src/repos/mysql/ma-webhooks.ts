import { maCredentials, maWebhookDeliveries, maWebhooks } from "@agenticx/db-schema/mysql";
import { and, desc, eq, gt, isNotNull, lte, sql } from "drizzle-orm";

import { getMysqlRepositoryDb } from "./db";

type WebhookInsert = typeof maWebhooks.$inferInsert;
type WebhookPatch = Partial<WebhookInsert>;

export async function mysqlListMaWebhooks(tenantId: string) {
  const db = await getMysqlRepositoryDb();
  return db.select().from(maWebhooks).where(eq(maWebhooks.tenantId, tenantId)).orderBy(desc(maWebhooks.createdAt));
}

export async function mysqlFindMaWebhook(tenantId: string, id: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maWebhooks)
    .where(and(eq(maWebhooks.tenantId, tenantId), eq(maWebhooks.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlFindMaWebhookByName(tenantId: string, name: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maWebhooks)
    .where(and(eq(maWebhooks.tenantId, tenantId), eq(maWebhooks.name, name)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlInsertMaWebhook(row: WebhookInsert): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.insert(maWebhooks).values(row);
}

export async function mysqlUpdateMaWebhook(tenantId: string, id: string, patch: WebhookPatch): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.update(maWebhooks).set(patch).where(and(eq(maWebhooks.tenantId, tenantId), eq(maWebhooks.id, id)));
}

function readAffectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  if (header && typeof header === "object" && "affectedRows" in header) {
    const value = (header as { affectedRows: unknown }).affectedRows;
    return typeof value === "number" ? value : 0;
  }
  return 0;
}

/** 仅当当前 enabled=true 时停用，返回是否改动了行。 */
export async function mysqlAutoDisableMaWebhook(tenantId: string, id: string, patch: WebhookPatch): Promise<boolean> {
  const db = await getMysqlRepositoryDb();
  const result = await db
    .update(maWebhooks)
    .set(patch)
    .where(and(eq(maWebhooks.tenantId, tenantId), eq(maWebhooks.id, id), eq(maWebhooks.enabled, true)));
  return readAffectedRows(result) > 0;
}

export async function mysqlDeleteMaWebhook(tenantId: string, id: string): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.delete(maWebhooks).where(and(eq(maWebhooks.tenantId, tenantId), eq(maWebhooks.id, id)));
}

export async function mysqlCountMaWebhooks(tenantId: string): Promise<number> {
  const db = await getMysqlRepositoryDb();
  const rows = await db.select({ n: sql<number>`count(*)` }).from(maWebhooks).where(eq(maWebhooks.tenantId, tenantId));
  return Number(rows[0]?.n ?? 0);
}

export async function mysqlListEnabledMaWebhooks() {
  const db = await getMysqlRepositoryDb();
  return db.select().from(maWebhooks).where(eq(maWebhooks.enabled, true));
}

export async function mysqlListMaWebhookDeliveries(tenantId: string, webhookId: string, limit: number) {
  const db = await getMysqlRepositoryDb();
  return db
    .select()
    .from(maWebhookDeliveries)
    .where(and(eq(maWebhookDeliveries.tenantId, tenantId), eq(maWebhookDeliveries.webhookId, webhookId)))
    .orderBy(desc(maWebhookDeliveries.createdAt))
    .limit(limit);
}

export async function mysqlListExpiringCredentialRows(after: Date, until: Date) {
  const db = await getMysqlRepositoryDb();
  return db
    .select({
      id: maCredentials.id,
      tenantId: maCredentials.tenantId,
      vaultId: maCredentials.vaultId,
      type: maCredentials.type,
      displayName: maCredentials.displayName,
      status: maCredentials.status,
      expiresAt: maCredentials.expiresAt,
    })
    .from(maCredentials)
    .where(
      and(
        eq(maCredentials.status, "active"),
        isNotNull(maCredentials.expiresAt),
        gt(maCredentials.expiresAt, after),
        lte(maCredentials.expiresAt, until),
      ),
    );
}
