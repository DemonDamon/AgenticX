# agent_messages assistant 与 chat_history 同步修复

**Plan-Id:** 2026-06-12-agent-messages-assistant-sync
**Date:** 2026-06-12
**Status:** Implemented (c69a53f8)

## 问题

`invoke`/`stream_with_tools` 返回空 `response.content` 时，运行时走 stream fallback 补全 `final_text` 并写入 `chat_history`，但 `agent_messages` 已在更早步骤 append 了 `content: ""`。下一轮 LLM 上下文丢失上一轮助手回复（sanitize 后甚至变成连续 user）。

## 方案

在 `agent_runtime.py` 无 tool_calls 终局分支，确定 `final_text` 后、写入 `chat_history` 前，回填 `agent_messages` 最后一条 assistant 的 `content`。

## 验收

- AC-1: `tests/test_agent_runtime.py::test_runtime_stream_fallback_syncs_agent_messages_with_chat_history` 通过
- AC-2: 既有 `test_runtime_text_only_emits_tokens_then_final` 仍绿
