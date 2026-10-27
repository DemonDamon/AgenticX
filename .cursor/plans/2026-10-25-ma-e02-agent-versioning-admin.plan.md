# MA-E02 Agent 版本化管理、公共接口与内部快照（admin-console）

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W2 · MA-E02）
Depends-on:
- .cursor/plans/2026-10-25-ma-00-protocol-freeze.plan.md（core-api `validateManifest`、`PAT_SCOPES`、`MA_ERROR_CODES`、`AgentRecord` / `AgentVersionRecord` / `EnvironmentRecord` 类型）
- .cursor/plans/pending/2026-10-25-ma-e01-schema.plan.md（表结构与 iam-core repos：`listAgentsWithMa`、`getAgentWithMa`、`createAgentWithInitialVersion`、`createAgentVersion`、`previewAgentManifest`、`listAgentVersions`、`getAgentVersion`、`ensureAgentVersionOne`、`updateAgentMaSettings`、`resolveEffectiveVersion`、`*MaEnvironment*`、错误类）
Downstream: MA-E03（agent-runtime 调本子规划的 `/api/internal/ma/*`）、MA-E11（SDK / CLI 调 `/api/ma/v1/*`）、MA-D02 / MA-D04

**栈：** TS（`enterprise/apps/admin-console` 单 app）。不改 iam-core / db-schema / core-api（缺函数时回到 E01 补，不在这里写 SQL）。

---

## 0. 一句话目标

管理员在 `/admin/agents` 里能编辑 Agent 的 Manifest（表单 + 原始 JSON）、保存为不可变新版本、看版本列表与差异、以旧版本为基础回滚、把路由在「跟随最新 / 固定版本」间切换、指定默认执行环境；新增「执行环境」管理页；对外提供 PAT（`ma:` scope）鉴权的 `/api/ma/v1/agents*`、`/api/ma/v1/environments*`；对 agent-runtime 提供 `MA_INTERNAL_TOKEN` 鉴权的版本解析、环境快照与 PAT 内省接口；API 令牌页可勾选 `ma:` 权限。

---

## 1. 根因 / 动机与证据链

### 1.1 来自 master 的约束

| master 节 | 约束 | 落点 |
|---|---|---|
| §2.3 | 控制面表唯一写入方是 admin-console（经 iam-core）；agent-runtime 调 `/api/internal/ma/*`（Bearer `MA_INTERNAL_TOKEN`），沿用网关拉 `/api/internal/*` 的模式 | §5.4 内部接口 |
| §4 决策 4 | 对外统一 `/ma/v1/*`，控制面资源由 nginx 转到 admin-console 的 `/api/ma/v1/*`；凭证为 iam-core PAT + `ma:` scope；agent-runtime 校验 PAT 走 admin-console 内省接口（本地缓存 30 秒） | §5.3 公共接口、§5.4.3 内省 |
| §4 决策 5 | ID 26 位 ULID | 路由参数校验 |
| §4 决策 7 | 版本不可变；Session 锁版本；路由跟随最新 / 固定；回滚 = 发布与旧版本等价的新版本，或把路由改回固定版本 | §6 UI「以此版本为基础编辑」「固定到此版本」 |
| §4 决策 8 | Manifest 严格校验、整体拒绝，错误格式 `manifest.<path>: <message>` | 服务端一律走 iam-core（内部调 core-api `validateManifest`），失败 400 `manifest_invalid` + `errors[]` |
| §5.2 | AgentRecord / AgentVersionRecord / EnvironmentRecord 最小字段集；MA-00 Python 侧 `extra="forbid"` | 公共与内部接口输出的 record **只含**冻结字段；路由等扩展信息放在同级 `routing` 对象，不塞进 record |
| §7 W2 门 | 发布 v1、v2；路由固定回 v1 后新会话用 v1 | 内部接口 `version=effective` |

### 1.2 现状代码证据（实施前重新核对行号）

| 文件 | 行 | 事实 |
|---|---|---|
| `enterprise/apps/admin-console/src/app/api/admin/agents/route.ts` | 7–27 | `GET` 用 `listAgents`，`POST` 用 `createAgent`；鉴权 `requireAdminScope(["provider:read"])` / `["provider:update"]`；租户 `requiredTenantId()`（`DEFAULT_TENANT_ID`） |
| `enterprise/apps/admin-console/src/app/api/admin/agents/[agentId]/route.ts` | 7–41 | `GET` / `PATCH`（`updateAgent`）/ `DELETE`（`deleteAgent`） |
| `enterprise/apps/admin-console/src/app/api/admin/agents/shared.ts` | 14、26–41 | `MIGRATE_HINT`；`agentErrorResponse` 把 `AgentValidationError`→400 `40000`、`AgentSlugConflictError`→409 `40900`、`AgentNotFoundError`→404 `40400`、缺表→500 + 迁移提示 |
| 同上 | 110–137、139–165 | `prepareCreateInput` / `preparePatchInput`；`normalizeAssignmentKeys` 来自 `src/lib/capability-packs-store` |
| `enterprise/apps/admin-console/src/app/api/admin/agents/__tests__/route.test.ts` | 1–100、102–240 | vitest；`vi.mock("@agenticx/iam-core", ...)` 自造错误类；`vi.mock("../../../../../lib/admin-auth")`；用例名见第 114–235 行 |
| `enterprise/apps/admin-console/src/app/admin/_sections/agents.tsx` | 137–352 | 列表、`openEdit`、`save()`（PATCH 整包发送 model/systemPrompt/metadata/capabilityIds…）、`setLifecycle()`（**回收无确认**，第 318–331 行）、`confirmDelete()` |
| 同上 | 386–433 | 表格行操作：发布/回收、编辑、删除 |
| 同上 | 521–529 | 系统提示词 `Textarea maxLength={16000}` |
| `enterprise/apps/admin-console/src/app/admin/[section]/page.tsx` | 1–40 | `PLATFORM_SECTION_PAGES` 映射 section id → 组件 |
| `enterprise/apps/admin-console/src/lib/admin-platform-sections.ts` | 2–14 | `PLATFORM_SECTION_IDS` |
| `enterprise/apps/admin-console/src/lib/__tests__/admin-platform-sections.test.ts` | 5–18 | 逐项断言 `PLATFORM_SECTION_IDS` |
| `enterprise/apps/admin-console/src/components/AppShell.tsx` | 35–66、111–124、348 | lucide 图标 import；`platform` 组 nav：`{ href: "/admin/agents", labelKey: "agents", icon: Bot }` 等；高亮匹配 `pathname === item.href \|\| pathname.startsWith(\`${item.href}/\`)` |
| `enterprise/apps/admin-console/messages/zh.json`、`en.json` | `shell.nav.items`、`pages.admin.agents`、`pages.admin.apiTokens` | 文案走 next-intl（`useTranslations("pages.admin.agents")`） |
| `enterprise/apps/admin-console/src/lib/admin-auth.ts` | 32–49、51–68 | `requireAdminScope(required)` / `requireAdminSomeScope(candidates)`，返回 `{ ok, session, scopes }` 或 `{ ok:false, response }` |
| `enterprise/apps/admin-console/src/lib/gateway-internal-token.ts` | 6–30 | 内部 token 解析模式：`GATEWAY_INTERNAL_TOKEN` 或 `_FILE`，进程内缓存 |
| `enterprise/apps/admin-console/src/lib/gateway-internal-auth.ts` | 4–15 | `Bearer` 比对（普通 `===`）；未配置 token 时一律拒绝；401 体 `{ code: "40101", message: "unauthorized" }` |
| `enterprise/apps/admin-console/src/app/api/internal/pat-revocation-snapshot/route.ts` | 1–18 | 内部接口样板：`export const dynamic = "force-dynamic"`，先鉴权再处理，`cache-control: no-store` |
| `enterprise/apps/admin-console/src/app/api/admin/api-tokens/route.ts` | 26–64 | `POST` 直接把 `body.scopes` 透传给 `createPat`，**没有任何 scope 白名单**；仓库中不存在「PAT scope 目录」 |
| `enterprise/apps/admin-console/src/app/admin/_sections/api-tokens.tsx` | 56–120 | 新建对话框只有名称 / 归属用户 / 有效天数；`form` state 第 64 行 |
| `enterprise/packages/iam-core/src/pat-service.ts` | 176–205、207–214 | `verifyPat(plain)` → `{ id, tenantId, userId, deptId, scopes, status }` 或 null（吊销 / 过期 / 非 `agx-pat-` 前缀都返回 null）；`touchPatLastUsed(id)` |
| `enterprise/packages/iam-core/src/pat-service.ts` | 100 | 未传 scopes 时默认 `["workspace:chat"]` |
| `enterprise/packages/iam-core/src/scope-registry.ts` | 26–35、43–53 | `hasSomeScope` / `hasEveryScope` 会先 `expandRoleScopes` **过滤掉未注册 scope**——`ma:*` 不在 `SCOPE_REGISTRY` 里，**不能**用它们判 PAT 的 `ma:` 权限 |
| `enterprise/apps/admin-console/src/components/assignment/AssignmentScopeEditor` | agents.tsx 564–582 用法 | `value / onChange / depts / groups / users`，配合 `toAssignmentKeys` / `fromAssignmentKeys`（`src/lib/capability-pack-form`） |
| `enterprise/apps/admin-console/vitest.config.ts` | 全文 | `testTimeout: 20000` |
| admin-console 无 `middleware.ts` | — | `/api/ma/v1/*` 与 `/api/internal/ma/*` 由各自路由自行鉴权 |
| `enterprise/apps/admin-console/package.json` | dependencies | 已依赖 `@agenticx/core-api`、`@agenticx/iam-core`、`ulid` |

### 1.3 关键设计决策（本子规划内定）

