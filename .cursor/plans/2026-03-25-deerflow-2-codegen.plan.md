---
name: DeerFlow 2.0 codegen
overview: 内化 Guardrails（ToolGuardrailHook + AllowlistProvider）、MCP sync wrapper、FINAL 轮 token_usage SSE 透传；每项含冒烟测试。
todos: []
isProject: false
---

# DeerFlow 2.0 → AgenticX codegen

## Requirements

- FR-1: `agenticx/tools/guardrails/` — Provider Protocol、AllowlistProvider、`ToolGuardrailHook` 接入 `AgentHook.before_tool_call`
- FR-2: `make_sync_mcp_wrapper` + 线程池于 `agenticx/tools/remote.py`（嵌套 event loop 安全）
- FR-3: `usage_metadata_from_llm_response` + `agent_runtime` FINAL 携带用量 + `server._runtime_event_to_sse_lines` 额外 `token_usage` SSE
- AC-1: `pytest -q tests/test_smoke_deerflow_guardrails.py tests/test_smoke_deerflow_mcp_sync.py tests/test_smoke_deerflow_token_usage.py` 通过

## Out of scope

- Guardrails YAML 全局加载、OAP Passport、avatar→prompt 注入、Desktop Command Palette、Session 文件清理 API

## Implementation map

| Item | Path |
|------|------|
| Guardrails | `agenticx/tools/guardrails/{__init__,provider,builtin,hook}.py` |
| Usage extract | `agenticx/runtime/usage_metadata.py` |
| FINAL + usage | `agenticx/runtime/agent_runtime.py` |
| MCP wrapper | `agenticx/tools/remote.py` |
| SSE | `agenticx/studio/server.py` — `_runtime_event_to_sse_lines` |
| Tests | `tests/test_smoke_deerflow_*.py` |
