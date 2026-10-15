# mkt-02 验签与规范事件

Planned-with: Grok 4.7
Suggested-Impl-Model: gpt-5.6-sol-medium
Parent: `.cursor/plans/pending/2026-10-15-marketplace-token-master.plan.md`

## 目标

把商城回调收成一个纯函数管道：验签、解析、拒绝过期时间和重复 nonce。本计划不创建用户、不调用 `createPat`、不写配额。HTTP 路由留到 mkt-03，避免在没有 Token 的情况下对商城返回成功。

## 根因

门户没有商城验签。若在路由里先 `request.json()` 再验签，原始字节和解析后的 JSON 可能不一致，签名会被换行或键顺序破坏。验签必须吃原始字符串。

## 文件

- 新建 `enterprise/packages/iam-core/src/marketplace/signature.ts`
- 新建 `enterprise/packages/iam-core/src/marketplace/signature.test.ts`
- 新建 `enterprise/packages/iam-core/src/marketplace/parse.ts`
- 新建 `enterprise/packages/iam-core/src/marketplace/parse.test.ts`
- 新建 `enterprise/packages/iam-core/src/marketplace/nonce.ts`
- `enterprise/packages/iam-core/src/index.ts` 追加 `export * from "./marketplace/signature";` 与 `export * from "./marketplace/parse";` 与 `export * from "./marketplace/nonce";`。若 mkt-01 已加 sku 那一行，不要删它。

## 验签

```ts
export type SignatureVerdict =
  | { ok: true }
  | { ok: false; reason: "secret_missing" | "timestamp" | "nonce" | "signature" | "mismatch" };

export function verifyMarketplaceSignature(input: {
  secret: string | undefined;
  timestamp: string | null;
  nonce: string | null;
  signature: string | null;
  rawBody: string;
  nowMs: number;
}): SignatureVerdict;
```

规则按这个顺序，命中即返回：

1. `secret` trim 后长度 `< 32` → `secret_missing`。不要把短密钥当成可用。
2. `timestamp` 必须是 `/^\d{10}$/`，数值与 `Math.floor(nowMs / 1000)` 的差的绝对值 `> 300` → `timestamp`。
3. `nonce` 必须匹配 `/^[A-Za-z0-9_-]{16,64}$/`，否则 `nonce`。
4. `signature` 必须匹配 `/^[0-9a-f]{64}$/`，否则 `signature`。大写 hex 算失败，调用方先不要 toLowerCase，这样日志里能发现商城传了大写。
5. 计算 `HMAC-SHA256(secret, timestamp + "\n" + nonce + "\n" + rawBody)`，digest 为小写 hex。用 `crypto.timingSafeEqual` 比较两个 32 字节 buffer。不相等 → `mismatch`。
6. 否则 `{ ok: true }`。

固定测试向量，必须原样出现在测试里，不要重新“算一个看起来对的”：

- secret：`test-secret-key-at-least-32-characters`
- timestamp：`1700000000`
- nonce：`nonce-1234567890`
- rawBody：`{"provider":"sandbox","eventId":"evt_1"}`
- nowMs：`1700000000 * 1000`
- 期望签名：`56dbe407be860594dbcbcfd90a486f906c90ee84ed96b5ce00b705c5bc205909`

其它断言：

- 签名改最后一位 → `mismatch`
- nowMs 换成 `1700000000 * 1000 + 301_000` → `timestamp`
- secret 为 `short` → `secret_missing`
- nonce 为 `short` → `nonce`
- signature 为 64 个 `A` → `signature`

在 `enterprise/` 执行：

```bash
pnpm --filter @agenticx/iam-core exec vitest run src/marketplace/signature.test.ts
```

## 解析

```ts
export const MARKETPLACE_EVENT_TYPES = [
  "instance.create",
  "instance.renew",
  "instance.upgrade",
  "instance.expire",
  "instance.release",
  "order.refund",
] as const;

export type MarketplaceEventType = (typeof MARKETPLACE_EVENT_TYPES)[number];

export type CanonicalMarketplaceEvent = {
  provider: string;
  eventId: string;
  eventType: MarketplaceEventType;
  occurredAt: string;
  orderId: string;
  skuCode: string;
  externalUserId: string;
  email: string | null;
  displayName: string | null;
  periodEnd: string | null;
  trial: boolean;
  instanceId: string | null;
};

export class MarketplacePayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplacePayloadError";
  }
}

export function parseCanonicalEvent(rawBody: string, allowedProviders: string[]): CanonicalMarketplaceEvent;
```

