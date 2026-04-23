# ADR-0001：开源基座选型与自研策略

> **状态**：Accepted
> **日期**：2026-04-21
> **决策者**：Damon Li
> **范围**：AgenticX Enterprise（前台 / 后台 / AI 网关 / 端侧 sidecar）

---

## 1. 背景

AgenticX Enterprise 作为通用企业产品，需要就「基础能力的获取方式」做出决策：
- 是否基于现有开源项目 **fork + 二次开发**？
- 还是 **参考架构、自研实现**？

候选开源项目（已在本地仓 `客户 A/thirdparty/` 做过源码核查）：

| 项目 | 定位 | License | 语言 | 可参考能力 |
|---|---|---|---|---|
| **APIPark** | AI 网关 + 开发者门户 | Apache-2.0 | Go + React | 多模型路由、认证、策略链、审计日志 |
| **Langfuse** | LLM 可观测性 | MIT（ee/ 为独立 License）| TS + Prisma | Trace/Observation 数据模型、成本计算 |
| **Dify** | LLM 应用开发平台 | Dify Open Source License（基于 Apache 2.0 + 附加条件）| TS + Python | 工作流编排、Agent、RAG、插件体系 |
| **LiteLLM** | LLM Proxy | MIT | Python | 统一 Provider 抽象、Token 计量 |
| **Kong / Higress** | 通用 API 网关 | Apache-2.0 | Lua / Go | 插件链、限流、熔断 |

---

## 2. 决策

**不 fork 任何开源项目代码。自研主干，有限借鉴开源项目的架构思想，通过标准协议对接可选后端。**

具体策略：

| 组件 | 策略 | 说明 |
|---|---|---|
| `apps/gateway`（AI 网关）| **自研（Go）**。**借鉴** APIPark / Higress 的插件链架构；**不**嵌入其源代码 | 安全可控 + 代码风格统一 |
| `features/audit`（审计层）| **自研**。通过 **OpenTelemetry 标准协议** 可选对接 Langfuse 作为可视化后端 | 不强依赖，客户可选 |
| `features/*`（业务模块）| **自研 TypeScript**。延续 AgenticX-Website 同栈（Next.js + shadcn）| 与 Machi 桌面端共享 TypeScript 生态 |
| `apps/edge-agent`（端侧 sidecar）| **自研 Go**。独立二进制，最小权限 | 私有能力，不需要生态 |
| `plugins/*`（插件包）| **自研协议与官方实现**。第三方插件走标准 manifest 协议 | 开放生态 |

---

## 3. 为什么不 fork（关键理由）

### 3.1 安全可控性

Fork 意味着：
- **继承对方全部 CVE 历史**：一旦被 fork 的项目爆出漏洞，我们必须紧跟 upstream patch
- **供应链不可控**：上游依赖升级节奏、版本兼容性不受控
- **审计面积巨大**：客户做安全审计时需审阅 fork 进来的全部代码

自研时：
- 只实现我们需要的 20% 能力，代码量可控
- 依赖锁定到最新安全版本，主动防御
- SBOM 清晰、SCA 扫描可管理

### 3.2 架构可演进

Fork 代码的缺点：
- **APIPark** 的 i18n、前端栈（React 18 + Ant Design）、数据模型等与我们不匹配
- **Langfuse** 深度绑定 Prisma + ClickHouse schema，迁移到我们的 Drizzle + 多租户模型成本高
- **Dify** 的应用模型（App / Workflow / Dataset）与我们的租户-组织-员工模型不同

自研时：
- 从 day 1 按多租户设计数据模型
- 前后端一致的 TypeScript 类型流（`packages/core-api`）
- 按 AgenticX 自己的 UX 语言（参考 Cherry Studio / Cursor 设定）塑造交互

### 3.3 License 清洁与商业灵活度

- **Apache-2.0 兼容**：fork Apache 项目是 OK 的，但需要保留 NOTICE、版权声明
- **Dify Open Source License** 有额外商业条款（比如"不能用作 multi-tenant SaaS 对外服务"），与我们的 SaaS 路线冲突
- 自研意味着我们对 License 选择有完全自主权（目前选 Apache-2.0）

### 3.4 代码质量

坦诚说，三个参考项目都有我们不想继承的债务：
- APIPark：Chinese-first 注释/命名与英文混杂，测试覆盖不稳定
- Langfuse：Next.js + Prisma + ClickHouse 技术栈过重，单应用职责过多
- Dify：快速演进带来的频繁 breaking change，自研模块难以随版本升级

自研让我们在 day 1 就建立**高于这些项目平均水平**的工程基线：
- 统一 TypeScript 类型端到端
- 所有 API 带 OpenAPI schema + 自动生成 SDK
- 测试覆盖率门槛（lines ≥ 70%，核心安全模块 ≥ 90%）
- 结构化日志 + trace id 贯穿全链

