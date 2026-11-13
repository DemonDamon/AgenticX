# GW-05 管理台网关副本视图

Planned-with: grok-4.7-high
Suggested-Impl-Model: grok-4.7-high

**Goal:** 管理员在现有渠道页看到每个网关副本的最后心跳，以及模型服务、渠道、策略、MCP 服务四个核心域的生效时间、版本、错误和内容摘要。策略域版本与当前已发布版本不一致，或任一域有错误，标为未生效；超过 2 分钟没有心跳标为失联。

**D-4（已决策）：** 页面放在渠道页内新增子区块，不新开菜单。心跳保留 7 天，在写入时删除 `last_seen_at` 早于 7 天的行，不新增定时任务。

---

## 根因与证据

复制自主规划 A-06 与 GW-05（2026-11-09 快照，行号已按本 worktree 复核）。

**A-06 配置源分散，没有统一的生效状态。**

- 网关读取约 13 个远端或文件配置源。每个源有自己的轮询器，失败语义各不相同。
- GW-04 已落地统一登记：`enterprise/apps/gateway/internal/configstatus/status.go` 的 `Outcome` / `Registry` / `FillCoreDomains` / `InstanceID`，以及 `enterprise/apps/gateway/internal/server/health.go` 第 98–125 行的 `handleInternalConfigStatus`。`GET /internal/config-status` 返回：

```json
{"instanceId":"<GATEWAY_INSTANCE_ID 或主机名>","startedAt":"...","domains":[Outcome...]}
```

- 鉴权与同组 internal 路由一致：`enterprise/apps/gateway/internal/server/channel_handlers.go` 第 243–254 行 `gatewayInternalAuthorized`，Bearer 来自 `gatewayinternal.SecretFromEnv("GATEWAY_INTERNAL_TOKEN")`。
- 管理台侧 `enterprise/apps/admin-console/src/lib/gateway-internal-auth.ts` 的 `isGatewayInternalAuthorized` 校验同一 token。`api/internal/policy-snapshot/route.ts` 第 7–8 行先调用它，失败返回 `gatewayInternalUnauthorized()`。
- 策略域 `version` 不是单个 publishId。`enterprise/apps/gateway/internal/server/server.go` 第 683–697 行 `policyPublishVersion`：把 `status.Tenants` 的租户 id 按字符串升序排序，再把各租户 `PublishID` 用逗号拼接。空租户集合得到空字符串。
- 管理台已发布快照的单一来源是 `buildPolicySnapshotBundleForGateway()`（`enterprise/features/policy/src/snapshot/writer.ts` 第 188–204 行）。它读 `enterprise_runtime_policy_snapshots`，返回 `{ updatedAt, tenants: Record<tenantId, PolicySnapshot> }`。`PolicySnapshot.publishId` 为可选字符串（`enterprise/features/policy/src/types.ts` 第 136–144 行）。
- 渠道页是 `enterprise/apps/admin-console/src/app/admin/_sections/channels.tsx`。列表数据走 `GET /api/admin/channels`（`src/app/api/admin/channels/route.ts` 第 10–14 行），鉴权 `requireAdminScope(["provider:read"])`。文案在 `messages/zh.json` / `en.json` 的 `pages.admin.channels`（zh 约第 1663 行起）。
- 现状：配置生效状态只在网关进程内，管理台看不到哪个副本生效了哪一版。这是 A-06 的延伸，也是主规划 GW-05 的目标。

**本 worktree 行号复核（与主规划不一致时以代码为准）：**

- `handleInternalConfigStatus` 在 `health.go` 第 104–125 行，不是 `server.go` 第 665 行。路由注册在 `server.go` 第 730 行。
- `server.New` 在 `server.go` 第 114 行创建 `cfgStatus`，第 163–165 行 `NewRegistry`，第 217–264 行组装 `Server` 并 `return srv, nil`。
- `gatewayinternal/http.go` 的 `HTTPGet`（第 26–54 行）使用 `&http.Client{Timeout: 25 * time.Second}`，不替换 `Transport`。默认 Transport 走 `ProxyFromEnvironment`，因此尊重大小写代理环境变量。自定义空 `Transport` 会绕过代理，禁止这样做。
- PG journal 尾部是 idx 73 / `0074_ecp_e4_expert_package`。MySQL journal 尾部是 idx 48 / `0048_ecp_e4_expert_package`。`schema-parity.test.ts` 断言表数量 109，MySQL SQL 清单与 journal 均止于 `0048_ecp_e4_expert_package`。`migration-inventory.test.ts` 断言 PG journal 74 条、磁盘 SQL 76 个（含 2 个已知孤儿）。