| # | 决策 | 理由 |
|---|---|---|
| D1 | 不改现有「编辑智能体」弹窗的字段集合（基础信息 + 模型 + 提示词 + 能力仍可在那里改）；新增「定义与版本」弹窗承载 Manifest 编辑、版本、路由、默认环境 | 现有弹窗被员工登记、能力配置等流程依赖；E01 已保证经旧 PATCH 改模型/提示词/能力会同步追加 `legacy_edit` 版本，两条入口结果一致 |
| D2 | 路由与默认环境存在 `enterprise_agents.version_routing` / `pinned_version` / `default_environment_id`（E01 已建列）；UI 只调 `PATCH /api/admin/agents/:id/ma-settings` | 与 E01 决策 D3 一致 |
| D3 | 公共与内部接口的 `agent` / `version` / `environment` 对象**严格等于** MA-00 冻结的 record 字段；扩展信息（`routing`、`runtime`）放在同级键 | MA-00 Python `AgentRecord` 等 `extra="forbid"`，多一个键 agent-runtime 解析即失败 |
| D4 | 控制面扩展错误码（不在 MA-00 枚举里，agent-runtime 不会收到）：`agent_version_conflict` 409、`agent_slug_conflict` 409、`environment_name_conflict` 409、`environment_in_use` 409，定义在 admin-console 本地常量 `MA_CONTROL_PLANE_ERROR_CODES` | MA-00 错误码表无版本冲突类；不改 MA-00 文件。**合入前须在 master §12 变更记录登记一行**（由用户或单独的文档 commit 完成，本子规划不改 master 文件） |
| D5 | PAT 的 `ma:` 判定自写：`scopes.includes(required) \|\| scopes.includes("ma:admin")` | `scope-registry` 的 `hasSomeScope` 会把未注册 scope 过滤掉（见 1.2） |
| D6 | PAT 内省新建 `POST /api/internal/ma/pat-introspect`，token 放请求体不放 query；返回 RFC 7662 风格 `{active:false}` 或 `{active:true, tenant_id, user_id, dept_id, scopes, token_id}`；底层复用 `verifyPat`（含吊销与过期判断） | 仓库中不存在等价接口（`pat-revocation-snapshot` 只给哈希列表）；放 body 避免 token 进访问日志 |
| D7 | 内部 token：`MA_INTERNAL_TOKEN` 或 `MA_INTERNAL_TOKEN_FILE`，**不复用** `GATEWAY_INTERNAL_TOKEN`；比较用 `crypto.timingSafeEqual`；未配置时一律 401（fail closed） | 两个调用方（网关 / 托管运行时）权限面不同，分开轮换；master §2.3 指定 `MA_INTERNAL_TOKEN` |
| D8 | 内部接口要求 query `tenant_id`，所有查询带租户条件 | agent-runtime 从 PAT 内省得到 tenant，再按租户取版本；防止串租户 |
| D9 | 客户端组件**不得** import `@agenticx/core-api`（MA-00 的 `manifestHash` 依赖 `node:crypto`）；即时校验走服务端 dry-run（`POST .../versions?dryRun=1`）；UI 需要的 `ma:` scope 列表放客户端安全的常量文件，并用测试保证与 core-api `PAT_SCOPES` 一致 | 防止 Next 客户端打包 `node:crypto` 失败 |
| D10 | 「回收」「固定到此版本 / 切换路由」「停用环境」「删除环境」都加确认弹窗（应用内 `Dialog`，不用 `window.confirm`） | 需求明确要求破坏性操作确认；回收会让员工侧立即不可用 |
| D11 | 版本差异在客户端用纯函数做行级 LCS diff（输入为键排序后 `JSON.stringify(…, null, 2)`），不新增依赖 | 版本 manifest ≤ 256 KiB，行级 diff 足够；仓库规则克制新依赖 |

---

## 2. In scope / Out of scope

### 2.1 In scope（只能创建或修改这些文件；路径均相对 `enterprise/apps/admin-console/`）

新建 · 服务端工具：
- `src/lib/ma/internal-auth.ts`
- `src/lib/ma/pat-auth.ts`
- `src/lib/ma/errors.ts`
- `src/lib/ma/records.ts`
- `src/lib/ma/http.ts`（读 JSON body、解析整数 / ULID 参数）

新建 · 客户端安全纯函数：
- `src/lib/ma/manifest-form.ts`
- `src/lib/ma/manifest-diff.ts`
- `src/lib/ma/pat-scope-options.ts`

新建 · 管理台路由（cookie 会话）：
- `src/app/api/admin/agents/[agentId]/versions/route.ts`
- `src/app/api/admin/agents/[agentId]/versions/[version]/route.ts`
- `src/app/api/admin/agents/[agentId]/ma-settings/route.ts`
- `src/app/api/admin/ma-environments/route.ts`
- `src/app/api/admin/ma-environments/[envId]/route.ts`
- `src/app/api/admin/ma-environments/shared.ts`

新建 · 公共接口（PAT）：
- `src/app/api/ma/v1/agents/route.ts`
- `src/app/api/ma/v1/agents/[agentId]/route.ts`
- `src/app/api/ma/v1/agents/[agentId]/versions/route.ts`
- `src/app/api/ma/v1/agents/[agentId]/versions/[version]/route.ts`
- `src/app/api/ma/v1/environments/route.ts`
- `src/app/api/ma/v1/environments/[envId]/route.ts`

新建 · 内部接口（`MA_INTERNAL_TOKEN`）：
- `src/app/api/internal/ma/agent-versions/[agentId]/[version]/route.ts`
- `src/app/api/internal/ma/environments/[envId]/route.ts`
- `src/app/api/internal/ma/pat-introspect/route.ts`

新建 · UI：
- `src/app/admin/_sections/agent-manifest/AgentManifestDialog.tsx`
- `src/app/admin/_sections/agent-manifest/ManifestFormTab.tsx`
- `src/app/admin/_sections/agent-manifest/ManifestJsonTab.tsx`
- `src/app/admin/_sections/agent-manifest/ManifestVersionsTab.tsx`
- `src/app/admin/_sections/agent-manifest/ManifestDiffView.tsx`
- `src/app/admin/_sections/agent-manifest/AgentRoutingTab.tsx`
- `src/app/admin/_sections/agent-environments.tsx`

修改：
- `src/app/api/admin/agents/route.ts`（`GET` 改用 `listAgentsWithMa`）
- `src/app/api/admin/agents/shared.ts`（`agentErrorResponse` 追加 4 个分支）
- `src/app/api/admin/api-tokens/route.ts`（`POST` 校验 `ma:` scope）
- `src/app/admin/_sections/agents.tsx`（版本列、「定义与版本」按钮、回收确认、`maxLength` 16000→65536）
- `src/app/admin/_sections/api-tokens.tsx`（新建对话框加 `ma:` 权限勾选）
- `src/app/admin/[section]/page.tsx`（映射 `agent-environments`）
- `src/lib/admin-platform-sections.ts`（加 `"agent-environments"`）
- `src/components/AppShell.tsx`（nav 加一项 + 一个 lucide 图标 import）
- `messages/zh.json`、`messages/en.json`（新增文案键，见 §7）
- `enterprise/.env.local.example`（追加 `MA_INTERNAL_TOKEN=` 说明行）

测试（新建或修改，见 §8）：
- 修改 `src/app/api/admin/agents/__tests__/route.test.ts`
- 修改 `src/lib/__tests__/admin-platform-sections.test.ts`
- 新建 `src/lib/ma/__tests__/{internal-auth,pat-auth,errors,records,manifest-form,manifest-diff,pat-scope-options}.test.ts`
- 新建 `src/app/api/admin/agents/__tests__/versions-route.test.ts`、`ma-settings-route.test.ts`
- 新建 `src/app/api/admin/ma-environments/__tests__/route.test.ts`
- 新建 `src/app/api/admin/api-tokens/__tests__/route.test.ts`
- 新建 `src/app/api/ma/v1/__tests__/agents-route.test.ts`、`versions-route.test.ts`、`environments-route.test.ts`
- 新建 `src/app/api/internal/ma/__tests__/internal-routes.test.ts`

### 2.2 Out of scope

- `enterprise/packages/**`（iam-core / db-schema / core-api）——缺函数回 E01 / MA-00。
- `enterprise/apps/web-portal/**`、`apps/gateway/**`、`apps/agent-runtime/**`（不存在，属 E03）、nginx 配置（属 E03）、`scripts/bootstrap.sh` 生成 `MA_INTERNAL_TOKEN`（属 E03）。
- 会话观测台（属 E05）；会话面 `/ma/v1/sessions*`（属 E03）。
- 不新增 npm 依赖。
- 现有「编辑智能体」弹窗除 `maxLength` 外不改字段与提交逻辑；`setLifecycle` 发布路径不改（只给回收加确认）。
- 不删除 Agent 的公共接口（只在管理台保留删除）。
- 不改 `scope-registry.ts`（`ma:` 是 PAT scope，不是角色 scope）。

---

## 3. 数据与协议细节

### 3.1 记录映射（`src/lib/ma/records.ts`）

