# acp-01 企业 Agent 注册表

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`

## 目标

管理员在管理台登记一个 Agent：名称、模型、系统提示词、绑定的 Skill/MCP、运行方式（云端 / 员工桌面）、可见范围、启停。数据真写数据库（PG 与 MySQL 双方言），后续 acp-04 把它放进协作房间。

## 根因与证据

- `enterprise/features/agents/src/index.ts` 只有 `TODO: implement`；`packages/db-schema/src/schema/` 没有 agent 表。
- 能力引用约定已存在：`mcp:<ulid>` / `skill:<ulid>`，见 `packages/db-schema/src/schema/capability-packs.ts` 文件头注释；校验函数 `assertCapabilityIds` 在 `apps/admin-console/src/lib/db-stores/postgresql/capability-packs-store.ts`（由 `src/lib/capability-packs-store.ts` 再导出）。
- 可见范围约定已存在：`all` / 用户 ulid / `email:<x>` / `dept:<id>` / `group:<ulid>`，解析函数 `resolveAssignmentKeysForUser`（`packages/iam-core/src/repos/assignment-keys.ts`），规范化 `normalizeAssignmentKeys`（同上 capability-packs-store 再导出）。

## 数据模型

新表 `enterprise_agents`：

| 列 | PG 类型 | 说明 |
| --- | --- | --- |
| `id` | `ulid("id")` 主键 | |
| `tenant_id` | ulid，FK `tenants.id` on delete cascade | |
| `slug` | varchar(64) not null | 正则 `^[a-z0-9][a-z0-9-]{1,62}$`；`(tenant_id, slug)` 唯一索引 `enterprise_agents_tenant_slug_uq` |
| `display_name` | varchar(64) not null | 房间里 @ 的显示名 |
| `description` | text | |
| `system_prompt` | text not null default `''` | ≤ 16000 字 |
| `model` | varchar(160) not null | 与门户模型选择器同一格式的模型 id。实施前读 `apps/web-portal/src/lib/admin-providers-reader.ts` 的 `PortalModelOption`，确认 id 字段形态（通常是 `<provider>/<model>`），在本表注释里写清 |
| `runtime` | varchar(24) not null default `'cloud'` | 只允许 `cloud`、`desktop_worker` |
| `capability_ids` | text[] not null default `{}` | 只允许 `mcp:<ulid>`、`skill:<ulid>`，用 `assertCapabilityIds` 校验 |
| `assignment_keys` | text[] not null default `{all}` | 谁能在房间里添加/使用该 Agent |
| `status` | varchar(16) not null default `'active'` | `active` / `disabled` |
| `metadata` | jsonb not null default `{}` | |
| 审计列 | `...auditColumns`（`schema/_shared.ts`） | |

另加索引 `enterprise_agents_tenant_status_idx (tenant_id, status)`。

MySQL：在 `packages/db-schema/src/mysql-schema/` 加同名表，数组列的写法照抄该目录下 `enterprise_skills.required_capabilities` 的 MySQL 定义。

迁移：

- PG：`packages/db-schema/drizzle/0053_enterprise_agents.sql`，并更新 `drizzle/meta/_journal.json`（照抄 0052 的条目格式）。
- MySQL：`packages/db-schema/drizzle-mysql/0027_enterprise_agents.sql`，更新 `drizzle-mysql/meta/_journal.json`。
- `src/schema/index.ts` 与 MySQL 侧 index 导出新表。

## 仓库层（iam-core，供 admin 与门户共用）

新建 `packages/iam-core/src/repos/agents.ts`（方言分派 + PG 实现，风格照 `repos/user-groups.ts`）与 `packages/iam-core/src/repos/mysql/agents.ts`，并在 `packages/iam-core/src/index.ts` 加 `export * from "./repos/agents";`。

```ts
export type AgentRuntime = "cloud" | "desktop_worker";
export type AgentStatus = "active" | "disabled";
export type EnterpriseAgent = {
  id: string; tenantId: string; slug: string; displayName: string;
  description: string | null; systemPrompt: string; model: string;
  runtime: AgentRuntime; capabilityIds: string[]; assignmentKeys: string[];
  status: AgentStatus; metadata: Record<string, unknown>;
  createdAt: string; updatedAt: string;
};
export type AgentInput = {
  slug: string; displayName: string; description?: string | null;
  systemPrompt?: string; model: string; runtime?: AgentRuntime;
  capabilityIds?: string[]; assignmentKeys?: string[];
  status?: AgentStatus; metadata?: Record<string, unknown>;
};

export class AgentValidationError extends Error {}
export class AgentNotFoundError extends Error {}
export class AgentSlugConflictError extends Error {}

