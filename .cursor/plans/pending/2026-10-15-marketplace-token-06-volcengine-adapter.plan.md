# mkt-06 火山映射、文档与沙箱

Planned-with: Grok 4.7
Suggested-Impl-Model: gpt-5.6-sol-medium
Parent: `.cursor/plans/pending/2026-10-15-marketplace-token-master.plan.md`

## 目标

加上火山专用入口，并写清履约协议，让沙箱能在没有伙伴回调文档时打通 mkt-03。映射在确认前必须失败关闭。本计划不发明火山的正式字段名，也不把示例映射打开。

## 根因

万有商城公开的是入驻和交易规范，不是生产 SPI。若把猜测的 JSON 路径写成 `confirmed: true`，上线后会把错误字段当成买家标识去签发 Token。

## 映射文件

新建 `enterprise/packages/iam-core/src/marketplace/volcengine-map.ts`。

```ts
export type VolcengineFieldMap = {
  confirmed: boolean;
  eventType: string;
  eventId: string;
  orderId: string;
  skuCode: string;
  externalUserId: string;
  email: string;
  displayName: string;
  periodEnd: string;
  instanceId: string;
  trial: string;
};

export const VOLCENGINE_FIELD_MAP: VolcengineFieldMap = {
  confirmed: false,
  eventType: "",
  eventId: "",
  orderId: "",
  skuCode: "",
  externalUserId: "",
  email: "",
  displayName: "",
  periodEnd: "",
  instanceId: "",
  trial: "",
};

export class MarketplaceSpiUnconfiguredError extends Error {
  constructor() {
    super("marketplace.spi_unconfigured");
    this.name = "MarketplaceSpiUnconfiguredError";
  }
}

export function mapVolcenginePayload(
  payload: unknown,
  fieldMap: VolcengineFieldMap = VOLCENGINE_FIELD_MAP,
): CanonicalMarketplaceEvent;
```

规则：

- `fieldMap.confirmed !== true` → 抛 `MarketplaceSpiUnconfiguredError`。不要读 payload。
- `confirmed === true` 时，每个路径是点分路径，例如 `data.orderId`。空路径且该字段在规范里可空（email、displayName、trial、create 的 instanceId）则填空值。必填路径为空 → 抛 `MarketplacePayloadError("invalid volcengine map")`。
- 取到的值组装成规范对象后，调用 `parseCanonicalEvent(JSON.stringify(canonical), ["volcengine-wanyou"])`。`provider` 固定写 `volcengine-wanyou`，忽略对方 payload 里的 provider。
- 对方事件名若不是六种 `eventType` 之一，由 `parseCanonicalEvent` 抛 `invalid event type`。不要在映射里偷偷把 `createInstance` 译成 `instance.create`。翻译表只有在 `confirmed: true` 且另有 `eventTypeAliases` 时才允许。本计划不添加 aliases。伙伴文档到达后，由后续改动显式加，避免现在猜。

测试 `volcengine-map.test.ts`：

- 默认 `VOLCENGINE_FIELD_MAP` 对任意对象抛 `marketplace.spi_unconfigured`。
- `confirmed: true` 但 `orderId: ""` 抛 `invalid volcengine map`。
- 一份**测试专用**映射（不要写进 `VOLCENGINE_FIELD_MAP` 常量）能把下面对象变成规范 create。这个对象是测试夹具，不是火山文档：

```json
{
  "meta": { "id": "evt_test", "kind": "instance.create", "at": "2026-10-15T03:00:00.000Z" },
  "trade": {
    "no": "ord_test",
    "sku": "token-100k",
    "until": "2026-11-15T03:00:00.000Z",
    "who": "buyer-1"
  }
}
```

测试映射路径：`eventId=meta.id`，`eventType=meta.kind`，`occurredAt` 不在 field map 里。补一个可选实现细节：`occurredAt` 路径也放进 `VolcengineFieldMap`，字段名 `occurredAt`。上面的类型定义要加上 `occurredAt: string`。测试映射 `occurredAt=meta.at`，`orderId=trade.no`，`skuCode=trade.sku`，`periodEnd=trade.until`，`externalUserId=trade.who`，email/displayName/instanceId/trial 为空路径。

断言解析结果的 `provider` 为 `volcengine-wanyou`，`eventType` 为 `instance.create`。

默认常量 `confirmed` 必须保持 `false`。测试要断言 `VOLCENGINE_FIELD_MAP.confirmed === false`。

## HTTP

新建 `enterprise/apps/web-portal/src/app/api/marketplace/v1/volcengine/route.ts`。

与 fulfillment 路由共用验签和 nonce（原文字节、同一套三个头、同一密钥）。验签失败的状态码与 mkt-03 相同。

