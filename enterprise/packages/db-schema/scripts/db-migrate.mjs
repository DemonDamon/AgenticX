#!/usr/bin/env node
/**
 * 按方言执行迁移，**出错时说清楚是哪一条、错在哪**。
 *
 * 原来这里是 spawn `drizzle-kit migrate`。它把驱动抛出的错误吞掉了，只留一个 exit 1 和
 * 一行转圈的 spinner——现场表现是「迁移跑了，但表没变」，而下一次再跑还是同样一行转圈。
 * 数据库的失败必须是响的。
 *
 * 账本语义和 drizzle-orm 完全一致（表名 __drizzle_migrations，hash = 文件 sha256，
 * 按 folderMillis 与账本最后一行比较），所以两个工具可以互相接手同一个库。三处不同：
 *
 * 1. **每条迁移单独记账**，而不是整批跑完再记。MySQL 的 DDL 隐式提交，drizzle 外面那层
 *    事务对 DDL 根本不起作用；批量记账意味着第 5 条失败时前 4 条的成果全部不被承认，
 *    重跑必然再撞一次。
 * 2. 逐条语句执行，失败时打印文件名、第几条、错误码和 SQL 原文。
 * 3. 「已经是目标状态」的错误（列已存在这类）放行并**明确打印跳过了哪一条**，让手工补
 *    过的库也能继续往下走。见 migrate-core 的 alreadySatisfiedReason。
 *
 * 用法：
 *   node scripts/db-migrate.mjs            应用待执行的迁移
 *   node scripts/db-migrate.mjs --status   只看状态，不改库
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  alreadySatisfiedReason,
  excerpt,
  findNonMonotonicEntry,
  pendingMigrations,
  readMigrations,
} from "./migrate-core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const statusOnly = process.argv.includes("--status");

function resolveDialect() {
  const explicit = (process.env.DATABASE_DIALECT || "").trim().toLowerCase();
  const url = (process.env.DATABASE_URL || "").trim();
  if (explicit === "mysql" || explicit === "postgresql") return explicit;
  if (/^mysql:\/\//i.test(url)) return "mysql";
  if (/^postgres(ql)?:\/\//i.test(url)) return "postgresql";
  return "postgresql";
}

function log(line) {
  process.stdout.write(`${line}\n`);
}

/** 两种驱动收敛成同一组四个动作，下面的主流程就不用再分方言写两遍。 */
async function openMysql(url) {
  const { createConnection } = await import("mysql2/promise");
  const connection = await createConnection(url);
  return {
    async ensureLedger() {
      await connection.query(
        "create table if not exists `__drizzle_migrations` (id serial primary key, hash text not null, created_at bigint)",
      );
    },
    async lastAppliedMillis() {
      const [rows] = await connection.query(
        "select created_at from `__drizzle_migrations` order by created_at desc limit 1",
      );
      return rows.length > 0 ? Number(rows[0].created_at) : null;
    },
    async exec(statement) {
      await connection.query(statement);
    },
    async record(hash, folderMillis) {
      await connection.query(
        "insert into `__drizzle_migrations` (`hash`, `created_at`) values (?, ?)",
        [hash, folderMillis],
      );
    },
    close: () => connection.end(),
  };
}

async function openPostgres(url) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return {
    async ensureLedger() {
      await client.query('create schema if not exists "drizzle"');
      await client.query(
        'create table if not exists "drizzle"."__drizzle_migrations" (id serial primary key, hash text not null, created_at bigint)',
      );
    },
    async lastAppliedMillis() {
      const result = await client.query(
        'select created_at from "drizzle"."__drizzle_migrations" order by created_at desc limit 1',
      );
      return result.rows.length > 0 ? Number(result.rows[0].created_at) : null;
    },
    async exec(statement) {
      await client.query(statement);
    },
    async record(hash, folderMillis) {
      await client.query(
        'insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)',
        [hash, folderMillis],
      );
    },
    close: () => client.end(),
  };
}

async function main() {
  const dialect = resolveDialect();
  const url = (process.env.DATABASE_URL || "").trim();
  if (!url) {
    // 原来 drizzle 的配置里写了个 localhost 默认值。迁移是改结构的，连错库比连不上
    // 难查得多——宁可在这里停下。
    log("[db:migrate] ✗ 没有 DATABASE_URL，不猜默认值——连错库比连不上难查得多");
    log("            export DATABASE_URL=$(grep '^DATABASE_URL' enterprise/.env.local | cut -d= -f2- | tr -d \"'\\\"\")");
    process.exit(1);
  }
  const dir = join(root, dialect === "mysql" ? "drizzle-mysql" : "drizzle");
  const migrations = readMigrations(dir);

  // when 不递增时，靠时间戳选待应用集合的那套逻辑会静默漏掉迁移；跑之前就拦。
  const disordered = findNonMonotonicEntry(migrations);
  if (disordered) {
    log(
      `[db:migrate] ✗ journal 的 when 不是递增的：${disordered.current} 不晚于 ${disordered.previous}`,
    );
    log("            按时间戳判定待应用集合，排在后面却时间更早的那条永远不会被执行。");
    process.exit(1);
  }

  const db = dialect === "mysql" ? await openMysql(url) : await openPostgres(url);
  let failed = false;
  try {
    await db.ensureLedger();
    const lastApplied = await db.lastAppliedMillis();
    const pending = pendingMigrations(migrations, lastApplied);
    log(
      `[db:migrate] ${dialect} · 共 ${migrations.length} 条，待应用 ${pending.length} 条`,
    );
    if (pending.length === 0) {
      log("[db:migrate] 已是最新");
      return;
    }
    if (statusOnly) {
      for (const migration of pending) log(`             待应用 ${migration.tag}`);
      return;
    }

    for (const migration of pending) {
      log(`[db:migrate] 应用 ${migration.tag}（${migration.statements.length} 条语句）`);
      for (const [index, statement] of migration.statements.entries()) {
        try {
          await db.exec(statement);
        } catch (error) {
          const satisfied = alreadySatisfiedReason(dialect, error);
          if (satisfied) {
            log(
              `             ↳ 第 ${index + 1} 条跳过：${satisfied}（${dialect === "mysql" ? `errno ${error.errno}` : error.code}）`,
            );
            log(`               ${excerpt(statement, 160)}`);
            continue;
          }
          log(`[db:migrate] ✗ ${migration.tag} 第 ${index + 1}/${migration.statements.length} 条失败`);
          log(`             ${dialect === "mysql" ? `errno ${error.errno}` : `code ${error.code}`}: ${error.message}`);
          log(`             SQL: ${excerpt(statement)}`);
          throw error;
        }
      }
      // 一条迁移跑完立刻记账。整批跑完再记的话，中途失败会让已经落库的 DDL 不被承认，
      // 而 MySQL 的 DDL 是回滚不掉的。
      await db.record(migration.hash, migration.folderMillis);
      log(`             ✓ ${migration.tag}`);
    }
    log(`[db:migrate] 完成，应用了 ${pending.length} 条`);
  } catch {
    failed = true;
  } finally {
    await db.close();
  }
  if (failed) process.exit(1);
}

await main();
