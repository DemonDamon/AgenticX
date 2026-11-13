# REG-01 托管 MCP 草稿与发布

Planned-with: grok-4.7-high
Suggested-Impl-Model: grok-4.7-high

**Goal:** 托管 MCP 的工具面（`mcp_tools` 与 `backend_config`）可以按版本保存草稿并发布。网关在 `published_version_id` 非空时只使用该已发布版本；为空时继续读现有 `mcp_tools`。上线/下线仍用 `mcp_servers.status`。不接审批。

**决策 D-5：** 不接审批。有 `provider:update` 的管理员直接发布。不改 `ecp-approval-store.ts`。

---

## 根因与证据

**A-08 托管 MCP 没有版本和发布流程。**

- `enterprise/packages/db-schema/drizzle/0027_mcp_hosting.sql`：`mcp_servers.status` 默认 `'active'`，`mcp_tools` 没有版本列。当前 drizzle 定义在 `enterprise/packages/db-schema/src/schema/mcp-servers.ts` 第 6–27 行、`mcp-tools.ts` 第 6–26 行；MySQL 镜像为 `src/mysql-schema/mcp-servers.ts`、`mcp-tools.ts`。基线表还在 `drizzle-mysql/0000_mysql_baseline.sql` 第 442–473 行。
- 网关 `enterprise/apps/gateway/internal/mcphost/registry.go`：`GetByName` 第 35–39 行只查 `status = 'active'`，第 58–62 行一律 `loadTools`；`ListActive` 第 70–74 行同样只按 active 过滤，第 102–106 行一律 `loadTools`。`loadTools` 第 112–117 行读取全部 `enabled = true` 的 `mcp_tools`。
- 管理台写入在 `enterprise/apps/admin-console/src/lib/db-stores/postgresql/mcp-servers-store.ts`（MySQL 副本 `db-stores/mysql/mcp-servers-store.ts` 同结构）：`updateMcpServer` 第 147–161 行直接改 `backend_config`；`replaceMcpTools` 第 176–196 行先删后插 `mcp_tools`；`importOpenAPITools` 第 277–309 行先 `updateMcpServer` 再 `replaceMcpTools`。API：`PUT /api/admin/mcp-servers/[id]`（`[id]/route.ts` 第 31–46 行）与 `POST .../openapi`（`openapi/route.ts` 第 7–26 行）。权限是 `provider:read` / `provider:update`（`requireAdminScope`）。
- 页面 `enterprise/apps/admin-console/src/app/admin/_sections/mcp-servers.tsx`：点「健康面板」`loadHealth`（第 308–317 行）记下 `selectedId`，OpenAPI 导入卡（第 794–830 行）对这个 id 调 `importOpenAPI`（第 320–340 行）。没有版本列表。
- `tools/list` 走 `host.listTools` → backend。OpenAPI backend `backend_openapi.go` 第 87–98 行：**`len(rec.Tools) > 0` 时只用 `rec.Tools`**，否则回退解析 `backend_config` 里的 OpenAPI。因此只要 `GetByName` 把已发布版本的工具放进 `rec.Tools`，`tools/list` 就不会看到草稿。空工具列表会掉进回退，必须另加标记（见下方新增落点）。
- 对照 U-06：资源带版本，生命周期含 draft → publish，以及 online/offline。本子规划只做 draft/published 加现有 `mcp_servers.status`，不引入 review。
- 技能货架的 `shelf_status` 命名见 `platform-catalog.ts` 第 51 行 `shelfStatus`，默认 `draft`。`effectiveVersionId`（第 25 行）是可空列、**没有**指向版本表的外键。本表的 `published_version_id` 同样不建外键，避免 `mcp_servers` ↔ `mcp_server_versions` 循环删除。

---

## 存量 server 首次编辑（必须遵守）

现网：重新导入或 `replaceMcpTools` / 带 `backendConfig` 的更新会立刻改 `mcp_tools` 与 `mcp_servers.backend_config`。`published_version_id` 为空时网关读的就是这两处，所以编辑立刻对网关可见。

原则「未发布前网关看到的工具面不变」如果用在**从未建过版本**的 server 的第一次导入/编辑上，就只能不写 `mcp_tools`。那会改变上述即时生效，任务禁止自行拍板。

