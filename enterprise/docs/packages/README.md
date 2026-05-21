# Packages 技术零件

目录：`enterprise/packages/`  
共享于 apps 与 features，pnpm workspace 统一管理。

---

## 包清单

> 状态图例：✅ 已实现 · 🟡 部分 · ⚪ Stub · ⛔ Skeleton

| 包 | NPM | 状态 | 说明 |
|---|---|---|---|
| ui | `@agenticx/ui` | ✅ | shadcn 原语、OKLCH 主题、AppShell、DataTable 等 |
| auth | `@agenticx/auth` | ✅ | JWT、密码、OIDC/SAML、Next middleware |
| db-schema | `@agenticx/db-schema` | ✅ | Drizzle schema、migrations、seed |
| iam-core | `@agenticx/iam-core` | ✅ | PG repos、scope-registry、crypto、legacy 迁移 |
| core-api | `@agenticx/core-api` | 🟡 | Chat 类型、errors、audit schema |
| config | `@agenticx/config` | 🟡 | 品牌/feature flag/插件配置加载 |
| policy-engine | `@agenticx/policy-engine` | Go ✅ / TS ⚪ | Gateway 内嵌策略引擎 |
| sdk-ts | `@agenticx/sdk-ts` | 🟡 | HTTP chat client / mock |
| sdk-py | `agenticx-sdk` | ⚪ | 不在 pnpm workspace |
| branding | `@agenticx/branding` | ⚪ | 白标组件预留 |
| telemetry | `@agenticx/telemetry` | ⚪ | 埋点/OTel 预留 |

---

## @agenticx/ui

**入口**：组件 barrel + `themes/base.css`

**要点**

- Tailwind v4 `@theme inline` + OKLCH indigo/violet primary
- 三态主题：`system` / `dark` / `light`（`useUiTheme`）
- AppShell v2：分组侧栏、⌘K 命令面板、面包屑
- 原语：Button, Dialog, Sheet, DataTable（tanstack-table）, Toaster（sonner）等

**消费方**：web-portal、admin-console

---

## @agenticx/auth

**职责**

- RS256 JWT 签发/校验
- Portal refresh session（PG）
- OIDC / SAML 协议 handler（portal + admin 共用）
- Next.js middleware 辅助

**环境变量**：见 [api/web-portal.md](../api/web-portal.md)

---

## @agenticx/db-schema

**职责**

- 全部 PG 表 Drizzle 定义
- `drizzle-kit` 迁移
- `db:seed` 默认租户与 owner

**文档**：[database/schema.md](../database/schema.md)

---

## @agenticx/iam-core

**职责**

- User / Dept / Role repository
- `scope-registry.ts` — 见 [rbac/scopes.md](../rbac/scopes.md)
- `provider-key-crypto.ts` — Provider API Key AES-GCM
- `runtime-legacy-migrate` — JSON → PG 导入逻辑
- Refresh token store

**CLI**：`pnpm migrate:legacy-runtime`

---

## @agenticx/core-api

**职责**

- 跨端 TypeScript 类型（ChatMessage、Session、AuditEvent 等）
- 统一 error code
- Session title 生成辅助

Gateway Go 侧有独立 struct，需手动对齐变更。

---

## @agenticx/policy-engine

**双语言**

- **Go**（生产）：`packages/policy-engine/go/` — Trie、regex、PII detector；被 `apps/gateway` import
- **TS**（stub）：admin 策略测试可能部分复用类型

**文档**：[gateway/policy-engine.md](../gateway/policy-engine.md)

---

## @agenticx/config

**导出**

- `.` — 配置加载
- `./schemas` — Zod/YAML schema
- `./loaders` — 文件/env 加载
- `./react` — React context

用于品牌名、feature flags、插件路径。

---

## @agenticx/sdk-ts

**用途**：外部系统集成 Enterprise Gateway（OpenAI 兼容）

```ts
// 概要 — 见 packages/sdk-ts/src/
import { createChatClient } from "@agenticx/sdk-ts";
```

**状态**：HTTP client 可用；高级能力（流式重连、策略错误解析）待完善。

---

## Stub 包 roadmap

| 包 | 计划 |
|---|---|
| branding | 客户 `customers/*/config/branding` 注入 |
| telemetry | OpenTelemetry + 可选 Langfuse（ADR-0001） |
| sdk-py | 与 AgenticX Python SDK 对齐 |

---

## 依赖规则

```
apps → features → packages
apps → packages (直接)
gateway (Go) → policy-engine (Go only)
```

Features **不应** 互相循环依赖；跨 feature 协作通过 apps 组装或 core-api 类型。

---

## 版本与发布

当前 monorepo `private: true`，版本 `@agenticx/enterprise@0.2.0`。客户仓通过 `workspace:*` 引用，无需 npm publish。
