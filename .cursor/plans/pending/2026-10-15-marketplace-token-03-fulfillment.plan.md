# mkt-03 履约状态机

Planned-with: Grok 4.7
Suggested-Impl-Model: gpt-5.6-sol-medium
Parent: `.cursor/plans/pending/2026-10-15-marketplace-token-master.plan.md`

## 目标

规范事件经过验签后，创建或更新一把 `agx-pat-`，把额度写进 `enterprise_runtime_token_quotas.config.apiTokens["<数字 id>"]`，并把明文放进 AES-GCM 密文。HTTP 成功响应只有 `claimUrl` 和 `tokenPrefix`。

依赖 mkt-01 的表与 SKU 仓库，mkt-02 的 `verifyMarketplaceSignature`、`parseCanonicalEvent`、`rememberMarketplaceNonce`。

## 根因

- `createPat()`（`packages/iam-core/src/pat-service.ts` 第 94–100 行）只用 `expireDays` 从现在往后推，商城给的是绝对 `periodEnd`。续费也没有更新 `expire_at` 的函数。
- `setQuotaConfig()` 整包覆盖。两笔订单并行会互相吃掉 `apiTokens` 键。
- `applyPlanRuleToScope()` 不写 `apiTokens`。履约不要调用它，也不要改 `PlanScopeType`。
- 明文不能进 `marketplace_events.response_json`。领取之前又必须能取出明文，所以用与 webhook 密钥分开的 `MARKETPLACE_CLAIM_KEY` 做 AES-256-GCM。

## 先改 PAT 过期时间

`CreatePatInput` 增加可选字段 `expireAt?: Date`。`createPat` 里现有逻辑：

```ts
const days = input.expireDays ?? defaultExpireDays();
const expireAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
```

改成：

```ts
const days = input.expireDays ?? defaultExpireDays();
const expireAt = input.expireAt ?? new Date(Date.now() + days * 24 * 60 * 60 * 1000);
```

PG insert 与 `createMysqlPatRow({ expireAt })` 都已经接收 `Date`，不要改这两处的列。

新增并导出：

```ts
export async function setPatExpireAt(id: number, tenantId: string, expireAt: Date): Promise<boolean>;
```

PG：`update api_tokens set expire_at, updated_at where id and tenant_id and status <> 'revoked'`，返回是否更新到行。MySQL 在 `repos/mysql/pat.ts` 加 `setMysqlPatExpireAt`，同样条件。已吊销的行保持吊销，返回 false。

不要在这个函数里写吊销表。

## 纯函数：计划

新建 `enterprise/packages/iam-core/src/marketplace/plan.ts`。

```ts
export type FulfillmentCommand =
  | { type: "duplicate"; instanceId: string; status: "active" | "expired" | "released" }
  | { type: "reject"; httpStatus: 400 | 404 | 409; code: "40000" | "40400" | "40900"; message: string }
  | { type: "create"; periodEnd: string }
  | { type: "renew"; instanceId: string; periodEnd: string }
  | { type: "upgrade"; instanceId: string }
  | { type: "expire"; instanceId: string }
  | { type: "release"; instanceId: string };

export function planFulfillment(input: {
  event: CanonicalMarketplaceEvent;
  sku: { code: string; status: "draft" | "active" | "archived" } | null;
  instanceByOrder: { id: string; status: "active" | "expired" | "released" } | null;
  instanceById: { id: string; status: "active" | "expired" | "released"; skuCode: string } | null;
  nowMs: number;
}): FulfillmentCommand;
```

决策顺序：

1. `instance.create`：若 `instanceByOrder` 存在 → `duplicate`。否则 sku 缺失或 `status !== "active"` → reject 404 `sku not found`。`Date.parse(periodEnd) < nowMs + 60_000` → reject 400 `periodEnd too soon`。否则 `create`。
2. 其余事件：`instanceById` 为空 → reject 404 `instance not found`。
3. `instance.renew`：状态 `released` → 409 `marketplace.instance_released`。`periodEnd` 同样必须晚于 now+60s，否则 400 `periodEnd too soon`。否则 `renew`。
4. `instance.upgrade`：`released` → 409。sku 不是 `active` → 404 `sku not found`。否则 `upgrade`。
5. `instance.expire`：已是 `expired` 或 `released` → `duplicate`。否则 `expire`。
6. `instance.release` 与 `order.refund`：已是 `released` → `duplicate`。否则 `release`。

