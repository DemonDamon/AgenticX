# 修复 MySQL 方言下大体量深度调研产物写入失败（TEXT 65KB 上限）

Planned-with: claude-opus-5-thinking
Suggested-Impl-Model: cursor-grok-4.5-high-fast（改动集中、落点明确，属"schema 迁移 + 小范围错误暴露"，不需要顶配推理；但涉及 DB 迁移与双方言一致性，不建议用最弱档）

---

## 1. 背景与根因（实施者必读，不要跳过）

### 1.1 现象

Portal 深度调研（deep-research）在 MySQL 方言下，**报告正文越长，越容易只产出 `final-report.md`，没有 `report.html`**。用户在交付偏好里明确选了 HTML，前端交付卡片却只有一个 md 文件。运行本身显示"成功完成"，没有任何报错提示。

### 1.2 根因（已用线上数据证实）

三个事实叠加：

1. **应用层预算远大于 DB 列容量。**
   `enterprise/apps/web-portal/src/lib/deep-research/artifact-store.ts:11` 定义
   `export const MAX_ARTIFACT_BYTES = 512 * 1024;`（524,288 字节）。
   而 MySQL 侧 `enterprise_chat_artifacts.content` 是 `TEXT`，硬上限 **65,535 字节**。
   预算是列容量的 **8 倍**，所以 `truncateContent()`（同文件 55–68 行）和
   `finalize-report-artifacts.ts` 里的 `buildCompactHtml()` 二分截断（66–107 行）
   **永远不会触发** —— 它们都以 512KB 为界，内容早在到达 64KB 时就已超出 DB 能力。

2. **MySQL 处于严格模式，超长即报错而非静默截断。**
   本机实测 `@@sql_mode = IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`（MySQL 8.0.36）。
   `STRICT_TRANS_TABLES` 下插入超长 TEXT 抛 `ER_DATA_TOO_LONG (1406)`，整条 INSERT 失败。

3. **失败被静默吞掉。**
   `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts:1450–1476`：
   ```ts
   try {
     artifactsWritten = await finalizeReportArtifacts({ ... });
   } catch (finalizeError) {
     console.warn(
       "[deep-research] finalizeReportArtifacts failed:",
       finalizeError instanceof Error ? finalizeError.message : finalizeError,
     );
   }
   ```
   只有 server 端 `console.warn`，前端毫无感知，run 依旧标记完成。

**为什么 md 能存下、html 存不下**：HTML 渲染会加上模板 chrome、HTML 转义、Mermaid 思维导图、引用列表，通常是 md 正文的 **约 2 倍体积**。所以 md 约 3 万字节时 HTML 约 6 万字节（勉强过关），md 一旦到 5 万字节以上，HTML 必然超 64KB。

### 1.3 数据证据（本机 `agenticx` 库，按 run 聚合）

| run_id | final-report.md 字节 | report.html 字节 |
|---|---|---|
| 01kz3pen218jgxjk3xpz699m1n | 30,826 | 62,128 ✅ |
| 01kz2k5t6ttvdz7fvd7krjm94z | 39,998 | 63,331 ✅ |
| 01kz2tj3w0z89zeacte9q9yybr | 30,280 | 61,484 ✅ |
| 01kz2xzqk234ddtnenbjnmz4fy | 56,359 | **缺失** ❌ |
| 01kz1namsh9bxsmz75wjw89yqa | 50,994 | **缺失** ❌ |
| 01kz1m1f63tkswbjvjs5h4d0sb | 55,989 | **缺失** ❌ |
| 01kz47a3derv64b4rf5v2kg15j | 59,418 | **缺失** ❌ |

规律无一例外：**成功写入的最大 HTML 是 63,331 字节，紧贴 65,535 上限；所有缺失 HTML 的 run，其 md 都在 5 万字节以上。**

### 1.4 影响面判定

- **PostgreSQL 方言不受影响**：PG 的 `text` 无实际长度上限。本 bug 是 **MySQL-only**。
- 这不是某个分支合并出的错，`main` 与其他分支的相关代码字节一致；只要用 MySQL 就会复现。
- 复现命令（可选，用于自查）：
  ```sql
  -- 在任一 MySQL 库执行，观察 1406 报错
  CREATE TEMPORARY TABLE t_probe (c TEXT NOT NULL);
  INSERT INTO t_probe (c) VALUES (REPEAT('x', 70000));
  ```