```ts
import type { EnterpriseAgentWithMa, AgentVersion, MaEnvironment } from "@agenticx/iam-core";

/** MA-00 AgentRecord：恰好这 12 个键。 */
export type MaAgentRecord = {
  id: string; tenant_id: string; slug: string; display_name: string; description: string | null;
  latest_version: number; status: "active" | "disabled"; lifecycle: "draft" | "published" | "recalled";
  origin: "enterprise" | "employee"; assignment_keys: string[]; worker_keys: string[];
  default_environment_id: string | null;
};
/** MA-00 AgentVersionRecord：恰好这 7 个键。 */
export type MaAgentVersionRecord = {
  agent_id: string; version: number; manifest: Record<string, unknown>; manifest_hash: string;
  created_by: string | null; created_at: string; note: string | null;
};
/** MA-00 EnvironmentRecord：恰好这 6 个键（不含 description）。 */
export type MaEnvironmentRecord = {
  id: string; tenant_id: string; name: string; type: "cloud" | "desktop_worker";
  config: Record<string, unknown>; status: "active" | "disabled";
};
export type MaAgentRouting = { mode: "follow_latest" | "pinned"; pinned_version: number | null; effective_version: number };

export function toMaAgentRecord(agent: EnterpriseAgentWithMa): MaAgentRecord;
export function toMaAgentRouting(agent: EnterpriseAgentWithMa): MaAgentRouting;
export function toMaAgentVersionRecord(version: AgentVersion): MaAgentVersionRecord;
export function toMaEnvironmentRecord(env: MaEnvironment): MaEnvironmentRecord;
/** {agent, routing} 包装，公共接口 GET 单个 / 列表元素都用它。 */
export function toMaAgentEnvelope(agent: EnterpriseAgentWithMa): { agent: MaAgentRecord; routing: MaAgentRouting };
```

若 MA-00 的 TS 已导出同名语义的 `AgentRecord` / `AgentVersionRecord` / `EnvironmentRecord` 类型，`MaAgentRecord` 等直接 `= AgentRecord` 别名，不重复定义（以 MA-00 实际导出为准）。

### 3.2 错误（`src/lib/ma/errors.ts`）

```ts
import { MA_ERROR_CODES } from "@agenticx/core-api";

export const MA_CONTROL_PLANE_ERROR_CODES = {
  agent_version_conflict: 409,
  agent_slug_conflict: 409,
  environment_name_conflict: 409,
  environment_in_use: 409,
} as const;
export type MaApiErrorCode = keyof typeof MA_ERROR_CODES | keyof typeof MA_CONTROL_PLANE_ERROR_CODES;

/** 统一体：{"error":{"code","message","details"?}}，status 取两张表中的值。 */
export function maError(code: MaApiErrorCode, message: string, details?: Record<string, unknown>): NextResponse;

/** iam-core 错误 → MA 错误。未知错误：console.error("ma.api.internal_error", error) 后返回 internal_error，message 固定 "internal error"（不回显底层信息）。 */
export function maErrorFromException(error: unknown): NextResponse;
```

映射表（逐条实现，按 `error.name` 判断，避免跨包 `instanceof` 失效）：

| 异常 `name` | code | message | details |
|---|---|---|---|
| `AgentValidationError` | `invalid_request` | 原 message | — |
| `MaEnvironmentValidationError` | `invalid_request` | 原 message | — |
| `AgentNotFoundError` | `agent_not_found` | `agent not found` | — |
| `AgentVersionNotFoundError` | `agent_version_not_found` | `agent version not found` | — |
| `MaEnvironmentNotFoundError` | `environment_not_found` | `environment not found` | — |
| `AgentManifestInvalidError` | `manifest_invalid` | `manifest is invalid` | `{ errors: string[] }` |
| `AgentVersionConflictError` | `agent_version_conflict` | `latest version has changed` | `{ current_latest_version: number }` |
| `AgentSlugConflictError` | `agent_slug_conflict` | `slug already exists` | — |
| `MaEnvironmentNameConflictError` | `environment_name_conflict` | `environment name already exists` | — |
| `MaEnvironmentInUseError` | `environment_in_use` | `environment is referenced by agents or active sessions` | — |

### 3.3 PAT 鉴权（`src/lib/ma/pat-auth.ts`）

```ts
import { touchPatLastUsed, verifyPat } from "@agenticx/iam-core";

export type MaPatIdentity = { tokenId: number; tenantId: string; userId: string; deptId: string | null; scopes: string[] };

export function patHasMaScope(scopes: readonly string[], required: string): boolean {
  return scopes.includes(required) || scopes.includes("ma:admin");
}

/** 1) 取 Authorization: Bearer <token>；缺失或非 agx-pat- 前缀 → 401 unauthorized "missing or invalid token"
 *  2) verifyPat(token) 为 null → 401 unauthorized "missing or invalid token"
 *  3) !patHasMaScope → 403 forbidden_scope "token lacks required scope"，details {required}
 *  4) 成功：void touchPatLastUsed(id).catch(() => {})；返回 {ok:true, identity} */
export async function requireMaPat(request: Request, required: string):
  Promise<{ ok: true; identity: MaPatIdentity } | { ok: false; response: NextResponse }>;
```

### 3.4 内部鉴权（`src/lib/ma/internal-auth.ts`）

```ts
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";

/** MA_INTERNAL_TOKEN 优先，其次读 MA_INTERNAL_TOKEN_FILE；结果进程内缓存（同 gateway-internal-token.ts 第 3–30 行写法）。 */
export function getMaInternalToken(): string;
/** 测试用：清缓存。 */
export function __resetMaInternalTokenCacheForTests(): void;
/** 未配置 → false；Bearer 解析同 gateway-internal-auth.ts 第 11–13 行；长度不等 → false；否则 timingSafeEqual。 */
export function isMaInternalAuthorized(request: Request): boolean;
/** 401：{"error":{"code":"unauthorized","message":"invalid internal token"}} */
export function maInternalUnauthorized(): NextResponse;
```

### 3.5 HTTP 工具（`src/lib/ma/http.ts`）

```ts
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const TENANT_ID_RE = /^[0-9A-Za-z_-]{1,64}$/;
/** 请求体必须是 JSON object，否则抛 {code:"invalid_request", message:"request body must be a JSON object"}（自定义 MaRequestError）。 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>>;
/** 出现 allowed 之外的键 → MaRequestError("unknown field: <k>")（按键名字典序报第一个）。 */
export function assertOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void;
/** "latest" | "effective" | 正整数（字符串形式，/^[1-9]\d{0,8}$/），否则 MaRequestError("invalid version")。 */
export function parseVersionParam(raw: string): "latest" | "effective" | number;
export class MaRequestError extends Error { /* name = "MaRequestError" */ }
```

`maErrorFromException` 额外映射 `MaRequestError` → `invalid_request`（原 message）。

---

## 4. 管理台路由（cookie 会话，信封 `{ code, message, data }`）

所有路由：读用 `requireAdminScope(["provider:read"])`，写用 `requireAdminScope(["provider:update"])`（与现有 `/api/admin/agents` 一致）；租户 `requiredTenantId()`（从 `../shared` 导入）；`export const dynamic = "force-dynamic"`。

### 4.1 `src/app/api/admin/agents/route.ts`（修改）

Before（第 2、11 行）：

```ts
import { createAgent, listAgents } from "@agenticx/iam-core";
...
    const agents = await listAgents(requiredTenantId());
```

After：

```ts
import { createAgent, listAgentsWithMa } from "@agenticx/iam-core";
...
    const agents = await listAgentsWithMa(requiredTenantId());
```

`POST` 不改（管理台新建仍走旧表单；E01 懒回填会在首次打开「定义与版本」时生成 v1）。

### 4.2 `src/app/api/admin/agents/shared.ts`（修改）

在 `agentErrorResponse` 中、`AgentNotFoundError` 分支之后、`const message = ...` 之前插入（按 `error.name` 判断，`error` 先断言为 `Error`）：

```ts
if (error instanceof Error && error.name === "AgentManifestInvalidError") {
  const errors = (error as Error & { errors?: string[] }).errors ?? [];
  return NextResponse.json({ code: "40000", message: "定义校验未通过", data: { errorCode: "manifest_invalid", errors } }, { status: 400 });
}
if (error instanceof Error && error.name === "AgentVersionConflictError") {
  const current = (error as Error & { currentLatestVersion?: number }).currentLatestVersion ?? null;
  return NextResponse.json({ code: "40900", message: "版本已被他人更新，请刷新后重试", data: { errorCode: "agent_version_conflict", currentLatestVersion: current } }, { status: 409 });
}
if (error instanceof Error && error.name === "AgentVersionNotFoundError") {
  return NextResponse.json({ code: "40400", message: "版本不存在" }, { status: 404 });
}
if (error instanceof Error && error.name === "AgentHasSessionsError") {
  return NextResponse.json({ code: "40900", message: error.message }, { status: 409 });
}
```

现有三个分支与缺表提示**一字不改**。

### 4.3 `src/app/api/admin/agents/[agentId]/versions/route.ts`（新建）

- `GET ?limit=&beforeVersion=` → `listAgentVersions(tenant, agentId, { limit, beforeVersion })` 与 `getAgentWithMa(tenant, agentId)`（先 versions 再 agent，确保懒回填后 `latestVersion` 已更新）→ `{ code:"00000", message:"ok", data:{ agent, versions } }`。`limit` 非法时用默认（交给 iam-core 夹取）。
- `POST`：body `{ manifest: object, expectedLatestVersion: number, note?: string }`。
  - query `dryRun=1`：`previewAgentManifest(tenant, body.manifest)`；ok → `{ code:"00000", message:"ok", data:{ ok:true, normalized, manifestHash } }`；否则 400 `{ code:"40000", message:"定义校验未通过", data:{ errorCode:"manifest_invalid", errors } }`。dry-run 不校验 `expectedLatestVersion`。
  - 正常：`createAgentVersion(tenant, agentId, { manifest, expectedLatestVersion, note, createdBy: auth.session.userId, source: "admin" })` → `{ code:"00000", message: created ? "ok" : "unchanged", data:{ version, created, agent: await getAgentWithMa(...) } }`。
  - `manifest` 不是对象 → 400 `40000`「定义须为 JSON 对象」；`expectedLatestVersion` 不是正整数 → 400 `40000`「缺少当前版本号，请刷新后重试」。
  - 异常一律 `agentErrorResponse(error)`。

