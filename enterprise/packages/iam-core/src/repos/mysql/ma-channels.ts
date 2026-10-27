import { maChannelConversations, maChannelRuntimeState, maChannels, maCredentials, maVaults } from "@agenticx/db-schema/mysql";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { getMysqlRepositoryDb } from "./db";

type ChannelInsert = typeof maChannels.$inferInsert;
type ChannelPatch = Partial<ChannelInsert>;

export async function mysqlListMaChannels(tenantId: string, agentId?: string) {
  const db = await getMysqlRepositoryDb();
  return db
    .select()
    .from(maChannels)
    .where(and(eq(maChannels.tenantId, tenantId), agentId ? eq(maChannels.agentId, agentId) : undefined))
    .orderBy(asc(maChannels.name));
}

export async function mysqlFindMaChannel(tenantId: string, id: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maChannels)
    .where(and(eq(maChannels.tenantId, tenantId), eq(maChannels.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlFindMaChannelByName(tenantId: string, name: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maChannels)
    .where(and(eq(maChannels.tenantId, tenantId), eq(maChannels.name, name)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlFindMaChannelByApp(tenantId: string, platform: string, appId: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maChannels)
    .where(and(eq(maChannels.tenantId, tenantId), eq(maChannels.platform, platform), eq(maChannels.appId, appId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlInsertMaChannel(row: ChannelInsert): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.insert(maChannels).values(row);
}

export async function mysqlUpdateMaChannel(tenantId: string, id: string, patch: ChannelPatch): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.update(maChannels).set(patch).where(and(eq(maChannels.tenantId, tenantId), eq(maChannels.id, id)));
}

export async function mysqlDeleteMaChannel(tenantId: string, id: string): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.delete(maChannels).where(and(eq(maChannels.tenantId, tenantId), eq(maChannels.id, id)));
}

export async function mysqlCountMaChannels(tenantId: string): Promise<number> {
  const db = await getMysqlRepositoryDb();
  const rows = await db.select({ n: sql<number>`count(*)` }).from(maChannels).where(eq(maChannels.tenantId, tenantId));
  return Number(rows[0]?.n ?? 0);
}

export async function mysqlListEnabledMaChannels() {
  const db = await getMysqlRepositoryDb();
  return db.select().from(maChannels).where(eq(maChannels.enabled, true)).orderBy(asc(maChannels.name));
}

export async function mysqlListRuntimeStates(channelIds: string[]) {
  const db = await getMysqlRepositoryDb();
  if (channelIds.length === 0) return [];
  return db.select().from(maChannelRuntimeState).where(inArray(maChannelRuntimeState.channelId, channelIds));
}

export async function mysqlListMaChannelConversations(tenantId: string, channelId: string, limit: number) {
  const db = await getMysqlRepositoryDb();
  return db
    .select()
    .from(maChannelConversations)
    .where(and(eq(maChannelConversations.tenantId, tenantId), eq(maChannelConversations.channelId, channelId)))
    .orderBy(desc(maChannelConversations.lastMessageAt))
    .limit(limit);
}

export async function mysqlLoadChannelCredential(tenantId: string, vaultId: string, credentialId: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select({
      type: maCredentials.type,
      status: maCredentials.status,
      vaultStatus: maVaults.status,
      ciphertext: maCredentials.secretCiphertext,
      wrappedDek: maCredentials.wrappedDek,
      kekId: maCredentials.kekId,
    })
    .from(maCredentials)
    .innerJoin(maVaults, eq(maCredentials.vaultId, maVaults.id))
    .where(
      and(
        eq(maCredentials.tenantId, tenantId),
        eq(maCredentials.id, credentialId),
        eq(maCredentials.vaultId, vaultId),
        eq(maVaults.tenantId, tenantId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