---

## 决策（子规划内拍板，不再问用户）

1. **页面位置：** `channels.tsx` 主列表与新建对话框之间渲染相邻组件 `gateway-replicas.tsx`。不改导航、不改 `AppShell`。
2. **保留 7 天：** `HEARTBEAT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000`。每次成功写入后执行 `DELETE WHERE last_seen_at < cutoff`。先 upsert 再删除，当前行的 `last_seen_at` 是本次写入时间，不会被删掉。不用按主键删除读到的旧行，避免并发心跳把刚更新的副本删掉。
3. **`tenant_scope`：** GW-04 的状态 JSON 没有租户字段。写入时若 body 带字符串 `tenantScope` 则截断到 255 字符保存，否则存空字符串。页面不展示、不按租户聚合。
4. **最后心跳时间：** 用管理台收到请求时的时钟写入 `last_seen_at` 与 `updated_at`，不信任网关时钟。`startedAt` 只放在 `status_json` 里。
5. **失联优先：** 状态判定顺序是失联，然后未生效，然后已生效。`now - lastSeenAt >= 2 分钟` 为失联（含恰好 2 分钟）。未生效的条件是：策略域 `version` 与当前已发布版本字符串不相等，或四个核心域任一 `lastError` 去空白后非空。两者都空字符串视为已对齐。
6. **已发布版本：** 与 `policyPublishVersion` 同算法。取快照 `tenants` 的 key 作为租户 id，`publishId` 缺省当空字符串，按租户 id 字节序升序（ASCII 租户 id 与 Go `sort.Strings` 一致）后用逗号拼接。
7. **状态 JSON：** 原样保存网关 POST 的同构对象（`instanceId`、`startedAt`、`domains`）。读 API 返回给页面时去掉每个域的 `source`，页面不渲染快照地址。域的展示名只用文案：模型服务 / 渠道 / 策略 / MCP 服务。
8. **本地心跳地址：** 只在 `enterprise/scripts/start-dev.sh` 里、现有预算地址回落的旁边，用同样方式在 `GATEWAY_ADMIN_HEARTBEAT_URL` 为空且 `GATEWAY_REMOTE_PROVIDERS_URL` 非空时导出默认值。不改启动脚本以外的部署文件。

---

## 精确落点

### 1. 网关：共用状态体与心跳

**`enterprise/apps/gateway/internal/configstatus/status.go`**

在 `FillCoreDomains` 之后新增：

```go
type StatusBody struct {
    InstanceID string    `json:"instanceId"`
    StartedAt  time.Time `json:"startedAt"`
    Domains    []Outcome `json:"domains"`
}

func BuildStatus(reg *Registry, startedAt time.Time) StatusBody
```

行为与今天 `handleInternalConfigStatus` 第 109–124 行相同：`reg.Snapshot()`，`startedAt` 为零时回落到 `reg.StartedAt()`，仍为零则 `time.Now().UTC()`，域列表走 `FillCoreDomains`，`InstanceID()` 填 `instanceId`。

**`enterprise/apps/gateway/internal/server/health.go` 第 98–125 行**

删除本地 `configStatusBody`。`handleInternalConfigStatus` 改为 `writeJSON(w, http.StatusOK, configstatus.BuildStatus(s.configStatus, s.startedAt))`。鉴权分支不动。

**`enterprise/apps/gateway/internal/gatewayinternal/http.go`**

新增 `HTTPPost(url string, body []byte) (int, error)`，对照 `HTTPGet`：

- 非 http(s) 返回错误，不发请求。
- `&http.Client{Timeout: 25 * time.Second}`，不设置 `Transport`。
- `Content-Type: application/json`。
- token 非空时 `Authorization: Bearer <gatewayinternal.SecretFromEnv("GATEWAY_INTERNAL_TOKEN")>`。
- 读完并丢弃最多 `maxBodyBytes` 的响应体，返回状态码。状态码不在这里当成错误。

