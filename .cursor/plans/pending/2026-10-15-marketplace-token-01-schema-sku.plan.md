# mkt-01 商城表与 SKU

Planned-with: Grok 4.7
Suggested-Impl-Model: claude-sonnet-5-5-medium
Parent: `.cursor/plans/pending/2026-10-15-marketplace-token-master.plan.md`

## 目标

落下履约要用的五张表，以及 SKU 的校验、仓库和管理台 JSON API。本计划不验签、不签发 Token、不做页面。

## 根因

没有订单、实例、领取票据、nonce 表。现有 `enterprise_quota_plans` 是租户内套餐，`publishQuotaPlan()` 只映射到 user/dept/tenant。商城 SKU 单独建表，避免发布套餐时把买家额度写进用户规则。

## 数据模型

PG 与 MySQL 都建这些表。列名 snake_case。ULID 用 `varchar(26)`。时间用 `timestamp with time zone`（MySQL 用该目录里其它表已有的 `timestamp` 写法，照抄 `mysql-schema/quota-plans.ts`）。

### `marketplace_skus`

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | ulid pk | |
| `tenant_id` | varchar(26) not null | |
| `code` | varchar(64) not null | |
| `display_name` | varchar(128) not null | |
| `monthly_tokens` | bigint not null | 入库时必须 `> 0` |
| `rpm` | integer not null default 0 | |
| `tpm` | integer not null default 0 | |
| `max_concurrency` | integer not null default 0 | |
| `status` | varchar(16) not null default `draft` | `draft` / `active` / `archived` |
| `created_at` / `updated_at` | `...auditColumns` | |

唯一索引 `marketplace_skus_tenant_code_uq (tenant_id, code)`。
索引 `marketplace_skus_tenant_status_idx (tenant_id, status)`。

### `marketplace_instances`

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | ulid pk | 返回给商城的 instanceId |
| `tenant_id` | varchar(26) not null | |
| `provider` | varchar(32) not null | |
| `order_id` | varchar(64) not null | |
| `sku_code` | varchar(64) not null | |
| `external_user_id` | varchar(128) not null | |
| `user_id` | varchar(26) not null | |
| `api_token_id` | bigint null | 十进制字符串就是配额键 |
| `token_prefix` | varchar(20) not null default `''` | 只有前 12 字符，无明文 |
| `status` | varchar(16) not null | `active` / `expired` / `released` |
| `period_end` | timestamptz not null | |
| 审计列 | | |

唯一索引 `marketplace_instances_provider_order_uq (provider, order_id)`。
索引 `marketplace_instances_tenant_status_idx (tenant_id, status)`。
不要建到 `api_tokens.id` 的外键。两边方言的 identity 列不一样，应用层保证。

### `marketplace_events`

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | ulid pk | |
| `tenant_id` | varchar(26) not null | |
| `provider` | varchar(32) not null | |
| `event_id` | varchar(128) not null | |
| `event_type` | varchar(32) not null | |
| `order_id` | varchar(64) not null | |
| `instance_id` | varchar(26) null | |
| `request_hash` | varchar(64) not null | raw body 的 sha256 hex |
| `response_json` | jsonb not null | 禁止出现 `agx-pat-` 明文 |
| `status` | varchar(16) not null | `accepted` / `duplicate` / `rejected` |
| 审计列 | | |

唯一索引 `marketplace_events_provider_event_uq (provider, event_id)`。

### `marketplace_claim_tickets`

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | ulid pk | |
| `tenant_id` | varchar(26) not null | |
| `instance_id` | varchar(26) not null | |
| `ticket_hash` | varchar(64) not null | SHA-256 hex，不存票据原文 |
| `nonce` | varchar(24) not null | AES-GCM 12 字节的 base64 |
| `ciphertext` | text not null default `''` | 领取后清空 |
| `expires_at` | timestamptz not null | |
| `consumed_at` | timestamptz null | |
| 审计列 | | |

唯一索引 `marketplace_claim_tickets_hash_uq (ticket_hash)`。
索引 `marketplace_claim_tickets_instance_idx (instance_id)`。

### `marketplace_webhook_nonces`

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `nonce` | varchar(64) pk | |
| `expires_at` | timestamptz not null | |
| `created_at` | timestamptz not null default now | |

