# AgenticX Enterprise

> 企业级大模型应用一体化平台 —— 前台 · 后台 · AI 网关三端联动

## 架构

```
enterprise/
├── apps/                      🎯 可部署整机
│   ├── web-portal/            #  员工前台（Next.js）
│   ├── admin-console/         #  管理后台（Next.js）
│   └── gateway/               #  AI 网关（Go，基于 APIPark）
│
├── features/                  🧩 业务功能域（客户挪用主单元）
│   ├── iam/                   身份 · 租户 · 部门 · 角色
│   ├── chat/                  对话工作区
│   ├── model-service/         模型服务管理
│   ├── knowledge-base/        知识库
│   ├── tools-mcp/             工具 · MCP
│   ├── agents/                智能体 · 分身
│   ├── metering/              计量 · 四维查询
│   ├── audit/                 审计日志
│   ├── policy/                敏感规则配置
│   └── settings/              设置面板
│
├── packages/                  📦 技术零件
│   ├── ui/                    shadcn 组件 + 主题
│   ├── branding/              白标组件
│   ├── auth/                  认证抽象（Supabase/LDAP/SSO/账密）
│   ├── db-schema/             Drizzle schema（多租户）
│   ├── core-api/              类型契约
│   ├── policy-engine/         JS 端规则引擎
│   ├── sdk-ts/                TS 客户端 SDK
│   ├── sdk-py/                Python SDK
│   ├── config/                配置加载器
│   └── telemetry/             埋点 · 审计上报
│
├── plugins/                   🔌 运行时插件
│   ├── moderation-pii-baseline/
│   ├── moderation-finance/
│   ├── moderation-medical/
│   ├── tool-watermark/
│   ├── tool-doc-review/
│   └── theme-default/
│
├── deploy/
│   ├── docker-compose/
│   └── helm/
│
└── docs/
```

## 快速开始

```bash
# 在 enterprise/ 根目录
pnpm install
pnpm dev      # 并行启动所有 apps
pnpm build    # 构建所有包
pnpm typecheck
```

## 产品定位

- **护城河**：桌面端（Machi）+ 后台管理 + AI 网关三端联动
- **差异化**：支持"云端统一管控 + 端侧安全闭环"混合模式
- **商业模式**：开源主干 + 客户专属定制（定制代码在独立私有仓 `customers/*`）

## 给客户项目挪用 enterprise 模块

见 `docs/guides/2026-04-21-enterprise-customers-collaboration.md`

## 相关文档

- 产品架构：`../docs/plans/2026-04-21-agenticx-enterprise-architecture.md`
- 插件协议：`./docs/plugin-protocol/`
- API 契约：`./docs/api/`
- 部署手册：`./docs/deployment/`

## License

Apache 2.0（与 AgenticX 主仓一致）
