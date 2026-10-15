# mkt-05 管理台 SKU 与实例

Planned-with: Grok 4.7
Suggested-Impl-Model: claude-sonnet-5-5-medium
Parent: `.cursor/plans/pending/2026-10-15-marketplace-token-master.plan.md`

## 目标

管理员在管理台维护 SKU，并查看商城实例。可以给仍有效的实例再开一张领取链接。页面上看不到历史明文。

依赖 mkt-01 的 SKU API 与表，mkt-03 的 `sealPatPlaintext` 与实例行。若 mkt-01 的 API 已存在，本计划不要重写校验规则。

## 导航落点

`enterprise/apps/admin-console/src/lib/admin-platform-sections.ts` 的 `PLATFORM_SECTION_IDS` 在 `"api-tokens"` 后面加 `"marketplace"`。

`enterprise/apps/admin-console/src/lib/__tests__/admin-platform-sections.test.ts` 的期望数组同步加这一项，位置在 `"api-tokens"` 与 `"mcp-servers"` 之间。

`enterprise/apps/admin-console/src/app/admin/[section]/page.tsx`：

- import `MarketplaceSection from "../_sections/marketplace"`
- `PLATFORM_SECTION_PAGES` 加 `"marketplace": MarketplaceSection`

`enterprise/apps/admin-console/src/components/AppShell.tsx`：

- `lucide-react` 的 import 列表加 `Store`（该文件第 40–69 行的图标列表）。
- `NAV_GROUPS` 里 `id: "platform"` 的 items，在 `{ href: "/admin/api-tokens", ...}` 后面插入：

```ts
{ href: "/admin/marketplace", labelKey: "marketplace", icon: Store },
```

文案：

- `enterprise/apps/admin-console/messages/zh.json` 的 `nav` 对象里，`"apiTokens": "API 令牌"` 下一行加 `"marketplace": "商城 Token"`。该对象大约在第 56 行。
- `messages/en.json` 同样位置加 `"marketplace": "Marketplace tokens"`。

不要改其它导航项的顺序。

## 实例 API

新建 `enterprise/apps/admin-console/src/app/api/admin/marketplace/instances/route.ts`。

`GET`，`requireAdminScope(["provider:read"])`，租户用 `DEFAULT_TENANT_ID`。

查询 `marketplace_instances`，按 `created_at` 降序，最多 100 行。响应：

```json
{
  "code": "00000",
  "message": "ok",
  "data": {
    "instances": [
      {
        "id": "",
        "provider": "",
        "orderId": "",
        "skuCode": "",
        "externalUserId": "",
        "userId": "",
        "apiTokenId": 0,
        "tokenPrefix": "",
        "status": "active",
        "periodEnd": "",
        "createdAt": ""
      }
    ]
  }
}
```

不要 join `api_tokens.token_hash`。不要返回 ciphertext。

新建 `enterprise/apps/admin-console/src/app/api/admin/marketplace/instances/[instanceId]/reclaim/route.ts`。

`POST`，scope `provider:update`。

行为：

1. 实例不存在 → 404 `instance not found`。
2. 状态不是 `active` → 409 `{ code: "40900", message: "only active instances can be reclaimed" }`。
3. 不读取旧明文，也做不到。补发必须轮换 Token：
   - `revokePat(apiTokenId, tenantId)`
   - `persistApiTokenQuota(tenantId, String(oldId), null)`
   - `createPat`，`expireAt` 为实例当前 `periodEnd`，name、scopes、user、tenant 与 mkt-03 create 相同
   - `persistApiTokenQuota` 写入新 id，规则从该实例的 `sku_code` 再读 SKU。SKU 不是 `active` → 409 `sku not active`，并且不要留下新 PAT（若已创建则 `revokePat`）
   - 更新实例的 `api_token_id` 与 `token_prefix`
   - 旧的未消费票据：ciphertext 清空，`consumed_at = now`
   - `sealPatPlaintext` 新票据，有效期 7 天
4. 响应 200：`{ code: "00000", message: "ok", data: { claimUrl, tokenPrefix } }`。不要返回 `token`。

`claimUrl` 用 `MARKETPLACE_CLAIM_BASE_URL`。缺失 → 500 `marketplace claim config missing`。

把轮换放在 `enterprise/packages/iam-core/src/marketplace/reclaim.ts`，导出 `reissueMarketplaceClaim(tenantId: string, instanceId: string, nowMs: number): Promise<...>`。路由只映射 HTTP。管理台测试 mock 这个函数。

## 页面

新建 `enterprise/apps/admin-console/src/app/admin/_sections/marketplace.tsx`，`"use client"`。视觉沿用 `_sections/api-tokens.tsx` 的 `adminFetch`、表格和 `@agenticx/ui`。不要新造一套颜色。

两个区块，同一页：

1. SKU。字段：code、显示名、月额度、RPM、TPM、并发、状态。保存调 `POST /api/admin/marketplace/skus`。列表调 `GET`。行内把 `draft` 改成 `active` 调 `PATCH /api/admin/marketplace/skus/:id`，body `{ "status": "active" }`。失败时保留表单，在表格上方显示接口返回的 `message`。
2. 实例。列：订单号、SKU、外部用户、状态、到期、token 前缀。没有「查看明文」。`active` 行有按钮 `补发领取链接`。成功后在该行下面显示 `claimUrl` 和一句 `链接只包含领取票据，不包含 Token 明文`。

状态用中文：`active` 显示「有效」，`expired` 显示「已到期」，`released` 显示「已释放」。SKU 状态：草稿 / 在售 / 已归档。

## 测试

- `enterprise/apps/admin-console/src/lib/__tests__/admin-platform-sections.test.ts` 更新后的数组断言必须通过。
- 新建 `enterprise/apps/admin-console/src/app/api/admin/marketplace/instances/[instanceId]/reclaim/route.test.ts`。mock `reissueMarketplaceClaim`：
  - 返回 409 时 status 409，body.message 为 `only active instances can be reclaimed`
  - 返回 200 时 body.data 有 `claimUrl`，没有 `token`

在 `enterprise/` 执行：

```bash
pnpm --filter @agenticx/app-admin-console exec vitest run src/lib/__tests__/admin-platform-sections.test.ts src/app/api/admin/marketplace/instances
```

包名以 `enterprise/apps/admin-console/package.json` 的 `name` 为准。若不是 `@agenticx/app-admin-console`，用该文件里的 `name`，不要改 package.json。

## 验收

- AC-1：侧栏「API 令牌」下面出现「商城 Token」，href 为 `/admin/marketplace`。
- AC-2：实例 JSON 类型里没有 `token`、`tokenHash`、`ciphertext`。
- AC-3：补发对非 active 实例返回 409，不调用 `createPat`。这个断言放在 `reissueMarketplaceClaim` 的单测里：先根据状态短路。把短路写成纯函数 `assertReclaimable(status: string): void`，`expired` 与 `released` 抛 `only active instances can be reclaimed`。测试文件 `enterprise/packages/iam-core/src/marketplace/reclaim.test.ts`。

## 不要改

- 不改 api-tokens 页面的列和行为。
- 不在补发响应里返回新明文。管理员把链接交给买家，由 mkt-04 显示一次。