export function validateAgentInput(input: AgentInput): void; // 纯函数，抛 AgentValidationError
export async function listAgents(tenantId: string, opts?: { status?: AgentStatus }): Promise<EnterpriseAgent[]>;
export async function getAgent(tenantId: string, id: string): Promise<EnterpriseAgent>; // 不存在抛 AgentNotFoundError
export async function getAgentBySlug(tenantId: string, slug: string): Promise<EnterpriseAgent | null>;
export async function createAgent(tenantId: string, input: AgentInput): Promise<EnterpriseAgent>; // slug 冲突抛 AgentSlugConflictError
export async function updateAgent(tenantId: string, id: string, patch: Partial<AgentInput>): Promise<EnterpriseAgent>;
export async function deleteAgent(tenantId: string, id: string): Promise<void>;
/** 门户用：status=active 且 assignment_keys 与 keys 有交集。 */
export async function listAgentsVisibleToKeys(tenantId: string, keys: string[]): Promise<EnterpriseAgent[]>;
```

`validateAgentInput` 规则：slug 正则；displayName 1–64 字、trim 后非空；model 非空；runtime ∈ 枚举；capabilityIds 每项匹配 `^(mcp|skill):[0-9A-HJKMNP-TV-Z]{26}$`；assignmentKeys 非空数组；systemPrompt ≤ 16000。能力 id 是否真实存在由 admin 路由层再调 `assertCapabilityIds` 校验（iam-core 不依赖 admin 代码）。

## 管理台 API

租户 id 的取法照抄 `apps/admin-console/src/lib/db-stores/postgresql/capability-packs-store.ts`。

- `apps/admin-console/src/app/api/admin/agents/route.ts`
  - `GET`：`requireAdminScope(["provider:read"])` → `{ code: "00000", data: { agents } }`
  - `POST`：`requireAdminScope(["provider:update"])` → 校验 → `assertCapabilityIds(capabilityIds)` → `normalizeAssignmentKeys(assignmentKeys)` → `createAgent`
- `apps/admin-console/src/app/api/admin/agents/[agentId]/route.ts`：`GET` / `PATCH` / `DELETE`，scope 同上。
- 错误映射：`AgentValidationError` → 400 `40000`；`AgentSlugConflictError` → 409 `40900`；`AgentNotFoundError` → 404 `40400`；表不存在 → 500 并提示 `请先执行 pnpm --filter @agenticx/db-schema db:migrate`（照抄 `api/admin/capability-packs/route.ts` 的 `migrationHint`）。

## 管理台页面

- `apps/admin-console/src/lib/admin-platform-sections.ts`：`PLATFORM_SECTION_IDS` 加 `"agents"`。
- `apps/admin-console/src/app/admin/[section]/page.tsx`：`PLATFORM_SECTION_PAGES` 加 `agents: AgentsSection`。
- 新建 `apps/admin-console/src/app/admin/_sections/agents.tsx`（`"use client"`，组件与 `_sections/capabilities.tsx` 同一套 `@agenticx/ui`）。
- `apps/admin-console/src/components/AppShell.tsx` 的 `NAV_GROUPS` 里 `platform` 组，在 `/policy` 之后插入 `{ href: "/admin/agents", labelKey: "agents", icon: Bot }`（`lucide-react` 的 `Bot`）。
- `apps/admin-console/messages/zh.json` / `en.json` 加导航与页面文案：导航「智能体」/「Agents」。

页面行为：

- 列表列：名称、slug、运行方式（「云端执行」/「员工桌面执行」）、模型、能力数、可见范围摘要、状态。空列表用 `EmptyState`，主按钮「新建智能体」。
- 新建/编辑弹窗字段：名称、slug（编辑时只读）、描述、模型（下拉，数据源用管理台已有的「已启用模型」接口——读 `_sections/models.tsx` 找到它调用的 API 并复用）、运行方式、系统提示词（多行）、能力（多选，数据源 `/api/admin/skills` 与 `/api/admin/mcp-servers`，值分别加 `skill:`、`mcp:` 前缀）、可见范围（复用 `_sections/capabilities.tsx` 里能力包的分配选择组件；若是内联实现，抽成同目录小组件后两处共用，不改其行为）、启用开关。
- 保存失败：保持弹窗打开，把接口 `message` 显示在弹窗内；成功后 `toast` 并刷新列表。
- 底部按钮：「取消」紧挨「保存」在其左侧。
- 删除：应用内确认弹窗（不用 `window.confirm`），确认后调用 `DELETE`。
- 文案不出现内部路径或表名。

## AC

1. `pnpm -C enterprise --filter @agenticx/db-schema db:migrate` 在本地 PG 成功，`\d enterprise_agents` 有上表各列。
2. `packages/iam-core/src/repos/__tests__/agents-validate.test.ts`：覆盖 slug 非法、runtime 非法、能力 id 非法、assignmentKeys 为空、合法输入通过。`pnpm -C enterprise --filter @agenticx/iam-core test` 通过。
3. `apps/admin-console/src/app/api/admin/agents/__tests__/route.test.ts`：mock iam-core 仓库，断言 400/409/404 映射与成功响应结构。`pnpm -C enterprise --filter @agenticx/app-admin-console typecheck` 与 `test` 通过。
4. 端到端（浏览器，`http://localhost:3001` 管理员登录）：侧栏出现「智能体」并高亮；新建 slug=`report-bot`、运行方式云端、选一个模型、写提示词、选至少一个能力；刷新后仍在；编辑描述后刷新仍在；用重复 slug 新建得到弹窗内错误；删除后列表消失；数据库 `select slug, runtime from enterprise_agents` 结果一致。

## Out of scope

门户侧读取与房间接入（acp-04）；Agent 级配额；Agent 版本管理；从桌面分身导入。
