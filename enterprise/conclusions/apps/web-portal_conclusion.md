# AgenticX Enterprise web-portal 模块总结

> 结论生成时间：2026-07-21（基于当前 worktree 代码重写，覆盖旧版）

> 说明：本文档描述 **员工前台**（Next.js 15 App Router 实现的消费端入口）。与 `apps/admin-console`（管理员后台）是**两个独立的 Next.js app**，部署端口默认 `:3000`。

## 模块概述

`apps/web-portal` 是 AgenticX Enterprise 面向员工（end-user）的前台 Web 应用，Next.js 15 + React 19 + App Router + Turbopack。它的角色是**消费端入口**：员工在这里与 LLM 对话、管理个人设置、查看配额、通过本地账密 / OIDC / SAML SSO 登录。Portal 层故意做得很薄 —— 大量重业务逻辑放在 workspace 包（`@agenticx/feature-chat`、`feature-settings`、`feature-model-service`、`feature-knowledge-base`）以及 `@agenticx/iam-core` / `@agenticx/auth` 里。Portal 主要负责**把这些 feature 装到路由、拥有 workspace 外壳 UI、处理 session cookie、提供 Next.js API Route 适配器**来调用共享 core。

## 定位 / 栈 / 端口

- **定位**：员工前台消费端入口（chat + 设置 + 配额 + 历史侧栏）；与 admin-console 共享 PG/MySQL 数据但只读 admin 写入的运行时配置表。
- **栈**：Next.js `^15.1.0`（App Router + Turbopack dev）+ React `^19.0.0` + TypeScript + Tailwind `^4.2.4` + `next-intl ^3`（zh/en，默认 zh）+ `@agenticx/ui` 设计系统。
- **端口**：`next dev --turbopack --port 3000`（`package.json` scripts.dev）；`next start -p 3000`（生产）。本地开发默认经 `enterprise/scripts/start-dev.sh` 拉起。
- **数据**：`drizzle-orm ^0.45.2` + `pg ^8.20.0`（PostgreSQL）+ `mysql2 ^3.14.1`（MySQL）；方言由 `@agenticx/iam-core` 的 `resolveDatabaseConfig()` 决定（`DATABASE_DIALECT`）。
- **Auth cookies**：`agenticx_access_token`（httpOnly，access TTL 1h）+ `agenticx_refresh_token`（httpOnly，refresh TTL 7d）。

## 目录结构