**因此本计划不改变这条存量路径：**

- **未启用版本管理**（`published_version_id` 为空，且 `mcp_server_versions` 没有该 server 的行）：`importOpenAPITools`、`replaceMcpTools`、`updateMcpServer` 的 `backendConfig` **仍立即写活表**。不插入 draft。网关行为与今天相同。
- **进入版本管理的唯一入口**是新动作「发布当前工具面」：把当前 `mcp_tools` 与库里已有的 `backend_config`（保持落库形态，不解密再加密）记为 version=1、`shelf_status=published`，并设置 `published_version_id`。工具内容不改，网关改从这份快照读，可见工具面不变。
- **已启用之后**（已有 `published_version_id`，或已有任意版本行）：再次导入、`replaceMcpTools`、或更新 `backendConfig`，只插入新的 draft（version = max+1）。不改 `mcp_tools`，不改 `mcp_servers.backend_config`。网关继续用已发布版本。
- 发布 draft：该行改为 `published`，`published_version_id` 指向它，然后把该版本的工具与 `backend_config` **回写**活表，使活表与网关权威版本一致。
- 回滚：只允许指向另一条 `shelf_status=published` 的版本。同样回写活表。不把旧版本改回 draft。

这与主规划「任意重新导入都先变草稿」有一处偏离，理由就是上面的存量即时生效约束。偏离记在文末。

`backend_type`、`status`、显示名、transport、scopes、rate limit 不进版本。上线/下线仍改 `status`（`active` / `disabled`），立即生效。

---

## 精确落点

### 1. Schema 与迁移

新文件（PG / MySQL 各一份）：

- `enterprise/packages/db-schema/src/schema/mcp-server-versions.ts`
- `enterprise/packages/db-schema/src/mysql-schema/mcp-server-versions.ts`

并在两个 `index.ts` 里紧跟 `mcp-tools` 的 export 之后各加一行 `export * from "./mcp-server-versions"`。

`mcp_servers` 增加可空列，插在 `status` 与 `rateLimit` 之间（`mcp-servers.ts` 第 19 行之后）：

```ts
publishedVersionId: ulid("published_version_id"),
```

MySQL 文件同样加这一列。不 `.references()` 版本表。

`mcp_server_versions` 列（两边逻辑类型必须一致，供 `schema-parity.test.ts`）：

| 列 | 类型 | 约束 |
| --- | --- | --- |
| id | varchar(26) | PK |
| server_id | varchar(26) | NOT NULL，FK → mcp_servers.id ON DELETE CASCADE |
| version | integer / int | NOT NULL，从 1 递增 |
| tools_json | jsonb / json | NOT NULL，默认 `[]` |
| backend_config_json | jsonb / json | NOT NULL，默认 `{}` |
| content_hash | varchar(64) | NOT NULL |
| shelf_status | varchar(16) | NOT NULL，默认 `draft`，仅 `draft` 或 `published` |
| created_by | varchar(128) | 可空 |
| created_at | timestamptz / datetime(6) | NOT NULL，默认 now |
| published_at | timestamptz / datetime(6) | 可空 |

唯一索引 `(server_id, version)`：`mcp_server_versions_server_version_uq`。普通索引 `(server_id, shelf_status)`：`mcp_server_versions_server_status_idx`。

不要 `updated_at`。迁移**不** INSERT 任何存量版本。

迁移文件（自包含，带 `--> statement-breakpoint`）：

- `enterprise/packages/db-schema/drizzle/0075_mcp_server_versions.sql`
- `enterprise/packages/db-schema/drizzle-mysql/0049_mcp_server_versions.sql`

Journal：

- PG `drizzle/meta/_journal.json` 追加 idx **74**、tag `0075_mcp_server_versions`、when `1789300000000`。当前最后一条是 idx 73 / `0074_ecp_e4_expert_package`（约第 516–522 行）。
- MySQL `drizzle-mysql/meta/_journal.json` 追加 idx **49**、tag `0049_mcp_server_versions`、when `1789300000001`。当前最后一条是 idx 48 / `0048_ecp_e4_expert_package`。

断言（这些测试文件是允许出现迁移文件名的唯一位置；网关与管理台代码禁止写死 `0075` / `0049`）：