---

## 2. 目标

1. 让 MySQL 方言下 512KB 以内的调研产物（HTML / Markdown）都能正常落库。
2. 让"产物写入失败"对用户可见，不再静默丢件。
3. 保持 PG / MySQL 双方言 schema 语义一致，不破坏现有 parity 测试。

---

## 3. In scope / Out of scope

### In scope
- `enterprise/packages/db-schema/src/mysql-schema/chat-artifacts.ts` 的 `content` 列类型。
- `enterprise/packages/db-schema/src/mysql-schema/deep-research-runs.ts` 的 `report_markdown` 列类型（同一根因，见 FR-3）。
- 对应的 MySQL 迁移文件 + journal 条目。
- `orchestrator.ts` 中 HTML 产物失败的用户可见提示。
- 相关单测。

### Out of scope（**禁止顺手改**）
- 不要动 PG schema 的任何列类型（PG `text` 本就没有这个限制，改了反而制造无谓 diff）。
- 不要调整 `MAX_ARTIFACT_BYTES` 的数值（512KB 是产品预算，本次让 DB 追上它，而不是把预算调小）。
- 不要重构 `buildCompactHtml()` 的二分截断逻辑（修完 DB 后它就是正确的兜底了）。
- 不要回填历史缺失的 `report.html`（旧 run 的渲染上下文已丢失，需重跑，不在本次范围）。
- 不要改 `enterprise_chat_messages.content`（聊天正文只放摘要，不放全文报告，当前无超限风险）。
- 不要改任何 auth / gateway / session_grant 相关代码。

---

## 4. 需求与验收标准

### FR-1：`enterprise_chat_artifacts.content` 升级为 `MEDIUMTEXT`

**落点**：`enterprise/packages/db-schema/src/mysql-schema/chat-artifacts.ts`

Before（第 2–10 行的 import，与第 25 行的列定义）：
```ts
import {
  datetime,
  index,
  int,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
...
    content: text("content").notNull(),
```

After：
```ts
import {
  datetime,
  index,
  int,
  mediumtext,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
...
    /** MEDIUMTEXT (16MB): TEXT's 64KB cap truncated large HTML reports. */
    content: mediumtext("content").notNull(),
```

注意：
- `text` 仍被 `path` / `title` 两列使用，**不要删除 text 的 import**。
- `mediumtext` 由 `drizzle-orm/mysql-core` 导出（已在 drizzle-orm 0.45.2 上验证存在）。
- 为什么选 `MEDIUMTEXT`（16,777,215 字节）而不是 `LONGTEXT`：512KB 预算下 MEDIUMTEXT 有 32 倍余量，足够；LONGTEXT 会带来不必要的行外存储与 `max_allowed_packet` 压力（本机 `max_allowed_packet = 67,108,864`）。

**AC-1**：`packages/db-schema/src/mysql-schema/chat-artifacts.ts` 中 `content` 使用 `mediumtext`；`pnpm --filter @agenticx/db-schema typecheck` 通过。

---

### FR-2：新增 MySQL 迁移并登记 journal

**新建文件**：`enterprise/packages/db-schema/drizzle-mysql/0013_chat_artifacts_content_mediumtext.sql`

内容（照抄，注意 `--> statement-breakpoint` 分隔符是 drizzle 约定，不能省）：
```sql
ALTER TABLE `enterprise_chat_artifacts`
  MODIFY COLUMN `content` mediumtext NOT NULL;
--> statement-breakpoint
ALTER TABLE `enterprise_deep_research_runs`
  MODIFY COLUMN `report_markdown` mediumtext NOT NULL;
```

> 第二条**刻意不写 DEFAULT**。drizzle schema 里虽然是
> `reportMarkdown: text("report_markdown").default("").notNull()`（`src/mysql-schema/deep-research-runs.ts:28`），
> 但迁移 `0012_enterprise_deep_research_runs.sql` 生成的 DDL 是 `report_markdown text NOT NULL`，
> 实测线上 `information_schema.columns.COLUMN_DEFAULT` 为 `NULL`——该默认值从未落到物理列，
> 应用层始终显式传值。本次只改类型，**不要顺手补 DEFAULT**，否则会引入与现网不一致的 schema drift
> （若要对齐 default 语义，另开需求处理）。

