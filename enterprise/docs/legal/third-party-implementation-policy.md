# Enterprise Gateway 第三方实现与合规说明（Third-Party Implementation Policy）

- **文档版本**: v1.0
- **生效日期**: 2026-05-22
- **维护**: Damon Li · `enterprise/apps/gateway` Owner
- **适用范围**: `enterprise/apps/gateway`、`enterprise/packages/policy-engine`、`enterprise/apps/admin-console` 与 `enterprise/apps/web-portal` 中与 AI 网关相关的子模块
- **文档性质**: **内部工程与合规自律说明**；不构成对任何第三方的法律意见，对外承诺前请由法务复核

> 本文档说明：AgenticX Enterprise Gateway 的实现来源、参考边界、许可证义务与对外表述规范，确保「学其能力、不抄其代码、不触其许可」。

---

## 1. 立项原则

Enterprise Gateway 与若干头部开源 AI 网关在产品形态上存在功能交集。为避免任何法律与声誉风险，本项目长期坚持以下三条立项原则：

1. **干净室实现（Clean-Room Implementation）**：所有协议适配、Channel 调度、缓存、计费、审计、MCP 托管等子系统，均以 **官方公开 API 规范 / 协议文档 / 行业事实标准** 为唯一实现依据；不参照、不复制、不移植第三方实现源码。
2. **架构与数据模型独立**：身份（JWT 四主体 / RS256 / RBAC scopes）、审计（Blake2b 哈希链 + PG `gateway_audit_events` + JSONL 兜底）、策略（三通道评估 + 规则中心 PG 化）、计量（Token + 月配额，**不引入** 整数币 Quota 形态）四条护城河独立设计，与任何对照对象的数据库 schema 不兼容。
3. **依赖纯净（License-Clean Dependencies）**：`go.mod` / `package.json` 仅引入与本项目主许可证兼容的第三方依赖；不引入、不打包、不分发任何受 AGPL 或类似 copyleft 影响、且对我们的发行方式产生外溢义务的组件。

---

## 2. 实现依据（Sources of Truth）

