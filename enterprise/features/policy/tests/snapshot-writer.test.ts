/**
 * snapshot writer 的行为契约。
 *
 * 这个文件原来是按"快照存在 JSON 文件里"写的（ENTERPRISE_POLICY_SNAPSHOT_FILE 指到
 * 临时目录，然后读回来断言）。2026-05-12 的 66bfef88 把存储换成了 PostgreSQL/MySQL，
 * 这个文件没跟着改，于是三条用例一直在真去连 127.0.0.1:5432，红了三个多月没人看——
 * 也就意味着策略发布路径上的 CAS 校验这段时间根本没有测试守着。
 *
 * 现在用一个内存假库替掉 drizzle 句柄：被测的是 writer.ts 自己的逻辑（CAS 比对、
 * 写入 vs 删除、方言分流、旧文件迁移的一次性与原子性），而不是 drizzle 或者 PG。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// eq() 只用来带出租户 id，这里换成一个能直接读出值的普通对象，假库才好过滤。
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (_column: unknown, value: unknown) => ({ __eqValue: value }),
}));

type Row = { tenantId: string; snapshot: Record<string, unknown>; updatedAt: Date };
type Table = { __brand?: never };

/** 记录每次调用落到哪张表上，用来断言方言分流。 */
const touchedTables: unknown[] = [];

function createFakeDb() {
  let rows: Row[] = [];
  /** 下一次写操作抛出的错误，用来模拟数据库抖动。 */
  let failNextWrite: Error | null = null;

  const filterRows = (source: Row[], cond: unknown) => {
    const wanted = (cond as { __eqValue?: unknown } | null)?.__eqValue;
    return wanted === undefined ? source : source.filter((r) => r.tenantId === wanted);
  };

  const makeThenable = <T>(run: () => T) => ({
    then(resolve: (v: T) => unknown, reject: (e: unknown) => unknown) {
      try {
        return Promise.resolve(run()).then(resolve, reject);
      } catch (err) {
        return Promise.reject(err).then(resolve, reject);
      }
    },
  });

  const consumeWriteFailure = () => {
    if (failNextWrite) {
      const err = failNextWrite;
      failNextWrite = null;
      throw err;
    }
  };

  const buildApi = (target: { rows: Row[] }) => ({
    select(_projection?: unknown) {
      let cond: unknown = null;
      let lim: number | null = null;
      const q: Record<string, unknown> = {
        from(table: Table) {
          touchedTables.push(table);
          return q;
        },
        where(c: unknown) {
          cond = c;
          return q;
        },
        limit(n: number) {
          lim = n;
          return q;
        },
        ...makeThenable(() => {
          const out = filterRows(target.rows, cond);
          return lim === null ? out : out.slice(0, lim);
        }),
      };
      return q as never;
    },
    insert(table: Table) {
      touchedTables.push(table);
      return {
        values(v: Row) {
          const upsert = () => {
            consumeWriteFailure();
            const idx = target.rows.findIndex((r) => r.tenantId === v.tenantId);
            if (idx >= 0) target.rows[idx] = { ...v };
            else target.rows.push({ ...v });
          };
          return {
            onConflictDoUpdate: (_o: unknown) => makeThenable(upsert),
            onDuplicateKeyUpdate: (_o: unknown) => makeThenable(upsert),
            ...makeThenable(() => {
              consumeWriteFailure();
              target.rows.push({ ...v });
            }),
          } as never;
        },
      };
    },
    delete(table: Table) {
      touchedTables.push(table);
      return {
        where: (cond: unknown) =>
          makeThenable(() => {
            consumeWriteFailure();
            const doomed = new Set(filterRows(target.rows, cond));
            target.rows = target.rows.filter((r) => !doomed.has(r));
            target.rows.forEach(() => undefined);
          }),
      } as never;
    },
    async transaction(fn: (tx: unknown) => Promise<unknown>) {
      // 真事务的语义：中途抛错整体回滚。
      const backup = target.rows.map((r) => ({ ...r }));
      try {
        return await fn(buildApi(target));
      } catch (err) {
        target.rows = backup;
        throw err;
      }
    },
  });

  const target = {
    get rows() {
      return rows;
    },
    set rows(next: Row[]) {
      rows = next;
    },
  };

  return {
    api: buildApi(target),
    dump: () => rows.map((r) => ({ ...r })),
    seed: (next: Row[]) => {
      rows = next;
    },
    failNextWriteWith: (err: Error) => {
      failNextWrite = err;
    },
  };
}

