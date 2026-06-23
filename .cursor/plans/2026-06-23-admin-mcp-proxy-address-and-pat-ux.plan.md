---
name: admin-console MCP 反代「完整地址 + 配置片段 + PAT 引导」UX
overview: 修复 /admin/mcp-servers 反代 UX 三处缺口——完整网关地址不可见、客户端配置需手拼、PAT 鉴权与反代页面割裂——纯 admin-console 前台改动，不动 Gateway 后端。
todos: []
isProject: false
---

Planned-with: claude-opus-4.8
Plan-Id: 2026-06-23-admin-mcp-proxy-address-and-pat-ux
Plan-File: .cursor/plans/2026-06-23-admin-mcp-proxy-address-and-pat-ux.plan.md

# admin-console MCP 反代「完整地址 + 配置片段 + PAT 引导」UX

## 0. 上下文（实施者必读）

### 问题来源
用户在 `http://localhost:3001/admin/mcp-servers` 创建 MCP 反代后反馈三点：
1. **完整反代地址不可见**：列表只显示路径片段 `/v1/mcp/{id}/*`，用户不知道要拼哪个 Host、完整 URL 是什么。
2. **客户端配置要手拼**：没有可直接粘贴到 Cursor / Near `mcp.json` 的配置片段。
3. **PAT 鉴权割裂**：为什么创建反代还要专门去 `/admin/api-tokens` 建鉴权？是不是每个反代都要建一次？

### 关键事实（已通过读代码确认，实施时无需再质疑）
- **管理台与网关是两套服务**：admin-console 跑在 `:3001`，Gateway 跑在 `:8088`。反代地址要拼 **Gateway** 的 Host，**不是** `localhost:3001`。
- **反代路由**：`enterprise/apps/gateway/internal/server/mcp_proxy_handlers.go:27` 注册 `/v1/mcp/{server_id}/*`，`handler.go` 把 `/*` 后缀透传到「上游 URL」。客户端访问 `/v1/mcp/{id}/`（后缀为空）时，网关用注册时填的 upstreamUrl（含其 query）作为 target。**因此客户端应连的完整地址形如 `http://127.0.0.1:8088/v1/mcp/{id}/`**（结尾带 `/`）。
- **两层鉴权（关键认知，必须在 UI 文案讲清）**：
  - 「上游鉴权 Header」（反代表单字段，`handler.go:148-155` 注入上游）= **网关 → 上游 MCP** 的凭证（如 Tushare token），客户端看不到（store 层返回 `***`，见 `mcp-proxy-store.ts:79`）。
  - 「PAT / API Token」= **客户端 → 网关** 的凭证（`server.go:1378 identityFromRequest` 校验 `agx-pat-` 前缀），放在客户端请求 `Authorization: Bearer agx-pat-...`。
- **PAT 可复用、非一次一发**：PAT 是用户级凭证（`packages/iam-core/src/pat-service.ts:createPat`），一个 PAT 可同时访问 Chat API、多个反代、托管 MCP。
- **反代路径不强制 `mcp:*` scope**：`handleMCPProxy`（`mcp_proxy_handlers.go:30`）只校验 PAT 有效性，不校验 scope；默认 scope `workspace:chat`（`pat-service.ts:93`）即可访问反代。（区别于 `/mcp/{name}/*` **托管** 路径，那个才需要 `mcp:*` / `mcp:server:*` scope。）
- **前端取网关地址的途径**：admin-console 是 Next.js，客户端组件可直接读 `process.env.NEXT_PUBLIC_*`（`NEXT_PUBLIC_` 前缀的变量构建期自动注入到浏览器侧，见 `admin-sso-runtime.ts` 已有用法）。当前 **没有** 暴露网关公网地址给前端的变量，需新增 `NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL`。

### Goal
让用户在 `/admin/mcp-servers` 创建反代后，**无需理解端口/路径细节**即可：
1. 看到并复制完整 Gateway 反代 URL。
2. 复制可直接用的 `mcp.json` 客户端配置片段（含 url + PAT 占位 headers）。
3. 理解「PAT 只需建一次、可复用」，并能一键跳转到 `/admin/api-tokens`。

