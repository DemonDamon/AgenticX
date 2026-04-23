# AgenticX Enterprise 产品架构文档 v0.2

> **状态**：草案 v0.2（2026-04-21 更新）
> **作者**：Damon Li
> **目的**：把"交付客户项目"升级为"经营企业级产品"，让每个新客户项目的边际成本降到 20%
> **读者**：产品/研发/售前/运维团队
> **v0.2 变更**：
> - 确定 enterprise 与 AgenticX 同仓（开源），仅 customers/* 为独立私有仓
> - 新增"四层模块化"设计（apps / features / packages / plugins）
> - 新增 AgenticX-Website 前台模块剥离映射表
> - 新增"客户仓挪用 enterprise 模块"的 4 种技术机制

---

## 1. 产品定位

### 1.1 一句话定义

**AgenticX Enterprise** 是一款面向企业私有化部署的大模型应用一体化平台，通过**桌面端（Machi）+ 后台管理 + AI 网关**的三端联动，同时支撑「云端统一管控」与「端侧安全闭环」两种业务模式。

### 1.2 核心差异化

| 维度 | AgenticX Enterprise | Dify Enterprise | LiteLLM | LangSmith |
|---|---|---|---|---|
| 桌面原生端 | ✅ Machi 一体化 | ❌ | ❌ | ❌ |
| 端侧本地闭环 | ✅ 原生支持 | ❌ | ❌ | ❌ |
| 企业级后台 | ✅ | ✅ | ⚠️ 弱 | ⚠️ 偏可观测 |
| AI 网关 | ✅ 基于 APIPark | ⚠️ 弱 | ✅ | ❌ |
| 可视化工作流 | 🟡 V2 规划 | ✅ | ❌ | ❌ |
| 开源生态 | ✅ 框架层开源 | ✅ Community | ✅ | ❌ |

**护城河**：三端联动是本产品的独特定位，竞品都只做其中一端。

### 1.3 商业模式（待决策，影响架构）

- **Mode A**：私有化一次性买断 + 年度维保（当前首个客户项目属于此）
- **Mode B**：SaaS 订阅（按席位/Token 计费，未来公有云版本）
- **Mode C**：Hybrid（控制面 SaaS + 数据面私有化）

> 架构须**同时兼容 A 和 B**，C 为未来扩展。

---

## 2. 目标用户与典型场景

### 2.1 用户角色

| 角色 | 对应入口 | 主要诉求 |
|---|---|---|
| 终端员工 | Machi 桌面端 / Web Portal | 日常对话、调模型、工具调用、工作区管理 |
| 业务管理员 | Admin Console | 账号、权限、消耗查询、规则配置 |
| 合规/审计员 | Admin Console → 审计模块 | 日志检索、策略审计、导出报表 |
| IT 运维 | Admin Console → 运维模块 | 节点状态、SLA 监控、故障处理 |
| 平台运营商（你们） | Super Admin | 多租户管理、版本发布、客户支持 |

### 2.2 典型行业场景

- **金融（首发）**：金融投研、文档校对、敏感拦截、合规审计
- **法律**：合同审查、案例检索、条款对比
- **医疗**：病历分析、文献综述（需医疗行业敏感规则包）
- **政务**：公文写作、报告审核、规范性校对
- **教育**：备课、教研、学生作业批改

每个行业通过**规则插件包**切换，不改主干代码。

---

## 3. 核心模块

```
┌─────────────────────────────────────────────────────────────────┐
│                  AgenticX Enterprise Platform                   │
│                                                                 │
│  ┌──────────────────────── 用户层 ────────────────────────┐    │
│  │                                                          │    │
│  │  Machi 桌面端      Web Portal        Admin Console       │    │
│  │  (Windows/Mac)    (Next.js)         (Next.js)            │    │
│  └──────────────┬───────────┬────────────────┬──────────────┘    │
│                 │           │                │                   │
│  ┌──────────────▼───────────▼────────────────▼──────────────┐   │
│  │              统一接入层 (API Gateway)                     │   │
│  │              · JWT/APIKey 鉴权                           │   │
│  │              · 租户路由                                   │   │
│  │              · 限流/熔断                                  │   │
│  └──────────────────────────┬─────────────────────────────┘     │
│                             │                                    │
│  ┌──────────────────────── 业务层 ────────────────────────┐    │
│  │                                                          │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │    │
│  │  │租户/权限  │ │会话/消息 │ │模型/路由 │ │规则/策略 │  │    │
│  │  │  IAM     │ │  Chat    │ │ Routing  │ │ Policy   │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │    │
│  │  │审计/日志  │ │计量/消耗 │ │工具/MCP  │ │智能体    │  │    │
│  │  │  Audit   │ │  Metering│ │  Tools   │ │  Agents  │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │    │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────── 数据面 ────────────────────────┐    │
│  │                                                          │    │
│  │   AI Gateway（Go，APIPark fork）                         │    │
│  │   · 三路路由（本地/独享/第三方）                          │    │
│  │   · 敏感拦截引擎                                         │    │
│  │   · 流式审计                                             │    │
│  └──────────────────────────┬─────────────────────────────┘    │
│                             │                                   │
│  ┌──────────────────────── 存储层 ────────────────────────┐    │
│  │  PostgreSQL  ·  Redis  ·  ClickHouse  ·  S3/MinIO       │    │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────── 扩展层 ────────────────────────┐    │
│  │   Plugins：规则包 / 工具包 / 工作流包 / 主题包           │    │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1 模块职责清单

| 模块 | 职责 | 技术栈 | 优先级 |
|---|---|---|---|
| **IAM**（身份/权限） | 多租户、组织、部门、角色、权限、SSO | Next.js API + PG | P0 |
| **Chat**（会话） | 会话创建、消息存储、SSE 流式 | Next.js API + PG | P0 |
| **Routing**（路由） | 三路路由策略、Provider 管理、Key 池 | Go (APIPark) | P0 |
| **Policy**（策略引擎） | 关键词/正则/PII/Prompt 规则；插件加载 | Go | P0 |
| **Audit**（审计） | 结构化日志、流式写入、查询 API | Go → CH | P0 |
| **Metering**（计量） | Token/Cost 聚合、四维查询 | PG + CH | P0 |
| **Tools/MCP** | 工具注册、MCP Server 管理 | Next.js + Python SDK | P1 |
| **Agents** | 智能体定义、分身管理 | Python (agenticx) | P1 |
| **Workflow** | 可视化工作流（V2） | Next.js + DAG engine | P2 |

---

## 4. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 前端 | Next.js 16 + React 19 + shadcn/ui | 延续 AgenticX-Website 栈，复用设计系统 |
| 业务后端 | Next.js API Routes / Hono | 和前端同栈，降低人力成本 |
| AI 网关 | Go + Gin（基于 APIPark）| 高并发流式、低延迟、成熟生态 |
| 数据库 | PostgreSQL 16 | 主库，支持 RLS 做租户隔离 |
| 缓存 | Redis 7 | 会话、限流、Token Bucket |
| 日志/审计 | ClickHouse | 海量审计日志查询性能优异 |
| 对象存储 | S3 / MinIO（私有化）| 文件、附件、导出报表 |
| 消息队列 | Redis Streams / NATS | 审计日志异步写入 |
| 容器编排 | Docker Compose（单机）/ Helm（集群）| 两种部署形态都要支持 |
| 监控 | Prometheus + Grafana | 标准选型 |
| 桌面端 | Electron + React + Zustand | 沿用 Machi 现有栈 |

---

## 5. 多租户设计

### 5.1 租户模型

```
Tenant (客户)
  └── Organization (组织，通常 1 个)
        └── Department (部门，N 层树)
              └── User (员工)
                    └── Role (角色，RBAC)
```

### 5.2 数据隔离策略

**三种模式，按部署方式切换：**

| 模式 | 适用 | 实现 |
|---|---|---|
| **Schema 级隔离** | SaaS 多租户 | 每个租户一个 PG schema |
| **行级隔离（RLS）** | SaaS 高密度 | PG Row Level Security + `tenant_id` |
| **物理隔离** | 私有化部署 | 整套部署独立，`tenant_id=default` |

**本次首个客户项目用物理隔离**（最简单，符合私有化要求），但代码层必须预留 `tenant_id` 字段，未来切 SaaS 不返工。

### 5.3 核心数据表（v0.1 草案）

```sql
-- 租户与组织
tenants (id, name, plan, created_at, config_json, status)
organizations (id, tenant_id, name, ...)
departments (id, tenant_id, org_id, parent_id, name, path)
users (id, tenant_id, email, name, status, ...)
roles (id, tenant_id, code, name, permissions_json)
user_roles (user_id, role_id, scope)

-- 模型与路由
providers (id, tenant_id, code, type, config_encrypted)
models (id, provider_id, name, context_length, output_length, metadata)
model_keys (id, model_id, key_encrypted, priority, status, quota)
route_rules (id, tenant_id, rule_json, priority, enabled)

-- 策略
policies (id, tenant_id, type, rule_dsl, action, enabled)
policy_hits (id, tenant_id, policy_id, user_id, session_id, matched, at)

-- 审计（写 ClickHouse，PG 只放索引）
audit_logs_index (id, tenant_id, user_id, session_id, at, type, ch_ref)

-- 计量
usage_records (id, tenant_id, dept_id, user_id, provider, model,
               input_tokens, output_tokens, cost, at)
  - 分区键：tenant_id + toYYYYMM(at)
  - 物化视图：按 (tenant_id, dept_id, user_id, provider, day) 预聚合

-- 会话
sessions (id, tenant_id, user_id, title, metadata_json, ...)
messages (id, session_id, role, content, tokens, at, ...)
```

---

## 6. 插件协议（关键！产品化成败的分界线）

### 6.1 插件类型

| 类型 | 作用 | 打包格式 |
|---|---|---|
| **Rule Pack**（规则包） | 敏感词库、正则、实体识别模型 | `.yaml + .json` |
| **Tool Pack**（工具包） | MCP Server / Skill / Script | `.tar.gz` |
| **Workflow Pack**（流程包） | 可视化工作流模板（V2） | `.json` |
| **Theme Pack**（主题包） | UI 定制、logo、色系、文案 | `.json + assets/` |
| **Connector**（连接器） | 内部系统集成（ERP/OA 等） | `.tar.gz` + manifest |

### 6.2 Rule Pack 协议示例

```yaml
# plugins/moderation-finance/manifest.yaml
name: moderation-finance
version: 1.0.0
type: rule-pack
description: 金融行业通用敏感信息规则库
industry: finance

rules:
  - id: fin-001
    name: 金额模式
    type: regex
    pattern: '\d+\.?\d*\s*(?:万|亿|元|RMB|CNY|USD)'
    action: redact
    severity: medium

  - id: fin-002
    name: 银行账号
    type: regex
    pattern: '\b[0-9]{16,19}\b'
    action: block
    severity: high

  - id: fin-003
    name: PII 身份证号
    type: regex
    pattern: '\b\d{17}[\dXx]\b'
    action: redact
    severity: high

extends:
  - pii-baseline  # 继承通用 PII 规则包
```

### 6.3 客户专属覆盖

```yaml
# customers/<client-name>/rules/manifest.yaml
name: client-a-custom
version: 1.0.0
type: rule-pack
extends:
  - moderation-finance  # 继承金融通用包

rules:
  - id: hc-001
    name: 客户 A内部项目代号
    type: keyword-list
    source: ./keywords/project-codes.txt
    action: block
    severity: critical

  - id: hc-002
    name: 目标客户名单
    type: keyword-list
    source: ./keywords/client-list.txt
    action: block
    severity: critical
```

**核心设计**：客户专属包**继承**行业通用包，只加增量规则，不改主干。

---

## 7. 白标规范

### 7.1 可配置维度

| 维度 | 配置项 | 示例 |
|---|---|---|
| 品牌 | `name`, `logo`, `favicon` | "客户 A 的 AI 平台" |
| 色系 | `primary`, `secondary`, `accent` | HSL tokens |
| 文案 | `welcome_text`, `footer`, `slogan` | i18n JSON |
| 域名 | `domain`, `api_base`, `cdn_base` | `ai.client-a.com` |
| 登录 | `sso_provider`, `custom_login_bg` | OIDC/SAML |
| 功能开关 | `features.*` | feature flags |

### 7.2 配置文件结构

```yaml
# customers/<client-name>/config/brand.yaml
brand:
  name: "客户 A 的 AI 平台"
  short_name: "客户 A AI"
  logo: ./assets/logo.svg
  favicon: ./assets/favicon.ico
  primary_color: "220 90% 50%"
  slogan: "数据智能驱动投研决策"

domain:
  web_portal: ai-portal.client-a.internal
  admin_console: ai-admin.client-a.internal
  gateway: ai-gateway.client-a.internal

features:
  ai_search: true
  knowledge_base: true
  workflow: false     # 一期不开
  edge_nodes: true    # 边缘节点接入
  sso: false          # 一期账密，二期接 LDAP

compliance:
  pipl_notice: true
  audit_retention_days: 365
```

前端通过 `window.__BRAND_CONFIG__` 注入，**无需重新编译镜像**即可换皮。

---

## 8. 仓库组织（v0.2 最终方案）

### 8.1 顶层结构

```
/Users/damon/myWork/AgenticX/             [public git repo] 🌐 开源主仓
├── agenticx/                              开源 · Python 框架
├── desktop/                               开源 · Machi 桌面端
├── AgenticX-Website/                      开源 · 品牌官网（剥离后变薄）
├── enterprise/                            开源 · 企业版（核心产品）
│   ├── apps/
│   ├── features/
│   ├── packages/
│   ├── plugins/
│   ├── deploy/
│   └── docs/
├── docs/                                  开源 · 公共文档
│
└── customers/                             🔒 .gitignore 排除
    └── client-a/                          [private git repo，嵌套独立仓]
        ├── apps/                          客户自有 app（组装壳）
        ├── config/                        白标配置
        ├── rules/                         专属规则库
        ├── plugins/                       客户专属插件
        ├── overrides/                     UI 覆盖组件
        ├── deploy/                        部署清单（含机密）
        └── docs/                          合同级交付文档
```

**关键规则：**
- `enterprise/` 跟随 AgenticX 开源，通过 pnpm workspace 组织为 monorepo
- `customers/*` 物理嵌套但 git 完全独立（每客户一个 private 仓）
- `.gitignore` 仅排除 `/customers/`

---

### 8.2 enterprise 四层模块化

```
enterprise/
├── apps/                      🎯 可部署整机（3 个应用 = 客户最终看到的东西）
│   ├── web-portal/            #  员工前台（Next.js）
│   ├── admin-console/         #  管理后台（Next.js）
│   └── gateway/               #  AI 网关（Go，基于 APIPark）
│
├── features/                  🧩 业务功能域（客户挪用的主单元）
│   ├── iam/                   #  身份/租户/部门/角色/权限
│   ├── chat/                  #  对话工作区 ⭐ 从 Website 剥离
│   ├── model-service/         #  模型服务管理
│   ├── knowledge-base/        #  知识库
│   ├── tools-mcp/             #  工具 · MCP
│   ├── agents/                #  智能体 · 分身
│   ├── metering/              #  计量 · 四维查询
│   ├── audit/                 #  审计日志
│   ├── policy/                #  敏感规则配置
│   └── settings/              #  设置面板
│
├── packages/                  📦 共享技术零件
│   ├── ui/                    #  shadcn 组件 + 主题
│   ├── branding/              #  白标组件（动态 logo/色系）
│   ├── auth/                  #  认证抽象（Supabase/LDAP/SSO/账密）
│   ├── db-schema/             #  Drizzle schema（多租户字段预留）
│   ├── core-api/              #  类型契约（OpenAPI）
│   ├── policy-engine/         #  JS 端规则引擎
│   ├── sdk-ts/                #  TS 客户端 SDK（Machi 接入）
│   ├── sdk-py/                #  Python SDK
│   ├── config/                #  配置加载器
│   └── telemetry/             #  埋点 / 审计上报
│
├── plugins/                   🔌 运行时插件（规则 / 工具 / 主题）
│   ├── moderation-pii-baseline/
│   ├── moderation-finance/
│   ├── moderation-medical/
│   ├── tool-watermark/
│   ├── tool-doc-review/
│   └── theme-default/
│
├── deploy/
├── docs/
├── package.json              # pnpm workspace root
├── pnpm-workspace.yaml
└── turbo.json
```

**四层职责对照：**

| 层 | 角色 | 粒度 | 发布形式 |
|---|---|---|---|
| `apps/` | 整机 | 可部署完整应用 | Docker 镜像 |
| `features/` | 功能域 | 跨 apps 复用的业务模块 | npm 包 `@agenticx/feature-*` |
| `packages/` | 零件 | 技术基础设施 | npm 包 `@agenticx/*` |
| `plugins/` | 外挂 | 运行时加载的配置/规则/工具 | npm 包 `@agenticx/plugin-*` |

---

### 8.3 AgenticX-Website 前台模块剥离映射

客户技术规范书里的"前台 Web 端"功能，原先写在 `AgenticX-Website` 下，现在剥离到 `enterprise`。

| AgenticX-Website 现有位置 | 迁移到 enterprise | 说明 |
|---|---|---|
| `app/agents/page.tsx` | `apps/web-portal/app/(workspace)/page.tsx` | 前台入口 |
| `app/auth/page.tsx` | `apps/web-portal/app/auth/page.tsx` | 认证页 |
| `app/api/auth/*` | `packages/auth/routes/*` | 认证 API |
| `components/agents/ChatWorkspace.tsx`（341行）| `features/chat/` | ⭐ 核心 |
| `components/agents/ModelServicePanel.tsx`（108行）| `features/model-service/` | 模型面板 |
| `components/agents/FeedbackDialog.tsx`（193行）| `features/chat/components/` | 对话子组件 |
| `components/agents/settings/SettingsPanel.tsx` | `features/settings/` | 设置主面板 |
| `components/agents/settings/tabs/*`（6 tabs） | `features/settings/tabs/` | 各 Tab |
| `components/ui/*` | `packages/ui/` | shadcn 全家桶 |
| `components/branding/*` | `packages/branding/` | 品牌/白标改造 |
| `lib/utils.ts` | `packages/ui/utils.ts` | 通用工具 |
| `lib/supabase/` | `packages/auth/providers/supabase/` | Supabase 适配 |
| `db/schema.ts` | `packages/db-schema/` | 数据库 schema |

**剥离后 AgenticX-Website 只保留：**
- 官网页面（`app/page.tsx` 首页、docs、privacy、terms）
- SEO / robots / 品牌资产

**Website 通过 npm workspace 反向引用 enterprise：**
```json
// AgenticX-Website/package.json
{
  "dependencies": {
    "@agenticx/ui": "workspace:*",
    "@agenticx/branding": "workspace:*"
  }
}
```

这样一次改 shadcn 组件，官网和企业版同步更新。

---

### 8.4 客户仓挪用 enterprise 的 4 种技术机制

#### 机制 1：pnpm workspace 依赖（代码级复用）⭐⭐⭐

```json
// customers/<client-name>/apps/portal/package.json
{
  "name": "@customer-client-a/portal",
  "dependencies": {
    "@agenticx/feature-chat": "workspace:*",
    "@agenticx/feature-iam": "workspace:*",
    "@agenticx/feature-metering": "workspace:*"
  }
}
```

客户 app 只是"壳"：
```tsx
// customers/<client-name>/apps/portal/app/page.tsx
import { ChatWorkspace } from '@agenticx/feature-chat'
import { brand } from '../config/brand'
import { rulePacks } from '../rules'

export default () => (
  <ChatWorkspace
    brand={brand}
    rulePacks={rulePacks}
    features={{ knowledgeBase: true, workflow: false }}
  />
)
```

#### 机制 2：配置注入（无代码定制）⭐⭐⭐

```yaml
# customers/<client-name>/config/brand.yaml
brand:
  name: "客户 A 的 AI 平台"
  primary_color: "220 90% 50%"
  logo: ./assets/logo.svg
features:
  knowledge_base: true
  workflow: false
  edge_nodes: true
```
`packages/config` 在运行时读取并注入。

#### 机制 3：插件覆盖（规则/工具定制）⭐⭐

```yaml
# customers/<client-name>/plugins/moderation-hc-custom/manifest.yaml
extends: '@agenticx/moderation-finance'
rules:
  - id: hc-001
    source: ./keywords/hc-project-codes.txt
    action: block
```

#### 机制 4：组件 slot 覆盖（UI 深定制）⭐

```tsx
<ChatWorkspace
  slots={{
    header: <ClientAHeader />,
    footer: <ClientACompliance />
  }}
/>
```

---

### 8.5 客户仓最终形态（挪用后极简）

```
customers/<client-name>/           [private git repo, ~10-20% 代码量]
├── apps/                     # 组装壳
│   ├── portal/               #   引用 enterprise/features/chat
│   └── admin/                #   引用 enterprise/features/iam
├── config/                   # ⭐ 白标配置（机制 2）
├── rules/                    # ⭐ 专属规则库（机制 3）
├── plugins/                  # 客户专属插件
├── overrides/                # UI 覆盖（罕用）
├── deploy/                   # 客户部署清单
├── docs/                     # 合同级交付文档
└── README.md
```

客户项目 **代码量约 enterprise 的 10-20%**，其余 80%+ 都来自挪用。

---

## 9. API 设计原则

1. **版本化**：所有 API 走 `/api/v1/*`，破坏性升级走 `/v2`
2. **租户透明**：租户 ID 从 JWT 提取，不走 URL
3. **OpenAPI 3.1**：schema 自动生成客户端 SDK
4. **流式统一**：SSE 为主，特殊场景用 WebSocket
5. **错误码规范**：`4xxxx 业务错误 / 5xxxx 系统错误 / 9xxxx 策略拦截`
6. **幂等性**：写操作带 `Idempotency-Key` header
7. **审计默认**：所有写操作自动产生 audit event

---

## 10. 部署架构

### 10.1 单机部署（私有化默认）

```
客户内网
├── docker-compose.yml
├── web-portal       (Next.js, :3000)
├── admin-console    (Next.js, :3001)
├── gateway          (Go, :8080)
├── postgres         (:5432)
├── redis            (:6379)
├── clickhouse       (:8123)
├── minio            (:9000)
└── nginx            (反向代理, :80/:443)
```

资源要求：8C 32G 起步，支撑 200 并发。

### 10.2 集群部署（大客户/高可用）

- Helm Chart 部署到 K8s
- 所有组件横向扩展
- PG 主从 + PGBouncer
- Redis Cluster
- ClickHouse 集群

---

## 11. 实施路线图

### M0（本周，2026-04-21 ~ 04-27）— 奠基
- [x] 架构文档 v0.1 落盘
- [ ] 建仓库 `agenticx-enterprise` 和 `customers/<client-name>`
- [ ] 完成首个客户项目投标（废标项核查 + 方案 30 分冲刺）

### M1（1 个月内）— MVP 骨架
- [ ] 多租户数据模型 + IAM
- [ ] 基础三路路由 + Provider 管理
- [ ] 规则引擎 + 金融规则包
- [ ] 审计日志框架
- [ ] 四维消耗查询
- [ ] 首个客户项目一期部署验收

### M2（2-3 个月）— 产品化回流
- [ ] 客户 A定制代码回流通用能力
- [ ] 插件协议正式版（v1.0）
- [ ] 白标配置完善
- [ ] 部署文档 + 运维手册
- [ ] SDK（TS / Python）发布

### M3（4-6 个月）— 复制验证
- [ ] 接第二个客户（非金融行业优先，验证通用性）
- [ ] 可视化规则配置 UI
- [ ] 监控与告警体系
- [ ] 公开 v1.0 Release

### M6+（6 个月后）— 规模化
- [ ] SaaS 多租户版本
- [ ] 工作流可视化（参考 Dify）
- [ ] 插件市场
- [ ] 认证/安全合规强化（等保 / SOC2）

---

### 11.7 首个客户项目 P0-P4 分期 ↔ enterprise 模块映射

将之前方案里的定制开发包（A1-A3 / B1-B3 / C1-C3）精确映射到 enterprise 与 customers 的具体目录，**避免在客户仓重复造轮子**。

#### P0（2-3 周）— 基线搭建

| 任务 | 落位 | 产出 |
|---|---|---|
| enterprise monorepo 搭建 | `enterprise/` ✅ 已完成 | pnpm workspace + 24 packages |
| 客户仓初始化 | `customers/<client-name>/` ✅ 已完成 | 组装壳 + 配置骨架 |
| 多租户 DB schema | `enterprise/packages/db-schema/` | Drizzle 初始 migration |
| 统一认证抽象 | `enterprise/packages/auth/` | 支持账密 / SSO / SAML 接口 |
| 基础 CI / SBOM / 漏洞扫描 | `.github/workflows/` | 供应链门禁 |
| ADR 落盘 | `enterprise/docs/adr/` ✅ 已完成 | 0001 开源选型 |

#### P1（4-6 周）— 后台关键能力

| 条款 | 落位（enterprise）| 落位（customers/<client-name>）|
|---|---|---|
| **A1 子账号批量开通** | `features/iam/` + `apps/admin-console/` | — |
| **A2 四维消耗查询** ⭐ | `features/metering/` + `packages/db-schema/usage_records` | — |
| **A3 配置统一下发（远期）** | `features/settings/distribution/`（V2） | — |
| 部门/角色/权限 | `features/iam/` | 品牌 YAML |
| 前台 Chat 从 Website 剥离 | `features/chat/` | `apps/portal` 组装 |

#### P2（4-6 周）— 网关安全与路由

| 条款 | 落位（enterprise）| 落位（customers/<client-name>）|
|---|---|---|
| **B1 多层敏感治理** | `apps/gateway/internal/policy/` + `packages/policy-engine/` | `rules/keywords/` + `plugins/moderation-hc-custom/` |
| **B2 路由与审计增强** | `apps/gateway/internal/router/` 三路路由 | — |
| **B3 全量日志增强** | `features/audit/` + `apps/gateway/internal/audit/` | `config/audit.yaml` |
| 阻断原因回传客户端 | `packages/core-api/errors.ts` 标准错误码 | i18n 文案 |
| Provider / Model / Key 池 | `features/model-service/` | — |

#### P3（4-8 周）— 端侧闭环与 Workspace 沙箱

| 条款 | 落位（enterprise）| 落位（customers/<client-name>）|
|---|---|---|
| **C1 本地推理闭环** | `apps/edge-agent/internal/ollama/` + `internal/router/` | — |
| **C2 脱敏审计上送** | `apps/edge-agent/internal/redact/` + `internal/uploader/` | — |
| **C3 Workspace 权限沙箱** | `apps/edge-agent/internal/sandbox/` | `config/features.yaml` 白名单 |
| Machi ↔ Edge Agent IPC | `packages/sdk-ts/` + `apps/edge-agent/internal/api/` | — |
| 18 台边缘节点部署 | `apps/edge-agent/` 单二进制分发 | `deploy/edge-nodes.yaml` 清单 |

#### P4（2-3 周）— 压测、验收、演练

| 任务 | 落位 |
|---|---|
| 200 并发压测 | `enterprise/tools/load-test/` |
| 敏感拦截 100% 验收 | `customers/<client-name>/rules/golden-samples/` + 自动化测试 |
| 文档校对漏误报率测试 | `customers/<client-name>/rules/golden-samples/` + 评估脚本 |
| 容灾 / 回滚演练 | `deploy/helm/` + runbook |
| 安全渗透 | `apps/edge-agent/docs/security-model.md` 清单 |

#### 关键原则（贯穿 P0-P4）

- **通用能力进 enterprise**：客户 A 的需求同时满足客户 B 才算通用 → 回流主干
- **专属内容进 customers**：品牌、规则库、金标准、合同机密 → 永远只在客户私有仓
- **协议优先于实现**：审计（OTel）、向量库（S3）、LLM（OpenAI 兼容）用标准协议，不强绑定具体后端
- **安全融入每一层**：参见各模块 README 的"安全基线"章节

---

## 12. 开放决策项（需要本周拍板）

| # | 决策项 | 选项 | 影响 |
|---|---|---|---|
| D1 | 商业模式 | 买断 / 订阅 / Hybrid | 计费模块深度 |
| D2 | Machi 策略 | 全开源 / 核心开源+企业闭源 / 全闭源 | 桌面端与 Enterprise 的边界 |
| D3 | 品牌策略 | 统一品牌 / 行业子品牌 | 白标深度 |
| D4 | 后端语言 | 全 TS（Next.js）/ TS+Go 混合 / 全 Go | 团队招聘 + 开发效率 |
| D5 | 网关选型 | Fork APIPark / 自研 / Kong+Lua | 可控性 vs 成本 |
| D6 | 审计存储 | ClickHouse / PG 分区表 / Elasticsearch | 规模上限 |
| D7 | 插件发布 | Git 仓 / NPM+PyPI / 私有 Registry | 生态模式 |

---

## 13. 附录

### 13.1 术语表

- **Tenant**：租户，一个客户实例
- **Rule Pack**：规则包，可插拔的敏感信息规则集合
- **Three-way Routing**：三路路由（本地/独享云/第三方）
- **End-side Closed Loop**：端侧闭环，数据在终端完成推理不出域
- **Policy DSL**：策略领域特定语言，描述拦截规则

### 13.2 参考资料

- [Dify Enterprise 架构](https://docs.dify.ai/enterprise)
- [LiteLLM Proxy 设计](https://docs.litellm.ai/docs/proxy)
- [APIPark 源码](../../客户 A/thirdparty/APIPark/)
- [LangSmith Platform](https://smith.langchain.com)

---

**下一份文档**：`2026-04-21-agenticx-enterprise-implementation-plan.md`（实施级详细 WBS，含接口清单、数据库迁移、CI/CD 配置）
