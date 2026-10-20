# 能力回流 B1：门户安全响应头与可选 HSTS

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-20-enterprise-capability-backflow.plan.md`
Depends-on: —

## 目标

员工门户（`enterprise/apps/web-portal`）对所有页面和接口返回一组基础安全响应头；HTTPS 部署可通过环境变量开启 HSTS。

## 现状（已核实）

- `enterprise/apps/web-portal/next.config.ts`（36 行）没有 `headers()`。
- 门户没有 `src/middleware.ts`。
- Cookie 的 `Secure` 已由 `src/lib/session.ts` L15 `isAuthCookieSecure()` 控制（`AUTH_COOKIE_SECURE`），本计划不动。
- 来源：`$DELIVERY_REPO` 提交 `f6a10281`（基线响应头）与 `4180a000`（可选 HSTS）。对应文件：`enterprise/apps/web-portal/next.config.ts`、`next.config.test.ts`、`src/lib/hsts.ts`、`src/middleware.ts`、`src/middleware.test.ts`。用 `git -C $DELIVERY_REPO show <hash> -- <path>` 读原文。

## 改动

### 1. `next.config.ts` 增加 `headers()`

```ts
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const config: NextConfig = {
  // ...现有字段原样保留
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};
```

- CSP 有意只写这三项，不限制 `script-src` / `connect-src`（不能破坏 Next 运行时、报告预览 iframe、外链图标）。
- 不加 `output: "standalone"`，不改其他字段。
- 把 `SECURITY_HEADERS` 导出供测试使用（或测试直接调用 `config.headers()`，按交付仓 `next.config.test.ts` 写法）。

### 2. 新文件 `src/lib/hsts.ts`

照搬交付仓同名文件逻辑：

- `resolveHstsHeader(env = process.env): string | null`
  - 读 `PORTAL_HSTS_MAX_AGE`；为空时读 `PORTAL_HSTS_DEFAULT_MAX_AGE`；都为空 → `null`（不发 HSTS）。
  - 值必须是非负整数（`/^\d+$/`）；`0` 合法，输出 `max-age=0`（用于清除浏览器缓存的策略）。
  - 非法值 → `null`，并 `console.warn` 一条只提变量名、不回显值的警告（同一进程只警告一次）。
  - 合法时输出 `max-age=<n>`。不加 `includeSubDomains` / `preload`。
- 不从 `NODE_ENV` 推导是否开启。

### 3. 新文件 `src/middleware.ts`

```ts
import { NextResponse } from "next/server";
import { resolveHstsHeader } from "./lib/hsts";

export function middleware() {
  const response = NextResponse.next();
  const hsts = resolveHstsHeader();
  if (hsts) response.headers.set("Strict-Transport-Security", hsts);
  return response;
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static/|_next/image|favicon.ico).*)"],
};
```

- 不在 middleware 里做鉴权、重定向或其他逻辑。
- 若主仓 Next 版本不支持 middleware `runtime: "nodejs"`（`pnpm -C enterprise/apps/web-portal exec next --version` 查看），去掉 `runtime` 字段，并在 `hsts.ts` 只用 Edge 可用的 API（只读 `process.env`，满足）。

### 4. 部署样例

- `enterprise/deploy/docker-compose/portal.yml` 的 `web-portal` 环境变量里加一行注释掉的示例：`# PORTAL_HSTS_MAX_AGE: "31536000"  # 仅在 HTTPS 且证书稳定后开启`。
- 不改 `prod.yml`，不加 `PORTAL_HSTS_DEFAULT_MAX_AGE`（交付仓的生产字面量默认不适用于主仓）。

## In scope / Out of scope

- In：门户 `next.config.ts` 响应头、`hsts.ts`、`middleware.ts`、对应测试、compose 注释示例。
- Out：管理台响应头（主计划 §8 待办）；Cookie 默认值；nginx 边缘配置；`AUTH_COOKIE_SECURE` 相关 compose 默认值。

## 验收

- AC-1：新增 `enterprise/apps/web-portal/next.config.test.ts`：`headers()` 返回一条 `source: "/:path*"`，四个头与值完全相等。
- AC-2：新增 `src/lib/hsts.test.ts`：未设置 → `null`；`"31536000"` → `max-age=31536000`；`"0"` → `max-age=0`；`"abc"` / `"-1"` / `" "` → `null` 且警告文本不含原值；`PORTAL_HSTS_MAX_AGE` 为空时回落 `PORTAL_HSTS_DEFAULT_MAX_AGE`。
- AC-3：新增 `src/middleware.test.ts`：设置变量时响应带 `Strict-Transport-Security`；未设置时不带；`config.matcher` 不匹配 `/_next/static/x.js`、`/_next/image`、`/favicon.ico`，匹配 `/workspace`、`/api/chat/sessions`。
- AC-4：`pnpm -C enterprise/apps/web-portal typecheck` 通过；`pnpm -C enterprise/apps/web-portal test` 除主计划 §1.3 列出的 10 条外无新增失败。
- AC-5（验收方手工）：本机门户 `curl -sI --noproxy '*' http://127.0.0.1:3000/auth` 能看到四个头；`PORTAL_HSTS_MAX_AGE=60` 重启后多出 `Strict-Transport-Security: max-age=60`；登录、聊天、报告预览正常。

## 验收记录

- 2026-10-20 Opus 5.5 复核（自动部分）：AC-1–AC-3 三个测试文件 21 条全过；AC-4 门户测试无基线外新失败，类型错误与基线一致（26 条，本计划文件 0 条）。代码复核：响应头值与计划一致；HSTS 只读环境变量、不看 `NODE_ENV`，非法值只提变量名；middleware 只设头，无其他逻辑；compose 仅一行注释。
- AC-5 手工：`next.config.ts` 改动需重启门户开发服务，待第一波统一走查。
