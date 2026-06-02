---
name: kb-search-tool-card-stream-order-fix
overview: 修复 knowledge_search / web_search 流式过程中工具卡延迟弹出、两个 Thought 黏连的问题。
todos:
  - id: root-cause
    content: SSE tool_call/tool_result 对 SEARCH_REFERENCE_TOOLS continue 跳过，工具卡仅 mergeTailFromDisk 后插入
    status: completed
  - id: live-tool-card
    content: ChatPane/ChatView 实时创建/更新 ToolCallCard，保留引用累积逻辑
    status: completed
  - id: format-result
    content: 移除 formatToolResultMessage 对 SEARCH_REFERENCE_TOOLS 的 silent 早退，启用 knowledge_search 预览
    status: completed
isProject: false
---

# knowledge_search 工具卡流式顺序修复

## 现象

- FR-1：流式输出时两个 Thought 上下黏在一起，中间没有 knowledge_search 工具卡。
- FR-2：正文已开始输出「知识库命中 N 条…」后，工具卡才最后弹出。

## 根因

`ChatPane.tsx` / `ChatView.tsx` 在 SSE `tool_call` / `tool_result` 中对 `knowledge_search` / `web_search` 执行 `continue`，不在内存中创建 ToolCallCard。流式期间 `mergeTailFromDisk` 又因 `sessionStreamState.active` 被跳过，工具行只能等 SSE 结束后才从磁盘合并进来，造成时序错乱。

## 修复

- 保留 `pendingSearchedQueries` / `pendingReferences` 累积。
- 移除 `continue`，与其他工具一样 `commitCurrentStreamIfNeeded` + `addPaneMessage(tool)` + `updatePaneMessageByToolCallId`。
- 删除 `formatToolResultMessage` 中对 SEARCH_REFERENCE_TOOLS 的 `silent: true` 早退（原 knowledge_search 详细格式化代码因此 unreachable）。

## 验收

- AC-1：knowledge_search 调用后、第二轮 Thought/正文之前即出现「本次调用 1 个工具 · knowledge_search」。
- AC-2：工具卡 running → done 状态随 tool_result 实时更新。
- AC-3：引用卡片仍附着于最终 assistant 消息。