### 4.4 `src/app/api/admin/agents/[agentId]/versions/[version]/route.ts`（新建）

`GET`：`version` 只接受正整数（`/^[1-9]\d{0,8}$/`），否则 400「版本号不合法」；`getAgentVersion` → `{ data:{ version } }`。

### 4.5 `src/app/api/admin/agents/[agentId]/ma-settings/route.ts`（新建）

- `GET` → `{ data:{ agent: await getAgentWithMa(...) } }`。
- `PATCH` body 允许键：`defaultEnvironmentId`（string|null）、`versionRouting`（`follow_latest`|`pinned`）、`pinnedVersion`（number|null）；出现其它键 → 400「不支持的字段：<k>」；类型不符 → 400。→ `updateAgentMaSettings(tenant, agentId, patch)` → `{ data:{ agent } }`。

### 4.6 `src/app/api/admin/ma-environments/*`（新建）

`shared.ts`：

```ts
export function environmentErrorResponse(error: unknown): NextResponse;
// MaEnvironmentValidationError → 400 {code:"40000", message}
// MaEnvironmentNotFoundError → 404 {code:"40400", message}
// MaEnvironmentNameConflictError → 409 {code:"40900", message}
// MaEnvironmentInUseError → 409 {code:"40900", message}
// 其余 → 交给 agentErrorResponse（含缺表迁移提示：正则追加 /ma_environments/ 不需要——agentErrorResponse 的 /relation .* does not exist/ 已覆盖）
export function readEnvironmentInput(body: Record<string, unknown>, mode: "create" | "patch"): MaEnvironmentInput | Partial<MaEnvironmentInput>;
// create：name(string)、type(string)、description?(string|null)、config?(object)、status?(string)；patch：同名键全部可选；其它键 → MaEnvironmentValidationError("不支持的字段：<k>")
```

- `route.ts`：`GET ?status=&type=` → `listMaEnvironments` 后对每个环境 `countMaEnvironmentReferences`（`Promise.all`）→ `{ data:{ environments: Array<MaEnvironment & { references }> } }`；`POST` → `createMaEnvironment(tenant, input, auth.session.userId)` → `{ data:{ environment } }`。
- `[envId]/route.ts`：`GET` → `{ data:{ environment, references } }`；`PATCH` → `updateMaEnvironment`；`DELETE` → `deleteMaEnvironment` → `{ data:{ id } }`。

### 4.7 `src/app/api/admin/api-tokens/route.ts`（修改 `POST`）

在第 41–43 行 name/userId 检查之后插入：

```ts
if (body.scopes !== undefined) {
  if (!Array.isArray(body.scopes) || body.scopes.some((s) => typeof s !== "string" || !s.trim())) {
    return NextResponse.json({ code: "40000", message: "权限列表不合法" }, { status: 400 });
  }
  const unknown = body.scopes.map((s) => s.trim()).find((s) => s.startsWith("ma:") && !(PAT_SCOPES as readonly string[]).includes(s));
  if (unknown) {
    return NextResponse.json({ code: "40000", message: `未知的托管智能体权限：${unknown}` }, { status: 400 });
  }
}
```

`PAT_SCOPES` 从 `@agenticx/core-api` 导入。非 `ma:` 前缀的 scope 不做额外校验（保持现状）。`GET` 不改。

---

## 5. 公共接口与内部接口

### 5.1 通用约定

- 每个路由 `export const dynamic = "force-dynamic"`；响应 JSON、snake_case。
- 成功体不包信封；错误体统一 `{"error":{"code","message","details"?}}`（§3.2）。
- 每个 handler 结构：

```ts
export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const auth = await requireMaPat(request, "ma:agents:read");
  if (!auth.ok) return auth.response;
  try {
    const { agentId } = await context.params;
    if (!ULID_RE.test(agentId)) return maError("agent_not_found", "agent not found");
    // …调用 iam-core，tenant = auth.identity.tenantId
  } catch (error) {
    return maErrorFromException(error);
  }
}
```

### 5.2 Scope 对照

| 方法 · 路径 | scope |
|---|---|
| GET `/api/ma/v1/agents`、GET `/api/ma/v1/agents/:id`、GET `/api/ma/v1/agents/:id/versions`、GET `.../versions/:version` | `ma:agents:read` |
| POST `/api/ma/v1/agents`、PATCH `/api/ma/v1/agents/:id`、POST `/api/ma/v1/agents/:id/versions` | `ma:agents:write` |
| GET `/api/ma/v1/environments`、GET `/api/ma/v1/environments/:id` | `ma:environments:read` |
| POST / PATCH / DELETE `/api/ma/v1/environments*` | `ma:environments:write` |

`ma:admin` 满足以上全部。

### 5.3 公共接口请求 / 响应

**GET `/api/ma/v1/agents`**（query：`lifecycle?`、`status?`，非法值 → 400 invalid_request `invalid filter`）

```json
{ "data": [ { "agent": { "id": "01J…", "tenant_id": "…", "slug": "report-bot", "display_name": "报告助手", "description": null, "latest_version": 2, "status": "active", "lifecycle": "published", "origin": "enterprise", "assignment_keys": ["all"], "worker_keys": [], "default_environment_id": null },
              "routing": { "mode": "follow_latest", "pinned_version": null, "effective_version": 2 } } ] }
```

**POST `/api/ma/v1/agents`** → 201

请求（允许键恰为这些，其它 → `unknown field: <k>`）：

```json
{ "slug": "report-bot", "display_name": "报告助手", "description": null,
  "runtime": "cloud", "assignment_keys": ["all"], "worker_keys": [],
  "manifest": { "schema": "agx.agent/v1", "model": "openai/gpt-4o", "system": "你是报告助手" },
  "note": "初始版本" }
```

处理：`slug` / `display_name` / `manifest` 必填（缺失 → invalid_request `<k> is required`）；`assignment_keys` 缺省 `["all"]`，经 `normalizeAssignmentKeys`（`src/lib/capability-packs-store`）且非空；`worker_keys` 缺省 `[]`；`runtime` 缺省 `cloud`；调用 `createAgentWithInitialVersion(tenant, { slug, displayName, description, runtime, assignmentKeys, workerKeys, lifecycle: "draft", origin: "enterprise", model: "", systemPrompt: "" }, { manifest, note, createdBy: identity.userId, source: "api" })`（model/systemPrompt 由 iam-core 从 manifest 覆盖）。

响应：`{ "agent": MaAgentRecord, "routing": MaAgentRouting, "version": MaAgentVersionRecord }`。

**GET `/api/ma/v1/agents/:id`** → `{ "agent", "routing" }`。

**PATCH `/api/ma/v1/agents/:id`** → 200 `{ "agent", "routing" }`

允许键：`display_name`、`description`、`status`、`lifecycle`、`runtime`、`assignment_keys`、`worker_keys`、`default_environment_id`、`routing`（对象：`{ "mode": "follow_latest" | "pinned", "pinned_version"?: number }`）。出现 `manifest` / `model` / `system` / `system_prompt` / `capability_ids` → invalid_request `use POST /ma/v1/agents/{id}/versions to change the manifest`；其它未知键 → `unknown field: <k>`。

处理顺序：先把基础字段映射为 `Partial<AgentInput>` 调 `updateAgent`（不含 manifest 字段，因此不会触发 legacy_edit 版本）；再若含 `default_environment_id` 或 `routing` 调 `updateAgentMaSettings`；最后 `getAgentWithMa` 返回。两步不在同一事务（已知限制，写入 §10 风险）。

**GET `/api/ma/v1/agents/:id/versions`**（query：`limit` 默认 50 最大 200、`before_version`）

```json
{ "data": [ { "agent_id": "01J…", "version": 2, "manifest": { … }, "manifest_hash": "sha256:…", "created_by": "01H…", "created_at": "2026-10-26T08:00:00.000Z", "note": "加工具" } ],
  "next_before_version": 2 }
```

`next_before_version` = 返回条数等于 limit 时为本页最小 version，否则 `null`。

**POST `/api/ma/v1/agents/:id/versions`**

请求：`{ "manifest": {…}, "expected_latest_version": 2, "note": "…" }`（允许键恰为这三个）。
- 新建 → 201 `{ "version": MaAgentVersionRecord, "created": true }`
- 内容未变 → 200 `{ "version": <最新>, "created": false }`
- 校验失败 → 400 `{"error":{"code":"manifest_invalid","message":"manifest is invalid","details":{"errors":["manifest.model: is required"]}}}`
- 冲突 → 409 `{"error":{"code":"agent_version_conflict","message":"latest version has changed","details":{"current_latest_version":3}}}`

**GET `/api/ma/v1/agents/:id/versions/:version`**：`:version` 用 `parseVersionParam`；`latest` → `agent.latestVersion`；`effective` → `agent.effectiveVersion`（先 `ensureAgentVersionOne` 再 `getAgentWithMa`）；→ `{ "version": MaAgentVersionRecord }`。

**环境**

- GET `/api/ma/v1/environments`（query `type?`、`status?`）→ `{ "data": [MaEnvironmentRecord] }`
- POST → 201 `{ "environment": MaEnvironmentRecord }`；请求允许键：`name`、`type`、`config`、`description`、`status`
- GET `/:id` → `{ "environment": MaEnvironmentRecord }`
- PATCH `/:id` → 200 `{ "environment" }`；允许键：`name`、`config`、`description`、`status`（`type` 出现且不同 → invalid_request，由 iam-core 报）
- DELETE `/:id` → 200 `{ "id": "…", "deleted": true }`；被引用 → 409 `environment_in_use`

### 5.4 内部接口（Bearer `MA_INTERNAL_TOKEN`，供 agent-runtime）

