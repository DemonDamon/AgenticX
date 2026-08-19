/**
 * 迁移执行的纯逻辑部分：读文件、算待应用集合、判断一个错误是不是「已经是目标状态」。
 *
 * 单独拆出来是为了能不连数据库就测——这些判断错了的后果是「迁移没跑但看起来跑了」，
 * 那种故障要等到线上查询报 unknown column 才暴露。
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 按 journal 顺序读出每条迁移。
 *
 * 切分规则、hash 算法、folderMillis 取值都必须和 drizzle-orm 的 readMigrationFiles
 * 一模一样（hash = 整个文件的 sha256，切分只按 `--> statement-breakpoint`），否则同一个
 * 库被两个工具轮流跑过之后，账本对不上，迁移会重跑或漏跑。
 */
export function readMigrations(dir) {
  const journal = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8"));
  return journal.entries.map((entry) => {
    const sql = readFileSync(join(dir, `${entry.tag}.sql`), "utf8");
    return {
      tag: entry.tag,
      folderMillis: entry.when,
      hash: createHash("sha256").update(sql).digest("hex"),
      statements: sql
        .split("--> statement-breakpoint")
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.length > 0),
    };
  });
}

/**
 * 还没应用的那些。
 *
 * drizzle 的判定是「folderMillis 大于账本里最后一行的 created_at」——**按时间戳，不是按
 * 集合**。所以新迁移的 `when` 必须比前一条大，否则它永远不会被执行，而且不报错。
 * 这里顺带把这个陷阱查出来：时间戳没有单调递增就直接拒绝跑。
 */
export function pendingMigrations(migrations, lastAppliedMillis) {
  const cutoff = lastAppliedMillis === null || lastAppliedMillis === undefined
    ? -Infinity
    : Number(lastAppliedMillis);
  return migrations.filter((migration) => migration.folderMillis > cutoff);
}

/** journal 的 when 必须严格递增，否则靠时间戳选待应用集合的逻辑会静默漏掉迁移。 */
export function findNonMonotonicEntry(migrations) {
  for (let index = 1; index < migrations.length; index += 1) {
    const previous = migrations[index - 1];
    const current = migrations[index];
    if (current.folderMillis <= previous.folderMillis) {
      return { previous: previous.tag, current: current.tag };
    }
  }
  return null;
}

/**
 * 这些错误码的意思是「你想要的状态已经在那儿了」。
 *
 * MySQL 没有 `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`，所以手写迁移
 * 天然不可重入：只要有人手工补过一列（现场很常见），整条链就永久卡在那一步。而 MySQL
 * 的 DDL 会隐式提交，drizzle 那个包在外面的事务是假的——前面几条已经落库，账本却没记，
 * 重跑必然再撞同一个错。
 *
 * 所以这里按错误码放行，但**每一条都要打印出来**。跳过和静默失败的区别就在这句日志：
 * 我们说得出跳过了哪一条、为什么跳过；不说的那种才是不能接受的。
 *
 * 名单只收「该语句的目标状态已达成」这一类，不收任何含义模糊的码。1146（表不存在）
 * 之类的一律不放行——那是真出事了。
 */
const ALREADY_SATISFIED = {
  mysql: new Map([
    [1050, "表已存在"],
    [1060, "列已存在"],
    [1061, "索引已存在"],
    [1091, "要删的列/索引本来就不在"],
    [1826, "外键名已存在"],
  ]),
  // PG 的 DDL 在事务里，失败会整条回滚，不会留下半截状态；这几个码列在这里只是为了
  // 让手工补过的库也能继续，而不是因为 PG 也会卡住。
  postgresql: new Map([
    ["42701", "列已存在"],
    ["42P07", "表/索引已存在"],
    ["42710", "对象已存在"],
  ]),
};

/** 已经是目标状态就返回一句人话的原因，否则返回 null（= 真的失败了）。 */
export function alreadySatisfiedReason(dialect, error) {
  const table = ALREADY_SATISFIED[dialect];
  if (!table) return null;
  const code = dialect === "mysql" ? error?.errno : error?.code;
  if (code === undefined || code === null) return null;
  return table.get(code) ?? null;
}

/**
 * 报错时贴出来的那段 SQL，太长就截断——错误信息本身要能一眼看完。
 *
 * 先剥注释：迁移文件开头往往有一整段说明，不剥的话截断之后只剩注释，真正出错的
 * 那句 SQL 一个字都看不见。
 */
export function excerpt(statement, max = 400) {
  const flat = statement
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)} …（共 ${flat.length} 字符）`;
}
