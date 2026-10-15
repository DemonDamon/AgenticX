# mkt-04 一次性领取

Planned-with: Grok 4.7
Suggested-Impl-Model: claude-sonnet-5-5-medium
Parent: `.cursor/plans/pending/2026-10-15-marketplace-token-master.plan.md`

## 目标

买家打开履约响应里的 `claimUrl`，提交票据，看到一次明文 `agx-pat-`。第二次打开同一链接不再返回明文。

依赖 mkt-03 的 `marketplace_claim_tickets` 与 `openPatPlaintext()`。

## 根因

`createPat` 的明文只在创建返回值里出现一次，库里没有原文。mkt-03 把原文封进票据密文。领取必须原子地“解密并清空密文”，否则刷新页面等于第二次发放。

## API

新建 `enterprise/apps/web-portal/src/app/api/marketplace/v1/claim/route.ts`。

`POST`，`dynamic = "force-dynamic"`。body：`{ "ticket": "<string>" }`。

不需要门户登录。票据本身是秘密。不要把这个路由挂到需 cookie 的中间件后面；若 `middleware.ts` 有全局鉴权，给 `/api/marketplace/v1/claim` 与页面 `/marketplace/claim` 加放行。实施前先读 `enterprise/apps/web-portal/src/middleware.ts`。若文件不存在，就不要新建一个全局鉴权中间件。

处理：

1. ticket 缺失，或长度不在 20–128，或包含 `+`、`/`、空白 → 400 `{ code: "40000", message: "invalid ticket" }`。
2. `ticketHash = sha256(ticket)`。按 hash 查 `marketplace_claim_tickets`。没有行 → 404 `{ code: "40400", message: "ticket not found" }`。
3. `consumed_at` 非空，或 `ciphertext` 为空 → 410 `{ code: "41000", message: "ticket already used" }`。
4. `expires_at.getTime() < Date.now()` → 把 ciphertext 置 `''`、`consumed_at` 设为现在，返回 410 `{ code: "41000", message: "ticket expired" }`。不要返回明文。
5. 否则 `openPatPlaintext`。成功后同一条 UPDATE：`ciphertext=''`，`consumed_at=now`，条件是 `id` 且 `consumed_at is null` 且 `ciphertext <> ''`。更新行数为 0 → 410 `ticket already used`（并发双开）。行数为 1 → 200：

```json
{
  "code": "00000",
  "message": "ok",
  "data": {
    "token": "agx-pat-...",
    "tokenPrefix": "agx-pat-xxxx",
    "hint": "明文只显示一次，请立即保存。"
  }
}
```

`tokenPrefix` 取明文的前 12 个字符。

密钥用 `MARKETPLACE_CLAIM_KEY`。缺失 → 500 `{ code: "50000", message: "marketplace claim config missing" }`。解密抛错 → 400 `{ code: "40000", message: "invalid ticket" }`，并仍然清空密文，避免坏票据被反复撞。

方言分派照 iam-core 其它仓库：PG `getIamDb()`，MySQL `getMysqlRepositoryDb()`。把查询放在 `enterprise/packages/iam-core/src/marketplace/claim.ts`，导出 `redeemMarketplaceTicket(ticket: string, nowMs: number): Promise<RedeemResult>`，路由只做 HTTP 映射。这样测试不必起 Next。

`RedeemResult`：

```ts
export type RedeemResult =
  | { httpStatus: 200; token: string; tokenPrefix: string }
  | { httpStatus: 400 | 404 | 410 | 500; code: string; message: string };
```

## 页面

新建 `enterprise/apps/web-portal/src/app/marketplace/claim/page.tsx`。客户端组件。

查询参数 `ticket`。页面上只有：

- 标题：`领取 API Token`
- 按钮：`显示 Token`
- 点击后 `POST /api/marketplace/v1/claim`，body `{ ticket }`
- 200：等宽显示 `data.token`，一个复制按钮，下面一行 `明文只显示一次，请立即保存。`
- 410：`这张领取链接已经用过或已过期。`
- 其它错误：显示 `message`，不要再拼技术细节

不要在页面上解释商城规则，不要放第二套保存按钮。复制用 `navigator.clipboard.writeText`。失败时按钮文案改成 `复制失败`。

不要把 token 写进 `localStorage`。

## 测试

`enterprise/packages/iam-core/src/marketplace/claim.test.ts` 不连数据库。导出一个纯函数供路由与仓库共用：

```ts
export function classifyTicket(row: {
  ciphertext: string;
  consumedAt: string | null;
  expiresAt: string;
} | null, nowMs: number): "missing" | "used" | "expired" | "ok";
```

断言：

- `null` → `missing`
- `consumedAt` 有值 → `used`
- `ciphertext === ""` → `used`
- `expiresAt` 早于 nowMs → `expired`
- 密文非空、未消费、未过期 → `ok`

路由测试 `enterprise/apps/web-portal/src/app/api/marketplace/v1/claim/route.test.ts` mock `redeemMarketplaceTicket`：

- 返回 200 时 JSON 含 `data.token` 且以 `agx-pat-` 开头
- 返回 410 时 status 410 且 body 没有 `token` 字段

在 `enterprise/` 执行：

```bash
pnpm --filter @agenticx/iam-core exec vitest run src/marketplace/claim.test.ts
pnpm --filter @agenticx/app-web-portal exec vitest run src/app/api/marketplace/v1/claim/route.test.ts
```

## 验收

- AC-1：`classifyTicket` 五条断言 PASS。
- AC-2：410 响应对象没有 `token` 键。
- AC-3：页面源码不含 `localStorage`。
- AC-4：若改了 `middleware.ts`，只放行 `/marketplace/claim` 与 `/api/marketplace/v1/`，不要放行其它 `/api/`。

## 不要改

- 履约路由的成功体。不要在 create 响应里补上明文。
- 管理台。那是 mkt-05。
