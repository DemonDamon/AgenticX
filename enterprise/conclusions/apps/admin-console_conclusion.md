# AgenticX Enterprise admin-console 模块总结

> 结论生成时间：2026-11-14（基线提交 `cebdabd5`）

> 说明：本文档描述 **企业管理员后台**（`@agenticx/app-admin-console`，Next.js 15 App Router + Turbopack，端口 `:3001`）。与 `apps/web-portal`（员工前台，端口 `:3000`）是两个独立 Next.js app，但共享 `packages/*` 与 PG 数据底座。**它是 AgenticX gateway 与托管智能体运行时的运营控制平面**：核心身份、计量、模型、MCP、托管智能体和平台目录数据写入 PG/MySQL；策略快照、部分安全配置及数据/知识治理演示能力另有 `.runtime/admin` 文件存储，再分别经 `/api/internal/*` 与 `/api/internal/ma/*` 提供给运行时。

## 模块概述

admin-console 是企业管理员的运营控制平面，Next.js 15 + React 19 + App Router。它承担两类职责：

1. **数据面**：`/api/admin/*`、`/api/metering/*`、`/api/policy/*`、`/api/audit/*` 等路由在 admin cookie session + RBAC 守卫下，对 PG/MySQL（经 `@agenticx/iam-core` 与 `@agenticx/db-schema`）或明确标注的 `.runtime/admin` 文件 store 做 CRUD。
2. **控制面**：`/api/internal/*` 用 `GATEWAY_INTERNAL_TOKEN`（Bearer）向 Go 网关提供 policy / pricing / budget / quotas / providers / channels / compliance / MCP / session grant / PAT 与 session 吊销 / virtual models 等快照，并接收 gateway heartbeat；`/api/internal/ma/*` 则用独立 `MA_INTERNAL_TOKEN` 向托管智能体运行时提供版本、环境、通道凭证、调度、记忆、凭证解析和 worker eligibility 等内部接口。两类接口均**不走 admin cookie**。

页面由 `@agenticx/feature-*` 工作区包、`@agenticx/ui` 与本 app 的管理面共同组成；`AppShell`（`NAV_GROUPS`：overview / iam / ops / agentRuntime / platform / content）提供可拖拽宽度的分组侧栏、面包屑、带搜索历史的 ⌘K 命令面板、主题/语言切换、页面水印，并每 5s 轮询 `/api/gateway/health` 显示网关健康徽标。运维观测主入口为 `/ops/logs`，托管会话则从 `/ops/logs/managed` 进入筛选、详情和事件回放。

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
    │   ├── ops/logs/               # 日志与观测聚合页；managed 子路由提供托管会话回放
    │   ├── audit/ portal-logs/ metering/agent-traces/  # 仍保留 page，next.config redirects → /ops/logs?tab=*
    │   ├── metering/{,quota,plans,split}/  # 用量 / 配额 / 套餐 / 分账
    │   ├── policy/                 # 敏感规则 / policy pack 管理
    │   ├── admin/[section]/       # 平台动态路由（Agent Runtime、模型、数据/知识治理等）
    │   ├── admin/_sections/       # 上述 section 的 client 页面实现（自原 admin/*/page 迁入）
    │   ├── admin/{compliance,errors,perf,session-grants}/  # 未并入 [section] 的独立页
    │   ├── settings/sso/           # SSO provider 配置（OIDC / SAML 字段映射）
    │   └── api/                    # admin / internal / ma/v1 / metering 等处理器（见路由表）
    ├── components/                 # AppShell、PageWatermark、托管会话/评测/记忆、能力目录等 UI
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
| `/admin/agent-environments` `/admin/agent-vaults` `/admin/agent-memory` `/admin/agent-evals` `/admin/agent-schedules` `/admin/agent-webhooks` `/admin/agent-channels` | 托管智能体环境、凭证库、记忆与 Dream 审核、评测、调度、Webhook、外部通道 |
| `/ops/logs/managed` `/metering/agents` | 托管会话检索/事件回放与按 Agent/用户/部门/模型聚合的用量、配额 |
| `/admin/data-governance` `/admin/data-boards` `/admin/data-security` `/admin/data-jobs` `/admin/data-nl2sql` `/admin/data-idmapping` | 数据字典/清洗/分级/质量、看板、ACL 脱敏、任务、NL2SQL、ID Mapping；当前主要是本地样例存储 |
| `/admin/rule-governance` `/admin/knowledge-lifecycle` `/admin/disambiguation` `/admin/citation-evidence` `/admin/graph-incremental` `/admin/graph-explorer` | 规则资产、知识生命周期、消歧、引用证据、增量图谱与 GraphStore 浏览；默认带演示种子 |
| `/admin/projects` `/admin/cases` | 交付项目只读列表（RBAC 可见域）/ 企业案例库状态流转 |
| `/admin/compliance` `/admin/session-grants` | 合规配置 / 短期 session scope（侧栏未收录，URL 仍可直达） |
| `/settings/sso` | SSO provider 配置（OIDC client + SAML IdP/SP/cert/属性映射）|