不改 `HTTPGet` 的行为。

**新建 `enterprise/apps/gateway/internal/configstatus/heartbeat.go`**

- `HeartbeatInterval = 30 * time.Second`。
- `HeartbeatURL()` 读 `GATEWAY_ADMIN_HEARTBEAT_URL` 并 TrimSpace。
- `SendHeartbeat(reg *Registry, startedAt time.Time) error`：URL 不是 http(s) 时返回 nil，不调用 `HTTPPost`。否则 `json.Marshal(BuildStatus(...))`，调用 `HTTPPost`。网络错误或状态码不在 200–299 时返回 error。不在这里打日志。
- `StartHeartbeat(ctx context.Context, reg *Registry, startedAt time.Time, logger *slog.Logger)`：URL 未配置则立即返回，不起 goroutine。否则起一个 goroutine：先发一次，然后每 30 秒发一次，直到 `ctx.Done()`。失败只 `logger.Warn("gateway heartbeat failed", "error", err)`。`logger` 为 nil 时用 `slog.Default()`。goroutine 用 `recover` 包住单次发送，避免把进程打崩。日志不打印 token。

**`enterprise/apps/gateway/internal/server/server.go` 第 263 行 `return srv, nil` 之前**

```go
configstatus.StartHeartbeat(context.Background(), cfgStatus, startedAt, logger)
```

只加这一行。不改 `New` 里其他初始化顺序。

### 2. 表与迁移

新建两份自包含迁移，只建本表和本索引，不 ALTER 其他表。

PG `enterprise/packages/db-schema/drizzle/0075_gateway_instances.sql`：

```sql
CREATE TABLE IF NOT EXISTS "gateway_instances" (
  "instance_id" varchar(255) PRIMARY KEY NOT NULL,
  "tenant_scope" varchar(255) DEFAULT '' NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "status_json" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gateway_instances_last_seen_idx" ON "gateway_instances" ("last_seen_at");
```

MySQL `enterprise/packages/db-schema/drizzle-mysql/0049_gateway_instances.sql`：

```sql
CREATE TABLE IF NOT EXISTS `gateway_instances` (
  `instance_id` varchar(255) NOT NULL,
  `tenant_scope` varchar(255) NOT NULL DEFAULT '',
  `last_seen_at` datetime(6) NOT NULL,
  `status_json` json NOT NULL,
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`instance_id`)
);
--> statement-breakpoint
CREATE INDEX `gateway_instances_last_seen_idx` ON `gateway_instances` (`last_seen_at`);
```

Journal 只追加一条，不改旧条目：

- PG `drizzle/meta/_journal.json`：idx **74**，version `"7"`，when `1789300000000`，tag `0075_gateway_instances`，breakpoints true。
- MySQL `drizzle-mysql/meta/_journal.json`：idx **49**，version `"5"`，when `1789300000001`，tag `0049_gateway_instances`，breakpoints true。

Drizzle 定义：

- 新建 `enterprise/packages/db-schema/src/schema/gateway-instances.ts`，`pgTable("gateway_instances")`，列与上面一致。`status_json` 用 `jsonb`。`last_seen_at` / `updated_at` 用 `timestamp(..., { withTimezone: true })`。索引名 `gateway_instances_last_seen_idx`。
- 新建 `enterprise/packages/db-schema/src/mysql-schema/gateway-instances.ts`，`mysqlTable`，`json` + `datetime({ fsp: 6 })`。列名、可空性与 PG 一致，供 `schema-parity` 对齐。
- `src/schema/index.ts` 与 `src/mysql-schema/index.ts` 在 `gateway-channels` 导出旁边各加一行 `export * from "./gateway-instances"`。

测试断言只改计数和尾部 tag，不把迁移文件名写进应用代码：

- `migration-inventory.test.ts`：journal 长度 74→75，`Array(74)`→`Array(75)`，磁盘 SQL 76→77，尾部四条改为 `0072`…`0075_gateway_instances`。
- `schema-parity.test.ts`：表数量 109→110；MySQL SQL 文件清单与 journal `expect.objectContaining` 列表末尾追加 `0049_gateway_instances`。

### 3. 管理台 store

