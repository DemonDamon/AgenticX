---
module_id: wb-bridge
module_name: WB Bridge
roots:
  - agenticx/wb_bridge
summary_schema: code-module-summaries/v1
---

# AgenticX WB Bridge 模块总结

> 结论生成时间：2026-09-18（首次创建，覆盖 `30e57496990b0e2acb18978091d9e623210eaba3`）

## 模块概述

WB Bridge 把本机 **CodeBuddy / WorkBuddy CLI**（`codebuddy` / `cbc`）封装为受 Bearer Token 保护的 FastAPI 控制面，协议形态对齐 CC Bridge（stream-json / NDJSON），但 **没有** `--permission-prompt-tool` 审批通道：无人值守必须用 `acceptEdits` / `dontAsk` / `bypassPermissions`，`cc_bridge_permission` 对本桥无效。

CLI 入口：`agx wb-bridge serve`（默认 `127.0.0.1:9743`）。Studio 工具：`wb_bridge_start` / `send` / `list` / `describe` / `stop`。

Explicit non-responsibilities：不实现 Claude Code 桥（见 `cc_bridge`）；可执行文件解析 **永不回落 `wb`**（避免误调 Weights & Biases）。

## 目录结构

```
agenticx/wb_bridge/
├── __init__.py
├── settings.py           # URL/Token/健康 schema / codebuddy 路径解析 / probe
├── http_app.py           # FastAPI：/health + /v1/sessions*
├── session_manager.py    # WbBridgeSessionManager：子进程 + 回合状态机
├── process.py            # 确保本机桥进程 / 协议版本
├── events.py             # stream-json 行解析、终态、工具观察
```

## 核心组件

### 设置（settings.py）

- 默认 URL `http://127.0.0.1:9743`；优先级 `AGX_WB_BRIDGE_URL` > `wb_bridge.url`。
- Token：`AGX_WB_BRIDGE_TOKEN`（不落盘）> `wb_bridge.token` > 生成并写入 config。
- `WB_BRIDGE_HEALTH_SCHEMA = "supervision-2"`：旧 serve 缺字段时 Studio 视为 stale 并回收 loopback 进程。
- `probe_wb_bridge()`：`reachable`（`GET /health`）/ `auth_ok`（`GET /v1/sessions`）/ `schema_ok` / `ready`。
- `resolve_codebuddy_executable()`：`AGX_WB_BRIDGE_EXECUTABLE` > yaml > WorkBuddy.app 固定路径 > `which codebuddy|cbc`。
- 非 loopback 需 `AGX_WB_BRIDGE_ALLOW_NONLOCAL=1`。

### HTTP 控制面（http_app.py）

- `GET /health`：无鉴权，返回 `{ok, service: wb-bridge, schema}`。
- 其余 `/v1/*`：`Authorization: Bearer`，`WB_BRIDGE_TOKEN` 未设则 503；`secrets.compare_digest`。
- `POST /v1/sessions`：`cwd` + `permission_mode`；非无人值守模式带 hint。
- `GET /v1/sessions` / `GET /v1/sessions/{id}`：列表 / 权威快照（含 turn_state、observed_tools、written_paths）。
- `POST .../message`：进行中再发送 → **409**；`idempotency_key` 命中则不重派、返回现有回合。
- `DELETE .../{id}`：停子进程。
- `session_id` 强制 UUID。

### 会话管理（session_manager.py）

- `WbBridgeSession`：`permission_mode`、`turn_state` idle/running、`turn_seq`、`observed_tools` / `written_paths`（每回合去重上限 20）、`last_terminal_kind`（success/blocked/error）。
- 权限模式集合：`default` / `acceptEdits` / `bypassPermissions` / `dontAsk` / `plan` / `auto`。
- 行缓冲上限 2000；日志目录与 CC Bridge 同类。

## 依赖

- Upstream：`cli/wb_bridge_commands.py`、`cli/agent_tools.py` 的 `wb_bridge_*`、`cli/config_manager.set_wb_bridge_field`。
- Downstream：复用 `cc_bridge.ndjson.build_user_message_line`；httpx 探活对 loopback 绕系统代理。
