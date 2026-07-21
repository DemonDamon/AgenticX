# @agenticx/core-api 模块总结

> 结论生成时间：2026-07-21（基于源码核验重写）

## 模块概述

`@agenticx/core-api` 是**纯类型 / 契约包**——只有 TypeScript 类型定义与少量纯函数，没有任何运行时副作用。被 gateway、SDK、apps 共享，涵盖 chat、audit、错误码、session-title 启发式，是跨语言（TS ↔ Go）字段对齐的契约源。

## 目录结构

```
packages/core-api/
└── src/
    ├── index.ts            # barrel：re-export chat / session-title / errors / audit
    ├── chat.ts             # ChatMessage、ChatSession、ChatRequest、ChatResponse、ChatChunk、ChatError、ChatMessageRole、ToolCallSummary、ChatMessageAttachment、IsoDateTime、EntityId、ApiEnvelope
    ├── audit.ts            # AuditEvent、AuditEventType、AuditRoute、AuditClientType、AuditPolicySeverity/Action、AuditDigest、AuditPolicyHit、AuditQueryInput、AuditQueryResult
    ├── errors.ts           # BUSINESS_ERROR_CODES、POLICY_ERROR_CODES、isPolicyErrorCode、toComplianceMessage
    └── session-title.ts    # sessionTitleNeedsAutoFill、buildAutoTitleFromFirstUserMessage
```

## 关键导出

### chat.ts
`IsoDateTime`、`EntityId`、`ChatMessageRole`（`system | user | assistant | tool`）、`ToolCallSummary`（status `queued | running | success | failed`）、`ChatMessageAttachment`（name/mime_type/size/data_url）、`ChatMessage`、`ChatSession`、`ChatRequest`、`ChatError`（`code` 注释 4xxxx 业务 / 9xxxx 策略）、`ChatChunk`（流式增量，含 delta/reasoning/tool_call/done/error）、`ChatResponse`（含 `usage` 与 `route: local | private-cloud | third-party`）、`ApiEnvelope<T>`

### audit.ts
- `AuditEventType` = `chat_call | tool_call | mcp_tool_call | policy_hit | auth_login | auth_logout | audit_export`（**含 `mcp_tool_call`**）
- `AuditRoute` = `local | private-cloud | third-party`
- `AuditClientType` = `web-portal | desktop | edge-agent | admin-console`
- `AuditPolicySeverity` = `low | medium | high | critical`；`AuditPolicyAction` = `allow | redact | block`
- `AuditDigest`（prompt_hash / response_hash / summary）、`AuditPolicyHit`（policy_id / severity / action / matched_rule）
- `AuditEvent`：字段丰富，含 token/cost/latency、`digest`、`tools_called`、`policies_hit`、MCP 侧（`mcp_server`/`mcp_tool_name`/`mcp_input_hash`/`mcp_output_hash`/`mcp_status`）、**哈希链**（`prev_checksum`/`checksum`/`checksum_version`/`signature`）、**跨境**（`src_region`/`dst_region`/`cross_border`/`residency_rule`）
- `AuditQueryInput` / `AuditQueryResult`（含 `chain_valid`/`chain_error_at`/`chain_error_reason`/`chain_verification`/`chain_verified_count`/`chain_legacy_unverified`）

### errors.ts
- `BUSINESS_ERROR_CODES`：`40000 / 40100 / 40300 / 40400 / 42900 / 50000`
- `POLICY_ERROR_CODES`：`90001（REQUEST_BLOCKED）/ 90002（RESPONSE_BLOCKED）`
- `isPolicyErrorCode`（`/^9\d{4}$/`）
- `toComplianceMessage`：中文 compliance 消息映射；额外处理 `42901`（token 配额用尽）；**若 fallback 已含「命中策略」则保留网关拼入的具体原因**，避免前端只显示泛化文案；未匹配 fallback 保留原文

### session-title.ts
- `PLACEHOLDER_SESSION_TITLES_CF`：占位标题集合（微信/飞书/新对话/new chat 等，小写）
- `sessionTitleNeedsAutoFill`：空名、命中占位、或以「新会话/新对话/new session/new chat」前缀开头则需自动填充
- `buildAutoTitleFromFirstUserMessage`：空白压平（`\s+` → 单空格）后取前 **48 字**——**与主仓 Python `session_manager._build_auto_title` 显式对齐**，跨语言契约一致

## 显著模式

- **错误码命名空间**：`4xxxx` 业务错 / `9xxxx` policy 错（regex 区分），policy 错对应 gateway/policy-engine 触发
- **中文 compliance 消息 + 网关原因优先**：`toComplianceMessage` 在 fallback 已含「命中策略」时保留具体原因，体现"网关拼原因、前端不覆盖"的协作约定
- **session-title 跨语言契约**：与主仓 Python 实现镜像（占位集合 + 48 字截断）
- **审计哈希链 / 跨境字段**：`AuditEvent` 内置 `prev_checksum → checksum → signature` 链与 `cross_border/residency_rule`，是 gateway Blake2b 链审计与跨境合规的 TS 侧契约

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/web-portal` / `apps/admin-console` | 直接 import 类型 | 所有 chat / audit / 错误码 / session-title 契约 |
| `packages/sdk-ts` | 部分覆盖 | SDK 的 `ChatMessage` 是更窄子集 |
| `apps/gateway`（Go） | **结构对齐** | Go 端 `audit.Event` 字段与本包 `AuditEvent` 对齐（含哈希链、跨境、MCP 字段） |
| `apps/gateway` → `packages/policy-engine` | 间接 | `POLICY_ERROR_CODES` 90001/90002 对应 policy-engine 的 block 命中 |