```
apps/web-portal/
├── next.config.ts              # transpilePackages @agenticx/*；next-intl plugin
├── package.json                # @agenticx/app-web-portal
├── vercel.json
├── messages/                   # i18n 字典：zh.json, en.json
├── public/
└── src/
    ├── app/                    # Next.js App Router（页面 + API 路由）
    │   ├── layout.tsx              # 根布局：theme bootstrap 脚本、NextIntlClientProvider、AppProviders
    │   ├── page.tsx                # 根：有 session 跳 /workspace，否则跳 /auth
    │   ├── globals.css
    │   ├── auth/page.tsx           # 登录 / 注册 / SSO 入口（client component，410 行）
    │   ├── workspace/page.tsx      # 服务端 auth gate，渲染 <WorkspaceShell/>
    │   └── api/                    # 所有后端端点（见路由表）
    ├── components/             # portal 专属 React UI（shell + chat 视图 + 设置）
    │   ├── WorkspaceShell.tsx      # 三栏 workspace 主壳（555 行）
    │   ├── WorkspaceClient.tsx     # 备用 ChatWorkspace 包装（31 行，当前未被任何页面引用）
    │   ├── MachiChatView.tsx       # "Machi" 品牌化对话界面（722 行）
    │   ├── QuotaCard.tsx           # 用户 / 部门配额进度卡（184 行）
    │   ├── SessionGeneratingDots.tsx # 会话生成中的动态三点动画（37 行）
    │   └── settings/SettingsPanel.tsx # 分 tab 设置面板（605 行）
    ├── lib/                    # 服务端辅助（API 路由共用）
    │   ├── session.ts              # getSessionFromCookies() —— access 校验 + refresh 自动刷新 + PG hydrate
    │   ├── auth-runtime.ts         # AuthService 装配 + IAM repos + 审计 + dev 引导 + SSO JIT 登录
    │   ├── auth-scopes.ts          # DEFAULT_WEB_PORTAL_SCOPES + getEffectiveUserScopes() 回退
    │   ├── chat-history.ts         # chat-history 门面：按方言分发到 postgresql / mysql store
    │   ├── chat-history/            # 跨方言 chat-history 持久化抽象
    │   │   ├── types.ts                # ChatHistoryStore 接口 + ChatHistoryNotFoundError
    │   │   ├── sql-store.ts            # SqlChatHistoryStore（原始 SQL，方言参数化占位符）
    │   │   ├── postgresql.ts           # pg Pool 适配 SqlClient
    │   │   ├── mysql.ts                # mysql2 Pool 适配 SqlClient
    │   │   └── contract.test.ts        # 两种方言的契约测试
    │   ├── chat-history-http.ts    # 共享 NextResponse 辅助（unauthorized/forbidden/not_found/bad_request/server_error）
    │   ├── chat-message-order.ts   # normalizeChatMessageOrder —— 修正同轮 user/assistant 时间戳倒挂
    │   ├── chat-message-sanitize.ts # sanitizeInboundMessages —— 入站消息角色/长度/附件校验
    │   ├── admin-providers-reader.ts # 只读 admin 配置的 providers + 用户可见性（PG/MySQL 双方言）
    │   ├── effective-models.ts    # 可见模型级联收窄纯函数（部门祖先链 → 用户级）
    │   ├── provider-api-key-crypto.ts # 重导出 iam-core 的 decryptProviderApiKey（server-only）
    │   ├── sso-runtime.ts          # OIDC/SAML 客户端 service（server-only）+ provider 配置加载
    │   ├── sso-provider-options.ts # 解析 NEXT_PUBLIC_SSO_PROVIDERS（id:name:protocol）
    │   ├── sso-return-to.ts       # 安全 returnTo 解析（SSO_RETURN_TO_ALLOWLIST）
    │   ├── portal-copy.ts          # 已废弃 usePortalCopy() shim
    │   └── __tests__/              # vitest 单元测试
    ├── providers/AppProviders.tsx # client LocaleProvider 包装
    └── i18n/                   # next-intl 配置（locales: zh, en；默认 zh）
        ├── routing.ts
        └── request.ts          # 从 cookie 或 Accept-Language 解析 locale
```

## 路由表

### 页面路由

| 路由 | 用途 |
|---|---|
| `/` | 服务端 redirect —— 有 session 跳 `/workspace`，否则跳 `/auth`（`src/app/page.tsx`）|
| `/auth` | 登录 + 注册表单 + WeChat / 企业 SSO / GitHub 按钮；读 `?sso_error=` 和 `?returnTo=`（`src/app/auth/page.tsx`，410 行）|
| `/workspace` | 鉴权后的员工 workspace —— 服务端 `getSessionFromCookies()` gate，渲染 `<WorkspaceShell userEmail userScopes/>` |

### API 路由（`src/app/api/**/route.ts`）

**Auth（`/api/auth/*`）**
- `login` —— 邮箱 + 密码 → `loginWithPassword()` → 设置 `agenticx_access_token` & `agenticx_refresh_token` cookie；错误码 `40100/50300`
- `register` —— 自助注册
- `logout` —— 清 cookie + 吊销 refresh token
- `session` —— 当前 session 探测（GET）
- `sso/oidc/start` & `sso/oidc/callback` —— OIDC PKCE 流程（state cookie `agenticx_oidc_state_portal`，含审计 + provider-disabled / fallback 测试）
- `sso/saml/start` & `sso/saml/callback` —— SAML SP 流程（cookie policy + 失败审计测试）