### 非目标（严格遵守 no-scope-creep）
- **不改** Gateway 任何 Go 代码（反代链路已通）。
- **不改** PAT 签发逻辑（不在反代页内联创建 PAT，仅做引导跳转；避免触碰 `createPat` / scopes 语义）。
- **不动** 托管 MCP（`/admin/mcp-servers` 页内的 OpenAPI 导入区、`/mcp/{name}/*` 托管区）的既有逻辑，仅在其反代区块（`proxyTitle` Card）内做展示增强。
- **不改** 数据库 schema、`mcp-proxy-store.ts`、反代 CRUD API。
- 不做 i18n 以外的多语言（仅维护既有 zh / en 两套 messages）。

### Tech Stack
TypeScript / React (admin-console, Next.js App Router) · `@agenticx/ui` 组件 · next-intl i18n。

---

## 关键现有代码定位（实施时直接跳转）

| 文件 | 位置 | 现状 | 本 plan 操作 |
|---|---|---|---|
| `enterprise/apps/admin-console/src/app/admin/mcp-servers/page.tsx` | L22-28 `McpProxyServer` 类型 | 无 `authHeader` 之外的展示辅助 | 不改类型，新增派生函数 |
| 同上 | L46-62 组件 state | — | 新增 `copiedId` 等本地状态（可选） |
| 同上 | L147-172 `createProxyServer` | 创建后仅 toast + reload | 保持，无需改 |
| 同上 | L285-344 反代 Card 渲染 | 仅显示 `/v1/mcp/{s.id}/* · {s.upstreamUrl}` | ✅ 核心改造：完整 URL + 复制 + 配置片段 + PAT 引导 |
| `enterprise/apps/admin-console/messages/zh.json` | L215-221 `mcpServers.proxy*` | 缺新文案 key | ✅ 新增 key |
| `enterprise/apps/admin-console/messages/en.json` | L215-221 同上 | 缺新文案 key | ✅ 新增对应英文 key |
| `enterprise/.env.local.example` | L37-57 GATEWAY 段 | 无 `NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL` | ✅ 新增并注释 |
| `enterprise/apps/api-tokens` 页 | `/admin/api-tokens` | 已存在，PAT 复用 | 仅作跳转目标，不改 |
| `@agenticx/ui` | `Button` 等 | 已有 `navigator.clipboard` 用法（api-tokens 页 L146） | 复用复制模式 |

---

## Phase 1 (P0)：网关地址来源 + 完整 URL 展示与复制

### Task 1.1：新增前端可见的网关地址变量
**Files:**
- Modify: `enterprise/.env.local.example`（GATEWAY 段，约 L55 附近 MCP 注释下方）

**Steps:**
1. 在 `GATEWAY_MCP_HOSTING=on` 附近新增：
   ```bash
   # 前台展示用：客户端实际连接的 Gateway 公网/本机地址（用于 /admin/mcp-servers 反代地址拼接与配置片段）
   # 本地默认 http://127.0.0.1:8088；生产填对外网关域名（无尾随 /v1）
   NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL=http://127.0.0.1:8088
   ```
2. 不强制要求 `.env.local` 同步（前端有 fallback，见 Task 1.2）。

**Acceptance:** `.env.local.example` 含该变量及中文注释；变量名以 `NEXT_PUBLIC_` 开头确保浏览器侧可读。

### Task 1.2：页面派生完整反代 URL
**Files:**
- Modify: `enterprise/apps/admin-console/src/app/admin/mcp-servers/page.tsx`

**Steps:**
1. 在组件顶部（`export default function` 内、`useTranslations` 之后）定义网关基址常量：
   ```ts
   const gatewayBase = (
     process.env.NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL?.trim() || "http://127.0.0.1:8088"
   ).replace(/\/+$/, "");
   ```
   - 注意：`process.env.NEXT_PUBLIC_*` 在客户端组件可直接读；值在构建期内联，运行时固定。
2. 新增纯函数（组件外或组件内均可，建议组件外、文件顶部 import 之后）：
   ```ts
   function proxyClientUrl(base: string, serverId: string): string {
     return `${base}/v1/mcp/${serverId}/`;
   }
   ```
   - 结尾保留 `/`，与网关 `suffix` 透传语义一致（见上下文：后缀为空时用 upstreamUrl 作 target）。
