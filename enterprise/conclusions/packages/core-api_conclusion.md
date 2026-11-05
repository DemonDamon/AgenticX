# @agenticx/core-api 模块总结

> 结论生成时间：2026-11-14（基于 commit cebdabd5 核验重写）

## 模块概述

`@agenticx/core-api` 以 **TypeScript 类型与跨端契约** 为主：Enterprise gateway、SDK、apps 共享 chat、audit、错误码、session-title 等定义，并与 Go 网关字段对齐。自 `managed-agents` 起，包内另含与主仓 Python（`agenticx/managed/manifest.py`）规则一致的 **Manifest / 客户端事件批校验** 与 canonical JSON + `sha256` 哈希，供 Managed Agents 与评测 rubric 在 TS 侧复用同一套约束。

## 目录结构

```
packages/core-api/
└── src/
    ├── index.ts            # barrel：chat / session-title / errors / audit / trace / managed-agents
    ├── chat.ts             # ChatMessage、ChatSession、ChatRequest、ChatResponse、ChatChunk、ChatError、ChatMessageRole、ToolCallSummary、ChatMessageAttachment、IsoDateTime、EntityId、ApiEnvelope
    ├── audit.ts            # AuditEvent、AuditEventType、AuditRoute、AuditClientType、AuditPolicySeverity/Action、AuditDigest、AuditPolicyHit、AuditQueryInput、AuditQueryResult
    ├── errors.ts           # BUSINESS_ERROR_CODES、POLICY_ERROR_CODES、isPolicyErrorCode、toComplianceMessage
    ├── session-title.ts    # sessionTitleNeedsAutoFill、buildAutoTitleFromFirstUserMessage
    ├── trace.ts            # trace-id 契约
    ├── managed-agents.ts   # agx-ma/2026-11 协议类型、常量、validateManifest / validateClientEventBatch 等
    ├── managed-evals.ts    # Eval rubric 类型与 validateRubric（子路径 `@agenticx/core-api/managed-evals`）
    └── __tests__/          # vitest：manifest / event / rubric fixture 与 Python 哈希对齐用例
```

## 关键导出

### chat.ts
`IsoDateTime`、`EntityId`、`ChatMessageRole`（`system | user | assistant | tool`）、`ToolCallSummary`（status `queued | running | success | failed`）、`ChatMessageAttachment`（name/mime_type/size/data_url）、`ChatMessage`（可选 `control: "continue_report"` 续写触发——非用户提问，transcript 隐藏且送模前丢弃；可选 `interruption`：`reason cancelled | failed | disconnected` + `contentLength` 区分模型真实输出与系统追加提示）、`DeepResearchEventPayload` 含 `report_resume_available`（报告提前结束时下发，带 `runId`/`nextRunId`/`completedSections`/`totalSections`）、`ChatSession`、`ChatRequest`、`ChatError`（`code` 注释 4xxxx 业务 / 9xxxx 策略）、`ChatChunk`（流式增量，含 delta/reasoning/tool_call/done/error）、`ChatResponse`（含 `usage` 与 `route: local | private-cloud | third-party`）、`ApiEnvelope<T>`

### audit.ts
- `AuditEventType` = `chat_call | tool_call | mcp_tool_call | desktop_agent_action | policy_hit | auth_login | auth_logout | audit_export`（**含 `mcp_tool_call` 与 Desktop 侧 `desktop_agent_action`**）
- `AuditRoute` = `local | private-cloud | third-party`
- `AuditClientType` = `web-portal | desktop | edge-agent | admin-console`
- `AuditPolicySeverity` = `low | medium | high | critical`；`AuditPolicyAction` = `allow | redact | block`
- `AuditDigest`（prompt_hash / response_hash / summary）、`AuditPolicyHit`（policy_id / severity / action / matched_rule）
- `AuditEvent`：字段丰富，含 token/cost/latency、`digest`、`tools_called`、`policies_hit`、MCP 侧（`mcp_server`/`mcp_tool_name`/`mcp_input_hash`/`mcp_output_hash`/`mcp_status`）、**哈希链**（`prev_checksum`/`checksum`/`checksum_version`/`signature`）、**跨境**（`src_region`/`dst_region`/`cross_border`/`residency_rule`）
- `AuditQueryInput` / `AuditQueryResult`（查询侧可选 `event_type` 按事件类型过滤；结果含 `chain_valid`/`chain_error_at`/`chain_error_reason`/`chain_verification`/`chain_verified_count`/`chain_legacy_unverified`）

### errors.ts
- `BUSINESS_ERROR_CODES`：`40000 / 40100 / 40300 / 40400 / 42900 / 50000`
- `POLICY_ERROR_CODES`：`90001（REQUEST_BLOCKED）/ 90002（RESPONSE_BLOCKED）`
- `isPolicyErrorCode`（`/^9\d{4}$/`）
- `toComplianceMessage`：中文 compliance 消息映射；额外处理 `42901`（token 配额用尽）、`42902`（模型服务繁忙）；**若 fallback 已含「命中策略」则保留网关拼入的具体原因**，避免前端只显示泛化文案；未匹配 fallback 保留原文