每个 handler 第一行：`if (!isMaInternalAuthorized(request)) return maInternalUnauthorized();`。`tenant_id` query 必填且匹配 `TENANT_ID_RE`，否则 400 invalid_request `tenant_id is required`。响应头 `cache-control: no-store`。

**5.4.1 GET `/api/internal/ma/agent-versions/:agentId/:version?tenant_id=…`**

`:version` ∈ `latest` | `effective` | 正整数。流程：`ensureAgentVersionOne(tenant, agentId)`（不存在 → 404 `agent_not_found`）→ `getAgentWithMa` → 解析目标版本号 → `getAgentVersion`（不存在或懒回填为 invalid → 404 `agent_version_not_found`）。

```json
{
  "agent": { …MaAgentRecord },
  "routing": { "mode": "pinned", "pinned_version": 1, "effective_version": 1 },
  "runtime": "cloud",
  "version": { …MaAgentVersionRecord }
}
```

不过滤 `status` / `lifecycle`（是否允许建会话由 agent-runtime 依据 `agent.status` / `agent.lifecycle` 决定，见 E03）。

**5.4.2 GET `/api/internal/ma/environments/:envId?tenant_id=…`** → `{ "environment": MaEnvironmentRecord }`；不存在 → 404 `environment_not_found`。

**5.4.3 POST `/api/internal/ma/pat-introspect`**

请求体：`{ "token": "agx-pat-…" }`（必须是对象且 `token` 为字符串，否则 400 invalid_request `token is required`）。

- `verifyPat(token)` 为 null → 200 `{ "active": false }`
- 否则 `void touchPatLastUsed(id).catch(() => {})`，200：

```json
{ "active": true, "tenant_id": "…", "user_id": "…", "dept_id": null, "scopes": ["workspace:chat", "ma:sessions:write"], "token_id": 42 }
```

响应中**不得**回显 token；日志中不得打印 token（只允许打印 `token_id`）。

### 5.5 `enterprise/.env.local.example`

追加：

```bash
# 托管运行时（agent-runtime）调用管理台 /api/internal/ma/* 的 Bearer token；未配置时这些接口一律 401。
MA_INTERNAL_TOKEN=
# 或：MA_INTERNAL_TOKEN_FILE=/path/to/ma_internal.token
```

---

## 6. UI 设计（全部中文文案，经 next-intl）

### 6.1 `src/app/admin/_sections/agents.tsx`（修改）

1. `AgentRecord` 类型（第 51–66 行）追加可选字段：`latestVersion?: number; effectiveVersion?: number; versionRouting?: "follow_latest" | "pinned"; pinnedVersion?: number | null; defaultEnvironmentId?: string | null;`。
2. 表头在「模型」列后插入 `<TableHead>{t("columns.version")}</TableHead>`；行内对应单元格：

```tsx
<TableCell>
  {agent.effectiveVersion ? (
    <div className="flex items-center gap-1">
      <span>v{agent.effectiveVersion}</span>
      {agent.versionRouting === "pinned" ? <Badge variant="secondary">{t("routing.pinnedBadge")}</Badge> : null}
    </div>
  ) : "—"}
</TableCell>
```

3. 行操作「编辑」按钮之后插入：`<Button size="sm" variant="outline" onClick={() => setManifestAgent(agent)}>{t("actions.manifest")}</Button>`；新增 state `const [manifestAgent, setManifestAgent] = useState<AgentRecord | null>(null);`，在删除 Dialog 之后渲染：

```tsx
{manifestAgent ? (
  <AgentManifestDialog
    agentId={manifestAgent.id}
    agentName={manifestAgent.displayName}
    runtime={manifestAgent.runtime}
    models={models}
    open
    onOpenChange={(open) => { if (!open) setManifestAgent(null); }}
    onChanged={() => void load()}
  />
) : null}
```

4. 回收确认：把第 413 行 `onClick={() => void setLifecycle(agent, "recalled")}` 改为 `onClick={() => setPendingRecall(agent)}`；新增 state `pendingRecall` 与一个 `Dialog`（标题 `t("recall.title")`，正文 `t("recall.description", { name })`，按钮「取消」在左、`variant="destructive"` 的「回收」在右，点击后 `await setLifecycle(pendingRecall, "recalled"); setPendingRecall(null);`）。发布按钮行为不变。
5. 第 526 行 `maxLength={16000}` → `maxLength={65536}`。

### 6.2 `AgentManifestDialog.tsx`

Props：`{ agentId: string; agentName: string; runtime: "cloud" | "desktop_worker"; models: Array<{ id: string; label: string }>; open: boolean; onOpenChange(open: boolean): void; onChanged(): void }`。

状态：
- `agent: AgentWithMa | null`、`versions: VersionRow[]`（来自 `GET /api/admin/agents/:id/versions?limit=50`）
- `draft: Record<string, unknown>`（初值 = 最新版本 manifest 的深拷贝；无版本时 = `{ schema: "agx.agent/v1", model: "", system: "" }`）
- `note: string`、`errors: string[]`、`saving: boolean`、`tab: "form" | "json" | "versions" | "routing"`
- `skills: Array<{ id: string; slug: string; displayName: string; version: string; status: string }>`（`GET /api/admin/skills`）
- `environments: Array<{ id; name; type; status }>`（`GET /api/admin/ma-environments`）

布局：`DialogContent className="max-w-5xl"`，`DialogTitle` = `t("manifest.title", { name: agentName })`；`Tabs`（`@agenticx/ui`）四个 `TabsTrigger`：`t("manifest.tabs.form")` 表单编辑、`t("manifest.tabs.json")` 原始 JSON、`t("manifest.tabs.versions")` 版本历史、`t("manifest.tabs.routing")` 路由与环境。表单 / JSON 两个 tab 共享底栏：

- 若最新版本 manifest 的 `model` / `system` 与 `agent.model` / `agent.systemPrompt` 不一致：在底栏上方显示 `Alert`（`t("manifest.driftWarning")`）。
- `errors.length > 0`：显示错误列表（每条一行，`text-destructive`，等宽字体）。
- 版本说明 `Input`（`maxLength={500}`，占位 `t("manifest.notePlaceholder")`）。
- 按钮（右对齐，顺序：`取消` → `校验` → `保存为新版本`）：
  - 校验：`POST …/versions?dryRun=1`，ok → `toast.success(t("manifest.validateOk"))` 并清空 errors；400 → `errors = data.errors`。
  - 保存：`POST …/versions` body `{ manifest: draft, expectedLatestVersion: agent.latestVersion, note }`；`created` → `toast.success(t("manifest.saved", { version }))`、重新拉取、`onChanged()`；`created === false` → `toast(t("manifest.unchanged"))`；409 → `toast.error(t("manifest.conflict"))` 并自动重新拉取（不覆盖 draft）；400 → 显示 errors。

### 6.3 `ManifestFormTab.tsx`（表单 ↔ draft，靠 `src/lib/ma/manifest-form.ts`）

`manifest-form.ts`（纯函数，**不得 import `@agenticx/core-api`**）：

```ts
export type ToolPolicyChoice = "inherit" | "always_allow" | "always_ask";
export type ToolConfigRow = { name: string; policy: ToolPolicyChoice; enabled: boolean };
export type BuiltinToolsetForm = { present: boolean; defaultPolicy: "always_allow" | "always_ask"; configs: ToolConfigRow[] };
export type McpServerForm = { name: string; url: string; transport: "http" | "sse"; defaultPolicy: "always_allow" | "always_ask"; configs: ToolConfigRow[]; hasToolset: boolean };
export type CustomToolForm = { name: string; description: string; inputSchemaText: string };
export type SkillForm = { source: "builtin" | "tenant"; id: string; version: string | null };
export type ManifestFormState = {
  model: string; system: string;
  builtin: BuiltinToolsetForm; mcpServers: McpServerForm[]; customTools: CustomToolForm[];
  skills: SkillForm[]; maxToolRounds: string; maxSessionTokens: string;
  welcomeMessage: string; suggestedQuestionsText: string;  // 每行一个
};
export function manifestToForm(manifest: Record<string, unknown>): ManifestFormState;
/**
 * 生成新 manifest：以 base 为底（保留 base.metadata 中除 welcome_message / suggested_questions 外的全部键，
 * 包括 legacy_capability_ids），用 form 覆盖 model / system / tools / mcp_servers / skills / runtime / metadata 两个键。
 * - builtin.present=false → 不输出 agx_builtin toolset
 * - ToolConfigRow.policy="inherit" → 输出不带 policy 键；enabled=true 时不输出 enabled 键
 * - mcp server 的 toolset：hasToolset=true 时在 tools 中输出 {type:"mcp", server:name, default_policy, configs}
 * - customTools.inputSchemaText 解析失败 → 抛 ManifestFormError(`自定义工具 ${name} 的输入参数不是合法 JSON`)
 * - maxToolRounds 空串 → 40；maxSessionTokens 空串 → null；非数字 → 抛 ManifestFormError("运行限制须为整数")
 * - suggestedQuestionsText 按行切分、trim、去空行；为空数组时删除该键；welcomeMessage 空串时删除该键
 */
export function formToManifest(form: ManifestFormState, base: Record<string, unknown>): Record<string, unknown>;
export class ManifestFormError extends Error {}
```