3. 在反代列表项（L323-343 `proxyServers.map`）的描述区，将原：
   ```tsx
   {t("proxyGatewayPath")}: /v1/mcp/{s.id}/* · {s.upstreamUrl}
   ```
   改为分行结构（保持 `text-xs text-muted-foreground` 风格）：
   - 第 1 行：完整客户端地址 `proxyClientUrl(gatewayBase, s.id)`，等宽字体 `font-mono`，可换行 `break-all`，右侧一个「复制」`Button`（`size="sm" variant="ghost"`，复用 `navigator.clipboard.writeText`）。
   - 第 2 行（次要、更淡）：`{t("proxyUpstreamLabel")}: {s.upstreamUrl}`，说明这是上游地址（用户配置的源）。

**Acceptance:**
- 列表项显示形如 `http://127.0.0.1:8088/v1/mcp/01KVQ.../` 的完整地址。
- 点「复制」把完整地址写入剪贴板并 toast 成功（复用既有 `toast` from `@agenticx/ui`）。
- 上游 URL 仍可见但视觉降级为辅助信息。

---

## Phase 2 (P0)：客户端 `mcp.json` 配置片段

### Task 2.1：每个反代项可展开/复制配置片段
**Files:**
- Modify: `enterprise/apps/admin-console/src/app/admin/mcp-servers/page.tsx`

**Steps:**
1. 新增纯函数生成配置片段（组件外）：
   ```ts
   function proxyMcpJsonSnippet(base: string, server: { id: string; name: string }): string {
     const cfg = {
       mcpServers: {
         [server.name || server.id]: {
           url: `${base}/v1/mcp/${server.id}/`,
           headers: { Authorization: "Bearer agx-pat-在 API Tokens 页创建" },
         },
       },
     };
     return JSON.stringify(cfg, null, 2);
   }
   ```
   - `headers` 的 PAT 用占位串（中文提示），避免让用户误以为系统已自动签发。
2. 在反代列表项内新增一个可折叠区（用 `@agenticx/ui` 已导入的组件；若无 Collapsible，则用本地 `useState<string|null>` 记录展开的 `serverId`，点击「查看客户端配置」按钮切换）：
   - 展开时渲染一个 `<pre className="...font-mono text-xs...">` 显示 `proxyMcpJsonSnippet(...)`。
   - 配上「复制配置」`Button`。
3. **不要**引入新依赖；折叠交互优先用现有 state + 条件渲染，保持与页面其余实现风格一致。

**Acceptance:**
- 每个反代项可展开看到完整 `mcp.json` 片段（含正确 url 与 PAT 占位）。
- 「复制配置」把整段 JSON 写入剪贴板并 toast。
- 折叠状态为单项（展开 A 再展开 B 时 A 收起，或各自独立——二选一，实施者择简单者，注释说明）。

---

## Phase 3 (P0)：双层鉴权说明 + PAT 引导

### Task 3.1：反代 Card 顶部加说明 + PAT 跳转
**Files:**
- Modify: `enterprise/apps/admin-console/src/app/admin/mcp-servers/page.tsx`
- Modify: `enterprise/apps/admin-console/messages/zh.json`
- Modify: `enterprise/apps/admin-console/messages/en.json`

**Steps:**
1. 在反代 Card 的 `CardDescription`（L288 `t("proxyDescription")`）下方，或 `CardContent` 顶部，新增一段说明性区块（`text-xs text-muted-foreground` + 轻边框 `rounded-md border p-3`），文案要点（写进 i18n key，不硬编码）：
   - 客户端请连 **Gateway**（`NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL`，默认 `:8088`），不是当前管理台 `:3001`。
   - **两层鉴权**：表单「上游鉴权 Header」是网关访问上游的凭证；客户端访问网关需用 **API Token (PAT)**，放在 `Authorization: Bearer`。
   - **PAT 只需创建一次、可复用**于所有反代；前往「API Tokens」管理。
