import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  alreadySatisfiedReason,
  excerpt,
  findNonMonotonicEntry,
  pendingMigrations,
  readMigrations,
} from "../migrate-core.mjs";

function fixture(entries) {
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  mkdirSync(join(dir, "meta"));
  writeFileSync(
    join(dir, "meta/_journal.json"),
    JSON.stringify({
      dialect: "mysql",
      entries: entries.map((entry, idx) => ({
        idx,
        version: "5",
        when: entry.when,
        tag: entry.tag,
        breakpoints: true,
      })),
    }),
  );
  for (const entry of entries) writeFileSync(join(dir, `${entry.tag}.sql`), entry.sql);
  return dir;
}

describe("readMigrations", () => {
  it("splits only on the breakpoint marker and keeps drizzle's hash", () => {
    // 切分和 hash 必须和 drizzle-orm 逐字一致，否则两个工具轮流跑过同一个库之后
    // 账本对不上，迁移会重跑或漏跑。
    const dir = fixture([
      { tag: "0000_a", when: 1, sql: "SELECT 1;\n--> statement-breakpoint\nSELECT 2;\n" },
    ]);
    const [migration] = readMigrations(dir);
    expect(migration.statements).toEqual(["SELECT 1;", "SELECT 2;"]);
    expect(migration.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(migration.folderMillis).toBe(1);
  });

  it("keeps a file without any breakpoint as one statement", () => {
    // PG 的 simple query 允许多语句，历史迁移里就有这种；不能自作主张切开。
    const dir = fixture([{ tag: "0000_a", when: 1, sql: "CREATE TABLE a();\nCREATE INDEX i ON a(x);\n" }]);
    expect(readMigrations(dir)[0].statements).toHaveLength(1);
  });
});

describe("pendingMigrations", () => {
  const migrations = [
    { tag: "a", folderMillis: 100 },
    { tag: "b", folderMillis: 200 },
    { tag: "c", folderMillis: 300 },
  ];

  it("takes everything when the ledger is empty", () => {
    expect(pendingMigrations(migrations, null).map((m) => m.tag)).toEqual(["a", "b", "c"]);
  });

  it("takes only what is newer than the last recorded row", () => {
    expect(pendingMigrations(migrations, 200).map((m) => m.tag)).toEqual(["c"]);
  });

  it("takes nothing when the newest is already recorded", () => {
    expect(pendingMigrations(migrations, 300)).toEqual([]);
  });
});

describe("findNonMonotonicEntry", () => {
  it("passes a strictly increasing journal", () => {
    expect(findNonMonotonicEntry([{ tag: "a", folderMillis: 1 }, { tag: "b", folderMillis: 2 }])).toBeNull();
  });

  it("catches a new migration stamped earlier than the one before it", () => {
    // 这条要是漏了，那个迁移永远不会被执行，而且一声不吭——正是最难查的那种。
    expect(
      findNonMonotonicEntry([{ tag: "a", folderMillis: 5 }, { tag: "b", folderMillis: 5 }]),
    ).toEqual({ previous: "a", current: "b" });
  });
});

describe("alreadySatisfiedReason", () => {
  it("lets a duplicate-column error through on MySQL", () => {
    expect(alreadySatisfiedReason("mysql", { errno: 1060 })).toBe("列已存在");
  });

  it("lets a duplicate-index error through on MySQL", () => {
    expect(alreadySatisfiedReason("mysql", { errno: 1061 })).toBe("索引已存在");
  });

  it("does NOT let a missing table through", () => {
    // 1146 是真出事了：表都不在，后面的语句没有一条会是对的。
    expect(alreadySatisfiedReason("mysql", { errno: 1146 })).toBeNull();
  });

  it("does not let a constraint violation through", () => {
    expect(alreadySatisfiedReason("mysql", { errno: 1451 })).toBeNull();
  });

  it("recognises the PostgreSQL duplicate-object codes", () => {
    expect(alreadySatisfiedReason("postgresql", { code: "42701" })).toBe("列已存在");
    expect(alreadySatisfiedReason("postgresql", { code: "23505" })).toBeNull();
  });

  it("returns null when there is no code at all", () => {
    expect(alreadySatisfiedReason("mysql", new Error("socket hang up"))).toBeNull();
  });
});

describe("excerpt", () => {
  it("flattens whitespace so the error line stays one line", () => {
    expect(excerpt("ALTER TABLE a\n  ADD COLUMN b int;")).toBe("ALTER TABLE a ADD COLUMN b int;");
  });

  it("truncates and says how long the original was", () => {
    expect(excerpt("x".repeat(500))).toContain("共 500 字符");
  });

  it("drops the comment header so the failing SQL is what you see", () => {
    // 迁移文件开头常有一整段说明；不剥注释的话截断之后只剩注释，出错的那句看不见。
    expect(excerpt("-- 为什么要加这一列\n-- 又一行说明\nALTER TABLE a ADD COLUMN b int;")).toBe(
      "ALTER TABLE a ADD COLUMN b int;",
    );
  });
});

describe("the real journals", () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

  for (const dir of ["drizzle", "drizzle-mysql"]) {
    it(`keeps ${dir} timestamps strictly increasing`, () => {
      // 待应用集合是按 when 与账本最后一行比出来的。新迁移的 when 要是不比前一条大，
      // 它永远不会被执行，而且不报错 —— 现场表现是「迁移跑过了，表却没变」。
      // 这一条挡在提交时，比等到线上报 unknown column 便宜得多。
      expect(findNonMonotonicEntry(readMigrations(join(packageRoot, dir)))).toBeNull();
    });

    it(`can read every ${dir} migration the journal names`, () => {
      // journal 里写了、文件却不在，drizzle 会跳过它；readMigrations 直接抛。
      const migrations = readMigrations(join(packageRoot, dir));
      expect(migrations.length).toBeGreaterThan(0);
      expect(migrations.every((m) => m.statements.length > 0)).toBe(true);
    });
  }
});
