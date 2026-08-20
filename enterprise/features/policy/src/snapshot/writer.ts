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
let legacyMigrationInFlight: Promise<void> | null = null;

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
  // 这里原本是先把 legacyFileMigrated 置 true 再干活。只要迁移过程中数据库抖一下
  // （下面的探测查询或者插入抛错），标记已经留在 true 了：调用方看到报错重试一次，
  // 第二次直接从这里 return，旧文件里的租户快照**永远不会**再被导入。结果就是升级
  // 之后策略包静悄悄全没了，只能靠人重新发布。改成"成功才置位"，失败时清掉 in-flight
  // 让下一次调用重试；并发调用共用同一个 promise，避免重复迁移。
  legacyMigrationInFlight ??= runLegacySnapshotMigration().then(
    () => {
      legacyFileMigrated = true;
      legacyMigrationInFlight = null;
    },
    (err) => {
      legacyMigrationInFlight = null;
      throw err;
    },
  );
  return legacyMigrationInFlight;
}

async function runLegacySnapshotMigration(): Promise<void> {
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
  let parsed: Partial<SnapshotStoreFile>;
  try {
    parsed = JSON.parse(await fs.readFile(fp, "utf-8")) as Partial<SnapshotStoreFile>;
  } catch {
    // 旧文件不存在（ENOENT，全新部署的正常情况）或者内容不是合法 JSON —— 两种都当作
    // "没有需要迁移的东西"。注意 try 只包住读文件+解析：原来它一直包到插入结束，
    // 于是写库失败也会被这句注释掉的 "ENOENT ok" 吞掉，外面记成迁移完成。
    return;
  }
  if (!parsed?.tenants || typeof parsed.tenants !== "object") return;

  const rows = Object.entries(parsed.tenants).map(([tid, snapshot]) => ({
    tenantId: tid,
    snapshot: snapshot as unknown as Record<string, unknown>,
    updatedAt: new Date(parsed.updatedAt ?? new Date().toISOString()),
  }));
  if (!rows.length) return;

  // 必须整体成败：逐条插入时如果插到一半失败，库里已经有行了，重试会被上面的
  // hasRows 判成"已经迁过"直接返回，剩下的租户就永久丢了。
  if (dialect === "mysql") {
    const db = getPolicyMysqlDb();
    await db.transaction(async (tx) => {
      for (const values of rows) await tx.insert(mysqlSnapTable).values(values);
    });
  } else {
    const db = getIamDb();
    await db.transaction(async (tx) => {
      for (const values of rows) await tx.insert(pgSnapTable).values(values);
    });
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
  legacyMigrationInFlight = null;
}