`plan.test.ts` 把上面 6 类各至少一条写死。`nowMs` 用 `Date.parse("2026-10-15T00:00:00.000Z")`。合法 `periodEnd` 用 `2026-11-15T00:00:00.000Z`。过近的用 `2026-10-15T00:00:30.000Z`。

## 配额补丁

新建 `enterprise/packages/iam-core/src/marketplace/quota-patch.ts`。

```ts
export type TokenQuotaRule = {
  monthlyTokens: number;
  tpm: number;
  rpm: number;
  maxConcurrency: number;
  action: "block";
};

export function applyApiTokenQuota(
  config: Record<string, unknown>,
  apiTokenId: string,
  rule: TokenQuotaRule | null,
): Record<string, unknown>;
```

行为：

- 浅拷贝 config。保证 `apiTokens` 是对象。
- `rule === null` 时删除 `apiTokens[apiTokenId]`。
- 否则写入恰好这五个字段，`action` 永远是 `"block"`。不要带 `poolScope`、`dailyTokens`。
- 不动 `users`、`departments`、`defaults`、`_planSources`。
- `apiTokenId` 必须匹配 `/^\d+$/`，否则抛 `Error("invalid api token id")`。

`quota-patch.test.ts`：在已有 `users.u1` 的配置上写入 `apiTokens["15"]`，断言 `users.u1` 仍在；再传 `null` 断言键被删且 `users` 仍在。

写入数据库的函数放在同文件：

```ts
export async function persistApiTokenQuota(
  tenantId: string,
  apiTokenId: string,
  rule: TokenQuotaRule | null,
): Promise<void>;
```

必须在一个事务里完成。PG 使用 `getIamDb().transaction`：

```sql
SELECT config FROM enterprise_runtime_token_quotas WHERE tenant_id = $tenant FOR UPDATE
```

没有行则 `INSERT` 一份 `{ defaults: { role: {}, model: {} }, users: {}, departments: {}, apiTokens: {} }` 再更新。有行则把 `applyApiTokenQuota` 的结果 `UPDATE` 回去，并改 `updated_at`。

MySQL 在 `repos/mysql/quota.ts` 旁新增 `persistMysqlApiTokenQuota`，同样 `FOR UPDATE`。`loadMysqlQuotaConfig` 不要改行为。

不要调用 admin-console 的 `setQuotaConfig()`。iam-core 不能依赖 admin-console。

## 领取密文

新建 `enterprise/packages/iam-core/src/marketplace/claim-crypto.ts`。

```ts
export type SealedToken = { ticket: string; ticketHash: string; nonce: string; ciphertext: string };

export function sealPatPlaintext(plaintext: string, keyMaterial: string): SealedToken;
export function openPatPlaintext(sealed: { nonce: string; ciphertext: string }, keyMaterial: string): string;
```

算法：

- 密钥：`crypto.createHash("sha256").update(keyMaterial, "utf8").digest()`，32 字节。`keyMaterial.trim().length < 32` 抛 `Error("claim key missing")`。
- IV：`crypto.randomBytes(12)`。
- AES-256-GCM。`ciphertext` 字段是 `cipher.update + cipher.final + getAuthTag` 的 base64（tag 附在末尾 16 字节）。`nonce` 是 IV 的 base64。
- `ticket`：`base64url(randomBytes(32))`，无填充。`ticketHash`：sha256 hex of ticket。
- `openPatPlaintext` 取末尾 16 字节为 tag，前面为密文。认证失败抛 `Error("claim ciphertext invalid")`。

