# AgenticX Enterprise admin-console 模块总结

> 结论生成时间：2026-07-21（按当前工作树代码重生成，覆盖旧版）

> 说明：本文档描述 **企业管理员后台**（`@agenticx/app-admin-console`，Next.js 15 App Router + Turbopack，端口 `:3001`）。与 `apps/web-portal`（员工前台，端口 `:3000`）是两个独立 Next.js app，但共享 `packages/*` 与 PG 数据底座。**它是 AgenticX gateway 的运营控制平面**：所有运行时配置（身份/计量/策略/模型/通道/MCP/审计）在此写入 PG，再经 `/api/internal/*` snapshot 端点供 gateway 热加载。

## 模块概述

admin-console 是企业管理员的运营控制平面，Next.js 15 + React 19 + App Router。它承担两类职责：

1. **数据面**：`/api/admin/*`、`/api/metering/*`、`/api/policy/*`、`/api/audit/*` 等路由在 admin cookie session + RBAC 守卫下，对 PG（`drizzle-orm` + `pg`，经 `@agenticx/iam-core` 与 `@agenticx/db-schema`）做 CRUD。
2. **控制面**：`/api/internal/*` 暴露 10 个 snapshot 端点（policy / pricing / budget / quotas / providers / channels / compliance / mcp-servers / session-grants / pat-revocation），用 `GATEWAY_INTERNAL_TOKEN`（Bearer）鉴权——**不走 admin cookie**，供 Go 网关进程热加载运行时配置。

页面是从 `@agenticx/feature-*` 工作区包与 `@agenticx/ui` 设计系统装出来的薄壳；`AppShell`（`NAV_GROUPS`：overview / iam / ops / platform / content）提供可拖拽宽度的分组侧栏、面包屑、带搜索历史的 ⌘K 命令面板、主题/语言切换，并每 5s 轮询 `/api/gateway/health` 显示网关健康徽标。运维观测主入口为 `/ops/logs`（日志与观测中心，内嵌 trace / 审计 / Portal 请求 / 错误 / Pyroscope 等 tab）。

## 目录结构

```
apps/admin-console/
├── messages/{en,zh}.json           # next-intl 字典
├── public/                         # Machi / Near 品牌资源、favicon、CSV templates
├── next.config.ts                  # next-intl 插件 + transpilePackages + optimizePackageImports
├── vercel.json                     # monorepo turbo 构建/安装 hook
└── src/
    ├── app/                        # Next.js app-router（UI 页 + API handler）
    │   ├── layout.tsx              # 根：NextIntl + AppProviders + RootShell + 主题 bootstrap（inline script 防 FOUC）
    │   ├── page.tsx                # → redirect("/dashboard")（admin session 守卫后）
    │   ├── login/                  # 邮箱密码 + SSO（OIDC/SAML）登录
    │   ├── dashboard/              # 运营落地页（StatCard、charts、最近 AuditEvent）
    │   ├── iam/{members,roles}/    # 组织与成员（合并原 users/departments/user-groups/bulk-import）+ 角色
    │   ├── iam/{users,departments,user-groups,bulk-import}/  # 遗留路径 → redirect 到 /iam/members（query 保留 dept/user/tab/import）
    │   ├── ops/logs/               # 日志与观测聚合页（RuntimeObserve + 动态挂载各子面板）
    │   ├── audit/ portal-logs/ metering/agent-traces/  # 仍保留 page，next.config redirects → /ops/logs?tab=*
    │   ├── metering/{,quota,plans,split}/  # 用量 / 配额 / 套餐 / 分账
    │   ├── policy/                 # 敏感规则 / policy pack 管理
    │   ├── admin/[section]/       # 平台配置动态路由（agents/models/channels/…/cases/plugins）
    │   ├── admin/_sections/       # 上述 section 的 client 页面实现（自原 admin/*/page 迁入）
    │   ├── admin/{compliance,errors,perf,session-grants}/  # 未并入 [section] 的独立页
    │   ├── settings/sso/           # SSO provider 配置（OIDC / SAML 字段映射）
    │   └── api/                    # ~150 个 route.ts 处理器（见路由表）
    ├── components/                 # AppShell、RuntimeObserve、iam/*、metering/*、quota/LimitEditor、capabilities/DesktopAgentPolicyPanel 等
    ├── lib/                        # 服务端 stores / auth / 加密 / gateway 内部 RPC（见 lib 节）
    ├── providers/AppProviders.tsx # UI / locale / 主题 provider 组合
    └── i18n/{request,routing}.ts   # next-intl locale 解析 & 路由
```

