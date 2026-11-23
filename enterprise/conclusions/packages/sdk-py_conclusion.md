# agenticx-sdk (Python) 模块总结

> 结论生成时间：2026-11-14（target cebdabd5）

## 模块概述

`agenticx-sdk`（Python 包）已落地 **Managed Agents 同步客户端**：`src/agenticx_sdk/managed.py` 提供阻塞式 `/ma/v1` HTTP 调用，使用 `httpx.Client`；**不导入** 主仓 `agenticx` 包。`__init__.py` 再导出 `MAApiError`、`MAEndpoints`、`ManagedAgentsClient` 与 `__version__`。README 含安装与 Managed Agents 用法示例。

## 目录结构

```
packages/sdk-py/
├── pyproject.toml            # agenticx-sdk 0.1.0，requires-python>=3.10；httpx + pydantic
├── README.md                 # 安装 + ManagedAgentsClient 示例
├── src/agenticx_sdk/
│   ├── __init__.py           # 重导出 managed 公开符号 + __version__
│   └── managed.py            # ManagedAgentsClient / MAEndpoints / MAApiError
└── tests/
    └── test_managed_client.py  # MockTransport 路由、版本冲突、SSE 续传、无 agenticx 依赖
```

## 关键导出

- `MAApiError` — HTTP/网络失败异常（`status`/`code`/`message`/`details`）
- `MAEndpoints` — 控制面与会话面根地址（各带 `/ma/v1` 后缀）；`MAEndpoints.resolve`
- `ManagedAgentsClient` — 阻塞 `/ma/v1` 客户端（`agx-pat-` 令牌；令牌不出现在 `repr`/错误文本）
- `__version__ = "0.1.0"`

`ManagedAgentsClient` 主要方法：控制面 `list_agents` / `get_agent` / `create_agent` / `create_version` / `list_environments`；会话面 `create_session` / `get_session` / `list_sessions` / `send_events` / `list_events` / `archive_session`；流式 `iter_events`（SSE、`Last-Event-ID` 重连去重、`until_idle`）。

## 显著模式

- `requires-python = ">=3.10"`；依赖 `httpx>=0.27`、`pydantic>=2.0`（当前实现以 dict 为主，pydantic 未在 managed 路径使用）
- **同步阻塞** + 可注入 `httpx.Client`；`close()` 仅关闭自建的 client
- 双平面 URL：`MAEndpoints.resolve` 支持统一 `base_url` 或分开 `control_url` / `runtime_url`（本地 dev 控制面常带 `/api`）
- SSE：`_iter_sse` 解析 `text/event-stream`；`iter_events` 断线指数退避重连（默认最多 5 次）
- 测试与仓库根 `tests/fixtures/managed_agents/client_cases.json` 对齐，且子进程断言 `import agenticx_sdk.managed` 不加载 `agenticx`

## 状态

**部分实现** — Managed Agents `/ma/v1` 同步客户端已可用；尚无与 `sdk-ts` 对等的通用 Chat/gateway SSE 聊天客户端，也未见 async API。

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `packages/sdk-ts` | 对应物 | TS 侧另有聊天/SSE 能力；Python 当前聚焦 Managed Agents |
| Managed Agents 网关 | 上游 API | 控制面与会话面 `/ma/v1` 端点 |
| Python 端业务集成 | 目标消费者 | 给 Python 应用 / 脚本 / Machi 桌面 Python 侧接 enterprise 用 |
| 主仓 `agenticx` | 刻意隔离 | SDK 包独立安装，不依赖运行时框架包 |