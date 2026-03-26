# browser-use 集成 — 评测与回归草案

## 任务集（最小）

1. **T1 Navigate**：`open https://example.com` → `get title` 或 `state` 含 `example`。
2. **T2 Indexed click**：静态页或固定 fixture，已知索引 `click N` → URL 或文本变化。
3. **T3 Screenshot**：`screenshot` 返回非空 base64 或文件写入。
4. **T4 Session isolation**：两 `session` 并行打开不同 URL，互不覆盖（可选，资源敏感）。
5. **T5 Cleanup**：`close` 后无残留 `*.pid` / 套接字（本机 `~/.browser-use` 检查）。

## 指标

- **成功率**：任务通过 / 总运行。
- **P95 延迟**：自 tool 调用到 JSON 返回。
- **稳定性**：连续 20 次 T1 无 daemon 僵死。

## 回归门禁

- 默认 CI **跳过**（无 Chromium）。
- `AGX_BROWSER_USE_E2E=1` 且镜像预装 Playwright Chromium 时运行 pytest。

## 负例

- 错误 `session` 名（非法字符）应返回清晰错误，不崩溃 runner。
- headed/profile 与已存在 session 冲突时应返回可解析错误（与上游一致）。

## 自动化回归（AgenticX）

- `pytest tests/test_studio_mcp_call_async.py`：在**已运行的事件循环**中调用 `dispatch_tool_async("mcp_call", ...)`，确认不因嵌套 `asyncio.run` 失败。

## 手工验证（需本机安装 browser-use + Chromium + API Key）

1. 按 `examples/browser-use-mcp.md` 配置 `~/.agenticx/mcp.json`。
2. Studio：`mcp_connect` → `mcp_call` `browser_navigate` → `browser_get_state`。
3. `mcp_call` `retry_with_browser_use_agent` 与简短任务字符串，确认返回步骤摘要且无 MCP 子进程 JSON 污染 stdout。
