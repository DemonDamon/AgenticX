---
name: kb-always-eager-knowledge-search
overview: KB「始终检索」首轮在调 LLM 前主动执行 knowledge_search，修复 qwen-plus 不调工具、流式假 [N] 结束后消失。
todos:
  - id: eager-runtime
    content: agent_runtime 首轮 eager knowledge_search + TOOL_CALL/RESULT SSE
    status: completed
  - id: skip-duplicate-force
    content: eager 后跳过重复 tool_choice 强制
    status: completed
  - id: smoke-test
    content: test_smoke_kb_force_first_round 覆盖 query helper
    status: completed
  - id: verify-qwen-plus
    content: Near + agx serve 重启后 qwen-plus 工具条 + 角标持久
    status: pending
isProject: false
---

# KB always 首轮 eager knowledge_search

## 背景

`724e6560` 通过首轮 `tool_choice` 强制 `knowledge_search` 曾修复 qwen-plus 无工具条；
回归后弱 FC 模型在超大 tool schema + 长系统提示下仍可能**不发** `tool_calls`，只在正文口述检索并写假 `[N]`。

流式阶段 `CitationMarkdownBody` 在 `isStreaming` 时不 strip `[N]`；结束后 `references` 为空则 `stripOrphanCitationMarkers` 删除角标——与用户截图一致。

## 方案（P0）

在 `run_turn` 每轮 `round_idx == 1`、KB `always`、非系统触发、非 minimax 时，在 `run_before_model` / 首次 LLM 调用**之前**：

1. `dispatch_tool_async("knowledge_search", {query: user_input})`
2. 写入 `assistant(tool_calls)` + `tool` 到 `messages` / `session.agent_messages` / `chat_history`
3. 发出 `TOOL_CALL` + `TOOL_RESULT`（含 `structured` references，`raw_result` 解析）
4. `executed_tool_names` 含 `knowledge_search` 后，流式/fallback 不再重复 `_KB_FORCED_TOOL_CHOICE`

## Requirements

- FR-1: KB always 首轮必执行真实 `knowledge_search`（不依赖模型 FC）
- FR-2: 前端可见工具卡与 references，角标流式与结束后一致
- AC-1: qwen-plus + always +「查下知识库关于 AI 网关」→ 工具条 + 绿色角标不消失
- AC-2: 已正常模型行为不回退（eager 一次检索后 tool_choice 恢复 auto）

## 改动

- `agenticx/runtime/agent_runtime.py`: `_eager_knowledge_search_query`, `_eager_knowledge_search_events`, `run_turn` 注入
- `tests/test_smoke_kb_force_first_round.py`: query helper 冒烟

Plan-Id: 2026-06-03-kb-always-eager-knowledge-search
Plan-File: .cursor/plans/2026-06-03-kb-always-eager-knowledge-search.plan.md
