# mcp_call 失败信息透出与浏览器栈策略

## 背景与根因（已确认）

- [`_tool_mcp_call_async`](agenticx/cli/agent_tools.py) 在 `mcp_call_tool_async(..., echo=False)` 返回 `None` 时统一变成 **`ERROR: mcp_call failed`**。
- [`mcp_call_tool_async`](agenticx/cli/studio_mcp.py) 在 **`echo=False`** 时，若 `hub.call_tool` 抛异常会 **`return None`**，且不把 `exc` 传回调用方；工具不存在、JSON 解析失败等路径同样可能 `None`。
- 结果：模型与用户看不到 **browser-use / Playwright / MCP 的真实错误**，容易误判「MCP 不可用」并改用 **`bash_exec` + 本地 Playwright**（与 Machi 回答一致）。

## 设计原则（想清楚再动）

1. **最小面**：只改 MCP 调用链的返回值语义，不重构 `MCPHub`、不改 browser-use 上游。
2. **可诊断但可控**：错误串需包含 `type`/`message` 摘要；**截断**（建议 2k 字符内）避免撑爆上下文；不主动拼接完整 stderr 卷。
3. **不扩大攻击面**：异常文本可能含路径；**禁止**把 API Key 等写入新逻辑（仅透传上游已抛出的异常字符串，不做额外 env 打印）。
4. **语义统一**：成功仍返回工具结果字符串；失败返回 **`ERROR: mcp_call: <原因>`** 一类稳定前缀，便于 UI/日志与模型解析（与现有 `ERROR:` 风格一致）。

## 实现要点（待你确认执行后再改代码）

### A. `mcp_call_tool_async`（[`agenticx/cli/studio_mcp.py`](agenticx/cli/studio_mcp.py)）

- **工具不在路由**：`echo=False` 时也返回明确文案，例如 `ERROR: mcp_call: tool 'x' not connected; available: ...`（可用列表截断），**不要** `None`。
- **JSON 参数解析失败**：返回 `ERROR: mcp_call: invalid arguments JSON: ...`。
- **`hub.call_tool` / `extract_tool_result` 异常**：`echo=False` 时 **`return` 带前缀的错误串**（`exc` 的 `str`，截断），替代 `None`；`echo=True` 仍可 Rich 打印后返回同一字符串或保持现有行为（二选一以简单为准：**统一返回同一错误串**更利于测试）。
- **空 hub / 无路由**（若仍可能 `None`）：改为明确 `ERROR: mcp_call: no MCP tools connected`。

### B. `_tool_mcp_call_async`（[`agenticx/cli/agent_tools.py`](agenticx/cli/agent_tools.py)）

- 若 `mcp_call_tool_async` 已保证失败不返回 `None`，可保留 `result if result is not None else "ERROR: mcp_call failed"` 作为 **兜底**；或改为断言/日志告警 `None`（任选其一，优先简单）。

### C. 单测

- 新建或扩展现有测试：mock `hub.call_tool` 抛 `RuntimeError("persistent_context")`，`echo=False` 时断言返回串 **包含** 该信息且 **带** `ERROR: mcp_call` 前缀。
- mock 工具名不存在时返回 **非 None** 且含 `not connected` / `not found` 类文案。

### D. 可选（第二提交，避免与 A/B 缠在一起）

- 在 [`build_meta_agent_system_prompt`](agenticx/runtime/prompts/meta_agent.py) 增加 **短约束**：当 `list_mcps` / 上下文显示 **`browser-use` 已连接** 时，浏览器自动化 **优先 `mcp_call`**；仅当用户明确要求使用本机 Chrome profile / 或 MCP 返回明确不可恢复错误时，再考虑 `bash_exec`+Playwright。  
- **注意**：这是行为引导，非硬编码；若你不想改提示词，可跳过 D。

## 明确不做（防 scope creep）

- 不在本任务内「禁用」`bash_exec` 或 Playwright。
- 不修改 browser-use 包、不内置 `launch_persistent_context` 支持。
- 不大改 Desktop MCP UI（除非错误串过长需在 UI 截断，属后续）。

## 验收

- 复现路径：故意让 `mcp_call` 失败时，聊天里工具结果 **不再是** 裸 `ERROR: mcp_call failed`，而是 **可读原因摘要**。
- `pytest` 新增/更新用例通过。