let pgDb = createFakeDb();
let mysqlDb = createFakeDb();
let dialect: "postgresql" | "mysql" = "postgresql";

vi.mock("@agenticx/iam-core", () => ({
  getIamDb: () => pgDb.api,
  resolveDatabaseConfig: () => ({ dialect, url: "fake://" }),
}));
vi.mock("../src/services/mysql-database", () => ({
  getPolicyMysqlDb: () => mysqlDb.api,
}));

import {
  __resetLegacySnapshotMigrationFlag,
  buildPolicySnapshotBundleForGateway,
  readTenantSnapshot,
  replaceTenantSnapshot,
  resolveSnapshotPath,
  writeSnapshot,
  writeSnapshotWithCas,
} from "../src/snapshot/writer";
import type { PolicySnapshot } from "../src/types";

function makeSnapshot(tenantId: string, version: number, publishId?: string): PolicySnapshot {
  return {
    tenantId,
    version,
    publishedAt: new Date().toISOString(),
    publisher: "tester",
    deptIndex: {},
    packs: [],
    ...(publishId ? { publishId } : {}),
  };
}

async function writeLegacyFile(tenants: Record<string, PolicySnapshot>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "policy-snapshot-"));
  const fp = path.join(dir, "policy-snapshot.json");
  await fs.writeFile(fp, JSON.stringify({ updatedAt: new Date().toISOString(), tenants }), "utf-8");
  process.env.ENTERPRISE_POLICY_SNAPSHOT_FILE = fp;
  return fp;
}

beforeEach(() => {
  pgDb = createFakeDb();
  mysqlDb = createFakeDb();
  dialect = "postgresql";
  touchedTables.length = 0;
  __resetLegacySnapshotMigrationFlag();
  delete process.env.ENTERPRISE_POLICY_SNAPSHOT_FILE;
  delete process.env.GATEWAY_POLICY_SNAPSHOT_FILE;
});

describe("snapshot writer", () => {
  it("writes and reads a tenant snapshot", async () => {
    const id = await writeSnapshot(makeSnapshot("tenant-a", 1));
    expect(id).toBe("pg:enterprise_runtime_policy_snapshots:tenant-a");
    expect((await readTenantSnapshot("tenant-a"))?.version).toBe(1);
  });

  it("overwrites instead of appending when the same tenant publishes again", async () => {
    await writeSnapshot(makeSnapshot("tenant-a", 1));
    await writeSnapshot(makeSnapshot("tenant-a", 2));
    expect(pgDb.dump()).toHaveLength(1);
    expect((await readTenantSnapshot("tenant-a"))?.version).toBe(2);
  });

  it("keeps tenants isolated", async () => {
    await writeSnapshot(makeSnapshot("tenant-a", 1));
    await writeSnapshot(makeSnapshot("tenant-b", 9));
    expect((await readTenantSnapshot("tenant-a"))?.version).toBe(1);
    expect((await readTenantSnapshot("tenant-b"))?.version).toBe(9);
  });

  it("removes the tenant snapshot when replacing with null", async () => {
    await writeSnapshot(makeSnapshot("tenant-a", 1));
    await replaceTenantSnapshot("tenant-a", null);
    expect(await readTenantSnapshot("tenant-a")).toBeNull();
  });

  it("deletes only the named tenant", async () => {
    await writeSnapshot(makeSnapshot("tenant-a", 1));
    await writeSnapshot(makeSnapshot("tenant-b", 1));
    await replaceTenantSnapshot("tenant-a", null);
    expect(await readTenantSnapshot("tenant-a")).toBeNull();
    expect((await readTenantSnapshot("tenant-b"))?.version).toBe(1);
  });

  it("returns null for a tenant that never published", async () => {
    expect(await readTenantSnapshot("nobody")).toBeNull();
  });
});