参照 `src/lib/gateway-channels-store.ts` 的方言分发，以及 `postgresql/ecp-tenant-settings-store.ts` 的 `onConflictDoUpdate`、`mysql/budget-store.ts` 的 `onDuplicateKeyUpdate`。

- `src/lib/db-stores/postgresql/gateway-instances-store.ts`
- `src/lib/db-stores/mysql/gateway-instances-store.ts`
- `src/lib/gateway-instances-store.ts`（门面，算法只写在这里）

门面导出：

```ts
export const HEARTBEAT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type GatewayInstanceRepository = {
  upsert(row: GatewayInstanceRow): Promise<void>;
  deleteLastSeenBefore(cutoff: Date): Promise<void>;
  list(): Promise<GatewayInstanceRow[]>;
};

export async function recordGatewayHeartbeat(input: HeartbeatWrite): Promise<void>
export async function listGatewayInstances(): Promise<GatewayInstanceRow[]>
export function __setGatewayInstanceRepositoryForTests(repo: GatewayInstanceRepository | null): void
```

`recordGatewayHeartbeat`：

1. 取 `now = new Date()`。
2. `repo.upsert`，`lastSeenAt` 与 `updatedAt` 都是 `now`，`statusJson` 是校验后的对象。
3. `repo.deleteLastSeenBefore(new Date(now.getTime() - HEARTBEAT_RETENTION_MS))`。

`__setGatewayInstanceRepositoryForTests` 仅当 `NODE_ENV === "test"` 时生效，否则抛错。设置后门面不再碰真实库。生产路径：`resolveDatabaseConfig().dialect === "mysql"` 用 MySQL repository，否则用 PG。

PG repository：`getIamDb()`。`insert().values().onConflictDoUpdate({ target: instanceId, set: { tenantScope, lastSeenAt, statusJson, updatedAt } })`。删除用 `lt(lastSeenAt, cutoff)`。列表 `select().from().orderBy(desc(lastSeenAt))`。

MySQL repository：`getAdminMysqlDb()`。`onDuplicateKeyUpdate({ set })`。删除与列表语义相同。

`GatewayInstanceRow.statusJson` 形状：

```ts
{
  instanceId: string;
  startedAt: string;
  domains: Array<{
    domain: string;
    appliedAt: string;
    version: string;
    lastError: string;
    contentHash: string;
    checkedAt: string;
    consecutiveFailures: number;
  }>;
}
```

只保留四个核心域，顺序固定为 `providers`、`channels`、`policy`、`mcp_servers`。缺的域补空字段。`lastError` 截断到 1000 字符。不把 `source` 写入 `statusJson`。

### 4. 心跳写入路由

新建 `enterprise/apps/admin-console/src/app/api/internal/gateway-heartbeat/route.ts`。

```ts
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isGatewayInternalAuthorized(request)) return gatewayInternalUnauthorized();
  // 解析 JSON。instanceId 必填，trim 后长度 1–255。
  // 失败返回 400 { code: "40000", message: "invalid request" }。
  await recordGatewayHeartbeat(parsed);
  return NextResponse.json({ code: "00000", message: "ok" });
}
```

鉴权 import 与 `policy-snapshot/route.ts` 相同：`../../../../lib/gateway-internal-auth`。

### 5. 读取 API 与状态函数

新建 `enterprise/apps/admin-console/src/lib/gateway-replica-status.ts`（无 `"use client"`，服务端与单测共用）：

```ts
export const REPLICA_OFFLINE_AFTER_MS = 2 * 60 * 1000;
export type ReplicaStatus = "applied" | "pending" | "offline";

export function policyPublishVersion(
  tenants: Array<{ tenantId: string; publishId: string }>,
): string

export function classifyReplica(input: {
  lastSeenAt: Date;
  now: Date;
  domains: Array<{ domain: string; version?: string; lastError?: string }>;
  publishedPolicyVersion: string;
}): ReplicaStatus
```

`policyPublishVersion` 排序后 `publishId` 用逗号连接，没有租户时返回 `""`。

`classifyReplica`：`lastSeenAt` 无效，或 `now - lastSeenAt >= REPLICA_OFFLINE_AFTER_MS`，返回 `offline`。否则策略域 version（没有该域当 `""`）trim 后不等于 `publishedPolicyVersion.trim()`，或任一域 `lastError` trim 后非空，返回 `pending`。否则 `applied`。