验签通过后 `JSON.parse`。解析失败 → 400 `invalid json`。然后 `mapVolcenginePayload`。

- `MarketplaceSpiUnconfiguredError` → 501 `{ code: "50100", message: "marketplace.spi_unconfigured" }`。不要调用 `executeFulfillment`。
- `MarketplacePayloadError` → 400，message 原样返回。
- 成功则把 `parse` 之后的规范对象交给 `executeFulfillment`。`rawBody` 仍传火山原始正文，用于 `request_hash`。`event` 用映射结果。

路由测试：默认映射下，用合法签名发送 `{}`，得到 501，execute mock 调用次数为 0。

## 文档

新建 `enterprise/docs/marketplace/fulfillment-api.md`。用中文写下面这些，不要写客户名，不要写真实密钥：

- 生产地址：`POST {门户}/api/marketplace/v1/fulfillment`
- 三个请求头、HMAC 消息格式、300 秒窗口、nonce 10 分钟
- 六种 `eventType` 与正文示例（用 master 里的 sandbox JSON）
- 成功响应没有明文；领取链接 7 天、一次有效
- 重复 `eventId` 返回 200 且 `duplicate: true`
- 配额键是 `api_tokens.id` 的十进制字符串，`action` 为 `block`
- 网关配额缓存约 10 秒；PAT 吊销后进程缓存最长约 60 秒
- 环境变量表（与 master 相同的五个名字）
- 火山地址：`POST {门户}/api/marketplace/v1/volcengine`。在 `VOLCENGINE_FIELD_MAP.confirmed` 仍为 false 时返回 501。确认步骤只写：把伙伴沙箱的原始 JSON 存成夹具，填点分路径，把测试里的夹具断言跑绿，最后才把 `confirmed` 改为 true。不要在文档里列出虚构的火山字段。

`enterprise/docs/README.md` 的 Key Pool / PAT 那一行旁边加一条：

`| **商城 Token 履约** | [marketplace/fulfillment-api.md](./marketplace/fulfillment-api.md) |`

只加这一行。

## 沙箱脚本

新建 `enterprise/scripts/marketplace-sandbox-sign.mjs`。无第三方依赖。

用法：

```bash
MARKETPLACE_WEBHOOK_SECRET='test-secret-key-at-least-32-characters' \
  node enterprise/scripts/marketplace-sandbox-sign.mjs enterprise/scripts/marketplace-sandbox-event.json
```

脚本读文件为 rawBody，用当前 unix 秒和 `randomBytes` 生成 nonce，按 mkt-02 的算法打印三行：

```text
X-Agx-Marketplace-Timestamp: ...
X-Agx-Marketplace-Nonce: ...
X-Agx-Marketplace-Signature: ...
```

再打印一条可复制的 curl，URL 默认 `http://127.0.0.1:3000/api/marketplace/v1/fulfillment`，可用环境变量 `MARKETPLACE_FULFILLMENT_URL` 覆盖。curl 带 `--data-binary @文件`。

同目录放 `marketplace-sandbox-event.json`，内容就是 mkt-03 路由测试里的 create 正文。

脚本自测不必起服务。在 `enterprise/packages/iam-core/src/marketplace/sandbox-sign.test.ts` 用 `node:child_process` `execFileSync` 跑脚本，对它打印的 signature 用 `verifyMarketplaceSignature` 断言 `ok: true`。`nowMs` 用脚本输出的 timestamp 乘 1000，允许测试自身耗时，所以验签的 now 就用该 timestamp，不要用 `Date.now()`，否则边界上会 flaky。

在仓库根目录执行：

```bash
pnpm --filter @agenticx/iam-core exec vitest run src/marketplace/volcengine-map.test.ts src/marketplace/sandbox-sign.test.ts
pnpm --filter @agenticx/app-web-portal exec vitest run src/app/api/marketplace/v1/volcengine/route.test.ts
```

工作目录是 `enterprise/`。

## 验收

- AC-1：默认映射对 `{}` 抛 `marketplace.spi_unconfigured`，且 `VOLCENGINE_FIELD_MAP.confirmed === false`。
- AC-2：火山路由在 501 时不调用 `executeFulfillment`。
- AC-3：沙箱脚本输出的签名能通过 `verifyMarketplaceSignature`。
- AC-4：`fulfillment-api.md` 里不出现 `agx-pat-` 后接一长串示例明文。允许出现前缀说明 `agx-pat-`。
- AC-5：文档写明 10 秒配额缓存与约 60 秒吊销缓存。

## 不要改

- 不要把 `VOLCENGINE_FIELD_MAP.confirmed` 设为 true。
- 不要改 mkt-03 的规范 JSON 字段名。
- 不要在脚本里请求外网。
