# AGX 内化 AgentScope 2.0 — P0（Offloader + Workspace MCP Gateway）

> **Source proposal**: `research/codedeepresearch/agentscope/agentscope_proposal_v2.md`
> **Upstream baseline**: AgentScope `v2.0.0` (`6d7189c`, Apache-2.0)
> **Date**: 2026-05-29
> **Scope**: P0 三项（克制内化，最小可迁移机制 + 冒烟测试），P1–P3 保持 backlog。
> **战略调整（2026-05-29）**: 因 AGX vs AgentScope "谁更适合当可嵌入 SDK 底座" 的外部辩论，新增最高优先级 **P0-0**：暴露一个零产品耦合、注入式的 ReActAgent 门面，直接反转"AGX 主循环只有 Studio 耦合的 `AgentRuntime`、不可干净嵌入"的结论。

---

## 功能点清单

| # | 功能点 | 优先级 | 上游/对标证据 | AGX 落点 | 验收场景 |
|---|--------|--------|---------|----------|---------|
| 0 | 注入式 ReActAgent 门面（可嵌入 SDK 原语） | **P0-0** | AS `agent/_react_agent.py`（注入式构造对标） | `agenticx/agents/react_agent.py` | 仅注入 LLM+tools 即 `.run()` 跑通；import 不拉入 Studio 重运行时 |
| 1 | Offloader Protocol + Reference | P0-2 | `workspace/_offload_protocol.py` | `agenticx/core/offload/protocol.py` | 协议方法签名、Reference 序列化/占位符、`should_offload` 阈值判定 |
| 2 | FileOffloader 落盘实现 | P0-2 | （AGX 原创落地，对齐 AS 语义） | `agenticx/core/offload/file_offloader.py` | context/tool_result 写入 `~/.agenticx/offload/<session>/`，按 handle retrieve round-trip |
| 3 | Workspace MCP Gateway app | P0-1 | `workspace/_mcp_gateway/_mcp_gateway_app.py` | `agenticx/sandbox/mcp_gateway/gateway_app.py` | FastAPI builder + Bearer 鉴权 + 可插拔 backend，注册/列举/调用工具 |
| 4 | 宿主侧 GatewayClient | P0-1 | `workspace/_gateway_client.py` | `agenticx/sandbox/mcp_gateway/client.py` | health/list_mcps/add/remove/call_tool，错误透传为可推理结果 |

### P0-0 关键发现（核实 + 诚实记录）
- **核实**：那场辩论的论据"对了一半"。`agenticx/runtime/agent_runtime.py` 确实强耦合 Studio/CLI（顶层 `from agenticx.cli.agent_tools import ...`，全程依赖 `StudioSession`）→ 不可干净嵌入。**但** `agenticx/core/agent_executor.py` 的 `AgentExecutor` 是零 cli/studio 耦合的注入式执行器——评审漏看了它。AGX 不缺干净循环，缺的是把它"门面化 + 放到 SDK 头排"。
- **交付**：`ReActAgent(llm=..., tools=[...], ...).run(prompt)` 一行可嵌入；薄包 `AgentExecutor`，**不改** `AgentExecutor`/`Agent`/`Task` 既有逻辑。
- **冒烟证据**：`test_react_facade_import_has_no_studio_runtime_coupling` 断言 import 门面不拉入 `agenticx.studio` / `cli.agent_tools` / `cli.studio_mcp` / `cli.studio_skill` / `runtime.agent_runtime`。
- **诚实残留（follow-up，非本期）**：`import agenticx` 包根仍 eager 导入轻量配置读取器 `agenticx.cli.config_manager`（由 `.llms`/`.tools` 某模块顶层 import 触发）。它不是 Studio 重运行时，但仍是一处包根 eager 耦合，建议后续单开议题做惰性化（波及多个 llms/tools 模块，按 no-scope-creep 不在本期擅自重构）。

---

## 设计要点

### Offloader（FR-OFF）
- **FR-OFF-1**: `Offloader` Protocol 暴露 `offload_context` / `offload_tool_result` / `retrieve`，返回 `Reference` 句柄。
- **FR-OFF-2**: `Reference` dataclass 含 `handle`(sha256)/`size`/`summary`/`kind`/`session_id`/`tool_name`/`content_type`/`created_at`；`to_placeholder()` 生成对话历史内联占位符；`to_dict/from_dict` 可序列化。
- **FR-OFF-3**: `should_offload(text, threshold)` 默认阈值 4KB，低于阈值不外置（兼容关闭）。
- **FR-OFF-4**: `FileOffloader` 落盘到 `root/<session>/<handle>.json`，retrieve 未知 handle 抛 `OffloadError`。
- **NFR-OFF-1**: 不开启 offloader 时调用方行为完全等同当前（纯可选组件，无侵入）。

### MCP Gateway（FR-GW）
- **FR-GW-1**: `build_gateway_app(state)` 返回 FastAPI app，端点对齐上游：`GET /health`、`GET/POST /mcps`、`DELETE /mcps/{name}`、`GET /mcps/{name}/tools`、`POST /mcps/{name}/tools/{tool}`。
- **FR-GW-2**: 除 `/health` 外全部 Bearer 鉴权（token 为空则放行，向后兼容）。
- **FR-GW-3**: gateway 通过可插拔 `MCPBackend` Protocol 解耦真实 MCP；提供 `InMemoryMCPBackend` 供测试与本地演示。
- **FR-GW-4**: 宿主侧 `GatewayClient`（httpx）支持注入自定义 transport（ASGI），便于无 Docker 冒烟；工具调用 4xx/5xx 透传为 `{"state":"error"}` chunk 而非崩溃。
- **NFR-GW-1**: 不引入新二进制依赖（沿用 fastapi/httpx/uvicorn 既有依赖）。

---

## 验收标准（AC）
- **AC-1**: `pytest -q tests/test_smoke_agentscope_offloader.py` 全绿（round-trip / 阈值 / 未知 handle 失败路径）。
- **AC-2**: `pytest -q tests/test_smoke_agentscope_mcp_gateway.py` 全绿（health / 注册+列举+调用 / 401 鉴权 / 未知工具失败路径）。
- **AC-3**: 两模块均为可选组件，import 不影响既有运行时（默认关闭）。

---

## 非目标
- 不改 `runtime/compactor.py` / `memory_hook.py` 主干（仅提供可被其调用的 Offloader，接线留待后续 phase）。
- 不引入 E2B；Docker 容器实际拉起为后续工程（本期交付可被容器内 `python -m` 调用的 importable gateway app）。
- 不做 Desktop UI 集成（留 backlog）。