## API 路由树（`src/app/api`，重点）

- **auth/** —— `login`, `logout`, `session`；`sso/oidc/{start,callback}`、`sso/saml/{start,callback}`（均含 `__tests__`）
- **admin/** —— RBAC 保护的 CRUD：既有 IAM / provider / channel / connector / MCP / PAT / policy / project / case 路由之外，`agents/[agentId]/{ma-settings,versions}` 增加 manifest 版本与 follow-latest / pinned 路由；`ma-{environments,channels,memory-stores,schedules,vaults,webhooks,evals,sessions}` 提供托管智能体管理面；`platform-catalog`、`approval-requests`、`ecp/*` 管理平台目录、跨租户分发和审批；`security/{admission,moderation,scorecards,incidents}`、`alerts/channels`、`gateway-instances`、`virtual-models` 提供安全与副本治理；`data-suite/*`、`graph-*`、`knowledge-lifecycle/*`、`disambiguation/*` 则承接数据/知识演示工作流。
- **dashboard/** —— `runtime`（`buildRuntimeDashboard`，供 `RuntimeObserve`）
- **metering/** —— `query`, `export`, `heatmap`, `overview`, `hourly-ridge`, `request-distribution`, `feature-usage`, `traces`, `roi`, `pricing`, `budget`（v2 patch + 乐观锁）、`quota`（含 `/usage`）、`plans`（含 `[id]`, `/publish`, `/assign`, `/rollover`）
- **billing/** —— `split/{rules,sync,reconcile}`, `settlement/webhook`
- **policy/** —— `rules`, `packs/[code]`, `publishes/[id]/rollback`, `publish`, `test`
- **audit/** —— `query`, `export`, `chain-verify`
- **agent-traces/** —— `agent-traces/`, `agent-traces/ingest`
- **gateway/** —— `gateway/health`
- **ma/v1/** —— 对外托管智能体 API：Agent/版本、环境、通道、记忆、调度、凭证库、Webhook；使用 `agx-pat-*` Bearer PAT，并按 `ma:*` 或 `ma:admin` scope 授权。
- **metering/agents/** —— Agent 用量多维聚合及配额 CRUD。
- **internal/** —— ⚡ 供 gateway 消费的快照与 heartbeat（**无 admin cookie，走 `GATEWAY_INTERNAL_TOKEN` Bearer**）；除原有快照外新增 `session-revocation-snapshot`、`virtual-models` 与 `gateway-heartbeat`。
- **internal/ma/** —— ⚡ 供托管智能体 runtime/worker 消费的内部协议（**走 `MA_INTERNAL_TOKEN`**），包括 PAT introspection、Agent 版本、环境、通道凭证、调度、记忆写入/快照/Dream、vault resolve、Webhook 自动停用、配额与 worker eligibility。

## RBAC 实现

- 入口 `src/lib/admin-auth.ts`：`getAdminSession()` 读 `admin_console_session` cookie 并 `verifyAdminSessionToken`；`requireAdminScope(required)` 与 `requireAdminSomeScope(candidates)` 在 cookie 缺失时返回 **401**（`code: 40101`），scope 不足时返回 **403**（`code: 40300`）。
- scope 聚合来自 `@agenticx/iam-core` 的 `aggregateScopesForUser(tenantId, userId)`（基于 PG 角色表实时聚合）；常见 scope：`user:read`、`user:create`、`dept:read`、`role:read`、`provider:read`、`provider:create`、`audit:read:all` / `audit:read:dept` 等；超级管理员角色可为 `*`。
- 种子用户 `admin@agenticx.local` 绑定 `super_admin`（见 `packages/db-schema/scripts/db-seed.mjs`）。
- `/api/internal/*` 走另一套鉴权：`src/lib/gateway-internal-auth.ts` 的 `isGatewayInternalAuthorized(request)` 比对 `Authorization: Bearer <GATEWAY_INTERNAL_TOKEN>`，token 由 `gateway-internal-token.ts` 从 env 或 `GATEWAY_INTERNAL_TOKEN_FILE` 解析。

## PG 配置 → gateway 热加载（控制平面核心链路）

admin-console 是 gateway 运行时配置的**唯一写入源**，热加载有两条并行链路：

1. **HTTP 拉取（在线）**：admin 写数据库或管理配置 → `/api/internal/*` 聚合 snapshot bundle → Go 网关经 `apps/gateway/internal/gatewayinternal/http.go` 带 `Bearer $GATEWAY_INTERNAL_TOKEN` 拉取。快照端点使用动态/no-store 语义；`session-revocation-snapshot` 支持 JWT session 吊销恢复，`virtual-models` 下发虚拟模型目标，网关则反向 POST `gateway-heartbeat` 上报 providers/channels/policy/MCP 应用版本与错误。
2. **文件快照（兜底）**：admin-console 发布策略时把 `policy-snapshot.json` 落盘到 `enterprise/.runtime/admin/`，Go 网关从同目录读取（见 `apps/gateway/internal/server/server.go:173`、`apps/gateway/internal/quota/tracker.go:122` 注释「与 admin-console 发布 policy-snapshot 同目录」）。仅**已发布（active）**规则进入快照。

**反向链路（admin → runtime 运维）**：`src/lib/gateway-ops-store.ts` 继续经 `gateway-internal-base.ts` 调网关 `/internal/*`；托管智能体评测等操作则由 `runtimeInternal()` 访问 `MA_RUNTIME_INTERNAL_URL`（默认 `http://127.0.0.1:8092`，15s 超时）并携带 `MA_INTERNAL_TOKEN`。

## 共享 lib（`src/lib/`）

- **Auth / Session**：`admin-auth.ts`（`getAdminSession` / `requireAdminScope` / `requireAdminSomeScope`）、`admin-page-guard.ts`（服务端 redirect 到 `/login`）、`admin-client-auth.ts`（`adminFetch`、`safeAdminNextPath`）、`admin-session.ts`（cookie 签名/校验）、`admin-pg-auth.ts`（PG-backed 登录）
- **SSO**：`admin-sso-provider-options.ts`、`admin-sso-runtime.ts`、`sso-saml-config.ts`、`sso-url-guard.ts`；`getAdminAuthStrategy()`/`assertAdminSsoStrategyProtocol()` 通过 `@agenticx/auth` strategy registry 约束 OIDC/SAML 协议，callback 同时校验签名 state 与策略协议。
- **Stores（PG/MySQL 双方言）**：既有 runtime stores 之外，`platform-catalog-store` + `ecp-approval-store` + `ecp-tenant-settings-store` 实现版本扫描/发布、审批与跨租户 grant/revoke；`gateway-instances-store`、`virtual-models-store`、MCP version store 提供 heartbeat、副本状态、虚拟模型和 MCP draft/publish/rollback；托管智能体核心记录由 `@agenticx/iam-core` 持久化。
- **Stores（本地文件/演示后端）**：`data-suite-store`、`data-jobs-store`、`idmapping-store`、`knowledge-lifecycle-store`、`disambiguation-store`、`rules-store`、`graph-incremental-store` 默认写 `.runtime/admin/*` JSON 并自动注入样例；`graph-store` 支持 memory/file，配置 `NEO4J_URI` 时经 Python bridge 使用 Neo4j；`model-admission-store`、`moderation-store`、`alert-channels-store` 也是文件配置。
- **Services**：`audit-service.ts`、`billing-service.ts`、`metering-service.ts` 新增 `queryAgentUsage()` / Agent quota；`incident-response.ts` 编排 session/PAT 吊销、用户禁用等安全处置并记录 action。
- **内部协议**：`gateway-internal-auth.ts` / `gateway-internal-token.ts` 与 `ma/internal-auth.ts` 两套 Bearer 边界；`ma/pat-auth.ts` 提供公共 `/api/ma/v1` PAT scope 校验；`ma-session-console.ts` 把 session events 归一为状态、消息、思考、工具、模型、用量、错误和中断回放项。
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
| `apps/gateway`（Go） | 双向 | gateway 拉 `/api/internal/*` 快照并上报 heartbeat；admin 经 `gateway-ops-store.ts` 调 gateway `/internal/*`，并下发 virtual model、session/PAT 吊销等控制数据 |
| 托管智能体 runtime / worker | 双向 | runtime/worker 用 `MA_INTERNAL_TOKEN` 调 `/api/internal/ma/*`；外部客户端用 PAT 调 `/api/ma/v1/*`；admin 通过 `MA_RUNTIME_INTERNAL_URL` 发起评测等操作 |
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

**已实现（真实持久化/协议接线，可演示）**：
- IAM：组织与成员合一 UI（`/iam/members` + `DepartmentManager` / `MembersRoster` / `BulkImportWizard` / `UserGroupsPanel`）；遗留 `/iam/users` 等仅 redirect；用户 / 部门 / 角色 CRUD + CSV 批量导入 API 不变
- Auth / SSO：cookie session + OIDC（`openid-client`）+ SAML（含 start/callback 测试）
- Metering：消耗查询、`/api/metering/overview` 大盘、`hourly-ridge` / `request-distribution`、`feature-usage` 趋势、trace 列表 API、token 热力图、ROI、套餐生命周期、配额（`LimitEditor` / `quota-overview` / 用户组 overview）、预算 v2（公司月上限 + tenant/dept/group/user 规则，gateway snapshot 含 `userGroups` 映射）
- Policy：规则 upsert、pack、发布 / 回滚、test 端点（`policy-store.ts` + `feature-policy`）
- Audit：查询 / CSV 导出 / Blake2b 链验证（`audit-service.ts`）
- Agents：`/api/admin/agents` + `/admin/agents` 管理租户 Agent 实体（iam-core）
- 模型服务：provider 注册、API key 信封加密、per-model 开关、部门默认模型（`dept-default-model`）、上游模型拉取
- Gateway channel：key pool、probe、health；**Connectors**：OpenAPI spec 导入与 connection CRUD（`gateway-connectors-store`）
- MCP：server 托管 + OpenAPI introspect + stats；能力页 `/admin/capabilities` 含 packs / skills / mcp / **桌面 Agent 策略**（`desktop-agent-policy-store` + `DesktopAgentPolicyPanel`；含「附带对话摘录」开关 `traceContent`，默认关闭，PG / MySQL 均存于策略 JSON 列，无单独迁移）
- 内容与交付：`/api/admin/projects`（可见域过滤）、`/api/admin/cases` 列表与状态 transition（依赖 `enterprise_cases` 表迁移）
- 观测：`/api/dashboard/runtime` + `observation-center` 聚合 trace/会话指标；`/ops/logs` 统一入口
- API Token / Session Grant：PAT 生命周期 + 吊销 snapshot、短期临时授权
- Agent traces：ingest + 检索
- `/api/internal/*` gateway 快照、session/PAT 吊销、virtual models、heartbeat + `/api/gateway/health` 5s 轮询
- 托管智能体：Agent manifest 版本与路由、环境、会话回放、vault、memory/Dream、评测、调度、Webhook、通道及三层 API（admin / PAT / runtime internal）
- 平台目录与 ECP：能力版本扫描/发布、审批 preset/queue、跨租户 grant/revoke、技能/专家包同步；PG/MySQL 双方言实现
- MCP 与模型治理：MCP surface draft/publish/rollback；模型启用 admission gate、scorecard/override；虚拟模型下发；gateway heartbeat 副本状态
- 安全运营：审核页增加 moderation、告警通道与安全事件处置；JWT session revocation snapshot 支持多副本恢复

**stub / 转发壳 / 弱实现**：
- `/admin/plugins`：不本地存储，上传 manifest+wasm 转发到 gateway `/internal/plugins/upload`，列表来自 gateway `/internal/plugins`（`gateway-ops-store.ts`）
- `/admin/errors`：从 gateway `/internal/errors` 拉取，非本地表（侧栏入口合并到 `/ops/logs?tab=errors`）
- `/admin/perf`：仅读 `PYROSCOPE_URL` / `GATEWAY_PYROSCOPE` env 渲染一个外链，无本地配置（入口 `/ops/logs?tab=perf`）
- `/admin/cache`、`/admin/compliance`、`/metering/split`、`billing/settlement/webhook`：实现较薄，部分依赖 feature 包的内存/轻量 store
- 数据治理/看板/任务/ID Mapping、规则资产、知识生命周期、消歧、增量图谱默认写 `.runtime/admin` 并带固定样例种子；质量日汇总、任务调度和同步是演示实现，不等同外部数据平台生产链路
- `data-security` 使用前端/服务端 fixture 镜像 ACL 与脱敏；`citation-evidence` 直接构造共享样例；NL2SQL 默认 `fixture`，仅 `AGX_NL2SQL_BACKEND=python` 时调用 Python CLI
- `model-admission`、moderation、alert channels 仍是本地 JSON 配置；GraphStore 默认 file/memory，只有显式配置 `NEO4J_URI` 才走 Neo4j bridge
- `metering-service.ts` 在未配 `DEFAULT_TENANT_ID` 时回退到硬编码 `01J00000000000000000000001` 单租户

## 显著约定

- **页面**多为 `"use client"`，配 `adminFetch` 辅助；服务端 guard 在 `app/page.tsx` 与 `requireAdminPageSession`
- **`/api/admin/*` 全部 `requireAdminScope([...])`**（401 / 403 语义）；`/api/audit/query` 用 `requireAdminSomeScope`（read / read:all / read:dept 任一命中）
- **`/api/internal/*` 仅供 gateway**（Bearer token 保护），是控制平面与数据面解耦的关键边界
- **`/api/internal/ma/*` 与 gateway internal token 不共用密钥**；`MA_INTERNAL_TOKEN` 支持直接环境变量或 `MA_INTERNAL_TOKEN_FILE`，比较使用 `timingSafeEqual`
- **`/api/ma/v1/*` 使用 PAT**：`requireMaPat()` 验证 `agx-pat-*` 并要求细粒度 `ma:*` scope，`ma:admin` 可覆盖
- **主题 bootstrap** 以 inline script 跑在 `layout.tsx`，避免 FOUC
- **平台配置路由**：除 `/policy` 与 compliance/errors/perf/session-grants 外，多数 `/admin/*` 页共用 `admin/[section]/page.tsx`，section 白名单见 `admin-platform-sections.ts`，减轻 dev 下逐页 Compiling
- **遗留观测 URL**：`next.config.ts` `redirects()` 将 `/audit`、`/portal-logs`、`/metering/agent-traces`、`/admin/errors`、`/admin/perf` 转到 `/ops/logs?tab=*`；生产态可开 `admin-nav-prefetch` 预取侧栏路由
- **双方言**：`iam-core` 的 `resolveDatabaseConfig()` 按 `DATABASE_DIALECT` + `DATABASE_URL` 在 postgresql / mysql 间切换，stores 在 `db-stores/{mysql,postgresql}/` 下成对实现
- **演示存储边界**：数据/知识治理 API 虽有真实读写与 RBAC，但默认持久化到 `.runtime/admin` 并会自动 seed；维护时不得将其描述为租户隔离的 PG 生产存储


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