2. 在该区块放一个跳转按钮/链接到 `/admin/api-tokens`：
   - 用 `next/link` 的 `Link`（参考 api-tokens 页已 `import Link from "next/link"`）包 `@agenticx/ui` 的 `Button`（`variant="outline" size="sm"`），文案取 i18n key `proxyManagePat`。
3. i18n 新增 key（`pages.admin.mcpServers` 命名空间下）：
   - `proxyUpstreamLabel`：zh「上游地址」/ en "Upstream URL"
   - `proxyClientUrlLabel`：zh「客户端连接地址（Gateway）」/ en "Client URL (Gateway)"
   - `proxyViewConfig`：zh「查看客户端配置」/ en "View client config"
   - `proxyCopyUrl`：zh「复制地址」/ en "Copy URL"
   - `proxyCopyConfig`：zh「复制配置」/ en "Copy config"
   - `proxyCopied`：zh「已复制到剪贴板」/ en "Copied to clipboard"
   - `proxyAuthNote`：zh 双层鉴权说明长文案（见 Task3.1.1 要点）/ en 对应英文
   - `proxyManagePat`：zh「管理 API Tokens」/ en "Manage API Tokens"
   - `proxyPatReusableNote`：zh「一个 PAT 可复用于所有反代，无需每次新建」/ en 对应

**Acceptance:**
- 反代区块顶部显示中文（默认语言）双层鉴权说明，逻辑准确（不把两层凭证混为一谈）。
- 「管理 API Tokens」按钮跳转到 `/admin/api-tokens`。
- zh / en 两套 messages 均补齐，无缺 key（避免 next-intl 运行时报 `MISSING_MESSAGE`）。

---

## Phase 4：验收与回归

### Task 4.1：构建与类型校验
**Steps:**
1. `cd enterprise && pnpm --filter @agenticx/admin-console typecheck`（或仓库既有 typecheck 脚本）须绿。
2. `pnpm --filter @agenticx/admin-console build` 须绿。
3. 若仓库有 i18n key 校验脚本（检查 zh/en 对齐），一并跑过。

### Task 4.2：人工 UI 验收（dev）
**Steps:**
1. `bash enterprise/scripts/start-dev-with-infra.sh`（需 PG/Redis；反代列表依赖 `enterprise_runtime_mcp_servers` 表）。
2. 访问 `http://localhost:3001/admin/mcp-servers`，用截图里的 tushare 反代或新建一个验证：
   - 完整地址显示为 `http://127.0.0.1:8088/v1/mcp/{id}/`。
   - 复制地址 / 复制配置均 toast 成功，剪贴板内容正确。
   - 双层鉴权说明 + PAT 跳转可见、可点。
3. 切换 admin-console 语言到 en，确认新文案均有英文（不回退英文 key 名）。

**Acceptance:** 三处缺口（地址不可见 / 配置手拼 / PAT 割裂）均消除；无 console 报错、无 MISSING_MESSAGE。

---

## 实施顺序与提交建议
- 顺序：Phase 1 → 2 → 3 → 4，单 PR 即可（改动集中在 1 个页面 + 2 个 i18n + 1 个 env 示例）。
- commit 使用 `/commit --spec=.cursor/plans/2026-06-23-admin-mcp-proxy-address-and-pat-ux.plan.md`，自动注入 `Plan-Id` / `Plan-File`；`git add` 只加本 plan 直接改动的 4 个文件，禁止裹挟无关变更。
- commit 须含 `Made-with: Damon Li`，并附 `Plan-Model` / `Impl-Model`（值由用户提供，未提供时主动询问、禁止编造）。

## 风险与边界
- `NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL` 构建期内联：生产部署若网关域名变化，需重新构建 admin-console（在 env 注释中提示）。本地 fallback `http://127.0.0.1:8088` 与现有约定一致。
- 反代结尾 `/` 的正确性已据 `handler.go` 透传逻辑确认；若后续上游为「需带子路径」的 MCP（如 `…/streamable-http`），用户仍按上游实际路径在客户端 URL 后补后缀——本 plan 给出的是「后缀为空」基线地址，文案中以「客户端连接地址」表述，不夸大为唯一终点。
- 不触碰 `authHeader` 的 `***` 脱敏逻辑（store 层已处理），配置片段中绝不回显上游凭证。

Made-with: Damon Li
