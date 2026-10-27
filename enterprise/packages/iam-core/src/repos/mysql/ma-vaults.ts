import {
  auditEvents,
  enterpriseAgentVersions,
  enterpriseAgents,
  maCredentials,
  maSessions,
  maVaults,
} from "@agenticx/db-schema/mysql";
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { ulid } from "ulid";

import type { AuditInsert } from "../audit";
import { getMysqlRepositoryDb } from "./db";

type MysqlDb = Awaited<ReturnType<typeof getMysqlRepositoryDb>>;

async function writeAudit(tx: MysqlDb, input: AuditInsert): Promise<void> {
  const now = new Date();
  await tx.insert(auditEvents).values({
    id: ulid(),
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    targetKind: input.targetKind,
    targetId: input.targetId ?? null,
    detail: input.detail ?? null,
    createdAt: now,
    updatedAt: now,
  });
}

export async function mysqlListVaults(tenantId: string, includeArchived: boolean) {
  const db = await getMysqlRepositoryDb();
  return db
    .select()
    .from(maVaults)
    .where(and(eq(maVaults.tenantId, tenantId), includeArchived ? undefined : eq(maVaults.status, "active")))
    .orderBy(desc(maVaults.createdAt));
}

export async function mysqlFindVault(tenantId: string, id: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maVaults)
    .where(and(eq(maVaults.tenantId, tenantId), eq(maVaults.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlCredentialCounts(tenantId: string) {
  const db = await getMysqlRepositoryDb();
  return db
    .select({ vaultId: maCredentials.vaultId, n: sql<number>`count(*)` })
    .from(maCredentials)
    .where(and(eq(maCredentials.tenantId, tenantId), eq(maCredentials.status, "active")))
    .groupBy(maCredentials.vaultId);
}

export async function mysqlCountActiveCredentials(tenantId: string, vaultId: string): Promise<number> {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(maCredentials)
    .where(and(eq(maCredentials.tenantId, tenantId), eq(maCredentials.vaultId, vaultId), eq(maCredentials.status, "active")));
  return Number(rows[0]?.n ?? 0) || 0;
}

export async function mysqlListCredentials(tenantId: string, vaultId: string, includeArchived: boolean) {
  const db = await getMysqlRepositoryDb();
  return db
    .select()
    .from(maCredentials)
    .where(
      and(
        eq(maCredentials.tenantId, tenantId),
        eq(maCredentials.vaultId, vaultId),
        includeArchived ? undefined : eq(maCredentials.status, "active"),
      ),
    )
    .orderBy(asc(maCredentials.createdAt), asc(maCredentials.id));
}

export async function mysqlFindCredential(tenantId: string, vaultId: string, credentialId: string) {
  const db = await getMysqlRepositoryDb();
  const rows = await db
    .select()
    .from(maCredentials)
    .where(and(eq(maCredentials.tenantId, tenantId), eq(maCredentials.vaultId, vaultId), eq(maCredentials.id, credentialId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function mysqlVaultStatuses(tenantId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const db = await getMysqlRepositoryDb();
  return db
    .select({ id: maVaults.id, status: maVaults.status })
    .from(maVaults)
    .where(and(eq(maVaults.tenantId, tenantId), inArray(maVaults.id, ids)));
}

export async function mysqlInsertVault(row: typeof maVaults.$inferInsert, audit: AuditInsert): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.transaction(async (tx) => {
    await tx.insert(maVaults).values(row);
    await writeAudit(tx as MysqlDb, audit);
  });
}

export async function mysqlUpdateVault(
  tenantId: string,
  id: string,
  patch: Partial<typeof maVaults.$inferInsert>,
  audit: AuditInsert,
): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.transaction(async (tx) => {
    await tx.update(maVaults).set(patch).where(and(eq(maVaults.tenantId, tenantId), eq(maVaults.id, id)));
    await writeAudit(tx as MysqlDb, audit);
  });
}

export async function mysqlArchiveVault(tenantId: string, vaultId: string, now: Date, auditBase: Omit<AuditInsert, "detail">): Promise<number> {
  const db = await getMysqlRepositoryDb();
  return db.transaction(async (tx) => {
    const counts = await tx
      .select({ n: sql<number>`count(*)` })
      .from(maCredentials)
      .where(and(eq(maCredentials.tenantId, tenantId), eq(maCredentials.vaultId, vaultId), eq(maCredentials.status, "active")));
    const credentialCount = Number(counts[0]?.n ?? 0) || 0;
    await tx
      .update(maVaults)
      .set({ status: "archived", archivedAt: now, updatedAt: now })
      .where(and(eq(maVaults.tenantId, tenantId), eq(maVaults.id, vaultId)));
    await tx
      .update(maCredentials)
      .set({
        status: "archived",
        archivedAt: now,
        secretCiphertext: null,
        wrappedDek: null,
        kekId: null,
        activeIdentityKey: null,
        updatedAt: now,
      })
      .where(and(eq(maCredentials.tenantId, tenantId), eq(maCredentials.vaultId, vaultId), eq(maCredentials.status, "active")));
    await writeAudit(tx as MysqlDb, { ...auditBase, detail: { credential_count: credentialCount } });
    return credentialCount;
  });
}

export async function mysqlDeleteVault(tenantId: string, id: string, audit: AuditInsert): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.transaction(async (tx) => {
    await writeAudit(tx as MysqlDb, audit);
    await tx.delete(maVaults).where(and(eq(maVaults.tenantId, tenantId), eq(maVaults.id, id)));
  });
}

export async function mysqlInsertCredential(row: typeof maCredentials.$inferInsert, audit: AuditInsert): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.transaction(async (tx) => {
    await tx.insert(maCredentials).values(row);
    await writeAudit(tx as MysqlDb, audit);
  });
}

export async function mysqlUpdateCredential(
  tenantId: string,
  vaultId: string,
  credentialId: string,
  patch: Partial<typeof maCredentials.$inferInsert>,
  audit: AuditInsert,
): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.transaction(async (tx) => {
    await tx
      .update(maCredentials)
      .set(patch)
      .where(and(eq(maCredentials.tenantId, tenantId), eq(maCredentials.vaultId, vaultId), eq(maCredentials.id, credentialId)));
    await writeAudit(tx as MysqlDb, audit);
  });
}

export async function mysqlDeleteCredential(tenantId: string, vaultId: string, credentialId: string, audit: AuditInsert): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db.transaction(async (tx) => {
    await writeAudit(tx as MysqlDb, audit);
    await tx
      .delete(maCredentials)
      .where(and(eq(maCredentials.tenantId, tenantId), eq(maCredentials.vaultId, vaultId), eq(maCredentials.id, credentialId)));
  });
}

export async function mysqlListSessionReferences(tenantId: string, vaultId: string) {
  const db = await getMysqlRepositoryDb();
  const filters = and(
    eq(maSessions.tenantId, tenantId),
    isNull(maSessions.archivedAt),
    notInArray(maSessions.status, ["archived", "terminated"]),
    sql`JSON_CONTAINS(${maSessions.vaultIds}, JSON_QUOTE(${vaultId}))`,
  );
  const counts = await db.select({ n: sql<number>`count(*)` }).from(maSessions).where(filters);
  const recent = await db
    .select({
      id: maSessions.id,
      agentId: maSessions.agentId,
      status: maSessions.status,
      createdByUserId: maSessions.createdByUserId,
      createdAt: maSessions.createdAt,
    })
    .from(maSessions)
    .where(filters)
    .orderBy(desc(maSessions.createdAt))
    .limit(20);
  return { activeCount: Number(counts[0]?.n ?? 0) || 0, recent };
}

export async function mysqlListAgentManifests(tenantId: string) {
  const db = await getMysqlRepositoryDb();
  return db
    .select({
      id: enterpriseAgents.id,
      displayName: enterpriseAgents.displayName,
      latestVersion: enterpriseAgents.latestVersion,
      manifest: enterpriseAgentVersions.manifest,
    })
    .from(enterpriseAgents)
    .innerJoin(
      enterpriseAgentVersions,
      and(
        eq(enterpriseAgentVersions.agentId, enterpriseAgents.id),
        eq(enterpriseAgentVersions.tenantId, tenantId),
        eq(enterpriseAgentVersions.version, enterpriseAgents.latestVersion),
      ),
    )
    .where(and(eq(enterpriseAgents.tenantId, tenantId), eq(enterpriseAgents.status, "active")));
}

export async function mysqlWriteRefreshed(
  tenantId: string,
  vaultId: string,
  credentialId: string,
  patch: Partial<typeof maCredentials.$inferInsert>,
): Promise<void> {
  const db = await getMysqlRepositoryDb();
  await db
    .update(maCredentials)
    .set(patch)
    .where(and(eq(maCredentials.tenantId, tenantId), eq(maCredentials.vaultId, vaultId), eq(maCredentials.id, credentialId)));
}

export async function mysqlTouchResolved(tenantId: string, ids: string[], at: Date): Promise<void> {
  if (ids.length === 0) return;
  const db = await getMysqlRepositoryDb();
  await db
    .update(maCredentials)
    .set({ lastResolvedAt: at })
    .where(and(eq(maCredentials.tenantId, tenantId), inArray(maCredentials.id, ids)));
}