- `src/__tests__/migration-inventory.test.ts`：journal 长度 74→75，idx 为 `0..74`，末尾 tag 加上 `0075_mcp_server_versions`；磁盘 SQL 76→77。
- `src/__tests__/schema-parity.test.ts`：表数量 109→110；MySQL SQL 列表与 journal 期望数组末尾加上 `0049_mcp_server_versions`。
- 合入集成分支时，GW-05 已占用 PG 0075 / MySQL 0049，本迁移顺延为 PG `0076_mcp_server_versions`（idx 75）与 MySQL `0050_mcp_server_versions`（idx 50），上述计数随之各加一。

`tools_json` 元素（snake_case，与网关解析一致）：

```json
{
  "tool_name": "findPets",
  "description": "",
  "input_schema": {},
  "output_schema": null,
  "enabled": true,
  "source_operation_id": "findPets",
  "metadata": {}
}
```

`content_hash` = SHA-256 hex（64 字符）。输入是稳定 JSON：`backend_config` 与按 `tool_name` 排序后的 tools，对象键递归排序。`backend_config` 用**落库形态**（可能已是密文信封），避免把明文密钥写进哈希材料的另一种形态。

`backend_config` 加密沿用 `encryptBackendConfig` / `decryptBackendConfig`（`mcp-backend-config-crypto.ts`）。版本里的 `backend_config_json` 存落库形态。网关继续用现有 `decodeBackendConfig`。

### 2. 网关

`registry.go` 的两条 SELECT 都多读 `published_version_id`（可空）。占位符仍用 `?`，由现有 `database.Handle` 的 `Rebind` 处理 PG `$n` 与 MySQL `?`。

- 空：`BackendConfig = decodeBackendConfig(行内 backend_config)`，`Tools = loadTools`（第 112–147 行函数不动），`ToolsFromPublishedVersion = false`。
- 非空：`SELECT tools_json, backend_config_json FROM mcp_server_versions WHERE id = ? AND shelf_status = 'published' LIMIT 1`。命中则用该行构造 `Tools`（只保留 `enabled != false`，按 `tool_name` 升序）和 `BackendConfig`，并设 `ToolsFromPublishedVersion = true`。无行或 JSON 非法：返回错误，**不**回退 `loadTools`（避免把草稿或旧活表当成已发布面）。

`ServerRecord`（`types.go` 第 34–46 行）增加：

```go
ToolsFromPublishedVersion bool
```

**新增落点（主规划文件清单之外，不改则 AC 不成立）：** `backend_openapi.go` `ListTools` 第 91–98 行。今天 `len(rec.Tools)==0` 会回退解析 OpenAPI，已发布版本若工具为空，会把 `backend_config` 里的规格工具暴露出去。改为 `ToolsFromPublishedVersion || len(rec.Tools) > 0` 时只返回 `rec.Tools` 里 enabled 的项（可以是空列表）。不改 `CallTool`。连接器与 echo backend 本来就不读 `rec.Tools`，本次不改（见文末）。

### 3. 管理台状态机

新文件 `enterprise/apps/admin-console/src/lib/mcp-server-versions.ts`（纯函数，无数据库）：

- `versionManaged(publishedVersionId, versionCount)`
- `nextVersionNumber(existing)`
- `surfaceContentHash(tools, storedBackendConfig)`
- `toolToStoredJson` / `storedJsonToTool`
- `assertCanPublishCurrent` / `assertCanPublishDraft` / `assertCanRollback`
- `applySurfaceWrite` / `applyPublishCurrent` / `applyPublishDraft` / `applyRollback`
- `gatewayVisibleTools(state)`：有 `publishedVersionId` 时取该已发布版本里 enabled 的工具，否则取活表 enabled 工具

PG 与 MySQL 两个 `mcp-servers-store.ts` 都调用这些函数，避免两套方言各写一套判断。

`McpServerRecord` 增加 `publishedVersionId: string | null`。`rowToServer`（约第 68–82 行）填上。

行为：