表单区块（每块一个 `Card`）：
1. 模型：`Select`（选项 = props.models；当前值不在列表中时补一项原值，同 agents.tsx 第 246–249 行做法）。
2. 系统提示词：`Textarea rows={10} maxLength={65536}`。
3. 内置工具：开关「启用内置工具集」；默认权限 `Select`（始终允许 / 每次询问）；工具行表格（工具名 `Input`、权限 `Select`：继承默认 / 始终允许 / 每次询问、启用 `Switch`、删除按钮），「添加工具」按钮。
4. MCP 服务器：每个服务器一行卡片：名称、地址、传输方式（HTTP / SSE）、「单独配置工具权限」开关（hasToolset）+ 默认权限 + 工具行表格；「添加 MCP 服务器」按钮；卡片说明文案 `t("manifest.form.mcpSecretHint")`（「凭证不写在这里，由凭证库在运行时注入」）。
5. 自定义工具：名称、描述、输入参数（JSON `Textarea`）。
6. Skills：企业 Skill 勾选列表（显示 `displayName` + `v{version}`，勾选生成 `{source:"tenant", id, version:null}`，由服务端固化版本；已在 draft 中且带版本的显示该版本）；内置 Skill 行（id `Input`）。
7. 运行限制：最大工具轮次（数字）、单会话 token 上限（数字，可空）。
8. 欢迎语与推荐问题。

任一字段变更：`setDraft(formToManifest(nextForm, draft))`；抛 `ManifestFormError` 时在该区块下显示错误、不更新 draft。

### 6.4 `ManifestJsonTab.tsx`

`Textarea` 等宽字体，内容 = `JSON.stringify(draft, null, 2)`；用户编辑后点「应用」：`JSON.parse` 成功且是对象 → `setDraft(parsed)`；失败 → 显示 `t("manifest.json.parseError")`。切到表单 tab 时以 draft 重新 `manifestToForm`。

### 6.5 `ManifestVersionsTab.tsx` + `ManifestDiffView.tsx`

表格列：版本、来源（`t("manifest.source.<source>")`：`backfill` 自动生成 / `admin` 管理台 / `api` 接口 / `legacy_edit` 基础信息同步 / `desktop` 桌面）、说明、创建人（userId，空显示「系统」）、创建时间、标记（`最新` Badge：`version === latestVersion`；`生效中` Badge：`version === effectiveVersion`）、操作：
- 「查看」：在下方只读展示该版本 JSON。
- 「对比」：打开 `ManifestDiffView`，`from` 默认上一版本、`to` 默认该版本，两个 `Select` 可改。
- 「以此为基础编辑」：`setDraft(deepClone(v.manifest))`、`setNote(t("manifest.rollbackNote", { version: v.version }))`、切到表单 tab（保存即生成等价新版本 = 回滚）。
- 「固定到此版本」：打开确认 `Dialog`（标题 `t("routing.pinConfirmTitle")`，正文 `t("routing.pinConfirmDescription", { version })`），确认后 `PATCH …/ma-settings` `{ versionRouting: "pinned", pinnedVersion: v.version }`，成功 toast + 刷新 + `onChanged()`。

`manifest-diff.ts`：

```ts
export type DiffLine = { kind: "same" | "add" | "del"; text: string; oldNo: number | null; newNo: number | null };
/** 键递归排序后 JSON.stringify(v, null, 2)。数组顺序保留。 */
export function stableStringify(value: unknown): string;
/** 行级 LCS；两侧行数之积 > 4_000_000 时退化为「整体删除 + 整体新增」，避免卡死。 */
export function diffLines(oldText: string, newText: string): DiffLine[];
export function diffManifests(oldManifest: unknown, newManifest: unknown): DiffLine[];
```

`ManifestDiffView` 渲染：等宽、`add` 行 `bg-emerald-500/10`、`del` 行 `bg-destructive/10`，左侧两列行号；无差异时显示 `t("manifest.diff.noChange")`。

### 6.6 `AgentRoutingTab.tsx`

- 路由方式 `Select`：跟随最新版本 / 固定版本；选「固定版本」时出现版本 `Select`（列出全部版本号）。
- 默认环境 `Select`：选项 =「不指定」+ `environments.filter(e => e.status === "active" && e.type === runtime)`；若当前 `defaultEnvironmentId` 指向的环境不在选项中（已停用 / 类型不符），额外显示一项「<名称>（不可用）」并显示 `Alert` `t("routing.envUnavailable")`。
- 保存：若路由将从 `follow_latest` 变为 `pinned`，或固定版本号变化 → 先弹确认 Dialog（同 6.5 文案）；从 `pinned` 改回 `follow_latest` → 确认文案 `t("routing.followConfirmDescription")`；只改默认环境不弹确认。确认后 `PATCH …/ma-settings`。

### 6.7 `agent-environments.tsx`（新 section）

- `PageHeader` 标题 `t("title")`（执行环境）、描述 `t("description")`、操作「新建环境」。
- 空态 `EmptyState`。
- 表格列：名称、类型（云端执行 / 员工桌面执行）、状态（已启用 / 已停用）、引用（`t("references", { agents, sessions })`）、操作：编辑、停用 / 启用、删除。
- 新建 / 编辑 `Dialog`：名称、描述、类型（仅新建可选）、`cloud` 字段：沙箱后端 `Select`（容器 docker / 远程沙箱 remote / 本机进程 subprocess，后者附说明「仅用于开发调试」）、镜像、出站白名单（`Textarea`，每行一个域名，支持 `*.example.com`）、空闲回收时间（秒）；`desktop_worker` 字段：可承接执行的员工（`AssignmentScopeEditor` + `useAssignmentDirectory` + `toAssignmentKeys` / `fromAssignmentKeys`，写法照抄 agents.tsx 第 571–582 行）。保存失败保留弹窗并显示服务端 message。
- 停用：确认 Dialog（`t("disable.description", { name })`：「停用后，新会话不能再使用该环境；进行中的会话不受影响。」）。启用不确认。
- 删除：确认 Dialog（`t("delete.description", { name })`）；409 时在弹窗内显示服务端 message（「环境仍被智能体或进行中的会话引用，不能删除」）。
- 页面文案不得出现内部路径、表名、环境变量名。

注册：`admin-platform-sections.ts` 的数组在 `"agents"` 之后插入 `"agent-environments"`；`[section]/page.tsx` import `AgentEnvironmentsSection from "../_sections/agent-environments"` 并在映射中 `agents` 后加 `"agent-environments": AgentEnvironmentsSection,`；`AppShell.tsx` lucide import 追加 `Server`，`platform` 组在 agents 项后插入 `{ href: "/admin/agent-environments", labelKey: "agentEnvironments", icon: Server },`（高亮逻辑第 348 行无需改：`/admin/agent-environments` 不以 `/admin/agents/` 为前缀）。

### 6.8 `api-tokens.tsx`（修改）

- `form` state（第 64 行）追加 `maScopes: [] as string[]`。
- 新建对话框中「有效天数」之后插入一个区块：标题 `t("maScopesLabel")`（托管智能体 API 权限），说明 `t("maScopesHint")`（「不勾选则仅用于网关聊天」），用 `Checkbox` 逐项列出 `MA_PAT_SCOPE_OPTIONS`（来自 `src/lib/ma/pat-scope-options.ts`），标签 `t(\`maScopes.${scope.replaceAll(":", "_")}\`)`。
- 提交 body：`maScopes.length > 0` 时加 `scopes: ["workspace:chat", ...maScopes]`；否则不传 `scopes`（与现在一致）。

`pat-scope-options.ts`：

```ts
/** 与 @agenticx/core-api 的 PAT_SCOPES 逐项一致（测试保证）。客户端组件可安全 import。 */
export const MA_PAT_SCOPE_OPTIONS = [
  "ma:agents:read", "ma:agents:write",
  "ma:environments:read", "ma:environments:write",
  "ma:sessions:read", "ma:sessions:write",
  "ma:worker",
  "ma:vaults:read", "ma:vaults:write",
  "ma:memory:read", "ma:memory:write",
  "ma:admin",
] as const;
```

---

## 7. 文案键（`messages/zh.json` 与 `messages/en.json` 同步新增；下表为中文，英文按语义翻译）

`shell.nav.items.agentEnvironments`：执行环境

