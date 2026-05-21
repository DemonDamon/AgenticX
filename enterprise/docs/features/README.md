# Features 业务功能域

目录：`enterprise/features/`  
NPM 命名：`@agenticx/feature-<name>`

Features 是**客户挪用主单元**——定制项目应通过 workspace 引用 feature package，而非 fork app 代码。

---

## 总览

> 状态图例：✅ 已实现 · 🟡 部分 · ⚪ Stub · ⛔ Skeleton（详见 [docs/README.md](../README.md)）

| Feature | NPM | 状态 | 主要代码 |
|---|---|---|---|
| iam | `@agenticx/feature-iam` | ✅ | `services/`, `api/`, `components/` |
| chat | `@agenticx/feature-chat` | ✅ | `ChatWorkspace.tsx`, `store.ts`, `components/` |
| policy | `@agenticx/feature-policy` | ✅ | `services/pg-store.ts`, `snapshot/writer.ts` |
| audit | `@agenticx/feature-audit` | ✅ | `services/pg-store.ts`, `api/audit.ts` |
| metering | `@agenticx/feature-metering` | ✅ | `services/metering.ts`, `api/metering.ts` |
| model-service | `@agenticx/feature-model-service` | ⚪ | 逻辑在 `admin-console/lib/model-providers-store.ts` |
| knowledge-base | `@agenticx/feature-knowledge-base` | ⚪ | 规划对接 Machi KB stage-1 |
| tools-mcp | `@agenticx/feature-tools-mcp` | ⚪ | 规划 MCP 市场 |
| agents | `@agenticx/feature-agents` | ⚪ | 规划分身/智能体 |
| settings | `@agenticx/feature-settings` | ⚪ | portal 有 `SettingsPanel.tsx` 本地实现 |

---

## iam

**职责**：租户内用户、部门树、角色、RBAC、CSV 批量导入。

**关键模块**

- `services/user.ts`, `department.ts`, `role.ts`, `bulk-import.ts`
- `middleware/rbac.ts` — scope 校验
- `components/DepartmentTree.tsx`

**Admin 页面**：`/iam/*`

**依赖**：`@agenticx/iam-core`, `@agenticx/db-schema`

---

## chat

**职责**：员工前台聊天工作区 UI、Zustand store、Markdown 渲染、会话历史客户端。

**关键模块**

- `ChatWorkspace.tsx` — 主界面
- `store.ts` — 消息/流式状态
- `history-client.ts` — 调 portal `/api/chat/sessions`
- `components/` — 输入区、消息气泡、模型选择
- `markdown/` — 代码高亮（light/dark 主题）

**设计文档**：`features/chat/docs/design.md`

**依赖 portal API**：completions 代理、sessions CRUD、me/models

---

## policy

**职责**：策略规则 PG 存储、发布快照、审计辅助。

**关键模块**

- `services/pg-store.ts` — CRUD draft/active
- `snapshot/writer.ts` — 发布写入 `enterprise_runtime_policy_snapshots`
- `types.ts` — RuleKind, Action, AppliesTo

**Admin 页面**：`/policy`

**与 Gateway**：发布后 snapshot 被 Go policy-engine 热加载。

---

## audit

**职责**：Gateway LLM 审计查询、导出、链校验 UI 后端。

**关键模块**

- `services/pg-store.ts` — 主路径
- `services/local-store.ts` — JSONL 兜底
- `api/audit.ts` — query/export/chain-verify 处理器

**Admin 页面**：`/audit`

**Scope**：`audit:read:all`, `audit:read:dept`, `audit:export`

---

## metering

**职责**：Token 用量四维聚合查询与导出。

**维度**：tenant / dept / user / provider / model / time_bucket

**Admin 页面**：`/metering`, `/metering/quota`

**数据源**：`usage_records`（Gateway 写入）

---

## Stub Features 说明

以下 package 仅有 `index.ts` 占位或空导出，**不可作为现场演示项**：

- **model-service** — Provider GUI 在 admin-console app 层实现，后续下沉
- **knowledge-base** — 企业版 KB 未接 Machi `agenticx/studio/kb/`
- **tools-mcp** — MCP 市场 UI 未 enterprise 化
- **agents** — 无 enterprise 分身管理
- **settings** — 用户偏好等在 portal 本地组件

客户方案应如实标注完成度，参见 [mvp-acceptance-checklist-v20260422.md](../mvp-acceptance-checklist-v20260422.md)。

---

## 在 App 中引用

```json
// apps/web-portal/package.json
{
  "dependencies": {
    "@agenticx/feature-chat": "workspace:*",
    "@agenticx/feature-settings": "workspace:*"
  }
}
```

```tsx
import { ChatWorkspace } from "@agenticx/feature-chat";
```

---

## 定制原则

1. 通用需求 → 改 `enterprise/features/*`，回流主干
2. 客户专属 → `customers/*/overrides` 或私有 feature fork
3. 禁止在客户仓修改 `@agenticx/*` 源码

详见 [guides/enterprise-customers-collaboration.md](../guides/enterprise-customers-collaboration.md)。
