# MiniMax 2013 与 Desktop 工具确认即时生效

## 背景

- MiniMax OpenAI 兼容接口在相邻同 `role`（尤其双 `system`：主提示 + `[compacted]`）时易报 `invalid chat setting (2013)`。
- Desktop 选择 `Run Everything` 后，`onOpenConfirm` 仍可能读到闭包中的旧 `confirmStrategy`。

## 需求

- **FR-1**：`provider_name` 为 `minimax` 时，在调用 LLM 前合并相邻 `system`/`user`（不合并含 `tool_calls` 的消息）。
- **FR-2**：流式与 `invoke` 路径对 MiniMax 使用保守参数，并在仍报 2013 时分级重试。
- **FR-3**：工具确认弹窗判断是否自动放行时，读取 `useAppStore.getState().confirmStrategy`。

## 验收

- **AC-1**：`python -m py_compile agenticx/runtime/agent_runtime.py` 通过。
- **AC-2**：长对话触发压缩后，MiniMax 请求不再因双 `system` 稳定 2013（在相同环境下复测）。

## 涉及文件

- `agenticx/runtime/agent_runtime.py`
- `desktop/src/App.tsx`
