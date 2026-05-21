# AgenticX Enterprise 文档中心

> 基于 `enterprise/` 全量代码整理。最后更新：2026-05-21

Enterprise 是企业级大模型应用一体化平台，由 **员工前台（web-portal）**、**管理后台（admin-console）**、**AI 网关（gateway）** 三端联动，共享 Postgres 多租户数据层与统一 RBAC。

---

## 快速导航

| 我想… | 去看 |
|---|---|
| 第一次跑起来 | [../README.md](../README.md) → [development/local-dev.md](./development/local-dev.md) |
| 理解整体架构 | [architecture/overview.md](./architecture/overview.md) |
| 查 API 路由 | [api/README.md](./api/README.md) |
| 查数据库表 | [database/schema.md](./database/schema.md) |
| 查环境变量 | [configuration/env-vars.md](./configuration/env-vars.md) |
| **接通真实模型** | [development/local-dev.md#接通真实模型](./development/local-dev.md) · [gateway/runtime-config.md](./gateway/runtime-config.md) |
| **发布 / 测试策略** | [gateway/policy-engine.md](./gateway/policy-engine.md) · [api/admin-console.md#策略规则中心](./api/admin-console.md) |
| **看 Token 用量** | [api/admin-console.md#计量](./api/admin-console.md) · `/metering` 页面 |
| 配 SSO | [runbooks/sso-oidc-setup.md](./runbooks/sso-oidc-setup.md) |
| 配策略 / 插件 | [plugin-protocol/README.md](./plugin-protocol/README.md) · [gateway/policy-engine.md](./gateway/policy-engine.md) |
| 部署到 Vercel + 外部 Gateway | [deployment/README.md](./deployment/README.md) |
| 给客户做定制 | [guides/enterprise-customers-collaboration.md](./guides/enterprise-customers-collaboration.md) |
| 排障 | [development/troubleshooting.md](./development/troubleshooting.md) |

---

## 文档目录

### 架构

- [overview.md](./architecture/overview.md) — 组件拓扑、Monorepo 结构、技术栈
- [data-flow.md](./architecture/data-flow.md) — 聊天、策略、审计、计量数据流

### 应用与模块

- [apps/README.md](./apps/README.md) — 四个可部署单元（portal / admin / gateway / edge-agent）
- [features/README.md](./features/README.md) — 十个业务功能域及实现状态
- [packages/README.md](./packages/README.md) — 共享技术包

### API 契约

- [api/README.md](./api/README.md) — API 总索引
- [api/web-portal.md](./api/web-portal.md) — 前台 REST 路由
- [api/admin-console.md](./api/admin-console.md) — 后台 REST 路由
- [api/gateway.md](./api/gateway.md) — Go 网关 OpenAI 兼容 API
- [api/internal-api.md](./api/internal-api.md) — Gateway ↔ Admin Internal API

### 网关

- [gateway/overview.md](./gateway/overview.md) — 路由、Channel 中继、配额、审计
- [gateway/policy-engine.md](./gateway/policy-engine.md) — 三通道策略评估
- [gateway/runtime-config.md](./gateway/runtime-config.md) — Provider / 配额 / 快照 PG 化

### 数据与权限

- [database/schema.md](./database/schema.md) — Drizzle schema、22 张表、迁移策略
- [rbac/scopes.md](./rbac/scopes.md) — Scope 注册表与角色模板

### 配置

- [configuration/env-vars.md](./configuration/env-vars.md) — 全量环境变量分组表

### 插件

- [plugin-protocol/README.md](./plugin-protocol/README.md) — rule-pack / tool-pack / theme-pack manifest 规范

### 开发与测试

- [development/local-dev.md](./development/local-dev.md) — bootstrap / start-dev 工作流
- [development/troubleshooting.md](./development/troubleshooting.md) — 常见问题速查
- [testing/README.md](./testing/README.md) — E2E、视觉巡检、压测脚本
- [../scripts/README.md](../scripts/README.md) — 脚本参数详解

### 部署与运维（已有）

- [deployment/README.md](./deployment/README.md) — Vercel + 外部 Gateway
- [deployment/vercel-env-checklist.md](./deployment/vercel-env-checklist.md)
- [deployment/supabase-migration-guide.md](./deployment/supabase-migration-guide.md)
- [runbooks/](./runbooks/) — SSO、审计回灌、策略回滚、Channel 中继、隧道 demo

### 决策记录

- [adr/0001-oss-foundations-selection.md](./adr/0001-oss-foundations-selection.md)

### 验收与销售

- [mvp-acceptance-checklist-v20260422.md](./mvp-acceptance-checklist-v20260422.md)
- [sales/sso-demo-script.md](./sales/sso-demo-script.md)

---

## 与 Machi Desktop 的关系

| 维度 | Enterprise | Machi Desktop |
|---|---|---|
| 后端 | Go `apps/gateway` + Next.js API Routes | 内嵌 Python `agx serve`（PyInstaller） |
| 模型路由 | Go `OpenAICompatibleProvider` | Python LiteLLM |
| 目标用户 | 企业员工 Web 端 | 开发者桌面 Agent |
| 策略引擎 | Go policy-engine（gateway 内嵌） | AgenticX Python 框架 + 可选 Go 网关 |

两条链路**不混用**。客户方案中「端侧闭环」应描述 Machi 本地后端，而非 `apps/edge-agent`（当前为 skeleton）。

---

## 成熟度图例（全文档通用）

| 标记 | 含义 |
|---|---|
| ✅ 已实现 | 可本地演示、有 PG 落库 |
| 🟡 部分 | 核心路径可用，周边能力 stub |
| ⚪ Stub | 仅占位 package，逻辑在其他位置或未开发 |
| ⛔ Skeleton | 设计文档存在，代码未落地，不可演示 |
