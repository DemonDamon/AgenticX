# Qwen3-32B 上下文超限修复

## 根因

Near Meta 聊天使用 `build_meta_agent_system_prompt`（~49k 字符）+ 全量 `META_AGENT_TOOLS`（~65 个），估算 prompt+tools 约 23k+ tokens，超过彩讯 aibox 上 Qwen3-32B 的实际可用窗口。网关返回 `ContextWindowExceededError`，Desktop 无 final → 误报「上一轮未产出回答 / 已停滞」。

精简栈（`_build_agent_system_prompt` + `studio_tools_for_session`）实测 input ~15660 tokens 可正常回复。

## 方案

- `agenticx/runtime/context_budget.py`：对 32B/7B/9B 等小窗口模型，当 Meta 全量 prompt 超过阈值时自动切换 compact prompt + studio 工具集 + 必要 Meta 工具
- `provider_fault.py`：识别 `context_window` 并给出中文提示
- `agent_runtime.run_turn`：调用 compact；发出 warning；context_window 错误文案可读

## 验收

- AC-1: `tests/test_context_budget.py` 通过
- AC-2: `/api/chat` 新建会话 + Qwen3-32B +「你好」能收到 `final`
- AC-3: 不再仅显示「停滞」而无错误原因（若仍超限则显示上下文超限文案）
- AC-4: 同一轮 pending user（无 assistant 回复）重发/打断不再 UI 与 `messages.json` 双写「你好」
- AC-5: `tests/test_chat_history_dedupe.py` + `desktop/src/utils/send-dedupe.test.ts` 通过