`pages.admin.agents` 追加：
- `columns.version`：版本
- `actions.manifest`：定义与版本
- `routing.pinnedBadge`：已固定
- `recall.title`：回收智能体；`recall.description`：确认回收「{name}」？回收后员工侧立即不可用，可再次发布恢复。；`recall.confirm`：回收
- `manifest.title`：{name} · 定义与版本
- `manifest.tabs.form`：表单编辑；`manifest.tabs.json`：原始 JSON；`manifest.tabs.versions`：版本历史；`manifest.tabs.routing`：路由与环境
- `manifest.notePlaceholder`：版本说明（可选）
- `manifest.validate`：校验；`manifest.save`：保存为新版本
- `manifest.validateOk`：校验通过
- `manifest.saved`：已保存为 v{version}
- `manifest.unchanged`：内容未变化，未生成新版本
- `manifest.conflict`：版本已被他人更新，已刷新到最新，请确认后再保存
- `manifest.driftWarning`：基础信息中的模型或提示词与最新版本不一致，保存新版本后以版本内容为准。
- `manifest.rollbackNote`：基于 v{version} 回滚
- `manifest.json.apply`：应用；`manifest.json.parseError`：不是合法的 JSON 对象
- `manifest.form.model`：模型；`manifest.form.system`：系统提示词；`manifest.form.builtin`：内置工具；`manifest.form.builtinEnabled`：启用内置工具集；`manifest.form.defaultPolicy`：默认权限；`manifest.form.policy.inherit`：继承默认；`manifest.form.policy.always_allow`：始终允许；`manifest.form.policy.always_ask`：每次询问；`manifest.form.toolName`：工具名；`manifest.form.enabled`：启用；`manifest.form.addTool`：添加工具；`manifest.form.mcp`：MCP 服务器；`manifest.form.mcpName`：名称；`manifest.form.mcpUrl`：地址；`manifest.form.mcpTransport`：传输方式；`manifest.form.mcpToolset`：单独配置工具权限；`manifest.form.addMcp`：添加 MCP 服务器；`manifest.form.mcpSecretHint`：凭证不写在这里，由凭证库在运行时注入；`manifest.form.custom`：自定义工具；`manifest.form.customName`：名称；`manifest.form.customDescription`：描述；`manifest.form.customSchema`：输入参数（JSON）；`manifest.form.addCustom`：添加自定义工具；`manifest.form.skills`：Skills；`manifest.form.tenantSkills`：企业 Skill；`manifest.form.builtinSkills`：内置 Skill；`manifest.form.addBuiltinSkill`：添加内置 Skill；`manifest.form.runtime`：运行限制；`manifest.form.maxToolRounds`：最大工具轮次；`manifest.form.maxSessionTokens`：单会话 token 上限；`manifest.form.welcome`：欢迎语；`manifest.form.suggested`：推荐问题（每行一个）；`manifest.form.remove`：移除
- `manifest.versions.version`：版本；`manifest.versions.source`：来源；`manifest.versions.note`：说明；`manifest.versions.createdBy`：创建人；`manifest.versions.createdAt`：创建时间；`manifest.versions.system`：系统；`manifest.versions.latest`：最新；`manifest.versions.effective`：生效中；`manifest.versions.view`：查看；`manifest.versions.compare`：对比；`manifest.versions.editFrom`：以此为基础编辑；`manifest.versions.pin`：固定到此版本；`manifest.versions.empty`：旧配置无法自动转换为版本，请在表单中修正后保存
- `manifest.source.backfill`：自动生成；`manifest.source.admin`：管理台；`manifest.source.api`：接口；`manifest.source.legacy_edit`：基础信息同步；`manifest.source.desktop`：桌面
- `manifest.diff.from`：对比基准；`manifest.diff.to`：对比目标；`manifest.diff.noChange`：两个版本内容相同
- `routing.mode`：路由方式；`routing.followLatest`：跟随最新版本；`routing.pinned`：固定版本；`routing.pinnedVersion`：固定到；`routing.defaultEnvironment`：默认执行环境；`routing.noEnvironment`：不指定；`routing.envUnavailable`：当前默认环境已停用或类型与运行方式不一致，新会话将无法使用它；`routing.save`：保存路由；`routing.saved`：路由已更新；`routing.pinConfirmTitle`：固定版本；`routing.pinConfirmDescription`：之后新建的会话将固定使用 v{version}，发布新版本也不会自动生效。确认？；`routing.followConfirmDescription`：之后新建的会话将使用最新版本。确认？；`routing.confirm`：确认

`pages.admin.agentEnvironments`（新块）：`title` 执行环境；`description` 托管智能体会话在哪里执行：云端沙箱或员工桌面。；`create` 新建环境；`emptyTitle` 还没有执行环境；`emptyDescription` 新建后可设为智能体的默认执行环境。；`columns.name/type/status/references/actions`：名称 / 类型 / 状态 / 引用 / 操作；`type.cloud` 云端执行；`type.desktop_worker` 员工桌面执行；`status.active` 已启用；`status.disabled` 已停用；`references` {agents} 个智能体 · {sessions} 个进行中会话；`form.createTitle` 新建环境；`form.editTitle` 编辑环境；`form.name` 名称；`form.description` 描述；`form.type` 类型；`form.sandboxBackend` 沙箱后端；`form.sandbox.docker` 容器；`form.sandbox.remote` 远程沙箱；`form.sandbox.subprocess` 本机进程（仅用于开发调试）；`form.image` 镜像；`form.egress` 出站白名单（每行一个域名）；`form.idleTtl` 空闲回收时间（秒）；`form.workers` 可承接执行的员工；`actions.edit` 编辑；`actions.disable` 停用；`actions.enable` 启用；`actions.delete` 删除；`disable.title` 停用环境；`disable.description` 确认停用「{name}」？停用后新会话不能再使用该环境，进行中的会话不受影响。；`disable.confirm` 停用；`delete.title` 删除环境；`delete.description` 确认删除「{name}」？删除后不可恢复。；`delete.confirm` 删除；`toast.created` 已创建环境；`toast.saved` 已保存；`toast.disabled` 已停用；`toast.enabled` 已启用；`toast.deleted` 已删除

`pages.admin.apiTokens` 追加：`maScopesLabel` 托管智能体 API 权限；`maScopesHint` 不勾选则仅用于网关聊天；`maScopes.ma_agents_read` 查看智能体；`maScopes.ma_agents_write` 管理智能体与版本；`maScopes.ma_environments_read` 查看执行环境；`maScopes.ma_environments_write` 管理执行环境；`maScopes.ma_sessions_read` 查看托管会话；`maScopes.ma_sessions_write` 创建与驱动托管会话；`maScopes.ma_worker` 桌面执行节点；`maScopes.ma_vaults_read` 查看凭证库；`maScopes.ma_vaults_write` 管理凭证库；`maScopes.ma_memory_read` 查看记忆库；`maScopes.ma_memory_write` 管理记忆库；`maScopes.ma_admin` 托管智能体全部权限

---

## 8. FR / NFR / AC

所有测试 vitest，放在 admin-console 对应 `__tests__/`；路由测试照现有 `src/app/api/admin/agents/__tests__/route.test.ts` 的写法：`vi.mock("server-only", () => ({}))`、`vi.mock("@agenticx/iam-core", …)` 自造错误类（`name` 与真实一致）、动态 `await import("../route")` 后调用 handler。

