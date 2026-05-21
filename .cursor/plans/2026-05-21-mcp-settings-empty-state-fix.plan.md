# MCP 设置页"假空列表"修复

## What & Why

设置 → MCP 偶发显示「尚未发现 MCP 服务」，但 `~/.agenticx/mcp.json` 明明有配置。根因是「列表加载强依赖会话 ID + 失败静默 + 文案误导」三件事叠加。本次只做最小修复，恢复"打开设置必能看到配置"。

## Requirements

- FR-1: 后端 `GET /api/mcp/servers` 在缺失或未知 `session_id` 时，不再 404，改为返回 `GlobalMcpManager` 进程级配置 + 全局连接集 + 全局工具计数；保留带合法 session 时的现有行为（含 `op_message` 等会话级运维状态）。
- FR-2: Desktop 主进程 `load-mcp-status` IPC 去掉「`!sid` 直接 error」短路，允许把空 sid 传给后端。
- FR-3: 前端 `refreshMcpStatus` 不再因 `effectiveSid` 为空而提前 return；正常拉取并展示。
- FR-4: 设置页空状态文案修正：删去对「扫描发现」的引导（该按钮用于外部工具配置导入，不会填入主列表）。
- NFR-1: 不引入新依赖；不动 MCP 连接/断开/导入等其它接口。
- AC-1: 完全关闭 Machi 重启后，立即打开「设置 → MCP」，无需等待会话就绪即可看到 `~/.agenticx/mcp.json` 中的全部 server。
- AC-2: 当 `agx serve` 未就绪或鉴权失败时，UI 不再呈现「假空列表」——保持现有错误透出路径（`mcpMessage`），无需新增 UI 文案。
- AC-3: 现有 `tests/` 中 MCP 相关冒烟测试通过（若存在）。

## 影响范围

- `agenticx/studio/server.py`：`list_mcp_servers` 增加无会话兜底分支。
- `desktop/electron/main.ts`：`load-mcp-status` IPC 容忍空 sid。
- `desktop/src/App.tsx`：`refreshMcpStatus` 去掉空 sid 短路。
- `desktop/src/components/SettingsPanel.tsx`：空状态文案修正。

## 非目标（避免 scope creep）

- 不重写 MCP 设置页结构。
- 不调整「扫描发现」逻辑本身。
- 不引入新的 toast / 错误展示组件。
- 不动 `GlobalMcpManager`、`load_available_servers` 等底层逻辑。