| 子系统 | **唯一**实现依据 | 严禁参照 |
|---|---|---|
| OpenAI 兼容入站 / 出站 | [OpenAI Platform API Reference](https://platform.openai.com/docs/api-reference) | 任何第三方 OpenAI 兼容网关的源码 |
| Claude Messages 入站 / 出站 | [Anthropic Messages API](https://docs.anthropic.com/en/api/messages)、[Prompt Caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) | 同上 |
| Google Gemini 入站 / 出站 | [Google AI API Reference](https://ai.google.dev/api/rest) | 同上 |
| OpenAI Responses 入站 | [Responses API Reference](https://platform.openai.com/docs/api-reference/responses) | 同上 |
| MCP Server 托管 / OpenAPI→MCP | [Model Context Protocol Specification](https://modelcontextprotocol.io)、[OpenAPI 3.x 规范](https://spec.openapis.org/oas/v3.1.0) | 同上 |
| Wasm 插件 ABI | [proxy-wasm ABI 公开规范](https://github.com/proxy-wasm/spec)（截至本文档发布日期的公开版本） | 任何具体实现的 SDK 源码 |
| Channel 加权 / 重试 / 预扣结算 | 标准算法（加权随机抽样、token bucket、reservation/settlement 双段记账） | 任何第三方网关的具体实现 |
| 语义缓存 | 向量近邻 + canonical key（项目自定义），并引用我们已有的 KB 向量后端能力 | 任何第三方网关缓存插件 |
| 审计哈希链 | Blake2b（项目早期已自研）；记录格式由本仓 `audit/writer.go` 定义 | — |

> **行为参考资料**：本仓 `docs/thrdparty/` 与 `.cursor/plans/` 内的调研文档（如 `newapi-chat接口.md`、`newapi-补全接口.md`）仅用于**描述行为与边界**（"上游做了什么、返回什么"），不得作为代码移植的参考文本。

---

## 3. 调研、阅读与实现的纪律

为避免在调研阶段无意间接触到他方源码、再无意识地写进我们的实现，确立以下纪律：

### 3.1 「调研」与「实现」分离

- **调研阅读**第三方仓库 README、文档、issue、技术博客 → **允许**。
- **阅读第三方仓库源码**（包括 controller / relay / adaptor / web 任何目录的具体实现）→ **不写入本仓 plan、design、issue、commit、PR、注释、文档、测试夹具或代码**。
- **同一段时间** 同一开发者**不得同时**做"阅读第三方源码"与"撰写本仓对应模块代码"两件事；如确需深读，建议**分工**：A 负责阅读公开 spec 写需求，B 负责按需求实现。

### 3.2 严禁动作清单

实现 Enterprise Gateway 任何模块时，下列动作明确禁止：

- ❌ 直接 / 间接复制第三方源码、注释、测试夹具、错误码字符串、错误文案、UI 文案。
- ❌ 把第三方文件改名、调换函数顺序、改变量名后纳入本仓（即"换皮移植"）。
- ❌ 把第三方仓库作为本仓的 git submodule、go module、npm dependency、Docker base image 引入。
- ❌ 把第三方仓库的二进制（含 fork 后编译产物）打包到本仓发行物（DMG / EXE / Docker / Helm）中。
- ❌ 复制第三方仓库的 `manifest.yaml` / `model_pricing.json` 等数据文件原文；自建配置表时即使采用相同的命名约定（如 `gpt-5-high`），也须以**上游官方文档**为唯一来源。
- ❌ 在内部沟通或对外材料中称本项目为「new-api 企业版」「Higress 国产替代」「基于 new-api/Higress 二开」等表述。

### 3.3 允许动作清单

- ✅ 阅读对照对象的官方 README / 项目主页 / 文档站，了解能力清单与设计取向。
- ✅ 在 plan / docs 中**指名**第三方项目作为"调研对象 / 行业对照"，并附其官方仓库链接。
- ✅ 实现与第三方项目**架构层面相似但代码独立**的功能（例如 Channel 加权 + 失败重试是行业通用模式，独立实现不构成抄袭）。
- ✅ 引用上游模型厂商（OpenAI / Anthropic / Google / Mistral 等）公开的 model 命名约定、API 字段、错误码、协议事件流。

---

## 4. 许可证与依赖治理

### 4.1 主仓与子项目许可证

| 路径 | 主许可证 | 备注 |
|---|---|---|
| `AgenticX/` 根（Python 框架） | Apache-2.0 | 见根 `LICENSE` |
| `enterprise/` | Apache-2.0（与根一致，除非子目录明示） | — |
| `enterprise/customers/<name>/` | 客户私有（不开源） | 客户专属定制层 |

### 4.2 依赖白名单与黑名单

**白名单（已使用且兼容）**：Apache-2.0、MIT、BSD-2/3-Clause、ISC、MPL-2.0（限文件级别 copyleft，可控）、Go 标准库、CNCF 项目（多数 Apache-2.0）。

**审慎使用（需 case-by-case 评估）**：LGPL（链接形式而非静态嵌入更稳）、MPL（隔离文件即可）。

**禁止纳入网关核心进程**：

- **AGPL-3.0**（如 `new-api`、`one-api` 后期版本 / 部分模型推理项目）—— 一旦作为依赖或衍生作品并对外提供网络服务，可能触发"对外公开修改版源码"的义务，与企业私有化交付模式直接冲突。
- **SSPL / BUSL / Elastic License v2 / Commons Clause** 等**非 OSI 标准**或**商业附加**条款，禁止纳入主进程或客户分发物。

### 4.3 当前 `enterprise/apps/gateway/go.mod` 状态（核对基线）

截至本文档发布日期，gateway 模块的直接依赖仅含：

- `github.com/go-chi/chi/v5`（MIT）
- `github.com/golang-jwt/jwt/v5`（MIT）
- `github.com/jackc/pgx/v5` / `github.com/lib/pq`（MIT）
- `golang.org/x/crypto` / `x/sync` / `x/sys` / `x/text`（BSD-3-Clause）
- `gopkg.in/yaml.v3`（MIT + Apache-2.0 双协议）
- `github.com/agenticx/enterprise/policy-engine`（仓内 replace）

**未引入** new-api / one-api / higress / openai-relay / any-api 等 AGPL 或语义近邻的第三方网关代码库。本基线由 CI 持续校验（见 §6.2）。

### 4.4 NOTICE 与 LICENSE 留存

- 任何**新增**纳入主进程或分发物的第三方组件，必须在 `enterprise/NOTICE` 中追加声明，且保留其原始 `LICENSE` 文本。
- 对外二进制（DMG / EXE / Docker / Helm chart）的"关于 / About"页面或 `--license` 子命令须能列出第三方组件清单。

---

## 5. 子模块特别说明（按 Plan 对照）

> 以下条款与 `.cursor/plans/2026-05-21-enterprise-gateway-*.plan.md` 系列同源、互锁。

### 5.1 Channel + Relay + Adaptor（已落地）

- 已落地实现于 `enterprise/apps/gateway/internal/{channel,relay,adaptor,billing}/`；
- 全部实现以 OpenAI Chat Completions / Embeddings 协议公开文档为依据；
- 流式 SSE 解析与 idle timeout、buffer 上限为自研机制，未参考第三方网关的具体实现代码。

### 5.2 Key Pool + 多维配额 + PAT（进行中）

- PAT 实现：前缀 `agx-pat-` + SHA-256 / Argon2id hash 落库，**与任何第三方 token 体系数据库 schema 不兼容**；
- TPM/RPM/并发限流采用标准 token bucket / 滑动窗口；
- 配额数据表 `quota_rules` 由本仓 PG 迁移定义，不复用 One API/new-api 的 `Token`/`Quota` 表结构。

### 5.3 MCP Server 托管 + OpenAPI→MCP（规划中，Plan A）

- 实现唯一依据：[MCP 官方规范](https://modelcontextprotocol.io)（2025-03-26 / 2025-06-18 版本）+ OpenAPI 3.x 规范；
- streamable-http / SSE 双 transport 为原生 Go handler 实现，**不引用** Higress Wasm-based MCP plugin 源码；
- 工具调用审计沿用本仓 Blake2b 链。

### 5.4 多协议入站 + 跨格式转换（规划中，Plan B）

- 各协议入站归一化以官方 SDK（`@anthropic-ai/sdk`、`@google/genai`、`openai`）的 wire format 测试为唯一精度参考；
- Reasoning Effort 模型后缀派生（如 `gpt-5-high`）由本仓配置表自建，命名约定来自上游官方文档，不复制任何第三方 model_pricing 数据文件。

### 5.5 AI 缓存 + 计费 + 可观测（规划中，Plan C）

- L1 / L2 缓存为本仓 `cache/` 包独立实现；语义缓存复用项目已有 KB 向量栈（Chroma / Qdrant 等），无新外部依赖；
- usage 归一表按各上游厂商**官方** API 字段定义（如 OpenAI `prompt_tokens_details.cached_tokens`、Anthropic `cache_creation_input_tokens` / `cache_read_input_tokens`）。

### 5.6 Wasm 插件运行时（规划中，Plan D）

- 运行时选型为 [wazero](https://wazero.io/)（Apache-2.0，纯 Go 无 CGO），保留其 LICENSE 与 NOTICE；
- ABI 子集按 [proxy-wasm spec](https://github.com/proxy-wasm/spec) 公开规范自研，不复制任何 wasm-go SDK 实现源码；
- 内置示范插件（keyword-rewrite / bearer-extractor / audit-tagger / waf-basic）为本仓原创代码。

---

## 6. 验证与执行机制

### 6.1 PR Checklist

每个涉及 `enterprise/apps/gateway/` 与相关模块的 PR，作者须在 PR 描述中自检（template 将在工程化时落地）：

- [ ] 本 PR 未引入 AGPL / SSPL / BUSL 等限制性许可证的依赖
- [ ] 本 PR 未复制、移植任何第三方仓库的源码、注释、测试夹具
- [ ] 本 PR 涉及的协议适配、算法实现仅参考了 §2 表格中的"实现依据"
- [ ] 若新增第三方依赖，已更新 `enterprise/NOTICE` 与依赖白名单评估

### 6.2 CI 自动校验

在 `enterprise` CI 中维护以下硬护栏（任一失败即阻断合入）：

1. **路径与字符串扫描**：禁止 `enterprise/apps/gateway/**`、`enterprise/packages/policy-engine/**` 出现以下任意 token（除 `docs/`、`.cursor/plans/` 等明示的调研说明上下文外）：
   - `QuantumNous`、`new-api`、`newapi.pro`
   - `songquanpeng`、`one-api`
   - `higress-group`、`higress.cn`
   - `calciumion`
2. **go.mod 依赖白名单**：禁止 `enterprise/apps/gateway/go.mod` 出现 §4.2 黑名单条目。
3. **NOTICE 完整性**：若 `go.mod` 或 `package.json` 新增 third-party 直接依赖，CI 检测 `enterprise/NOTICE` 是否同步更新。
4. **License SBOM**：每次发布前生成 SBOM（如使用 `syft` / `go-licenses`），归档到 `enterprise/docs/legal/sbom/<version>.json`。

### 6.3 异常处理

- 误引入第三方代码 → 立即在该 PR 撤回（不仅 revert，亦从 git 历史保留为"已撤"标记，必要时走 `git filter-repo`）；
- 误依赖 AGPL 库 → 优先替换为兼容许可证依赖；无替代时升级至独立子进程通信 + 主进程内不动态链接，并与法务沟通确认。

---

## 7. 对外表述规范（Sales / Marketing / Docs）

### 7.1 推荐表述

- "AgenticX Enterprise Gateway——面向 2B 私有化的企业级 AI 网关"
- "兼容 OpenAI / Anthropic / Google Gemini 等主流模型公开 API，支持多协议入站与跨格式转换"
- "原生支持 MCP Server 托管，与 Machi Desktop 端侧形成端云闭环"
- "依据 OpenAI / Anthropic / Google / MCP 等公开协议规范自研实现"
- "与某些开源网关（如 X / Y）在能力维度上对标，但实现完全独立"

### 7.2 禁止表述

- ❌ "基于 new-api / Higress 二开 / fork / 修改而来"
- ❌ "new-api 企业版 / Higress 国产替代 / Higress 增强版"
- ❌ "复用了 new-api 的协议适配代码 / Higress 的 Wasm 实现"
- ❌ 任何会让客户、记者、合作伙伴误认为本项目是某第三方项目"加壳 / 加皮 / 中转打包"产物的措辞

### 7.3 客户合同条款建议

- 客户合同中关于"开源依赖"的承诺，可引述本文档 §4.2 与 §4.3；
- 客户若额外要求"无 AGPL 依赖书面承诺"，由本文档 + 当期 SBOM 共同支撑；
- 涉及客户专属代码（`enterprise/customers/<name>/`）的二开许可，单独在客户合同中约定，不在本文档范围内。

---

## 8. 文档生命周期

- **修订主体**：Damon Li（Gateway Owner）。
- **修订触发**：新增主进程依赖、新增子 plan、第三方仓库切换许可证、客户合同对依赖结构提出新要求时。
- **变更记录**：每次修订在 §9 附变更日志，并在对应 commit 中以 `docs(legal): ...` 前缀标注。
- **同步对象**：销售 / 售前 / 法务（如有）须在主要修订时同步阅读。

---

## 9. 变更日志

| 日期 | 修订点 | 备注 |
|---|---|---|
| 2026-05-22 | v1.0 初稿落盘 | 配套 `2026-05-21-enterprise-gateway-roadmap.plan.md` 系列四个子 plan；明确 §6.2 CI 护栏待工程化 |

---

## 10. 法律免责声明

本文档为 AgenticX 内部工程与合规自律说明，**不构成法律意见**。本文档对许可证义务、版权风险的判断仅供项目内部纪律参考；任何对外承诺、客户合同条款、潜在争议处理，须由具备执业资格的法律顾问审核后定稿。

---

**Made-with: Damon Li**
