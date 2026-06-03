# KB 角标渲染兜底 + MiniMax reasoning_details 停滞修复

## 问题

- GLM 等：流式有 `[N]`，落盘后 `message.references` 为空时被 strip，角标消失。
- Qwen：模型在正文粘贴 JSON 而非 tool_call，无「本次调用 · knowledge_search」条。
- MiniMax M2.7：工具后思考走 `reasoning_details`，未转发导致假停滞。

## 修复

- `resolveReferencesForAssistant`：从同轮 tool JSON / 正文嵌入 JSON 恢复 references 并渲染 pill。
- `litellm_provider`：转发 `reasoning_details`；MiniMax 默认 `reasoning_split=True`。
- `meta_agent`：禁止正文复读 hits JSON 代替 `knowledge_search` 工具调用。

Plan-Id: 2026-06-03-kb-citation-render-and-minimax-reasoning