describe("snapshot writer CAS", () => {
  it("fails when the baseline publishId mismatches", async () => {
    await writeSnapshot(makeSnapshot("tenant-a", 1, "pub-1"));
    await expect(writeSnapshotWithCas(makeSnapshot("tenant-a", 2, "pub-2"), "stale")).rejects.toThrow(
      /CAS mismatch/i,
    );
    // 失败的 CAS 不能留下副作用。
    expect((await readTenantSnapshot("tenant-a"))?.publishId).toBe("pub-1");
  });

  it("succeeds when the baseline publishId matches", async () => {
    await writeSnapshot(makeSnapshot("tenant-a", 1, "pub-1"));
    await writeSnapshotWithCas(makeSnapshot("tenant-a", 2, "pub-2"), "pub-1");
    expect((await readTenantSnapshot("tenant-a"))?.publishId).toBe("pub-2");
  });

  it("treats a first publish as baseline null", async () => {
    await writeSnapshotWithCas(makeSnapshot("tenant-a", 1, "pub-1"), null);
    expect((await readTenantSnapshot("tenant-a"))?.publishId).toBe("pub-1");
    await expect(writeSnapshotWithCas(makeSnapshot("tenant-a", 2, "pub-2"), null)).rejects.toThrow(
      /CAS mismatch/i,
    );
  });
});

describe("snapshot writer dialect routing", () => {
  it("routes to MySQL and reports a mysql source id", async () => {
    dialect = "mysql";
    const id = await writeSnapshot(makeSnapshot("tenant-a", 1));
    expect(id).toBe("mysql:enterprise_runtime_policy_snapshots:tenant-a");
    expect(mysqlDb.dump()).toHaveLength(1);
    expect(pgDb.dump()).toHaveLength(0);
  });

  it("aggregates every tenant for the gateway bundle", async () => {
    await writeSnapshot(makeSnapshot("tenant-a", 1));
    await writeSnapshot(makeSnapshot("tenant-b", 2));
    const bundle = await buildPolicySnapshotBundleForGateway();
    expect(Object.keys(bundle.tenants).sort()).toEqual(["tenant-a", "tenant-b"]);
  });
});

describe("legacy snapshot-file migration", () => {
  it("honours ENTERPRISE_POLICY_SNAPSHOT_FILE as the migration source", async () => {
    process.env.ENTERPRISE_POLICY_SNAPSHOT_FILE = "/tmp/whatever/policy-snapshot.json";
    expect(resolveSnapshotPath()).toBe("/tmp/whatever/policy-snapshot.json");
  });

  it("imports the legacy file on first access", async () => {
    await writeLegacyFile({ "tenant-a": makeSnapshot("tenant-a", 7) });
    expect((await readTenantSnapshot("tenant-a"))?.version).toBe(7);
  });

  it("does not re-import once the table already has rows", async () => {
    await writeLegacyFile({ "tenant-a": makeSnapshot("tenant-a", 7) });
    await writeSnapshot(makeSnapshot("tenant-b", 1));
    expect(pgDb.dump().map((r) => r.tenantId).sort()).toEqual(["tenant-a", "tenant-b"]);

    __resetLegacySnapshotMigrationFlag();
    await readTenantSnapshot("tenant-b");
    expect(pgDb.dump().filter((r) => r.tenantId === "tenant-a")).toHaveLength(1);
  });

  it("is a no-op when there is no legacy file", async () => {
    process.env.ENTERPRISE_POLICY_SNAPSHOT_FILE = path.join(os.tmpdir(), "definitely-absent.json");
    expect(await readTenantSnapshot("tenant-a")).toBeNull();
  });

  it("is a no-op when the legacy file is corrupt", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "policy-snapshot-"));
    const fp = path.join(dir, "policy-snapshot.json");
    await fs.writeFile(fp, "{not-valid-json", "utf-8");
    process.env.ENTERPRISE_POLICY_SNAPSHOT_FILE = fp;
    expect(await readTenantSnapshot("tenant-a")).toBeNull();
  });

  it("retries the migration after a database hiccup instead of marking it done", async () => {
    await writeLegacyFile({
      "tenant-a": makeSnapshot("tenant-a", 7),
      "tenant-b": makeSnapshot("tenant-b", 8),
    });
    pgDb.failNextWriteWith(new Error("ECONNRESET"));

    await expect(readTenantSnapshot("tenant-a")).rejects.toThrow(/ECONNRESET/);
    // 半途失败不能留下部分行，否则重试会被 hasRows 判成"已迁移"。
    expect(pgDb.dump()).toHaveLength(0);

    expect((await readTenantSnapshot("tenant-a"))?.version).toBe(7);
    expect((await readTenantSnapshot("tenant-b"))?.version).toBe(8);
  });
});
