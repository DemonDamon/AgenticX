/**
 * Policy 快照持久化 — PostgreSQL / MySQL（替代 enterprise/.runtime/admin/policy-snapshot.json）。
 */
import { enterpriseRuntimePolicySnapshots as pgSnapTable } from "@agenticx/db-schema";
import { enterpriseRuntimePolicySnapshots as mysqlSnapTable } from "@agenticx/db-schema/mysql";
import { getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

import { getPolicyMysqlDb } from "../services/mysql-database";
import type { PolicySnapshot } from "../types";

type SnapshotStoreFile = {
  updatedAt: string;
  tenants: Record<string, PolicySnapshot>;
};

type ReplaceSnapshotOptions = {
  expectedCurrentPublishId?: string | null;
};

let legacyFileMigrated = false;

export function resolveSnapshotPath(): string {
  const cwd = process.cwd();
  let enterpriseRoot = cwd;
  if (cwd.endsWith("/enterprise")) enterpriseRoot = cwd;
  else if (cwd.includes("/enterprise/"))
    enterpriseRoot = cwd.slice(0, cwd.indexOf("/enterprise/") + "/enterprise".length);
  else enterpriseRoot = path.resolve(cwd, "../..");
  return (
    process.env.ENTERPRISE_POLICY_SNAPSHOT_FILE ||
    process.env.GATEWAY_POLICY_SNAPSHOT_FILE ||
    path.join(enterpriseRoot, ".runtime/admin/policy-snapshot.json")
  );
}

async function migrateLegacySnapshotFileOnce(): Promise<void> {
  if (legacyFileMigrated) return;
  legacyFileMigrated = true;

  const dialect = resolveDatabaseConfig().dialect;
  const hasRows =
    dialect === "mysql"
      ? (
          await getPolicyMysqlDb()
            .select({ tenantId: mysqlSnapTable.tenantId })
            .from(mysqlSnapTable)
            .limit(1)
        ).length > 0
      : (
          await getIamDb()
            .select({ tenantId: pgSnapTable.tenantId })
            .from(pgSnapTable)
            .limit(1)
        ).length > 0;
  if (hasRows) return;

  const fp = resolveSnapshotPath();
  try {
    const raw = await fs.readFile(fp, "utf-8");
    const parsed = JSON.parse(raw) as Partial<SnapshotStoreFile>;
    if (!parsed?.tenants || typeof parsed.tenants !== "object") return;
    for (const [tid, snapshot] of Object.entries(parsed.tenants)) {
      const values = {
        tenantId: tid,
        snapshot: snapshot as unknown as Record<string, unknown>,
        updatedAt: new Date(parsed.updatedAt ?? new Date().toISOString()),
      };
      if (dialect === "mysql") {
        await getPolicyMysqlDb().insert(mysqlSnapTable).values(values);
      } else {
        await getIamDb().insert(pgSnapTable).values(values);
      }
    }
  } catch {
    /* ENOENT ok */
  }
}

export async function replaceTenantSnapshot(
  tenantId: string,
  snapshot: PolicySnapshot | null,
  options?: ReplaceSnapshotOptions,
): Promise<string> {
  await migrateLegacySnapshotFileOnce();
  const dialect = resolveDatabaseConfig().dialect;
  const iso = new Date().toISOString();

  if (dialect === "mysql") {
    const db = getPolicyMysqlDb();
    const existingRows = await db
      .select()
      .from(mysqlSnapTable)
      .where(eq(mysqlSnapTable.tenantId, tenantId))
      .limit(1);
    const current = existingRows[0]?.snapshot as PolicySnapshot | undefined;
    const currentPublishId = current?.publishId ?? null;
    if (options && "expectedCurrentPublishId" in options) {
      const exp = options.expectedCurrentPublishId ?? null;
      if ((currentPublishId ?? null) !== exp) {
        throw new Error("snapshot CAS mismatch");
      }
    }
    if (snapshot) {
      await db
        .insert(mysqlSnapTable)
        .values({
          tenantId,
          snapshot: snapshot as unknown as Record<string, unknown>,
          updatedAt: new Date(iso),
        })
        .onDuplicateKeyUpdate({
          set: {
            snapshot: snapshot as unknown as Record<string, unknown>,
            updatedAt: new Date(iso),
          },
        });
    } else {
      await db.delete(mysqlSnapTable).where(eq(mysqlSnapTable.tenantId, tenantId));
    }
    return `mysql:enterprise_runtime_policy_snapshots:${tenantId}`;
  }

  const db = getIamDb();
  const existingRows = await db.select().from(pgSnapTable).where(eq(pgSnapTable.tenantId, tenantId)).limit(1);
  const current = existingRows[0]?.snapshot as PolicySnapshot | undefined;
  const currentPublishId = current?.publishId ?? null;
  if (options && "expectedCurrentPublishId" in options) {
    const exp = options.expectedCurrentPublishId ?? null;
    if ((currentPublishId ?? null) !== exp) {
      throw new Error("snapshot CAS mismatch");
    }
  }
  if (snapshot) {
    await db
      .insert(pgSnapTable)
      .values({
        tenantId,
        snapshot: snapshot as unknown as Record<string, unknown>,
        updatedAt: new Date(iso),
      })
      .onConflictDoUpdate({
        target: pgSnapTable.tenantId,
        set: {
          snapshot: snapshot as unknown as Record<string, unknown>,
          updatedAt: new Date(iso),
        },
      });
  } else {
    await db.delete(pgSnapTable).where(eq(pgSnapTable.tenantId, tenantId));
  }
  return `pg:enterprise_runtime_policy_snapshots:${tenantId}`;
}

export async function writeSnapshot(snapshot: PolicySnapshot): Promise<string> {
  return replaceTenantSnapshot(snapshot.tenantId, snapshot);
}

export async function writeSnapshotWithCas(
  snapshot: PolicySnapshot,
  expectedCurrentPublishId: string | null,
): Promise<string> {
  return replaceTenantSnapshot(snapshot.tenantId, snapshot, {
    expectedCurrentPublishId,
  });
}

export async function readTenantSnapshot(tenantId: string): Promise<PolicySnapshot | null> {
  await migrateLegacySnapshotFileOnce();
  const dialect = resolveDatabaseConfig().dialect;
  if (dialect === "mysql") {
    const rows = await getPolicyMysqlDb()
      .select()
      .from(mysqlSnapTable)
      .where(eq(mysqlSnapTable.tenantId, tenantId))
      .limit(1);
    if (!rows.length) return null;
    return rows[0]!.snapshot as PolicySnapshot;
  }
  const rows = await getIamDb().select().from(pgSnapTable).where(eq(pgSnapTable.tenantId, tenantId)).limit(1);
  if (!rows.length) return null;
  return rows[0]!.snapshot as PolicySnapshot;
}

/** 网关 internal API：聚合为多租户快照 JSON（与旧文件结构一致）。 */
export async function buildPolicySnapshotBundleForGateway(): Promise<SnapshotStoreFile> {
  await migrateLegacySnapshotFileOnce();
  const dialect = resolveDatabaseConfig().dialect;
  const rows =
    dialect === "mysql"
      ? await getPolicyMysqlDb().select().from(mysqlSnapTable)
      : await getIamDb().select().from(pgSnapTable);
  const tenants: Record<string, PolicySnapshot> = {};
  let updatedAt = new Date(0).toISOString();
  for (const r of rows) {
    tenants[r.tenantId] = r.snapshot as PolicySnapshot;
    const u =
      r.updatedAt instanceof Date ? r.updatedAt.toISOString() : new Date(r.updatedAt!).toISOString();
    if (u > updatedAt) updatedAt = u;
  }
  return { updatedAt, tenants };
}

/** test-only */
export function __resetLegacySnapshotMigrationFlag(): void {
  legacyFileMigrated = false;
}