## 迁移落点

下一号是空的：PG journal 最后一条是 idx 54、`0055_enterprise_agent_lifecycle`；MySQL journal 最后一条是 idx 29、`0029_enterprise_agent_lifecycle`。

- 新建 `enterprise/packages/db-schema/src/schema/marketplace.ts`，表对象导出为 `marketplaceSkus`、`marketplaceInstances`、`marketplaceEvents`、`marketplaceClaimTickets`、`marketplaceWebhookNonces`。
- `enterprise/packages/db-schema/src/schema/index.ts` 在 `export * from "./quota-plans";` 下一行加 `export * from "./marketplace";`。只加这一行。
- 新建 `enterprise/packages/db-schema/src/mysql-schema/marketplace.ts`，从 `@agenticx/db-schema` 的 mysql 入口能导出同名对象。写法照 `mysql-schema/quota-plans.ts`。
- `enterprise/packages/db-schema/src/mysql-schema/index.ts` 同样只加一行 `export * from "./marketplace";`。
- PG SQL：`enterprise/packages/db-schema/drizzle/0056_marketplace_token.sql`。
- 在 `drizzle/meta/_journal.json` 的 `entries` 末尾追加：

```json
{
  "idx": 55,
  "version": "7",
  "when": 1787400000000,
  "tag": "0056_marketplace_token",
  "breakpoints": true
}
```

- MySQL SQL：`enterprise/packages/db-schema/drizzle-mysql/0030_marketplace_token.sql`。
- `drizzle-mysql/meta/_journal.json` 末尾追加 idx `30`、version `"5"`、when `1787400000001`、tag `0030_marketplace_token`、breakpoints true。
- `enterprise/scripts/db-portability/table-manifest.ts` 的 `TABLE_MANIFEST` 在 `"api_tokens"` 后面按这个顺序插入：`marketplace_skus`、`marketplace_instances`、`marketplace_events`、`marketplace_claim_tickets`、`marketplace_webhook_nonces`。

SQL 使用 `CREATE TABLE IF NOT EXISTS` 与 `CREATE UNIQUE INDEX IF NOT EXISTS`，风格照 `drizzle/0024_enterprise_quota_plans.sql`。MySQL 文件照 `drizzle-mysql/0027_enterprise_agents.sql` 的反引号与 `--> statement-breakpoint`。不要用部分唯一索引（`WHERE status = 'active'`）。MySQL 不支持，PG 也不要为了对称去用。

## SKU 仓库

新建 `enterprise/packages/iam-core/src/marketplace/sku.ts`。在 `packages/iam-core/src/index.ts` 加 `export * from "./marketplace/sku";`。不要改动该文件里已有的 export 行。

```ts
export type MarketplaceSkuStatus = "draft" | "active" | "archived";

export type MarketplaceSku = {
  id: string;
  tenantId: string;
  code: string;
  displayName: string;
  monthlyTokens: number;
  rpm: number;
  tpm: number;
  maxConcurrency: number;
  status: MarketplaceSkuStatus;
  createdAt: string;
  updatedAt: string;
};

export type MarketplaceSkuInput = {
  code: string;
  displayName: string;
  monthlyTokens: number;
  rpm?: number;
  tpm?: number;
  maxConcurrency?: number;
  status?: MarketplaceSkuStatus;
};

export class MarketplaceSkuValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplaceSkuValidationError";
  }
}

export function validateSkuInput(input: MarketplaceSkuInput): void;
export async function listMarketplaceSkus(tenantId: string): Promise<MarketplaceSku[]>;
export async function getMarketplaceSkuByCode(tenantId: string, code: string): Promise<MarketplaceSku | null>;
export async function createMarketplaceSku(tenantId: string, input: MarketplaceSkuInput): Promise<MarketplaceSku>;
export async function updateMarketplaceSku(tenantId: string, id: string, patch: Partial<MarketplaceSkuInput>): Promise<MarketplaceSku>;
```

`validateSkuInput` 规则，失败抛 `MarketplaceSkuValidationError`，消息用下面的英文短句，测试按消息断言：

