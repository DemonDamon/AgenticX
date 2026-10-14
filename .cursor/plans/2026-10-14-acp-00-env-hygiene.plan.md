# acp-00 环境与历史问题

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`

## 根因

Go 网关默认监听 `:8088`（`enterprise/apps/gateway/internal/config/*.go`：`HTTPAddr: ":8088"`），`.env.local.example` 也写 `GATEWAY_INTERNAL_BASE_URL=http://127.0.0.1:8088`。但 admin-console 在 env 缺省时兜底到 `http://127.0.0.1:8080`，并且缓存页读的是另一个变量 `GATEWAY_INTERNAL_URL`，该变量在 `.env.local.example` 与本地 `.env.local` 都不存在。结果：开发环境里缓存页（以及任何未设 env 的部署）必然连错端口。

README 仍写默认账号 `owner@agenticx.local`，种子与 e2e 实际是 `admin@agenticx.local`。

## 改动

1. 新建 `enterprise/apps/admin-console/src/lib/gateway-internal-base.ts`：

```ts
const DEFAULT_GATEWAY_INTERNAL_BASE = "http://127.0.0.1:8088";

export function gatewayInternalBase(): string {
  const raw =
    process.env.GATEWAY_INTERNAL_BASE_URL?.trim() ||
    process.env.GATEWAY_INTERNAL_URL?.trim() ||
    DEFAULT_GATEWAY_INTERNAL_BASE;
  return raw.replace(/\/+$/, "");
}
```

2. 下列位置把 `process.env.GATEWAY_INTERNAL_BASE_URL?.trim() || "http://127.0.0.1:8080"` 或 `process.env.GATEWAY_INTERNAL_URL?.trim() || "http://127.0.0.1:8080"` 换成 `gatewayInternalBase()`，其余逻辑不动：
   - `src/lib/gateway-connectors-store.ts:8`
   - `src/lib/gateway-ops-store.ts:3`
   - `src/lib/db-stores/{mysql,postgresql}/gateway-channels-store.ts` 各 3 处（约 232/246/257 行）
   - `src/lib/gateway-cache-store.ts:50`
   - `src/app/api/admin/cache/route.ts:27`
   - `src/app/api/admin/plugins/route.ts:29`
3. `enterprise/README.md`、`enterprise/README_ZN.md`、`enterprise/docs/development/local-dev.md` 中默认登录邮箱 `owner@agenticx.local` 改为 `admin@agenticx.local`。

## AC

- `rg -n "127\.0\.0\.1:8080" enterprise/apps/admin-console/src --glob '!**/*.test.*'` 无结果。
- 新增 `src/lib/__tests__/gateway-internal-base.test.ts`：未设两个变量时返回 `http://127.0.0.1:8088`；只设 `GATEWAY_INTERNAL_URL` 时用它；两者都设时用 `GATEWAY_INTERNAL_BASE_URL`；末尾斜杠被去掉。
- `pnpm -C enterprise --filter @agenticx/app-admin-console typecheck` 与 `test` 通过。
- 端到端：管理台「缓存」页加载不报网关连接错误。

## Out of scope

网关本身、其它 app 的端口配置。