### session-title.ts
- `PLACEHOLDER_SESSION_TITLES_CF`：占位标题集合（微信/飞书/新对话/new chat 等，小写）
- `sessionTitleNeedsAutoFill`：空名、命中占位、或以「新会话/新对话/new session/new chat」前缀开头则需自动填充
- `buildAutoTitleFromFirstUserMessage`：空白压平（`\s+` → 单空格）后取前 **48 字**——**与主仓 Python `session_manager._build_auto_title` 显式对齐**，跨语言契约一致

### managed-agents.ts（`PROTOCOL_VERSION = agx-ma/2026-11`）
- 事件枚举：`CLIENT_EVENT_TYPES` / `SERVER_EVENT_TYPES`（含 task、thread、MCP、span 等）；`PAT_SCOPES`、`MA_WEBHOOK_EVENT_GROUPS` / `MA_WEBHOOK_EVENT_TYPES`
- 资源与限制常量：`MAX_MANIFEST_BYTES`、`MAX_SYSTEM_BYTES`、`MULTIAGENT_MAX_MEMBERS`、`MAX_ADVISOR_INSTRUCTIONS_BYTES`、`MAX_EVENTS_PER_BATCH`、Worker lease / SSE 间隔等
- 领域类型：`ContentBlock`、`ClientEvent` / `ServerEvent`、`AgentManifest`、`SessionRecord`、`WorkItemRecord`、`EnvironmentRecord` 等；`MA_ERROR_CODES`
- 校验与哈希：`canonicalJson`、`manifestHash`、`validateManifest`（返回 `ManifestResult`：errors / normalized / `manifestHash`）、`validateClientEventBatch`（批量上限与 `duplicate_resolution`）

### managed-evals.ts（子路径导出，不进主 barrel）
- `RULE_TYPES`、`JUDGE_MODES`、`STOP_REASON_VALUES`；上限 `MAX_CRITERIA_BYTES`、`MAX_RULE_CHECKS` 等
- `EvalRubric` / `EvalRuleCheck`；`validateRubric` → `RubricResult`（含 `contentHash`，复用 `canonicalJson`）

## 显著模式

- **错误码命名空间**：`4xxxx` 业务错 / `9xxxx` policy 错（regex 区分），policy 错对应 gateway/policy-engine 触发
- **中文 compliance 消息 + 网关原因优先**：`toComplianceMessage` 在 fallback 已含「命中策略」时保留具体原因，体现"网关拼原因、前端不覆盖"的协作约定
- **session-title 跨语言契约**：与主仓 Python 实现镜像（占位集合 + 48 字截断）
- **审计哈希链 / 跨境字段**：`AuditEvent` 内置 `prev_checksum → checksum → signature` 链与 `cross_border/residency_rule`，是 gateway Blake2b 链审计与跨境合规的 TS 侧契约
- **Managed Agents 跨语言校验**：TS `validateManifest` / `validateClientEventBatch` / `validateRubric` 的错误文案与字节上限与 Python manifest 层对齐；fixture 测试锁定 `manifestHash` / `contentHash` 与 Python 一致

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/web-portal` / `apps/admin-console` | 直接 import 类型 | 所有 chat / audit / 错误码 / session-title 契约 |
| `packages/sdk-ts` | 部分覆盖 | SDK 的 `ChatMessage` 是更窄子集 |
| `apps/gateway`（Go） | **结构对齐** | Go 端 `audit.Event` 字段与本包 `AuditEvent` 对齐（含哈希链、跨境、MCP 字段） |
| `apps/gateway` → `packages/policy-engine` | 间接 | `POLICY_ERROR_CODES` 90001/90002 对应 policy-engine 的 block 命中 |
| Managed Agents / 主仓 `agenticx/managed` | **校验镜像** | TS 侧 manifest、事件批、rubric 与 Python 同规则同哈希，减少双栈漂移 |

## 增量（8ebec3b5 → 30e57496）

- `src/chat.ts`：会话/附件/产物/深度研究相关类型扩展（约 +168）。
- `src/trace.ts`：**新增** trace-id 契约，供 portal / sdk-ts / gateway 对齐。
- `src/errors.ts`：错误码表增量（配额/合规类）。
- `src/audit.ts`：审计事件补 trace 字段。
- barrel `index.ts` 增加 `export * from "./trace"`。

## 增量（30e57496 → 22d051f5）

- `src/audit.ts`：`AuditEventType` 增加 `desktop_agent_action`；`AuditQueryInput` 增加可选 `event_type?: string` 过滤条件。
- `src/chat.ts`：`ChatMessage` 增加 `control?: "continue_report"` 与 `interruption?: { reason; contentLength }`；`DeepResearchEventPayload` 增加 `report_resume_available` 变体（章节续写入口）。
- `src/errors.ts`：`toComplianceMessage` 对 `42902` 映射「模型服务繁忙，请稍后再试。」

## 增量（22d051f5 → cebdabd5）

- **新增** `src/managed-agents.ts`：`agx-ma/2026-11` 线协议类型全集 + `validateManifest` / `validateClientEventBatch` 等运行时校验；barrel `index.ts` `export * from "./managed-agents"`。
- **新增** `src/managed-evals.ts`：`validateRubric` 与 rubric 规则类型；`package.json` `exports["./managed-evals"]` 子路径，主入口不 re-export。
- **新增** `src/__tests__/managed-agents.test.ts`、`managed-evals.test.ts`（vitest）；`package.json` 增加 `"test": "vitest run"`。