**Chat（`/api/chat/*`）**
- `completions` —— 转发 chat 流式响应到 gateway；含 session 归属校验 + 实时模型可见性收窄 + `provider/model` 拆分到 `x-agenticx-provider` 头
- `sessions` —— 列出 / 创建会话（ULID）
- `sessions/[sessionId]` —— PATCH（title / active_model）/ DELETE（软删）
- `sessions/[sessionId]/messages` —— GET 取消息 / POST 追加或全量替换（经 `sanitizeInboundMessages` 校验）

**Me（`/api/me/*`）**
- `models` —— 返回 admin 配置的 providers 中**对当前用户可见**的子集（部门 + 用户级联收窄）
- `api-tokens` —— 个人访问令牌（PAT）CRUD，委托 iam-core `createPat` / `listPats` / `revokePat`

**Workspace（`/api/workspace/*`）**
- `quota/summary` —— 用户 + 部门 token 配额剩余，委托 iam-core `getQuotaSummaryForSession()`（含单元测试）

**Admin（`/api/admin/*`）**
- `users` —— admin 创建用户（注册表单在 caller 是 admin 时回退到这里，走 `provisionUserFromAdmin`）

## 关键 UI 模块

### 1. Auth (`src/app/auth/page.tsx`，410 行)

两栏 hero + tab 切换的登录/注册卡。通过 `getPortalSsoProviderOptions()` 读 SSO providers，`pickPreferredSsoProvider()` 偏好 OIDC，跳到 `/api/auth/sso/{oidc,saml}/start?provider=…&returnTo=…`。处理 `sso_error` query → 从 `@agenticx/auth/src/services/oidc-error-codes` 本地化错误（`getPortalSsoErrorMessageZh/En`）。语言切换器用 `@agenticx/ui` 的 `useLocale()`。默认登录卡预填 `admin@agenticx.local`。

### 2. Workspace Shell (`src/components/WorkspaceShell.tsx`，555 行)

可折叠左侧栏：chat 历史按日期分组（今日 / 昨日 / 本周 / 本月 / 更早，按 `createdAt` 排序避免切换 session 时 updated_at 跳动）、new-chat 按钮、用户下拉菜单（主题切换 sun/moon/monitor、语言切换、登出）。根据 `PanelMode` 挂载 `MachiChatView` 或 `SettingsPanel`，侧栏底部挂 `QuotaCard`。用 `@agenticx/feature-chat` 的 `useChatStore` 管 session 状态，用 `@agenticx/sdk-ts` 的 `HttpChatClient` / `MockChatClient`（`NEXT_PUBLIC_CHAT_CLIENT_MODE=mock` 时用 Mock）。折叠状态持久化到 `agenticx-portal-sidebar-collapsed`。

### 3. Chat (`src/components/MachiChatView.tsx`，722 行)

品牌化"Machi"对话界面，包裹 `feature-chat` 的 `MessageList` + `InputArea` + `MessageQueuePanel`。动态 model picker 拉 `/api/me/models`（admin 分配的模型，含 provider/route 元数据：`local` / `private-cloud` / `third-party`，含 `capabilities` 视觉能力位）。无可见模型时 fallback formatter 提示「请联系管理员分配模型」。工具栏：web 搜索、附件（`extractClipboardImageFiles` / `withClipboardImageNames`，视觉模型校验 `modelSupportsVision`）、deep research、分享、重试、历史版本切换（`showPrevious/NextResponseVersion`、`showPrevious/NextRetryVersion`）。合规错误（`isComplianceError`）与 Gateway 错误分别展示。

### 4. Settings (`src/components/settings/SettingsPanel.tsx`，605 行)

分 tab 面板：`general` / `model-service`（provider 配置）/ `defaults` / `web-search` / `parser` / `chat`（style 变体：`im` | `terminal` | `clean`，存 `agx-enterprise-chat-style`）。含 PAT 管理（拉 `/api/me/api-tokens`，创建后展示明文一次）。
> **诚实标注**：此面板的 provider 配置（deepseek 等列表）目前是**前端本地 state + localStorage**，并未真正写库 —— 真正的 provider 配置由 admin-console 写 `enterprise_runtime_*` 表，portal 侧只读。portal 设置面板的 provider tab 偏「用户偏好」展示，不是写入入口。