**修改文件**：`enterprise/packages/db-schema/drizzle-mysql/meta/_journal.json`

在 `entries` 数组末尾追加（当前最后一条是 `idx: 12 / when: 1785700000001 / tag: 0012_enterprise_deep_research_runs`）：
```json
{
  "idx": 13,
  "version": "5",
  "when": 1785800000001,
  "tag": "0013_chat_artifacts_content_mediumtext",
  "breakpoints": true
}
```

关键约束：
- `when` 必须严格大于上一条（1785800000001 > 1785700000001）。
- 本仓库 MySQL journal 的 `when` 约定以 `...1` 结尾、PG 以 `...0` 结尾，请遵守该惯例。
- `drizzle-mysql/meta/` 下**只有** `_journal.json`，没有 snapshot 文件——本仓库的 MySQL 迁移是**手写**的，**不要**运行 `drizzle-kit generate` 让它自动生成（会引入 snapshot 文件、打乱既有编号）。

**AC-2**：
```bash
cd enterprise
DATABASE_DIALECT=mysql DATABASE_URL='mysql://agenticx:agenticx@127.0.0.1:3306/<你的库>' \
  pnpm --filter @agenticx/db-schema db:migrate
```
执行成功，且随后查询列类型返回 `mediumtext`：
```sql
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND ((table_name='enterprise_chat_artifacts'   AND column_name='content')
    OR (table_name='enterprise_deep_research_runs' AND column_name='report_markdown'));
-- 期望两行 COLUMN_TYPE 均为 'mediumtext'
```

---

### FR-3：`enterprise_deep_research_runs.report_markdown` 同步升级

**落点**：`enterprise/packages/db-schema/src/mysql-schema/deep-research-runs.ts:28`

Before：
```ts
    reportMarkdown: text("report_markdown").default("").notNull(),
```
After：
```ts
    /** MEDIUMTEXT (16MB): long reports exceed TEXT's 64KB cap. */
    reportMarkdown: mediumtext("report_markdown").default("").notNull(),
```
并在该文件的 `drizzle-orm/mysql-core` import 中加入 `mediumtext`（保留 `text`，`topic` / `error_message` 仍在用）。

**为什么纳入本次范围**：这是**同一个根因**的另一处受害列。实测已有 59,418 字节的报告正文，距 65,535 上限只剩 6KB；一旦越界，整个 run 的持久化都会失败（比丢 HTML 更严重）。它与 FR-1 共用同一条迁移，不额外增加发布风险。

**AC-3**：schema 与迁移均已改；`pnpm --filter @agenticx/db-schema db:check:parity` 通过。
> parity 测试比对的是 drizzle 的逻辑 `dataType`，`mediumtext` 与 `text` 的 `dataType` 同为 `"string"`（已验证），因此 PG 侧不需要任何改动，测试应保持绿色。

---

### FR-4：产物写入失败对用户可见

**落点**：`enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts:1471–1476`

Before：
```ts
          } catch (finalizeError) {
            console.warn(
              "[deep-research] finalizeReportArtifacts failed:",
              finalizeError instanceof Error ? finalizeError.message : finalizeError,
            );
          }
```

After：
```ts
          } catch (finalizeError) {
            const reason =
              finalizeError instanceof Error ? finalizeError.message : String(finalizeError);
            console.warn("[deep-research] finalizeReportArtifacts failed:", reason);
            enqueueEvent({
              type: "narrative",
              text: `可视化 HTML 版本生成失败（${reason}）。完整正文已保存为 Markdown 交付物，可直接下载查看。`,
            });
          }
```

设计约束：
- **复用已有的 `narrative` 事件类型**（定义见 `enterprise/packages/sdk-ts/src/deep-research.ts:57`），不要为此新增事件类型或改动 SDK 协议——前端 workbench 已经会渲染 `narrative`。
- **不要**把这个错误改成抛出 / 让 run 失败。Markdown 正文已经落库，把整个 run 判失败是回退。当前"best-effort"语义保持不变，只是加一条用户可见提示。
- 使用外层已有的 `enqueueEvent`（不是 `collectArtifactEvent`，后者只用于收集 artifact 事件）。