新建 `enterprise/apps/admin-console/src/app/api/admin/gateway-instances/route.ts`：

- `GET` 调用 `requireAdminScope(["provider:read"])`，与渠道列表相同。失败原样返回其 response。
- `buildPolicySnapshotBundleForGateway()` 得到租户快照，用 `policyPublishVersion` 计算已发布版本。`publishId` 不是字符串时当 `""`。
- `listGatewayInstances()` 后对每行调用 `classifyReplica`，`now` 为请求处理时的 `new Date()`。
- 返回 `{ code: "00000", message: "ok", data: { publishedPolicyVersion, instances } }`。每个 instance 含 `instanceId`、`lastSeenAt`（ISO）、`status`、`domains`（四个核心域的 `appliedAt`、`version`、`lastError`、`contentHash`）。响应里不出现 `source`。
- 异常返回 500 `{ code: "50000", message: "gateway instances unavailable" }`，不把底层异常原文回给浏览器。

### 6. 渠道页子区块

新建 `enterprise/apps/admin-console/src/app/admin/_sections/gateway-replicas.tsx`，`"use client"`。

- `adminFetch("/api/admin/gateway-instances")`，失败 `toast.error`。
- 挂到 `channels.tsx` 的渠道网格结束之后、`<Dialog open={open}` 之前（当前约第 446–448 行），即 `{loading ? ... : ...}` 块之后：`<GatewayReplicas />`。
- 样式沿用渠道页：外层间距、`Card` / `CardContent`、`Badge`、`Button`、`EmptyState`、`RefreshCcw`。不新造视觉语言。
- 区块标题用文案「网关副本」。每张卡片是一个副本：副本标识、最后心跳的本地化时间、状态徽章。
- 徽章：`applied` → `Badge variant="success"` 已生效；`pending` → `variant="warning"` 未生效；`offline` → `variant="soft"` 失联，卡片加 `opacity-60`。
- 卡片内四行，标签只用文案键，禁止把 `providers` 等域 key 渲染出来。每行展示生效时间、版本、错误；`contentHash` 非空时再展示前 12 位，标签为「内容摘要」。空值显示「—」。
- 区块下方一行弱提示展示当前已发布策略版本；空字符串显示「尚未发布」。不出现 publishId 这个单词，不出现环境变量名或文件路径。
- 空列表用 `EmptyState`。提供刷新按钮，不另做定时轮询。

文案加在 `messages/zh.json` 与 `messages/en.json` 的 `pages.admin.channels.replicas` 下，两边键集合一致。中文界面用中文。不改 `shell.nav`。不改渠道页已有的、提到环境变量的旧描述。

### 7. 本地开发脚本

`enterprise/scripts/start-dev.sh` 第 160–163 行预算地址回落之后追加：

```sh
if [ -z "${GATEWAY_ADMIN_HEARTBEAT_URL:-}" ] && [ -n "${GATEWAY_REMOTE_PROVIDERS_URL:-}" ]; then
  export GATEWAY_ADMIN_HEARTBEAT_URL="${GATEWAY_REMOTE_PROVIDERS_URL%/api/internal/providers}/api/internal/gateway-heartbeat"
fi
```

不打印该变量的值。

---

## FR / AC