测试：seal 再 open 得到原文；改 ciphertext 一个字符后 open 抛错；key 短于 32 抛 `claim key missing`。断言 seal 的返回值里任何一个字段都不包含明文子串 `agx-pat-`。ticket 是随机的，明文只存在于测试传入的参数，不在返回值里。

## 执行器

新建 `enterprise/packages/iam-core/src/marketplace/execute.ts`。

```ts
export type FulfillmentResult = {
  httpStatus: number;
  body: {
    code: string;
    message: string;
    data?: {
      instanceId: string;
      status: "active" | "expired" | "released";
      duplicate: boolean;
      tokenPrefix: string;
      expiresAt: string;
      claimUrl: string | null;
    };
  };
};

export async function executeFulfillment(input: {
  tenantId: string;
  event: CanonicalMarketplaceEvent;
  rawBody: string;
  nowMs: number;
  claimKey: string;
  claimBaseUrl: string;
}): Promise<FulfillmentResult>;
```

顺序：

1. 用 `(provider, eventId)` 查 `marketplace_events`。已有行则按该行的 `response_json` 返回，`httpStatus` 200，并把 `data.duplicate` 设为 true。不要再签发。
2. `planFulfillment`。reject 时插入 events，`status=rejected`，`response_json` 只有 code 与 message，返回对应 httpStatus。
3. `duplicate` 命令：插入一条新的 event 行会和唯一键冲突，所以不要为“订单已存在但 eventId 不同的 create”插第二份成功签发。处理如下：
   - 若是 create 且 order 已占用：返回 200，`duplicate: true`，`claimUrl` 取该实例未消费且未过期的票据。没有则 `claimUrl: null`。仍然插入本次 event，`status=duplicate`。
4. `create`：
   - 买家邮箱：event.email 合法则用它，否则 `mkt.` + `sha256(externalUserId)` 的前 24 个 hex + `@buyers.invalid`。
   - `upsertUserByEmail`：`displayName` 用 event.displayName 或 externalUserId；`passwordHash` 为 `hashPassword(randomBytes(32).toString("hex"))`；`roleCodes: ["staff"]`；`deptId: null`；`defaultOrgId: null`；`status: "active"`。staff 角色不存在时现有 `resolveRoleIdsFromCodes` 会得到空 map，用户仍然创建。不要为此自动建角色。
   - `createPat`：`name` 为 `marketplace:${skuCode}` 截断到 128；`scopes: ["workspace:chat"]`；`expireAt: new Date(periodEnd)`；`createdBy` 为该 userId；`tenantId` 为入参。
   - `persistApiTokenQuota(tenantId, String(record.id), rule)`。rule 来自 SKU 的 monthlyTokens/rpm/tpm/maxConcurrency，action `"block"`。
   - 插实例，status `active`，`token_prefix = plain.slice(0, 12)`，`api_token_id = record.id`。
   - `sealPatPlaintext`，插 `marketplace_claim_tickets`，`expires_at = now + 7 天`。
   - 若插实例时 `(provider, order_id)` 唯一冲突：删掉刚创建的 PAT（`revokePat`）并删掉刚写的配额键，然后按 duplicate 返回。这是并发创建的补偿。
5. `renew`：`setPatExpireAt`。返回 false 说明已吊销，改返回 409 `marketplace.instance_released`，不要把实例改回 active。成功则实例 `status=active`，`period_end` 更新。不新开票据，`claimUrl: null`。
6. `upgrade`：读 SKU，`persistApiTokenQuota` 覆盖同一 `api_token_id`。更新实例 `sku_code`。不轮换 Token，`claimUrl: null`。
7. `expire`：`setPatExpireAt(id, tenantId, new Date(nowMs))`，`persistApiTokenQuota(..., null)`，实例 `expired`。不调用 `revokePat`。
8. `release`：`revokePat(apiTokenId, tenantId)`，`persistApiTokenQuota(..., null)`，实例 `released`。把该实例未消费票据的 `ciphertext` 置空、`consumed_at = now`。
9. 成功路径插入 event，`status=accepted`，`response_json` 等于返回 body。返回前断言 `JSON.stringify(body)` 不包含 `agx-pat-` 加上超过 12 字符的尾巴。`tokenPrefix` 只有 12 字符，允许出现。若检测到明文（`agx-pat-` 后还有字符），抛错并不要把该 JSON 写入 events。