### 5. Quota (`src/components/QuotaCard.tsx`，184 行)

渲染用户 + 部门 token 配额（拉 `/api/workspace/quota/summary`），处理 unlimited，K/M 数字格式化。

### 6. SessionGeneratingDots (`src/components/SessionGeneratingDots.tsx`，37 行)

会话生成中的动态三点动画（对齐豆包式），用于流式输出等待态。

### 7. WorkspaceClient (`src/components/WorkspaceClient.tsx`，31 行)

> **诚实标注**：此组件是 `feature-chat` 的 `ChatWorkspace` 简单包装，当前**未被任何页面引用**（`workspace/page.tsx` 走的是 `WorkspaceShell`）。属遗留/备用组件，未删除但不在主链路上。

## 共享 lib (`src/lib`)

| 文件 | 用途 |
|---|---|
| `session.ts` | `getSessionFromCookies()` —— 校验 access_token，refresh_token 过期则自动刷新并回写 cookie；从 PG hydrate（`loadAuthUserByEmail`），尊重 `disabled/locked/lockedUntil` 状态；`DATABASE_URL` 缺失时信任 JWT context |
| `auth-runtime.ts` | 装配 `@agenticx/auth` AuthService（JWT issuer `agenticx-enterprise-web-portal`、refresh token store —— 有 `DATABASE_URL` 用 `PgRefreshTokenStore`，否则 `InMemoryRefreshTokenStore`）+ IAM repos + 审计事件 + dev 引导（`ENABLE_DEV_BOOTSTRAP` 强密码校验、legacy `owner@agenticx.local` → `admin@agenticx.local` 迁移）+ SSO JIT 登录（`loginWithOidcClaims`，含角色 allowlist 与 `auth.sso.jit_create` / `auth.sso.login` 审计）|
| `auth-scopes.ts` | `DEFAULT_WEB_PORTAL_SCOPES = ["workspace:chat", "user:read"]`；`getEffectiveUserScopes()` 回退（10 行）|
| `chat-history.ts` | chat-history 门面：`isValidUlid()` + `store()` 按 `resolveDatabaseConfig().dialect` 分发到 `postgresqlChatHistoryStore` / `mysqlChatHistoryStore`；导出 list/create/get/append/replace/patch/rename/softDelete + `syncAuthUserToDatabase`（旧名 `syncAuthUserToPostgres` 保留一个兼容周期）|
| `chat-history/types.ts` | `ChatHistoryContext = { tenantId, userId }`、`ChatHistoryNotFoundError`、`ChatHistoryStore` 接口（含 `resetForTests`）|
| `chat-history/sql-store.ts` | `SqlChatHistoryStore` —— 跨方言原始 SQL 实现（`placeholders()` 按方言生成 `$1`/`?`），role 白名单校验，首条 user message 自动生成标题，`normalizeChatMessageOrder` 修正时间戳倒挂（388 行）|
| `chat-history/postgresql.ts` | `pg.Pool`（max 5，全局 `__agenticxPortalChatPgPool`）适配 `SqlClient`，`begin/commit/rollback` 事务 |
| `chat-history/mysql.ts` | `mysql2/promise.Pool`（connectionLimit 5，timezone Z，charset utf8mb4）适配 `SqlClient`，`beginTransaction/commit/rollback` |
| `chat-history/contract.test.ts` | 两种方言的契约测试 |
| `chat-history-http.ts` | 共享 NextResponse 辅助：`chatHistoryUnauthorized/Forbidden/NotFound/BadRequest/ServerError`、`toChatHistoryContext` |
| `chat-message-order.ts` | `normalizeChatMessageOrder` —— 修正同轮 assistant 排在 user 之前的倒挂；`pairedMessageTimestamps` —— user 时间戳在前、assistant 严格晚 1ms |
| `chat-message-sanitize.ts` | `sanitizeInboundMessages` —— 入站消息 role 白名单、内容长度（128k）、附件数量（≤4）/ mime（image/*）/ data URL 大小（≤8MB）校验 |
| `admin-providers-reader.ts` | 只读 admin 配置的 model providers + per-user 可见性表（PG/MySQL 双方言，`migrateLegacyUserVisibleModelsIfNeeded`），`listAvailableModelsForUser()` 做部门祖先链 + 用户级级联收窄，含 legacy admin email → user_id 映射兜底 |
| `effective-models.ts` | 可见模型级联收窄纯函数（`computeEffectiveDeptAllowed` / `mergeUserStoredSet` / `computeEffectiveUserAllowed` / `collectUserAssignmentKeys`），与 admin-console 同名文件语义一致（92 行）|
| `provider-api-key-crypto.ts` | 从 `@agenticx/iam-core` 重导出 `decryptProviderApiKey`（仅服务端，2 行）|
| `sso-runtime.ts` | OIDC/SAML 客户端 service（`server-only`）、discovery 降级上报、provider 配置加载、`decryptSecret`、重导出 `resolveReturnToOrDefault`（211 行）|
| `sso-return-to.ts` | 安全的 `returnTo` 解析（带 `SSO_RETURN_TO_ALLOWLIST` env）（12 行）|
| `sso-provider-options.ts` | 解析 `NEXT_PUBLIC_SSO_PROVIDERS`（`id:name:protocol` 格式，protocol ∈ oidc/saml，默认 oidc）；`pickPreferredSsoProvider()` 偏好 OIDC（39 行）|
| `portal-copy.ts` | 已废弃 `usePortalCopy()` shim（包 `useTranslations("portal")`，6 行）|
| `__tests__/` | vitest 单元测试（admin-providers-reader / auth-scopes / sso-provider-options / sso-runtime）|

## 技术栈

- **框架**：Next.js `^15.1.0`（App Router + Turbopack dev）+ React `^19.0.0` + TypeScript
- **样式**：Tailwind CSS `^4.2.4` + `@tailwindcss/postcss` + 根布局内联主题 bootstrap 脚本（`agenticx-ui-theme` localStorage key，dark/light/system，防 FOUC）
- **i18n**：`next-intl ^3`（默认 `zh` + `en`，cookie `NEXT_LOCALE` 或 `Accept-Language` 解析）
- **UI**：`@agenticx/ui`（共享设计系统：Cards / Tabs / DropdownMenu / MachiAvatar / GridBackdrop / LocaleProvider / useUiTheme / Toaster / Tooltip）+ `lucide-react ^0.542.0` 图标
- **workspace 包依赖**：`@agenticx/auth` · `iam-core` · `core-api` · `db-schema` · `feature-chat` · `feature-settings` · `feature-model-service` · `feature-knowledge-base` · `sdk-ts` · `branding` · `config`（`next.config.ts` 还 transpile 了 `feature-iam` / `feature-metering` / `feature-audit` / `feature-policy` / `feature-tools-mcp` / `feature-agents`，为后续接入预留）
- **数据**：`drizzle-orm ^0.45.2` · `pg ^8.20.0`（PostgreSQL）· `mysql2 ^3.14.1`（MySQL）—— 双方言由 `resolveDatabaseConfig()` 决定
- **SSO**：`openid-client ^6.0.0`（OIDC PKCE）；SAML 走 `@agenticx/auth`
- **ID**：`ulid ^2.3.0` for chat sessions
- **服务端边界**：`server-only` 防止 secret 泄漏到 client bundle
- **测试**：`vitest ^4.1.5`（chat-history 契约 + SSO 各路由 + quota + auth-scopes + admin-providers-reader）
- **Lint**：`eslint-config-next` + `eslint-plugin-i18next`（强制使用 t() 而非硬编码字符串）
- **部署**：`vercel.json`

## 关键流

### 登录流
1. `/auth` 页面 POST `/api/auth/login`（邮箱 + 密码）
2. `login/route.ts` → `auth-runtime.loginWithPassword()` → `AuthService.loginWithPassword()`（`@agenticx/auth` 校验密码哈希）→ `repo.findByEmail()` → `syncAuthUserToPostgres()` 同步到 chat-history 库
3. 成功后 `response.cookies.set(ACCESS_COOKIE, ...)` + `REFRESH_COOKIE`（httpOnly，prod secure）
4. 后续请求 `getSessionFromCookies()`：access 有效则 hydrate；access 过期则用 refresh 自动续签并回写 cookie

### Chat API 流
1. 浏览器 `HttpChatClient` POST `/api/chat/completions`，带 `x-chat-session-id` 头
2. `completions/route.ts`：`getSessionFromCookies()` 鉴权 → `isChatSessionOwned()` 校验会话归属 → 解析 body.model（`provider/model`）→ `listAvailableModelsForUser()` 实时收窄可见性（不可见则 403）→ 拆出 provider 放 `x-agenticx-provider` 头，body.model 仅保留模型名
3. 转发到 `GATEWAY_COMPLETIONS_URL`（默认 `http://127.0.0.1:8088/v1/chat/completions`），带 `authorization: Bearer <accessToken>` + `x-tenant-id` / `x-user-id` / `x-dept-id` / `x-user-email` / `x-session-id` 头
4. 上游响应原样透传（SSE `text/event-stream`，`cache-control: no-cache`，`connection: keep-alive`）；gateway 不可达时 503 + 提示「请确认已执行 bash scripts/start-dev.sh 且 :8088 网关进程正常」

### 设置流
- `SettingsPanel` 各 tab 多为前端本地 state + localStorage（chat style、provider 偏好、web-search/streaming/auto-title 开关）
- PAT 管理走真实 API：GET `/api/me/api-tokens` 列表、POST 创建（iam-core `createPat`，明文只展示一次）、DELETE 吊销（`revokePat`）

### 配额流
- `QuotaCard` GET `/api/workspace/quota/summary` → `getQuotaSummaryForSession({ tenantId, userId, deptId })`（iam-core，PG/MySQL）→ 返回用户 + 部门 token 配额剩余，处理 unlimited 与 K/M 格式化

## 关键跨切关注点

- **服务端 page 走 `getSessionFromCookies()` → `redirect()` 做 auth gate**（不依赖 middleware）：`/` 与 `/workspace` 都是服务端鉴权重定向
- **Chat 数据流**：浏览器 → `/api/chat/*` → `chat-history.ts` 门面 → `SqlChatHistoryStore`（PG 或 MySQL 原始 SQL）+ ULID session ID；`normalizeChatMessageOrder` 修正同轮时间戳倒挂
- **模型可见性**：admin-console 写 `enterprise_runtime_model_providers` + `enterprise_runtime_user_visible_models`；portal 通过 `admin-providers-reader.ts` 读 → `effective-models.ts` 做部门祖先链 + 用户级级联收窄 → `/api/me/models` → MachiChatView picker；`completions` 路由还会**实时**复算可见性，防止客户端未刷新时仍转发已失效模型
- **SSO**：portal 只拥有 `start` / `callback` 路由 + `returnTo` 安全 + state cookie；协议逻辑全部委托 `@agenticx/auth`（OIDC PKCE / SAML SP），JIT 创建用户走 `loginWithOidcClaims` + 角色允许列表（`SSO_JIT_ROLE_ALLOWLIST` / `SSO_DEFAULT_ROLE_CODES`）
- **dev 引导**：`ENABLE_DEV_BOOTSTRAP=true` 时创建 `admin@agenticx.local`（强密码 ≥14 位含大小写数字符号），并迁移 legacy `owner@agenticx.local`；旧 owner 密码 hash 不自动迁移
- **服务端边界**：`sso-runtime.ts` 用 `server-only` 防止 secret 泄漏到 client bundle；`provider-api-key-crypto.ts` 仅服务端重导出解密函数

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/admin-console` | 共享 PG/MySQL 数据 | portal 只读 admin 写入的 `enterprise_runtime_*` 表（providers / user_visible_models）；`effective-models.ts` 与 admin-console 同名文件语义一致 |
| `apps/gateway` | 出站 chat API | portal `completions/route.ts` 通过 `fetch(GATEWAY_COMPLETIONS_URL)` 调 gateway 的 `/v1/chat/completions`，透传四主体头 + `x-agenticx-provider` |
| `packages/auth` | 直接依赖 | OIDC/SAML 协议实现 + JWT 签发（`JwtService` / `AuthService`）+ refresh token store + `OidcConfigError` 错误码 + `oidc-error-codes` 本地化 |
| `packages/iam-core` | 直接依赖 | user / role / tenant repo（`PgAuthUserRepository`）+ refresh token store（`PgRefreshTokenStore`）+ 审计写入（`insertAuditEvent` / `sanitizeSsoAuditDetail`）+ 配额（`getQuotaSummaryForSession`）+ PAT（`createPat` / `listPats` / `revokePat`）+ 部门祖先链（`listDepartmentAncestorIds`）+ provider key 解密（`decryptProviderApiKey`）+ `resolveDatabaseConfig()` 方言分发 + `loadAuthUserByEmail` |
| `packages/feature-chat` | 直接依赖 | 提供 `ChatWorkspace`、`useChatStore`、`MessageList`、`InputArea`、`MessageQueuePanel`、`useComposerAttachments`、`modelSupportsVision` 等 |
| `packages/feature-settings` / `feature-model-service` / `feature-knowledge-base` | 直接依赖 | 设置面板的核心 tab（feature-chat 已接入主链路；其余 feature 包已 transpile 但实际 UI 多为 portal 本地实现）|
| `packages/sdk-ts` | 直接依赖 | `HttpChatClient` / `MockChatClient`（chat API 客户端，endpoint `/api/chat/completions`）|
| `packages/ui` | 直接依赖 | 整个设计系统（Cards / Tabs / DropdownMenu / MachiAvatar / GridBackdrop / LocaleProvider / useUiTheme / Toaster / Tooltip）|
| `packages/db-schema` | 直接依赖 | drizzle schema（`enterpriseRuntimeModelProviders` / `enterpriseRuntimeUserVisibleModels`，PG + MySQL 两套表定义）|
| `packages/branding` | 直接依赖 | 白标资产 + `getEnterpriseVersionLabel()` |
| `packages/config` | 直接依赖 | `DEFAULT_BRAND_CONFIG` / `DEFAULT_FEATURE_FLAGS`（`WorkspaceClient` 使用）|

## 已实现 vs stub 诚实标注

**真实落库 / 真实链路（可现场演示）**：
- 账密登录 / 注册 / 登出 / session 探测（PG/MySQL，JWT + refresh token）
- OIDC PKCE SSO `start`/`callback` + SAML SP `start`/`callback`（含 state cookie、审计、JIT 创建、provider-disabled / fallback 测试）
- Chat 会话 CRUD + 消息追加 / 全量替换 / 软删（`SqlChatHistoryStore`，PG + MySQL 双方言，ULID，归属校验，入站 sanitize）
- Chat completions 转发到 gateway（实时模型可见性收窄 + provider 拆头 + 四主体透传 + SSE 透传 + 503 兜底）
- `/api/me/models`（部门 + 用户级级联收窄，PG/MySQL 双方言，legacy email 兜底）
- PAT CRUD（iam-core `createPat` / `listPats` / `revokePat`）
- `/api/workspace/quota/summary`（iam-core `getQuotaSummaryForSession`）
- `/api/admin/users`（`provisionUserFromAdmin` + 角色分配）

**偏 stub / 本地态 / 未上链**：
- `SettingsPanel` 的 provider 配置 tab：前端本地 state + localStorage，未真正写库（真实 provider 配置由 admin-console 负责）
- `WorkspaceClient.tsx`：遗留 `ChatWorkspace` 包装，**未被任何页面引用**，不在主链路
- `feature-settings` / `feature-model-service` / `feature-knowledge-base` / `feature-iam` / `feature-metering` / `feature-audit` / `feature-policy` / `feature-tools-mcp` / `feature-agents`：已在 `next.config.ts` transpile，但 portal UI 侧多由本地组件实现，这些包尚未在 portal 主链路全面接入（为后续接入预留）
- `portal-copy.ts`：已废弃 shim