- **FR-1** 网关每 30 秒把与 `/internal/config-status` 相同结构的 JSON POST 到心跳地址；地址未配置则不发送；失败只记 Warn。
  - **AC-1** `enterprise/apps/gateway/internal/configstatus/heartbeat_test.go`
    - `GATEWAY_ADMIN_HEARTBEAT_URL` 为空时 `SendHeartbeat` 返回 nil。断言依据：`HTTPPost` 对空地址会返回错误，因此 nil 表示没有调用它。
    - httptest：请求带 `Authorization: Bearer <token>`，JSON 含 `instanceId` 与 4 个域 `providers`、`channels`、`policy`、`mcp_servers`。
    - 测试里清空 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` 的大小写形式，避免代理把 httptest 转走。
- **FR-2** 管理台 internal 路由鉴权后 upsert 心跳，并在写入时删除 7 天前的行。
  - **AC-2** `enterprise/apps/admin-console/src/app/api/internal/gateway-heartbeat/__tests__/route.test.ts`
    - 未授权：401，且内存仓库行数不变。
    - 合法 body：200 `{ code: "00000" }`，仓库出现该 `instanceId`。
    - 同一 `instanceId` 再 POST 一次不同 `version`：仍只有一行，版本是第二次的。
    - 预先放入 `lastSeenAt` 为 8 天前和 6 天前的两行，再 POST 一个新副本：8 天前的行消失，6 天前的行还在，新行在。
    - 缺 `instanceId`：400，不写入。
- **FR-3** 页面状态三态与已发布策略版本对齐。
  - **AC-3** `enterprise/apps/admin-console/src/lib/gateway-replica-status.test.ts`
    - 租户顺序 `t-b` 再 `t-a` 得到 `pub-a,pub-b`。无租户得到 `""`。
    - 心跳年龄 119999ms、版本一致、无错误 → `applied`。
    - 年龄恰好 120000ms → `offline`。非法日期 → `offline`。
    - 新鲜心跳但策略 version 与已发布版本不同 → `pending`。
    - 版本一致但渠道域 `lastError` 非空 → `pending`。
    - 失联且同时有错误 → `offline`（失联优先）。
    - 两边版本都是空且无错误 → `applied`。
- **FR-4** 渠道页能读到副本列表。读取 API 使用渠道页同一权限。
  - **AC-4** `src/app/api/admin/gateway-instances/__tests__/route.test.ts`：未登录 401 且不读库；已授权时，快照租户顺序与网关 version 不一致则该副本 `status === "pending"`，响应 JSON 不含 `source`。

---

## 测试命令

在 `enterprise/apps/gateway` 下先 unset `http_proxy` `https_proxy` `HTTP_PROXY` `HTTPS_PROXY` `all_proxy` `ALL_PROXY`，再：

- `go test ./... -count=1`
- `go vet ./...`

改动过的 Go 文件 `gofmt` 正确，不重排其他文件。

然后在 `enterprise/`：

- `npx pnpm@9.12.0 install --no-frozen-lockfile`（需要时 `http_proxy=https_proxy=http://127.0.0.1:7900`）
- `npx pnpm@9.12.0 --filter @agenticx/db-schema test`
- `npx pnpm@9.12.0 --filter @agenticx/app-admin-console test`
- `npx pnpm@9.12.0 --filter @agenticx/app-admin-console typecheck`

管理台既有 8 个失败套件与既有 typecheck 错误不修。新增或改动的文件不得新增失败或类型错误。改了 `messages/*.json` 后，若全量测试的失败集合变大，用 `git stash` 对比这 8 个套件，确认没有新的失败。

---

## In scope

- 心跳发送、共用 `BuildStatus`、`HTTPPost`、`server.New` 启动。
- `gateway_instances` 的 PG 与 MySQL 迁移、drizzle 定义、journal、inventory / parity 断言。
- internal 写入路由、admin 读取路由、两套 store、渠道页子区块与中英文案。
- `start-dev.sh` 的心跳 URL 默认值。
- 上面列出的测试。

## Out of scope

- 推送式配置下发、跨租户聚合、告警通知、定时清理任务。
- 将其余配置源接入 `configstatus`。
- 改导航、改门户、改桌面端、改 Python 运行时。
- 改 `bootstrap.sh`、compose 文件或其他部署清单里的网关环境变量。
- 修复管理台既有失败测试和既有 typecheck 错误。
- 改渠道页里与本需求无关的文案、布局和交互。
- 在应用代码里硬编码迁移文件名。

---

## 观察到但未处理

- `enterprise/scripts/bootstrap.sh` 以及 `enterprise/deploy/docker-compose/` 下若干文件也会导出 `GATEWAY_REMOTE_*_URL`。本次只按任务要求补 `start-dev.sh`。
- 渠道页现有描述里已经出现环境变量名。那是旧文案，本次不改。
- `start-dev.sh` 末尾按应用打印本地端口的 echo 含有既有产品名，本次不改、不引用。
- `/internal/config-status` 的 `source` 仍会随心跳 body 到达路由，写入前被丢掉，避免快照地址进库。页面因此看不到源地址。