`claimUrl`：`${claimBaseUrl}/marketplace/claim?ticket=${encodeURIComponent(ticket)}`。`claimBaseUrl` 去掉尾部 `/`。

任何日志只打 `eventId`、`orderId`、`instanceId`、`tokenPrefix`。禁止打印 plaintext、secret、claim key、完整 claimUrl 的 ticket。

## HTTP 路由

新建 `enterprise/apps/web-portal/src/app/api/marketplace/v1/fulfillment/route.ts`。

```ts
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response>;
```

步骤：

1. `const rawBody = await request.text()`。禁止先 `request.json()`。
2. 读三个头：`x-agx-marketplace-timestamp`、`x-agx-marketplace-nonce`、`x-agx-marketplace-signature`。
3. `verifyMarketplaceSignature`。`secret_missing` → 500 `{ code: "50000", message: "marketplace webhook secret missing" }`。其它失败 → 401 `{ code: "40101", message: "invalid marketplace signature" }`。不要把 `reason` 回给客户端。
4. `rememberMarketplaceNonce`。false → 401 同上。
5. `parseCanonicalEvent`。抛 `MarketplacePayloadError` → 400 `{ code: "40000", message: error.message }`。
6. `DEFAULT_TENANT_ID` 空 → 500 `DEFAULT_TENANT_ID missing`。`MARKETPLACE_CLAIM_KEY` 或 `MARKETPLACE_CLAIM_BASE_URL` 空 → 500 `marketplace claim config missing`。
7. `executeFulfillment`，把结果的 `httpStatus` 与 `body` 原样 `NextResponse.json`。

路由测试 `route.test.ts` 放在同目录。mock `executeFulfillment`、`rememberMarketplaceNonce`。用上面的签名向量：

- 错误签名 → 401，且 mock 的 execute 未被调用。
- 合法签名但 body 不是合法事件（向量里的短 JSON）→ 400 `invalid json` 或解析错误，execute 未被调用。要测这条时，rawBody 必须重新签名。测试里调用同一 `verifyMarketplaceSignature` 的实现生成签名，不要复制错误的 hex。
- 合法 create 正文：mock execute 返回 200，断言响应里没有 `agx-pat-` 后接 8 位以上的模式 `/agx-pat-[A-Za-z0-9]{8,}/`。

create 正文示例（测试内自己签名）：

```json
{
  "provider": "sandbox",
  "eventId": "evt_01",
  "eventType": "instance.create",
  "occurredAt": "2026-10-15T03:00:00.000Z",
  "order": {
    "orderId": "ord_01",
    "skuCode": "token-100k",
    "buyer": { "externalUserId": "buyer-1" },
    "periodEnd": "2026-11-15T03:00:00.000Z",
    "trial": false
  },
  "instance": { "instanceId": "" }
}
```

## 验收

在 `enterprise/`：

```bash
pnpm --filter @agenticx/iam-core exec vitest run src/marketplace/plan.test.ts src/marketplace/quota-patch.test.ts src/marketplace/claim-crypto.test.ts
pnpm --filter @agenticx/app-web-portal exec vitest run src/app/api/marketplace/v1/fulfillment/route.test.ts
```

- AC-1：过近的 `periodEnd` 得到 400 `periodEnd too soon`，不出现 create 命令。
- AC-2：`applyApiTokenQuota` 不删除已有 `users`。
- AC-3：seal/open 往返成功，返回字段不含明文。
- AC-4：路由在验签失败时不调用 execute。
- AC-5：`rg "applyPlanRuleToScope|publishQuotaPlan" enterprise/packages/iam-core/src/marketplace` 无匹配。

## 不要改

- `apps/admin-console/src/lib/db-stores/postgresql/token-quota-store.ts` 的 `PlanScopeType`。
- `apps/gateway/**`。
- 不在响应里增加 `token` 或 `plaintext` 字段。
