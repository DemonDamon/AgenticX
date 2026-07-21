# AgenticX Enterprise 项目概览

> **用途**：新 session 的第一入口。先读本文件获取全局视图，按需再查阅具体模块的 conclusion。
>
> **原则**：只覆盖到一级目录 / 一级子模块，不下钻到文件级。需要文件级细节时，查阅对应 `conclusions/<dimension>/<module>_conclusion.md`。
>
> **最近全量刷新**：2026-07-21（target `8ebec3b5`，`code-module-summaries` custom 布局 + `state/` 基线）。本目录与主仓 `AgenticX/conclusions/` 平行，专门覆盖 `enterprise/` monorepo。注意：`enterprise/.gitignore` 忽略整个 `conclusions/`（含 `registry.json` / `state/`），默认不进 git。

---

## 项目基本信息

| 属性 | 值 |
|------|-----|
| 名称 | AgenticX Enterprise |
| 定位 | 企业级大模型应用一体化平台（前台 · 后台 · AI 网关三端联动） |
| 形态 | pnpm + turborepo monorepo |
| 主语言 | TypeScript / Go / Python |
| 仓库路径 | `/Users/damon/myWork/AgenticX/enterprise` |
| 文档 | [README.md](../README.md) · [docs/](../docs/) · 本目录 |

---

## 顶层目录结构