## 关键路由（UI 页面）

| 路由 | 用途 |
|---|---|
| `/` | Auth 守卫后 → `/dashboard` |
| `/login` | 登录表单 + SSO provider 按钮（OIDC/SAML） |
| `/dashboard` | KPI、图表、最近审计事件 |
| `/iam/members` `/iam/roles` | 组织与成员（部门树、用户、用户组、CSV 导入合一）/ 角色+scope |
| `/ops/logs` | 观测总览（`RuntimeObserve` + `/api/dashboard/runtime`）+ tab：调用链 / 会话 / 审计 / Portal 日志 / 错误聚类 / 性能外链 |
| `/metering` `/metering/quota` `/metering/plans` `/metering/split` | 用量大盘（ridge / 分布 / feature-usage）/ 配额与 LimitEditor / 套餐 / 分账 |
| `/policy` | Policy 规则 + pack + 发布/回滚 |
| `/admin/agents` `/admin/models` `/admin/channels` `/admin/cache` `/admin/api-tokens` `/admin/mcp-servers` `/admin/connectors` `/admin/capabilities` `/admin/plugins` | Agent 注册 / 模型 / channel / 缓存 / PAT / MCP / **Connector 导入** / 能力包+技能+桌面 Agent 策略 / Wasm 插件 |
| `/admin/projects` `/admin/cases` | 交付项目只读列表（RBAC 可见域）/ 企业案例库状态流转 |
| `/admin/compliance` `/admin/session-grants` | 合规配置 / 短期 session scope（侧栏未收录，URL 仍可直达） |
| `/settings/sso` | SSO provider 配置（OIDC client + SAML IdP/SP/cert/属性映射）|

## API 路由树（`src/app/api`，重点）