---

## 4. 什么叫「借鉴架构」（允许）

以下行为 ✅ 允许：
- 阅读 APIPark 的 `module/strategy/driver/data-masking/` 理解脱敏规则引擎设计思路
- 参考 Langfuse 的 `packages/shared/prisma/schema.prisma` 理解 Trace/Observation 数据模型
- 借鉴 Dify 的 `core/moderation/` 分层拦截架构
- 参考 LiteLLM 的 Provider 抽象接口命名
- 研究 APIPark `plugins/core/mcp.go` 的 SSE 通道实现思路

但以下 ❌ **严格禁止**：
- 任何形式的代码复制粘贴（哪怕只是一个函数）
- 逆向 + 重命名后复用对方代码
- 直接 import / depend 对方 npm / pypi / go module
- 复用对方的 schema 字段命名（避免数据模型耦合）

---

## 5. 可选后端集成（标准协议）

我们通过**标准协议**让客户可以选择对接这些开源项目作为**后端插件**（非强依赖）：

| 协议 | 可对接 | 场景 |
|---|---|---|
| **OpenAI Compatible API** | 所有主流 LLM 网关 | 作为下游 Provider |
| **OpenTelemetry (OTLP)** | Langfuse / Jaeger / Datadog / 自建 | 审计追踪 |
| **OpenAI Embedding API** | 各种向量库 | RAG 后端 |
| **MCP (Model Context Protocol)** | 所有 MCP Server | 工具扩展 |
| **S3 API** | MinIO / Ceph / 阿里云 OSS | 对象存储 |
| **PostgreSQL Wire Protocol** | PG / CockroachDB / Supabase | 主库 |

**关键原则**：通过协议对接 ≠ 嵌入代码。客户私有化时可以不装 Langfuse，改用自带的审计查询。

---

## 6. 参考开源项目的受控使用

允许的受控使用（需 PR review + ADR 记录）：

1. **作为二进制依赖**：客户环境运行 Langfuse 容器镜像，我们通过 HTTP API 对接（不依赖其源码）
2. **作为规范参考**：实现 OpenAI 兼容协议时参考 OpenAI 官方 spec
3. **作为研究素材**：分析其数据模型设计，但写出来的 schema 必须是我方原创

不允许的使用：

- ❌ `pip install apipark-xxx` 或 `npm install @langfuse/core`（业务模块不依赖这些包）
- ❌ 把 APIPark 的 Go 源文件放到 `apps/gateway/` 下（哪怕加了注释声明来源）
- ❌ 拷贝 Langfuse 的 Prisma schema 改成我们的（需要从头设计）

---

## 7. License 与合规

- **本产品 License**：Apache-2.0（与 AgenticX 主仓一致）
- **NOTICE 文件**：如有合规必要的第三方依赖，需在 `NOTICE` 里列出（Apache-2.0 条款 4d 要求）
- **依赖扫描**：CI 中加入 `pnpm audit` / `go mod audit` / `govulncheck`
- **SBOM**：Release 时生成 CycloneDX / SPDX SBOM
- **开源合规复核**：每个 release 前跑一次 FOSSA / Syft + Grype

---

## 8. 决策后果

### 正向
- 代码质量、安全性、可控性从 day 1 达标
- 客户审计友好：代码是我们自己写的，敢直面所有安全问题
- 商业灵活：License 自主、可做闭源 EE、可做 SaaS
- 产品演进节奏不受 upstream 牵制

### 风险
- **开发周期长**：自研比 fork 慢，MVP 需要 1.5-2 倍时间
- **功能覆盖慢**：无法在短期内达到 APIPark / Langfuse 全部 feature 集合
- **迭代压力**：需要持续投入维护基础能力（认证 / 审计 / 插件系统）

### 缓解
- 借鉴架构**加速设计期**（不需要从 0 想架构）
- MVP 聚焦"首个客户项目能验收"需要的最小集（见架构文档 §11）
- 其余能力按客户实际需求**逐步回流**到 enterprise 主干

---

## 9. 相关决策

- ADR-0002（待写）：Monorepo 工具链选型（pnpm workspace + turbo）
- ADR-0003（待写）：主库选型（PostgreSQL + Drizzle ORM）
- ADR-0004（待写）：审计存储选型（ClickHouse vs PG 分区表）

---

## 10. 参考

- [Apache License 2.0 条款](https://www.apache.org/licenses/LICENSE-2.0)
- [Dify Open Source License](https://github.com/langgenius/dify/blob/main/LICENSE)
- [OpenTelemetry Specification](https://opentelemetry.io/docs/specs/)
- [CycloneDX SBOM Standard](https://cyclonedx.org/)
- 客户 A招标技术规范书 V20260422
- `/docs/plans/2026-04-21-agenticx-enterprise-architecture.md`
