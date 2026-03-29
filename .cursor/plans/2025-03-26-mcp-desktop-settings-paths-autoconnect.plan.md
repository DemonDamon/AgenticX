# MCP 设置：多路径 + 自动重连

## 目标

- 设置页默认展示主配置 `~/.agenticx/mcp.json`；可像环境变量一样用 **+** 追加其他 `mcp.json` 路径（Cursor / OpenClaw 等）。
- 去掉「刷新」按钮；路径变更后仍通过内部 `load_available_servers` 刷新列表。
- **连接状态持久化**：用户连接 A、未连接 B 时，将 A 写入 `~/.agenticx/config.yaml` 的 `mcp.auto_connect`；**新建会话**时后端自动 `mcp_connect`；断开时从列表移除并取消自动连接。

## 实现要点

- `ConfigManager.get_value`：改为读取合并后的原始 YAML，使 `mcp.*` / `runtime.*` 等未建模键生效。
- `studio_mcp.all_mcp_config_search_paths`：顺序为主 `mcp.json` → `mcp.extra_search_paths` → 项目 `.cursor/mcp.json` → `~/.cursor/mcp.json`。
- API：`GET/PUT /api/mcp/settings`、`POST /api/mcp/disconnect`；`connect` 成功后 `append_mcp_auto_connect_name`。
- Desktop：`getMcpSettings` / `putMcpSettings` / `disconnectMcp` IPC；MCP Tab UI。

## Requirements

- FR-1: 主路径只读展示为 `~/.agenticx/mcp.json`；附加路径可增删，持久化到 `mcp.extra_search_paths`。
- FR-2: 移除「导入」「刷新」按钮；以 **+** 添加路径。
- FR-3: 已连接服务写入 `mcp.auto_connect`；断开时移除；新 session 自动连接列表中的服务。

Made-with: Damon Li