```
enterprise/
├── apps/                      🎯 可部署整机（4 个）
│   ├── web-portal/            #  员工前台（Next.js 15，端口 3000）
│   ├── admin-console/         #  管理后台（Next.js 15，端口 3001）
│   ├── gateway/               #  AI 网关（Go，端口 8088，OpenAI 兼容）
│   └── edge-agent/            #  端侧 sidecar（Go，端口 127.0.0.1:7420）
│
├── features/                  🧩 业务功能域 workspace 包（11 个）
│   ├── chat/                  对话工作区（最大，~18 文件）
│   ├── iam/                   身份 · 部门 · 角色 · RBAC
│   ├── metering/              计量 · 四维查询
│   ├── billing/               多方实时分账
│   ├── policy/                敏感规则配置
│   ├── audit/                 审计日志（PG / MySQL / Local 三后端）
│   ├── agents/                智能体 · 分身（本包占位）
│   ├── knowledge-base/        知识库（本包占位）
│   ├── model-service/         模型服务管理（本包占位；能力散落 admin/iam-core）
│   ├── settings/              设置面板（本包占位；真实 UI 在 web-portal）
│   └── tools-mcp/             工具 · MCP 接入（本包占位；能力在 gateway+admin）
│
├── packages/                  📦 技术零件 workspace 包（11 个）
│   ├── auth/                  认证抽象（password / OIDC / SAML / JWT / 加密）
│   ├── iam-core/              IAM 数据访问层（PG + MySQL 双方言 repos）
│   ├── db-schema/             Drizzle 双方言 schema（PG 23 域文件 + MySQL 镜像）
│   ├── ui/                    shadcn 设计系统（OKLCH indigo/violet）
│   ├── policy-engine/         Go 规则引擎（gateway replace 嵌入；TS 侧 stub）
│   ├── core-api/              类型契约
│   ├── sdk-ts/                TS 客户端 SDK（SSE / 多模态，可演示）
│   ├── sdk-py/                Python SDK（占位）
│   ├── config/                config loader（brand / feature flags）
│   ├── telemetry/             埋点 · 审计上报（占位）
│   └── branding/              白标（部分：版本标签；视觉主体在 ui）
│
├── plugins/                   🔌 运行时插件（10 个）
│   ├── moderation-pii-baseline/   基线 PII 规则
│   ├── moderation-finance/         金融行业
│   ├── moderation-medical/         医疗行业
│   ├── wasm-keyword-rewrite/       关键词重写（默认 enabled）
│   ├── wasm-bearer-extractor/      token 头部提取
│   ├── wasm-audit-tagger/          审计标签
│   ├── wasm-waf-basic/             prompt 注入检测
│   ├── tool-doc-review/            文档校对 Python CLI
│   ├── tool-watermark/             PDF 水印 Python CLI
│   └── theme-default/              默认主题（TODO 填 tokens）
│
├── deploy/                    🚀 部署资产
│   ├── docker-compose/        本地开发 + 单机生产
│   ├── gateway/               K8s（deployment/service/hpa）+ 混合部署样例
│   ├── nginx/                 公网入口反代
│   └── config/                policy 装载清单模板
│
├── customers/                 客户专属定制（独立私有仓 `customers/*`）
├── docs/                      文档（architecture / api / database / gateway / runbooks ...）
├── scripts/                   构建 / 部署 / e2e / 冒烟脚本
├── conclusions/               🆕 本目录（结论摘要）
│
├── README.md                  项目入口介绍
├── package.json / pnpm-workspace.yaml / turbo.json
└── tsconfig.base.json
```

---

## apps/ 概览（可部署整机）

| 子模块 | 一句话定位 | 语言 | 端口 | 结论文档 |
|---|---|---|---|---|
| **web-portal** | 员工前台 Next.js app：登录 / 对话 / 设置 / 配额 | TS | 3000 | [apps/web-portal_conclusion.md](apps/web-portal_conclusion.md) |
| **admin-console** | 管理后台 Next.js app：IAM / metering / policy / 审计 / 模型 / channel / MCP | TS | 3001 | [apps/admin-console_conclusion.md](apps/admin-console_conclusion.md) |
| **gateway** | AI 控制平面网关（Go + Chi）：多 vendor adaptor / channel 池 / 配额 / 缓存 / wasm 插件 / MCP host&proxy / 防篡改审计 | Go | 8088 | [apps/gateway_conclusion.md](apps/gateway_conclusion.md) |
| **edge-agent** | 端侧 sidecar（Go）：沙箱执行 + trace 落盘/上送（v0.2.0 MVP；Desktop 尚未接线）| Go | 127.0.0.1:7420 | [apps/edge-agent_conclusion.md](apps/edge-agent_conclusion.md) |

---

## features/ 概览（业务功能域）

| 子模块 | 一句话定位 | 状态 | 结论文档 |
|---|---|---|---|
| **chat** | 对话工作区（Zustand store + ChatWorkspace + MessageList + InputArea + 流式版本/重试历史） | ✅ 标准档 | [features/chat_conclusion.md](features/chat_conclusion.md) |
| **iam** | 身份 · 部门 · 角色 · RBAC（service + API + rbac 中间件 + DepartmentTree UI） | ✅ | [features/iam_conclusion.md](features/iam_conclusion.md) |
| **metering** | 计量四维查询 + 热力图矩阵 + ROI 报表 | ✅ | [features/metering_conclusion.md](features/metering_conclusion.md) |
| **billing** | 多方分账（micro USD bigint 精度 + 对账 + webhook 结算） | ✅ | [features/billing_conclusion.md](features/billing_conclusion.md) |
| **policy** | 规则 / Pack PG 存储 + 内置 moderation 装载 + 发布 / 回滚 / CAS 快照 | ✅ | [features/policy_conclusion.md](features/policy_conclusion.md) |
| **audit** | 审计日志查询 / 导出（PG / MySQL / Local + blake2b 链 + scope 可见性） | ✅ | [features/audit_conclusion.md](features/audit_conclusion.md) |
| **agents** | 智能体 · 分身（本包占位；能力在主仓 avatar/agents） | ❌ stub | [features/agents_conclusion.md](features/agents_conclusion.md) |
| **knowledge-base** | 知识库（本包占位；能力在主仓 knowledge） | ❌ stub | [features/knowledge-base_conclusion.md](features/knowledge-base_conclusion.md) |
| **model-service** | 模型服务（本包占位；实现散落 admin-console + iam-core） | ❌ stub | [features/model-service_conclusion.md](features/model-service_conclusion.md) |
| **settings** | 设置面板（本包占位；真实 UI 在 web-portal SettingsPanel） | ❌ stub | [features/settings_conclusion.md](features/settings_conclusion.md) |
| **tools-mcp** | 工具 · MCP（本包占位；真实在 gateway mcphost/mcp + admin UI） | ❌ stub | [features/tools-mcp_conclusion.md](features/tools-mcp_conclusion.md) |

---

## packages/ 概览（技术零件）

### 基础设施层

| 子模块 | 一句话定位 | 结论文档 |
|---|---|---|
| **db-schema** | Drizzle 双方言 schema —— PG/MySQL 各 23 域文件；PG journal ~29 次迁移；MySQL baseline 建全量表 | [packages/db-schema_conclusion.md](packages/db-schema_conclusion.md) |
| **auth** | 认证抽象 —— password / OIDC（discovery cache）/ SAML 2.0 SP / JWT RS256 / 信封加密 / Next.js 中间件（无 LDAP/Supabase 实现） | [packages/auth_conclusion.md](packages/auth_conclusion.md) |
| **iam-core** | IAM 数据访问层 —— 双方言 repos（users/depts/roles/SSO/PAT/session-grant/compliance/quota）+ provider-key 加密 + legacy 迁移 | [packages/iam-core_conclusion.md](packages/iam-core_conclusion.md) |
| **config** | 配置加载器（brand / feature flags YAML → Zod；apps 多半只消费默认常量）| [packages/config_conclusion.md](packages/config_conclusion.md) |

### 协议与契约

| 子模块 | 一句话定位 | 结论文档 |
|---|---|---|
| **core-api** | 类型契约（chat / audit / 错误码 / session-title 启发式）| [packages/core-api_conclusion.md](packages/core-api_conclusion.md) |
| **policy-engine** | 规则引擎（**Go 实现**，gateway `go.mod replace` 嵌入；TS 仅 stub；kind=keyword/regex/pii/field）| [packages/policy-engine_conclusion.md](packages/policy-engine_conclusion.md) |

### 客户端 SDK

| 子模块 | 一句话定位 | 结论文档 |
|---|---|---|
| **sdk-ts** | TS 客户端 SDK —— `ChatClient` + Mock/HTTP + SSE 流式 / 多模态附件 / 中断语义（web-portal 已消费） | [packages/sdk-ts_conclusion.md](packages/sdk-ts_conclusion.md) |
| **sdk-py** | Python SDK（占位，仅 `__version__`）| [packages/sdk-py_conclusion.md](packages/sdk-py_conclusion.md) |

### UI 与品牌

| 子模块 | 一句话定位 | 结论文档 |
|---|---|---|
| **ui** | shadcn 设计系统 —— 24 个 Radix 原语 + 布局 + 数据表 + 图表 + Machi 品牌组件 | [packages/ui_conclusion.md](packages/ui_conclusion.md) |
| **branding** | 白标（部分：`getEnterpriseVersionLabel`；视觉主体在 ui）| [packages/branding_conclusion.md](packages/branding_conclusion.md) |
| **telemetry** | 埋点 / 审计上报（占位）| [packages/telemetry_conclusion.md](packages/telemetry_conclusion.md) |

---

## plugins/ + deploy/ 概览

| 维度 | 一句话定位 | 结论文档 |
|---|---|---|
| **plugins/** | 10 个运行时插件：3 个 PII/合规规则包 + 4 个 wasm 网关插件 + 2 个工具 CLI + 1 个主题（合订一篇）| [plugins/plugins_overview_conclusion.md](plugins/plugins_overview_conclusion.md) |
| **deploy/** | 部署资产：Docker Compose dev/prod + K8s deployment/service/hpa + Nginx 公网入口 + 公私混合部署 | [deploy/deploy_conclusion.md](deploy/deploy_conclusion.md) |

---

## 端到端数据流（架构速览）

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 用户/员工            apps/web-portal (3000)                             │
│                          │                                                │
│                          ├── /api/chat/sessions  → packages/auth + iam-core │
│                          │       (PG: chat_sessions / chat_messages)        │
│                          │                                                  │
│                          └── /api/chat/completions ───────┐                  │
│                                                            ▼                  │
│ 管理员            apps/admin-console (3001)         apps/gateway (8088)      │
│                          │                                ▲ │                │
│                          │ 写 PG 配置                     │ │ /v1/chat/comp.│
│                          ▼                                │ │                │
│                  PG enterprise_runtime_*                  │ ▼                │
│                  policy_rule_packs / rules                │ 上游 LLM         │
│                          │                                │ (OpenAI/Claude/  │
│                          │ /api/internal/*-snapshot       │  Gemini/Azure/   │
│                          └────────► gateway 5-10s 轮询────┘  Bedrock/...)    │
│                                                                              │
│ 桌面端 Machi  ──IPC──► apps/edge-agent (127.0.0.1:7420)                      │
│                              │                                               │
│                              │ POST /v1/chat/completions  (X-AgenticX-Trace) │
│                              └─────────────► gateway                          │
│                              │                                               │
│                              │ POST /api/agent-traces/ingest                 │
│                              └─────────────► admin-console (写 PG)            │
└──────────────────────────────────────────────────────────────────────────┘
```

**关键设计**：
- **admin-console 是控制平面**：所有运行时配置（providers / policy / pricing / budget / channels / PAT 吊销 / compliance）通过 `/api/internal/*` 端点暴露
- **gateway 是数据平面**：5-10s 轮询 admin internal endpoints **热加载所有配置**（无需重启）
- **PG 是真理之源**：所有持久化都在 `packages/db-schema` 定义的 23 张表里
- **优雅降级**：网关每个外部依赖都可缺（无 PG → file sink；无 Redis → 内存；无 key → mock；无 admin URL → 本地 JSON）
- **跨语言契约对齐**：`session-title` 启发式、错误码、审计事件结构在 TS / Go / Python 三端保持一致

---

## 这份索引怎么用

1. **新 session 起步**：读本文件，获取模块全貌和定位
2. **定位目标模块**：根据任务找到对应 conclusion 链接
3. **查看文件级细节**：每个 conclusion 都包含"目录结构 + 核心组件 + 关键导出 + 与其他模块的关系"
4. **占位模块（stub）**：可以放心跳过——它们当前只有 `featureName` 常量，实际能力在别处（结论文档会说明实际归属）

---

## 维护约定

- 代码大改后：更新对应模块的 conclusion；保持"目录结构 + 关键导出 + 与其他模块关系"三块准确
- 新增模块：新建 `conclusions/<dimension>/<module>_conclusion.md` 并在本 README 表格添加一行
- 跨模块的重大架构变更：更新本 README 的"端到端数据流"图

> 与主仓 [`AgenticX/conclusions/README.md`](../../conclusions/README.md) 风格保持一致，便于团队成员在两个仓库间无缝切换。