| ID | 需求 | AC（文件 · 用例 · 断言） |
|---|---|---|
| FR-1 | 内部 token 鉴权 fail-closed + 常量时间比较 | `src/lib/ma/__tests__/internal-auth.test.ts`：`rejects when MA_INTERNAL_TOKEN is unset`（`vi.stubEnv("MA_INTERNAL_TOKEN", "")` → false）；`accepts the exact bearer token`；`rejects a different token of the same length`；`rejects a token of different length without throwing`；`reads MA_INTERNAL_TOKEN_FILE`（写临时文件）；`does not accept GATEWAY_INTERNAL_TOKEN`（只设网关 token → false）。每个用例前调 `__resetMaInternalTokenCacheForTests()` |
| FR-2 | PAT 鉴权与 `ma:` 判定 | `pat-auth.test.ts`（mock `verifyPat` / `touchPatLastUsed`）：`returns 401 without Authorization header`（`error.code === "unauthorized"`）；`returns 401 when verifyPat returns null`；`returns 403 forbidden_scope when scope missing`（`details.required === "ma:agents:write"`）；`ma:admin satisfies any ma scope`；`patHasMaScope ignores role registry`（`["ma:agents:read"]` 判 `ma:agents:read` 为 true）；`touches last used on success` |
| FR-3 | 错误映射 | `errors.test.ts`：对映射表 10 行逐一构造 `Object.assign(new Error(m), { name })` 断言 status 与 `error.code`；`manifest_invalid details.errors` 透传；`agent_version_conflict details.current_latest_version`；`unknown error returns 500 internal_error without leaking message`（message === `"internal error"`） |
| FR-4 | record 严格字段 | `records.test.ts`：`toMaAgentRecord emits exactly the frozen keys`（`Object.keys(...).sort()` 等于 12 个键排序）；`toMaAgentVersionRecord emits exactly 7 keys`；`toMaEnvironmentRecord omits description`（6 个键）；`toMaAgentRouting uses effectiveVersion` |
| FR-5 | 管理台版本接口 | `src/app/api/admin/agents/__tests__/versions-route.test.ts`：`GET lists versions and returns agent with ma fields`（`listAgentVersions` 先于 `getAgentWithMa` 被调用：用 `mock.invocationCallOrder` 断言）；`POST dryRun returns normalized manifest`（不调用 `createAgentVersion`）；`POST dryRun maps invalid manifest to 400 with errors`；`POST creates a version with source admin and createdBy session user`（断言 `createAgentVersion` 参数）；`POST maps AgentVersionConflictError to 409 with currentLatestVersion`；`POST rejects non-object manifest`（400，`createAgentVersion` 未调用）；`POST rejects missing expectedLatestVersion`；`GET single version rejects non-integer version`（400）；`returns auth response when scope check fails` |
| FR-6 | 路由 / 默认环境接口 | `ma-settings-route.test.ts`：`PATCH forwards routing and environment to updateAgentMaSettings`；`PATCH rejects unknown keys`（400 `不支持的字段：foo`）；`PATCH maps AgentValidationError to 400` |
| FR-7 | 列表带版本字段 | 修改 `route.test.ts`：mock 新增 `listAgentsWithMa`，原 `GET returns agents with the success envelope` 改为断言调用 `listAgentsWithMa` 且返回体含 `effectiveVersion`；其余 7 个用例不改且通过 |
| FR-8 | 环境管理接口 | `src/app/api/admin/ma-environments/__tests__/route.test.ts`：`GET returns environments with reference counts`；`POST creates with session user as createdBy`；`POST maps MaEnvironmentValidationError to 400`；`PATCH maps MaEnvironmentNameConflictError to 409`；`DELETE maps MaEnvironmentInUseError to 409`；`DELETE maps not found to 404`；`rejects unsupported fields` |
| FR-9 | PAT `ma:` scope 白名单 | `src/app/api/admin/api-tokens/__tests__/route.test.ts`：`POST accepts known ma scopes`（`createPat` 收到原样 scopes）；`POST rejects unknown ma scope`（400，message `未知的托管智能体权限：ma:foo`，`createPat` 未调用）；`POST keeps non-ma scopes unvalidated`（`["workspace:chat","custom:x"]` 通过）；`POST rejects non-string scopes`；`POST without scopes still calls createPat with scopes undefined` |
| FR-10 | 公共 agents 接口 | `src/app/api/ma/v1/__tests__/agents-route.test.ts`：`GET requires ma:agents:read`（无头 401；只有 `ma:sessions:read` → 403）；`GET returns envelopes with agent and routing`（`data[0].agent` 恰 12 键）；`GET uses PAT tenant not DEFAULT_TENANT_ID`（stub `DEFAULT_TENANT_ID=other`，断言 `listAgentsWithMa` 收到 PAT tenant）；`POST creates draft agent with initial version`（201；`createAgentWithInitialVersion` 第二参含 `lifecycle:"draft"`、第三参 `source:"api"`、`createdBy` = PAT userId）；`POST rejects unknown field`（400 `unknown field: foo`）；`POST maps slug conflict to 409 agent_slug_conflict`；`POST maps invalid manifest to 400 manifest_invalid`；`PATCH rejects manifest keys with guidance message`；`PATCH updates basic fields then routing`（`updateAgent` 先于 `updateAgentMaSettings`）；`GET single rejects malformed id as agent_not_found` |
| FR-11 | 公共 versions 接口 | `versions-route.test.ts`：`POST returns 201 when created`；`POST returns 200 created false when unchanged`；`POST maps conflict to 409 with current_latest_version`；`POST requires expected_latest_version`；`GET list returns next_before_version when page is full`；`GET version resolves latest and effective`（mock agent latest=3 effective=1 → 分别请求 `getAgentVersion(…, 3)` / `(…, 1)`）；`GET version rejects "abc"` |
| FR-12 | 公共 environments 接口 | `environments-route.test.ts`：`GET requires ma:environments:read`；`POST requires ma:environments:write and returns 201`；`records omit description`；`DELETE returns deleted true`；`DELETE maps in-use to 409 environment_in_use` |
| FR-13 | 内部接口 | `src/app/api/internal/ma/__tests__/internal-routes.test.ts`：`agent-versions rejects without internal token`（401）；`agent-versions requires tenant_id`（400）；`agent-versions resolves effective version and returns agent/routing/runtime/version`（`Object.keys(body).sort()` 等于 `["agent","routing","runtime","version"]`）；`agent-versions maps invalid backfill to 404 agent_version_not_found`；`environments returns record`；`pat-introspect returns active false for unknown token`（200）；`pat-introspect returns identity for valid token without echoing it`（`JSON.stringify(body)` 不含 token 明文）；`pat-introspect requires token in body`（400）；`pat-introspect rejects gateway token`（只设 `GATEWAY_INTERNAL_TOKEN` 并用它请求 → 401） |
| FR-14 | Manifest 表单双向转换 | `manifest-form.test.ts`：`manifestToForm then formToManifest round-trips a full manifest`（取 MA-00 fixture `full_ok` 的 `normalized`，`formToManifest(manifestToForm(m), m)` 经 `stableStringify` 后相等）；`preserves unknown metadata keys including legacy_capability_ids`；`inherit policy omits the policy key`；`invalid custom tool schema throws ManifestFormError`；`empty maxSessionTokens becomes null`；`removes welcome_message when blank`；`does not import @agenticx/core-api`（读取源文件文本，断言不含该字符串） |
| FR-15 | 版本差异 | `manifest-diff.test.ts`：`stableStringify sorts keys recursively`；`diffLines marks added and removed lines`；`identical manifests produce only same lines`；`falls back to full replace for huge inputs`（两侧各 2100 行不同文本 → 结果只含 del 与 add） |
| FR-16 | scope 常量一致 | `pat-scope-options.test.ts`：`matches core-api PAT_SCOPES exactly`（`[...MA_PAT_SCOPE_OPTIONS]` toEqual `[...PAT_SCOPES]`）；`does not import @agenticx/core-api`（源文件文本检查） |
| FR-17 | 导航与 section | `admin-platform-sections.test.ts`：期望数组在 `"agents"` 后插入 `"agent-environments"`；其余断言不变 |
| FR-18 | UI 可用（人工验收） | 见 §9 演示脚本 1–9 步全部通过 |
| NFR-1 | 不改现有接口语义 | 现有 `route.test.ts` 其余用例、`/api/admin/api-tokens` GET 行为不变；`pnpm --filter @agenticx/app-admin-console test` 全绿 |
| NFR-2 | 客户端不打包 node:crypto | `pnpm --filter @agenticx/app-admin-console build` 成功；FR-14 / FR-16 的源码文本检查 |
| NFR-3 | 不泄露内部信息 | UI 文案不含路径 / 表名 / 环境变量名（人工检查 §7 文案）；internal_error 不回显异常信息（FR-3） |
| NFR-4 | typecheck | `pnpm --filter @agenticx/app-admin-console typecheck` 无错；switch 联合类型用 `never` 兜底 |

---

## 9. 验证命令与演示脚本

```bash
cd /Users/damon/myWork/AgenticX/enterprise
pnpm --filter @agenticx/app-admin-console test
pnpm --filter @agenticx/app-admin-console typecheck
pnpm --filter @agenticx/app-admin-console build
pnpm --filter @agenticx/iam-core test
git status --porcelain -- apps/admin-console .env.local.example
```

本地联调（需 E01 已合入、迁移已跑；`.env.local` 设 `MA_INTERNAL_TOKEN=dev-ma-token`；`bash scripts/start-dev-with-infra.sh`）：

1. 管理台 `/admin/agents`：列表出现「版本」列，旧 Agent 显示 `—` 或 `v1`；点「定义与版本」→ 版本历史出现 v1（来源「自动生成」）。
2. 表单改系统提示词 → 「校验」提示通过 →「保存为新版本」→ toast「已保存为 v2」，列表显示 `v2`。
3. 不改内容再保存 → toast「内容未变化，未生成新版本」。
4. JSON tab 删掉 `model` →「保存」→ 错误区显示 `manifest.model: is required`。
5. 版本历史勾选 v1 / v2「对比」→ 看到提示词行的删除与新增。
6. v1「固定到此版本」→ 确认弹窗 → 列表显示 `v1 已固定`。
7. `/admin/agent-environments` 新建云端环境（出站白名单两行）→ 路由与环境 tab 选为默认环境 → 保存成功；尝试删除该环境 → 弹窗内提示仍被引用。
8. API 令牌页新建令牌勾选「管理智能体与版本」「查看执行环境」，复制明文 `$PAT`：

```bash
curl -s -H "Authorization: Bearer $PAT" http://127.0.0.1:3001/api/ma/v1/agents | jq '.data[0]'
curl -s -X POST -H "Authorization: Bearer $PAT" -H 'content-type: application/json' \
  http://127.0.0.1:3001/api/ma/v1/agents/<agentId>/versions \
  -d '{"manifest":{"schema":"agx.agent/v1","model":"openai/gpt-4o","system":"x"},"expected_latest_version":2}' | jq
curl -s -X POST -H 'Authorization: Bearer dev-ma-token' -H 'content-type: application/json' \
  http://127.0.0.1:3001/api/internal/ma/pat-introspect -d "{\"token\":\"$PAT\"}" | jq
curl -s -H 'Authorization: Bearer dev-ma-token' \
  "http://127.0.0.1:3001/api/internal/ma/agent-versions/<agentId>/effective?tenant_id=$DEFAULT_TENANT_ID" | jq '.routing,.version.version'
```

   期望：第一条返回 `{agent, routing}`；第二条 201（或 409 冲突时 `current_latest_version`）；第三条 `active:true` 且 scopes 含 `ma:agents:write`；第四条在固定 v1 时 `version` 为 1。
9. 回收一个已发布 Agent → 出现确认弹窗 → 确认后状态为「已回收」。

---

## 10. 回滚

- 无运行时开关：本子规划只新增路由与 UI；回滚 = 还原 §2.1 全部文件。
- 回滚后：`/admin/agents` 恢复原列表与弹窗；`/api/ma/v1/*` 与 `/api/internal/ma/*` 返回 404（agent-runtime 侧须处于未启用状态，E03 合入前天然满足）；已写入的版本行与环境行保留在库中、无人读取，不影响旧功能。
- `MA_INTERNAL_TOKEN` 不配置时内部接口始终 401，可作为紧急「关闭托管运行时访问」的手段。

已知风险与限制：
1. 公共 `PATCH /api/ma/v1/agents/:id` 中基础字段与路由分两步写，第二步失败时第一步已生效（返回错误，调用方可重试）；后续若需原子性，回 E01 加组合函数。
2. Agent 的 `runtime` 被改后，原默认环境可能与类型不一致；UI 在路由 tab 提示，agent-runtime（E03）须在建会话时再次校验。
3. D4 的 4 个扩展错误码需要在 master §12 登记，否则与「冻结契约」口径不一致。

---

## 11. 不变量清单

1. `/admin/agents` 现有新建、编辑、发布、删除流程与提交体不变；仅回收多一步确认，系统提示词上限放宽到 65536。
2. `/api/admin/agents` `POST` / `[agentId]` `GET|PATCH|DELETE` 行为不变；`GET` 列表仅追加字段。
3. web-portal `/api/desktop/agents`、`/api/desktop/agents/register`、协作房间 TS loop 与桌面 Worker 旧队列不受影响（本子规划不改 web-portal 与 packages）。
4. `/api/admin/api-tokens` 不传 scopes 时行为与现在一致（默认 `["workspace:chat"]`）。
5. 现有 `/api/internal/*`（网关快照）鉴权与响应不变；`GATEWAY_INTERNAL_TOKEN` 不能访问 `/api/internal/ma/*`。
6. 公共 / 内部接口输出的 `agent` / `version` / `environment` 对象只含 MA-00 冻结字段。
7. 客户端组件不 import `@agenticx/core-api`。
8. commit / PR 文案不出现第三方产品名、对标措辞与客户信息。