- `importOpenAPITools` 增加可选第 5 参 `createdBy?: string`。返回值从 `McpServerRecord` 改为 `{ server, draft: { id, version, shelfStatus } | null }`。未启用：保持现在的 `updateMcpServer` + 写活表，`draft` 为 null。已启用：只插 draft，`server` 仍是写前的活记录。
- `replaceMcpTools`：未启用走现有删插；已启用插 draft（backend 取已发布版本的落库 config，没有指针则取活表落库 config），函数仍返回**活表**工具列表。
- `updateMcpServer`：`displayName` / `transport` / `backendType` / `requiredScopes` / `status` / `rateLimit` 始终直接更新。`backendConfig` 在未启用时仍立即加密写入；已启用时不改活列，改为 draft（工具取已发布版本，没有则取活表工具）。`UpdateMcpServerInput` 增加可选 `createdBy`，只由路由从会话写入，不信任请求体。
- 新函数：`listMcpServerVersions`、`publishCurrentMcpSurface`、`publishMcpServerVersion`、`rollbackMcpServerVersion`。列表项只有 id、version、shelfStatus、createdBy、createdAt、publishedAt、toolCount。不把 `tools_json` / `backend_config_json` 返回给浏览器。
- 门面 `src/lib/mcp-servers-store.ts` 按现有 dialect 转发，签名与 PG 实现一致。

路由：

- `POST .../openapi/route.ts`：把 `auth.session.userId` 传给 import；响应 `data.draft` 可为 null。权限仍是 `provider:update`。
- `PUT .../[id]/route.ts`：`createdBy` 用会话 userId，忽略 body 里的同名字段。
- 新 `.../[id]/versions/route.ts`：`GET` 要 `provider:read`；`POST` 要 `provider:update`。body `{ action: "publish_current" | "publish" | "rollback", versionId?: string }`。`publish` / `rollback` 必须有 `versionId`。switch 用 `never` 默认分支。

### 4. UI

`mcp-servers.tsx`：`selectedId` 已由健康面板设置。在 OpenAPI 导入卡（第 794 行）之前，当 `selectedId` 非空时加一张版本卡：版本号、状态、创建时间、发布时间、工具数。「发布」只给 draft；「回滚到此版本」只给已发布且不是当前指针的行。没有版本时显示「发布当前工具面」。回滚用已有 `Dialog`，取消在左、确认在右，不用 `window.confirm`。导入成功若 `data.draft` 非空，toast 说明已存为草稿。文案进 `messages/zh.json` 与 `messages/en.json` 的 `pages.admin.mcpServers`（约第 1493 行一段），不写内部路径、表名或环境变量。现有删除确认保持不动。

---

## Before / after

**网关 `GetByName`（`registry.go` 第 46–62 行附近）：**

before：扫完行后无条件 `loadTools`。

after：SELECT 多一列。`published_version_id` 为空走原来的 `loadTools` 与行内 `backend_config`。非空则只读那一条 `shelf_status='published'` 的版本；工具与 `backend_config` 都来自该行。

**导入（`importOpenAPITools` 第 299–306 行）：**

before：总是 `updateMcpServer` + `replaceMcpTools`。

after：`versionManaged` 为假时与 before 相同。为真时只 `insert` draft，活表两列保持原样。

---

## FR / AC

- **FR-1** 新表与可空 `published_version_id`。迁移不给存量行生成版本。
- **FR-2** 网关：无版本的 server，`GetByName` / `ListActive` / `tools/list` 与今天一致，且不查询 `mcp_server_versions`。
- **FR-3** 有已发布指针时，`tools/list` 只有该版本里 enabled 的工具；草稿工具不出现。`backend_config` 来自该版本。空工具列表也不回退 OpenAPI 规格。
- **FR-4** 未启用版本管理时，导入仍立即改活表。
- **FR-5** 「发布当前工具面」后指针指向 v1，网关可见工具名不变。之后导入生成 draft，发布前可见工具名仍是 v1。发布后指针指向 draft。回滚后指针回到 v1。
- **FR-6** 发布与回滚走 `provider:update`。回滚有二次确认。不调用审批 store。
- **FR-7** `status` 仍表示上线/下线。

**AC-1 网关** `enterprise/apps/gateway/internal/mcphost/registry_version_test.go`（进程内 `database/sql` 假驱动，仿 `entitlement_chain_test.go`，不新增依赖；MySQL 与 PostgreSQL 两种 `Dialect` 都跑）：