`allowedProviders` 来自 `process.env.MARKETPLACE_PROVIDERS`，缺省拆成 `["sandbox", "volcengine-wanyou"]`。拆分规则：逗号分隔、trim、丢空串。另导出 `marketplaceProvidersFromEnv(raw: string | undefined): string[]` 供路由用。

解析失败一律抛 `MarketplacePayloadError`，message 用下列固定英文，测试按全文断言：

| 条件 | message |
| --- | --- |
| 不是 JSON 对象 | `invalid json` |
| `provider` 不在允许列表 | `invalid provider` |
| `eventId` 不匹配 `/^[A-Za-z0-9_.:-]{1,128}$/` | `invalid event id` |
| `eventType` 不在六种里 | `invalid event type` |
| `occurredAt` 不是可解析的 ISO 时间 | `invalid occurredAt` |
| `order.orderId` 不匹配 `/^[A-Za-z0-9_.:-]{1,64}$/` | `invalid order id` |
| `order.skuCode` 不匹配 `/^[a-z0-9][a-z0-9-]{1,62}$/` | `invalid sku code` |
| `order.buyer.externalUserId` trim 后长度不在 1–128 | `invalid buyer` |
| email 若存在，必须匹配 `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` 且长度 `<= 320`，否则 | `invalid email` |
| `instance.create` 或 `instance.renew` 缺少可解析的 `order.periodEnd` | `periodEnd required` |
| `instance.renew`、`upgrade`、`expire`、`release`、`order.refund` 缺少 `instance.instanceId` 或它不匹配 `/^[0-9A-HJKMNP-TV-Z]{26}$/` | `instanceId required` |
| `instance.create` 若带了 `instance.instanceId` 且非空 | `instanceId must be empty on create` |

`trial` 缺省 `false`，只接受布尔。其它类型忽略未知字段，不要把整个对象存进返回值。`displayName` 有值则 trim 后截断到 128，空串变成 `null`。

`parse.test.ts` 至少覆盖：合法 create、create 缺 `periodEnd`、renew 缺 `instanceId`、provider 为 `other`、eventType 为 `instance.delete`。

## Nonce

```ts
export type NonceStore = {
  /** 首次见到返回 true；已存在或已过期未清理仍算见过则返回 false。 */
  remember(nonce: string, expiresAt: Date): Promise<boolean>;
};

export function nonceExpiry(nowMs: number): Date; // now + 10 分钟
```

PG 实现 `rememberPgNonce`，MySQL 实现 `rememberMysqlNonce`，都插入 `marketplace_webhook_nonces`。主键冲突返回 false。插入前可以删除 `expires_at < now` 的行，但这不是安全边界：重复 nonce 靠主键。

导出 `rememberMarketplaceNonce(nonce: string, nowMs: number): Promise<boolean>`，内部按 `resolveDatabaseConfig().dialect` 分派。

本计划的 AC 不要求连真实数据库。另写一个内存 `MemoryNonceStore` 放在 `nonce.ts` 里并导出，测试它：第一次 true，第二次 false。数据库函数的 SQL 必须包含表名 `marketplace_webhook_nonces`。用测试读源码字符串是脆弱的，不要这么做。在 `nonce.test.ts` 只测 `MemoryNonceStore` 和 `nonceExpiry`（now 为 0 时 expires 是 600_000 ms）。

## 验收

- AC-1：签名向量 hex 与上面的常量一致，`signature.test.ts` PASS。
- AC-2：`parse.test.ts` 五条用例 PASS。
- AC-3：`rg "createPat|apiTokens" enterprise/packages/iam-core/src/marketplace` 无匹配。
- AC-4：比较签名只用 `timingSafeEqual`，文件 `signature.ts` 里能搜到这个名字。

```bash
pnpm --filter @agenticx/iam-core exec vitest run src/marketplace/signature.test.ts src/marketplace/parse.test.ts src/marketplace/nonce.test.ts
```

## 不要改

- 不新建 Next 路由。
- 不改 `pat-service.ts`。
- 不把测试向量以外的密钥写进仓库。