- `code` trim 后匹配 `^[a-z0-9][a-z0-9-]{1,62}$`，否则 `invalid sku code`
- `displayName` trim 后长度 1–128，否则 `invalid display name`
- `monthlyTokens` 是有限数字且 `>= 1` 且 `<= 1_000_000_000`，否则 `invalid monthly tokens`
- `rpm` / `tpm` / `maxConcurrency` 缺省 0；若给出则是有限整数且 `0..1_000_000`，否则 `invalid rate limit`
- `status` 缺省 `draft`；只允许 `draft` | `active` | `archived`，否则 `invalid sku status`

`createMarketplaceSku` 先校验。`(tenant_id, code)` 冲突抛 `MarketplaceSkuValidationError("sku code already exists")`。id 用 `ulid` 包，与 `repos/agents.ts` 相同。

方言：函数开头若 `resolveDatabaseConfig().dialect === "mysql"`，转到 `enterprise/packages/iam-core/src/repos/mysql/marketplace-sku.ts`。PG 用 `getIamDb()`。不要在仓库里写配额。

## 管理台 API

照抄 `apps/admin-console/src/app/api/admin/api-tokens/route.ts` 的 `requireAdminScope` 与 `DEFAULT_TENANT_ID`。

- `GET/POST enterprise/apps/admin-console/src/app/api/admin/marketplace/skus/route.ts`
  - GET scope `provider:read`，响应 `{ code: "00000", message: "ok", data: { skus } }`
  - POST scope `provider:update`，body 即 `MarketplaceSkuInput`
- `PATCH enterprise/apps/admin-console/src/app/api/admin/marketplace/skus/[skuId]/route.ts`
  - scope `provider:update`
  - 找不到 id：404 `{ code: "40400", message: "sku not found" }`

错误映射：`MarketplaceSkuValidationError` → 400 `{ code: "40000", message }`。`DEFAULT_TENANT_ID` 缺失 → 500 `{ code: "50000", message: "DEFAULT_TENANT_ID missing" }`。表不存在的 500 提示照抄 api-tokens 路由里的 `请先执行 pnpm --filter @agenticx/db-schema db:migrate`。

不要在本计划加导航或页面。那是 mkt-05。

## 测试

新建 `enterprise/packages/iam-core/src/marketplace/sku.test.ts`。只测纯函数 `validateSkuInput`，不连数据库。

断言：

- `token-100k` 通过
- `Token` 抛 `invalid sku code`
- `monthlyTokens: 0` 抛 `invalid monthly tokens`
- `rpm: -1` 抛 `invalid rate limit`
- `status: "live"` 抛 `invalid sku status`
- 空 `displayName` 抛 `invalid display name`

在 `enterprise/` 目录执行：

```bash
pnpm --filter @agenticx/iam-core exec vitest run src/marketplace/sku.test.ts
```

期望：全部 PASS。

再执行：

```bash
pnpm --filter @agenticx/db-schema exec tsc --noEmit -p tsconfig.json
pnpm --filter @agenticx/iam-core exec tsc --noEmit -p tsconfig.json
```

若 `@agenticx/db-schema` 没有 `tsc` script，就在 `enterprise/packages/db-schema` 用该包已有的 typecheck script；没有的话用 `pnpm --filter @agenticx/db-schema exec tsc --noEmit -p tsconfig.json` 且只在存在 `tsconfig.json` 时跑。失败要修类型，不要跳过。

## 验收

- AC-1：`sku.test.ts` 五条断言通过。
- AC-2：PG `0056` 与 MySQL `0030` 的 journal idx 连续，没有改写 0055 / 0029。
- AC-3：`rg "agx-pat-" enterprise/packages/db-schema/src/schema/marketplace.ts` 无匹配。
- AC-4：管理台 POST 缺 `code` 返回 400 `invalid sku code`。这条用路由单测，mock `createMarketplaceSku` 与 `requireAdminScope`。测试文件：`enterprise/apps/admin-console/src/app/api/admin/marketplace/skus/route.test.ts`。断言 status 400 且 body.code 为 `40000`。

## 不要改

- `token-quota-store.ts`、`quota-plans-store.ts`、Go 网关、门户页面、`server.py`。