- 存量：`published_version_id` 为空时工具来自 `mcp_tools`，`base_url` 来自行内 config，查询日志里没有 `mcp_server_versions`。`tools/list` 名字与活表一致。
- 已发布：只出现版本内 enabled 工具；`enabled:false` 与另一条 draft 的工具名都不在 `tools/list`。`base_url` 是版本里的值，不是 `mcp_servers` 行里的值。此路径不查询 `mcp_tools`。
- 已发布版本工具数组为空，但 `backend_config.openapi_json` 含 `shouldNotAppear`：`tools/list` 的 tools 为空。
- 指针指向的行不是 published 或不存在：`GetByName` 返回错误。
- `ListActive` 同时返回一台存量 server 与一台已发布 server，工具面按上面的规则分开，不串。

**AC-2 管理台** `enterprise/apps/admin-console/src/lib/__tests__/mcp-server-versions.test.ts`：

- 未启用时 `applySurfaceWrite` 改活表工具，不产生版本；`gatewayVisibleTools` 变为新工具（断言这条存量即时生效仍在）。
- `applyPublishCurrent` 后指针是 v1，`gatewayVisibleTools` 的名字与发布前相同。
- 再次 `applySurfaceWrite` 增加 draft，活表与 `gatewayVisibleTools` 不变。
- `applyPublishDraft` 后 `publishedVersionId` 等于该 draft 的 id，可见工具变为 draft。
- `applyRollback` 后指针回到 v1，可见工具回到 v1。
- 回滚到 draft、发布一条已是 published 的行、对已有版本再 `applyPublishCurrent`，都抛错。
- `surfaceContentHash` 不随键顺序或工具数组顺序变化。

**AC-3 命令**

- `cd enterprise/apps/gateway && unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy && go test ./... -count=1 && go vet ./...`
- 改动过的 Go 文件 `gofmt` 干净，不重排其他文件。
- `cd enterprise && npx pnpm@9.12.0 install --no-frozen-lockfile` 后：`--filter @agenticx/db-schema test`、`--filter @agenticx/app-admin-console test`、`--filter @agenticx/app-admin-console typecheck`。管理台既有 8 个失败套件与既有 typecheck 错误不修。本次新增或修改的文件不得出现新的失败或类型错误。

---

## In scope / Out of scope

**In scope：** 上面的表、两条网关读路径、OpenAPI `ListTools` 的空列表标记、管理台导入/替换/backendConfig 的分支、发布当前面/发布 draft/回滚、版本列表 UI 与中英文案、对应测试与迁移清单断言。

**Out of scope：** Prompt / Agent 资源、`latest` / `stable` 标签、可见性、跨租户分发、审批、`ecp-approval-store.ts`、连接器与 echo 的 `ListTools`、MCP 反代（`mcp-proxy-store`）、把存量删除确认从 `window.confirm` 换成 Dialog、改 `status` 语义、自动给存量数据生成版本、在网关或管理台业务代码里写死迁移文件名。

**no-scope-creep：** 不重构两个 store 的健康统计 SQL，不改专家包同步的插入列（新列可空，省略即可），不改门户。

---

## 与主规划的偏离

主规划写「重新导入或编辑会生成草稿」。本计划对**尚未发布过当前工具面**的存量 server 保持即时写活表。启用之后才生成草稿。原因是任务要求：若「未发布前网关不变」必须以改变存量即时生效为代价，则不要自行改掉存量行为。启用动作本身不改变工具内容。

---

## 观察到但未处理

- OpenAPI `CallTool` 仍按 `backend_config` 里的规格找 operation，不读 `rec.Tools`。发布后 config 与工具一起切换，所以调用与列表一致；未改 `CallTool`。
- `ConnectorBackend.ListTools` 与 `EchoBackend.ListTools` 忽略 `rec.Tools`。托管 OpenAPI 工具面不走这两条。
- 页面删除仍用 `window.confirm`。
- `GET /api/admin/mcp-servers` 失败文案里现有的迁移命令提示未改。
- 发布/回滚是顺序写，没有事务。指针在版本行标成 published 之后更新；中途失败时网关不会读到仍是 draft 的行（查询带 `shelf_status='published'`）。
- 并发导入可能撞 `(server_id, version)` 唯一索引，错误直接返回，不自动重试。