**AC-4**：`orchestrator.test.ts` 新增一例：注入一个 `write()` 在 `path` 以 `report.html` 结尾时抛错的 stub artifact store，断言
（a）运行仍以完成状态结束、`final-report.md` 产物仍在，
（b）事件流中存在 `type === "narrative"` 且 `text` 含 `"HTML"` 的事件。

---

### FR-5：回归测试

**落点**：`enterprise/apps/web-portal/src/lib/deep-research/artifact-store.test.ts`

新增用例，锁住"预算与列容量"的关系，防止将来有人把列改回 TEXT 或调小预算：

```ts
it("MAX_ARTIFACT_BYTES exceeds MySQL TEXT capacity, so the DB column must be MEDIUMTEXT", () => {
  const MYSQL_TEXT_MAX = 65535;
  expect(MAX_ARTIFACT_BYTES).toBeGreaterThan(MYSQL_TEXT_MAX);
});

it("keeps content within budget instead of failing when oversized", async () => {
  const store = createMemoryArtifactStore();
  const huge = "字".repeat(400_000); // 3 bytes/char in UTF-8 → 约 1.2MB
  const record = await store.write({
    tenantId: "t", userId: "u", sessionId: "s", runId: "r",
    path: "research/r/report.html", title: "t.html",
    kind: "report", mimeType: "text/html", content: huge,
  });
  expect(record.byteSize).toBeLessThanOrEqual(MAX_ARTIFACT_BYTES);
});
```

**AC-5**：`pnpm --filter @agenticx/app-web-portal test` 全绿。

---

## 5. 实施顺序

1. FR-1 + FR-3：改两个 mysql-schema 文件的列类型与 import。
2. FR-2：写迁移 SQL，追加 journal 条目。
3. 跑 `db:migrate` 验证迁移可执行、列类型已变。
4. FR-4：改 orchestrator 的 catch 分支。
5. FR-5 + AC-4：补测试。
6. 全量验证（见下）。

---

## 6. 验证清单（全部必须绿，逐条贴输出）

```bash
cd enterprise

# 1) schema 包
pnpm --filter @agenticx/db-schema typecheck
pnpm --filter @agenticx/db-schema db:check:parity
pnpm --filter @agenticx/db-schema test

# 2) 迁移（对准你本机实际使用的库）
DATABASE_DIALECT=mysql DATABASE_URL='mysql://agenticx:agenticx@127.0.0.1:3306/<你的库>' \
  pnpm --filter @agenticx/db-schema db:migrate

# 3) portal
pnpm --filter @agenticx/app-web-portal typecheck
pnpm --filter @agenticx/app-web-portal test
```

**端到端人工验收**：
按 `bash scripts/start-dev-with-infra.sh --skip-infra --db=mysql --ui=stream --webpack` 启动，
发起一次交付格式选 HTML 的深度调研，主题要能产出 5 万字节以上正文（例如一个宽口径的行业调研题目），
完成后确认交付卡片中**同时**出现 `.html` 与 `.md` 两个产物，并用 SQL 核对：

```sql
SELECT path, byte_size FROM enterprise_chat_artifacts
WHERE run_id = '<新 run_id>' ORDER BY path;
-- 期望能看到 report.html 且 byte_size > 65535
```

---

## 7. 提交要求

- 只 `git add` 本次直接改动的文件：两个 mysql-schema 文件、迁移 SQL、`_journal.json`、`orchestrator.ts`、两个测试文件、以及本 plan 文件。
- 实施前把本 plan 从 `.cursor/plans/pending/` 移回 `.cursor/plans/` 根目录，使 `Plan-File` trailer 路径一致。
- commit trailer（顺序固定，不得增删其它 trailer）：

```
Plan-Id: 2026-08-04-mysql-artifact-content-mediumtext
Plan-File: .cursor/plans/2026-08-04-mysql-artifact-content-mediumtext.plan.md
Plan-Model: claude-opus-5-thinking
Impl-Model: <实际使用的实施模型>
Made-with: Damon Li
```

- commit subject/body 中不得出现客户信息，也不得出现第三方品牌或对标表述。