- **auth/** —— `login`, `logout`, `session`；`sso/oidc/{start,callback}`、`sso/saml/{start,callback}`（均含 `__tests__`）
- **admin/** —— RBAC 保护的 CRUD：`users`（含 `quota-overview`、`[id]/{models,reset-password}`）、`roles`（含 `[id]/users`）、`departments`（含 `[id]/models`）、`user-groups/overview`、`providers`（含 `[id]/{key,models,test,fetch-models}`）、`agents`（含 `[agentId]`，走 `@agenticx/iam-core` `listAgents`/`createAgent`）、`channels`（含 `[id]/{keypool,probe}`、`/health`）、`connectors`（含 `[connectorId]/connections` OpenAPI 导入与 destructive 409 确认）、`mcp-servers`（含 `[id]/{openapi,stats}`）、`mcp-proxy-servers`、`desktop-agent-policy`、`api-tokens`、`session-grants`、`sso/providers`（含 `[id]/{test,health}`、`/stats`）、`cache`、`compliance`、`errors`、`perf`、`plugins`、`projects`（含 `[id]/rooms/[roomId]/messages`）、`cases`（含 `[id]/transition`、`[id]/page`）、`iam/bulk-import`
- **dashboard/** —— `runtime`（`buildRuntimeDashboard`，供 `RuntimeObserve`）
- **metering/** —— `query`, `export`, `heatmap`, `overview`, `hourly-ridge`, `request-distribution`, `feature-usage`, `traces`, `roi`, `pricing`, `budget`（v2 patch + 乐观锁）、`quota`（含 `/usage`）、`plans`（含 `[id]`, `/publish`, `/assign`, `/rollover`）
- **billing/** —— `split/{rules,sync,reconcile}`, `settlement/webhook`
- **policy/** —— `rules`, `packs/[code]`, `publishes/[id]/rollback`, `publish`, `test`
- **audit/** —— `query`, `export`, `chain-verify`
- **agent-traces/** —— `agent-traces/`, `agent-traces/ingest`
- **gateway/** —— `gateway/health`
- **internal/** —— ⚡ 供 gateway 消费的 snapshot 端点（**无 admin cookie，走 `GATEWAY_INTERNAL_TOKEN` Bearer**）：`policy-snapshot`、`pricing-snapshot`、`budget-snapshot`、`quotas`、`providers`、`channels`、`compliance-snapshot`、`mcp-servers-snapshot`、`session-grants-snapshot`、`pat-revocation-snapshot`

## RBAC 实现

- 入口 `src/lib/admin-auth.ts`：`getAdminSession()` 读 `admin_console_session` cookie 并 `verifyAdminSessionToken`；`requireAdminScope(required)` 与 `requireAdminSomeScope(candidates)` 在 cookie 缺失时返回 **401**（`code: 40101`），scope 不足时返回 **403**（`code: 40300`）。
- scope 聚合来自 `@agenticx/iam-core` 的 `aggregateScopesForUser(tenantId, userId)`（基于 PG 角色表实时聚合）；常见 scope：`user:read`、`user:create`、`dept:read`、`role:read`、`provider:read`、`provider:create`、`audit:read:all` / `audit:read:dept` 等；超级管理员角色可为 `*`。
- 种子用户 `admin@agenticx.local` 绑定 `super_admin`（见 `packages/db-schema/scripts/db-seed.mjs`）。
- `/api/internal/*` 走另一套鉴权：`src/lib/gateway-internal-auth.ts` 的 `isGatewayInternalAuthorized(request)` 比对 `Authorization: Bearer <GATEWAY_INTERNAL_TOKEN>`，token 由 `gateway-internal-token.ts` 从 env 或 `GATEWAY_INTERNAL_TOKEN_FILE` 解析。

## PG 配置 → gateway 热加载（控制平面核心链路）

admin-console 是 gateway 运行时配置的**唯一写入源**，热加载有两条并行链路：

1. **HTTP 拉取（在线）**：admin 写 PG → `/api/internal/*` 聚合 snapshot bundle → Go 网关经 `apps/gateway/internal/gatewayinternal/http.go` 的 `HTTPGet(url)` 带 `Bearer $GATEWAY_INTERNAL_TOKEN` 拉取（25s 超时，32MiB 上限）。各 snapshot 端点均 `export const dynamic = "force-dynamic"` + `cache-control: no-store`，避免 Next 缓存。例如 `api/internal/policy-snapshot/route.ts` 调 `buildPolicySnapshotBundleForGateway()`（`@agenticx/feature-policy`）；`api/internal/quotas/route.ts` 调 `getQuotaConfig()`；`api/internal/providers/route.ts` 调 `listProvidersInternal()`。
2. **文件快照（兜底）**：admin-console 发布策略时把 `policy-snapshot.json` 落盘到 `enterprise/.runtime/admin/`，Go 网关从同目录读取（见 `apps/gateway/internal/server/server.go:173`、`apps/gateway/internal/quota/tracker.go:122` 注释「与 admin-console 发布 policy-snapshot 同目录」）。仅**已发布（active）**规则进入快照。

**反向链路（admin → gateway 运维）**：`src/lib/gateway-ops-store.ts` 经 `gateway-internal-base.ts` 解析基址（`GATEWAY_INTERNAL_BASE_URL` 或 `GATEWAY_INTERNAL_URL`，默认 `http://127.0.0.1:8088`）+ Bearer token 调网关 `/internal/plugins`、`/internal/plugins/reload`、`/internal/errors`、`/internal/perf`、`/internal/channels/{id}/probe`，把网关侧的运行态拉回 admin UI 展示（plugins/errors/perf 页面是「转发壳」而非本地存储；errors/perf 主入口在 `/ops/logs`）。

## 共享 lib（`src/lib/`）

- **Auth / Session**：`admin-auth.ts`（`getAdminSession` / `requireAdminScope` / `requireAdminSomeScope`）、`admin-page-guard.ts`（服务端 redirect 到 `/login`）、`admin-client-auth.ts`（`adminFetch`、`safeAdminNextPath`）、`admin-session.ts`（cookie 签名/校验）、`admin-pg-auth.ts`（PG-backed 登录）
- **SSO**：`admin-sso-provider-options.ts`、`admin-sso-runtime.ts`、`sso-saml-config.ts`、`sso-url-guard.ts`
- **Stores（PG / drizzle，含 mysql/postgresql 双方言适配）**：`gateway-channels-store`、`gateway-connectors-store`、`gateway-cache-store`、`gateway-ops-store`、`gateway-internal-base`、`model-providers-store`、`user-models-store`、`dept-models-store`、`dept-default-model`、`desktop-agent-policy-store`、`mcp-servers-store`、`mcp-proxy-store`、`policy-store`、`pricing-store`、`quota-plans-store`、`token-quota-store`、`quota-overview`、`quota-config-patch`、`limit-editor-model`、`db-stores/quota-pool-scope`、`budget-store`（v2 `BudgetConfig` + `mergeBudgetPatch` / `BudgetConflictError`）、`session-grant-store`、`pat-revocation-store`、`pat-vault`、`agent-trace-store`、`observation-center`、`runtime-dashboard`、`feature-usage-report`、`admin-project-visibility`；`db-stores/{mysql,postgresql}/` 下为方言实现
- **Services**：`audit-service.ts`（`createAuditStore` + `verifyGatewayAuditChain` + `insertGatewayAuditExportEvent`）、`billing-service.ts`、`metering-service.ts`（`MeteringService`/`HeatmapApi`/`RoiApi`，单租户回退 `DEFAULT_TENANT_ID`）
- **Gateway 内部 RPC**：`gateway-internal-auth.ts`、`gateway-internal-token.ts`
- **导航 / IAM 路由**：`admin-platform-sections.ts`（`PLATFORM_SECTION_IDS`）、`iam-members-redirects.ts`（`buildIamMembersRedirect`）、`admin-nav-prefetch.ts`
- **杂项**：`provider-api-key-crypto.ts`（信封加密）、`rate-limit.ts`、`fetch-upstream-models.ts`、`infer-model-capabilities.ts`、`effective-models.ts`；根目录 `vitest.config.ts` + `lib/__tests__/`、`components/__tests__/` 覆盖 budget v2、quota overview、runtime dashboard、platform sections 等

## 技术栈

- **框架**：Next.js 15.1（app-router + Turbopack）+ React 19 + TypeScript
- **工作区依赖**（已 transpile）：`@agenticx/{ui, branding, auth, config, core-api, db-schema, iam-core}` + `feature-{iam, metering, billing, audit, policy, model-service, tools-mcp}`
- **数据**：`drizzle-orm 0.45` + `pg 8.20` + `mysql2 3.14`（双方言）+ `ulid`
- **Auth**：`openid-client 6`（OIDC）+ 自定义 SAML（mock 脚本 `pnpm saml:mock`）+ cookie session
- **UI**：`@agenticx/ui`（shadcn 风格）+ `lucide-react` + `recharts 3` + `@tanstack/react-table 8`
- **i18n**：`next-intl 3` + `messages/{en,zh}.json` + `eslint-plugin-i18next`
- **其他**：`papaparse`（CSV 导入）+ `server-only`
- **Dev**：vitest 4 + eslint 10 + typescript-eslint 8

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/gateway`（Go） | 双向 | gateway 经 `gatewayinternal/http.go` 拉 admin 的 `/api/internal/*` snapshot 热加载；admin 经 `gateway-ops-store.ts` 调 gateway `/internal/*` 拉运行态；gateway 还把 agent-traces 上送到 `/api/agent-traces/ingest` |
| `apps/web-portal` | 共享 PG | portal 只读 admin 写入的 `enterprise_runtime_*` 表（providers / user-models / quotas） |
| `packages/iam-core` | 直接依赖 | `aggregateScopesForUser`、`getIamDb`、`resolveDatabaseConfig`（dialect-aware postgresql/mysql）、user/role/dept/sso-provider/audit repos、PAT service、session-grant、compliance、`runtime-legacy-migrate` |
| `packages/db-schema` | 直接依赖 | Drizzle schema（`postgres.ts` + `mysql.ts`），共享表定义 |
| `packages/auth` | 直接依赖 | OIDC/SAML 客户端、JWT |
| `packages/core-api` | 直接依赖 | 类型契约 |
| `packages/policy-engine` | 间接（经 `feature-policy` service） | policy 规则评估 |
| `packages/feature-{iam,metering,billing,audit,policy,model-service,tools-mcp}` | 直接依赖 | 每个 admin 页的核心 UI 组件 + store 工厂 |
| `packages/ui` | 直接依赖 | 整个设计系统（含 `MachiAvatar`、`useUiTheme`、Command/Toaster 等） |
| `packages/telemetry` | 间接 | 埋点 / 审计上报 |

## 已实现 vs stub / 转发壳

**已实现（PG 真落库，可演示）**：
- IAM：组织与成员合一 UI（`/iam/members` + `DepartmentManager` / `MembersRoster` / `BulkImportWizard` / `UserGroupsPanel`）；遗留 `/iam/users` 等仅 redirect；用户 / 部门 / 角色 CRUD + CSV 批量导入 API 不变
- Auth / SSO：cookie session + OIDC（`openid-client`）+ SAML（含 start/callback 测试）
- Metering：消耗查询、`/api/metering/overview` 大盘、`hourly-ridge` / `request-distribution`、`feature-usage` 趋势、trace 列表 API、token 热力图、ROI、套餐生命周期、配额（`LimitEditor` / `quota-overview` / 用户组 overview）、预算 v2（公司月上限 + tenant/dept/group/user 规则，gateway snapshot 含 `userGroups` 映射）
- Policy：规则 upsert、pack、发布 / 回滚、test 端点（`policy-store.ts` + `feature-policy`）
- Audit：查询 / CSV 导出 / Blake2b 链验证（`audit-service.ts`）
- Agents：`/api/admin/agents` + `/admin/agents` 管理租户 Agent 实体（iam-core）
- 模型服务：provider 注册、API key 信封加密、per-model 开关、部门默认模型（`dept-default-model`）、上游模型拉取
- Gateway channel：key pool、probe、health；**Connectors**：OpenAPI spec 导入与 connection CRUD（`gateway-connectors-store`）
- MCP：server 托管 + OpenAPI introspect + stats；能力页 `/admin/capabilities` 含 packs / skills / mcp / **桌面 Agent 策略**（`desktop-agent-policy-store` + `DesktopAgentPolicyPanel`）
- 内容与交付：`/api/admin/projects`（可见域过滤）、`/api/admin/cases` 列表与状态 transition（依赖 `enterprise_cases` 表迁移）
- 观测：`/api/dashboard/runtime` + `observation-center` 聚合 trace/会话指标；`/ops/logs` 统一入口
- API Token / Session Grant：PAT 生命周期 + 吊销 snapshot、短期临时授权
- Agent traces：ingest + 检索
- `/api/internal/*` 10 个 snapshot 端点 + `/api/gateway/health` 5s 轮询

**stub / 转发壳 / 弱实现**：
- `/admin/plugins`：不本地存储，上传 manifest+wasm 转发到 gateway `/internal/plugins/upload`，列表来自 gateway `/internal/plugins`（`gateway-ops-store.ts`）
- `/admin/errors`：从 gateway `/internal/errors` 拉取，非本地表（侧栏入口合并到 `/ops/logs?tab=errors`）
- `/admin/perf`：仅读 `PYROSCOPE_URL` / `GATEWAY_PYROSCOPE` env 渲染一个外链，无本地配置（入口 `/ops/logs?tab=perf`）
- `/admin/cache`、`/admin/compliance`、`/metering/split`、`billing/settlement/webhook`：实现较薄，部分依赖 feature 包的内存/轻量 store
- `metering-service.ts` 在未配 `DEFAULT_TENANT_ID` 时回退到硬编码 `01J00000000000000000000001` 单租户

## 显著约定

- **页面**多为 `"use client"`，配 `adminFetch` 辅助；服务端 guard 在 `app/page.tsx` 与 `requireAdminPageSession`
- **`/api/admin/*` 全部 `requireAdminScope([...])`**（401 / 403 语义）；`/api/audit/query` 用 `requireAdminSomeScope`（read / read:all / read:dept 任一命中）
- **`/api/internal/*` 仅供 gateway**（Bearer token 保护），是控制平面与数据面解耦的关键边界
- **主题 bootstrap** 以 inline script 跑在 `layout.tsx`，避免 FOUC
- **平台配置路由**：除 `/policy` 与 compliance/errors/perf/session-grants 外，多数 `/admin/*` 页共用 `admin/[section]/page.tsx`，section 白名单见 `admin-platform-sections.ts`，减轻 dev 下逐页 Compiling
- **遗留观测 URL**：`next.config.ts` `redirects()` 将 `/audit`、`/portal-logs`、`/metering/agent-traces`、`/admin/errors`、`/admin/perf` 转到 `/ops/logs?tab=*`；生产态可开 `admin-nav-prefetch` 预取侧栏路由
- **双方言**：`iam-core` 的 `resolveDatabaseConfig()` 按 `DATABASE_DIALECT` + `DATABASE_URL` 在 postgresql / mysql 间切换，stores 在 `db-stores/{mysql,postgresql}/` 下成对实现


## 增量（8ebec3b5 → 30e57496）

新增管理面（均双方言 store 或只读查询）：

- **能力包**：`capability-packs-store`（PG/MySQL）+ `capability-pack-form` + `/admin` capabilities UI（`use-capability-catalog`）。
- **用户组**：`user-groups-store` + `UserGroupsPanel`。
- **Portal 请求日志**：`portal-logs-query` / `portal-logs-session-query`。
- **Trace 会话**：`trace-timeline` + `TraceTimelineTree` / `TraceConversationPanel` / `deep-research-trace-query`。
- **技能扫描**：`skill-registry-scan.ts` 调独立 skill-registry 服务。
- **MCP 后端配置**：`mcp-backend-config-crypto.ts` 信封加解密。
- 审计查询过滤器补 `trace_id`。

## 增量（30e57496 → 22d051f5）

- **信息架构**：侧栏重组；IAM 收敛为 `/iam/members` + `/iam/roles`；新增 `/ops/logs` 观测 hub 与 `RuntimeObserve`；`/admin/agents`、`/admin/connectors`、`/admin/projects`、`/admin/cases` 入导航。
- **路由实现**：平台配置页迁至 `admin/_sections/*`，由 `admin/[section]/page.tsx` 动态挂载（R100/R087 rename，非新能力）；`iam-members-redirects` 保留旧 URL 查询参数。
- **控制面扩展**：Agents / Connectors / Desktop Agent 策略 / 企业案例 / 项目只读 API；预算 config **version 2** 与 patch 冲突检测；配额侧 `quota-overview`、`quota-pool-scope`、成员与用户组 limit 总览 API。
- **计量 API**：`metering/overview`、`hourly-ridge`、`request-distribution`、`feature-usage`、`traces`；dashboard `GET /api/dashboard/runtime`。
- **运维默认值**：`gateway-internal-base.ts` 统一 gateway 反查基址（默认 `:8088`）；`next.config.ts` 增加 legacy redirects 与 dev `onDemandEntries` / `staleTimes` 调优。
- **品牌资源**：`public/favicon.ico`、`near-logo.png`、`near-mark.png`（与既有 Machi 静态资源并存）。
