# Harness 模块结论

> 结论基线：`cebdabd5883de1d5a62c96ae4084de6ad036b32f`（mapping TARGET，模块根 `agenticx/harness/`）

## Responsibility
- 作为**统一外部 coding-agent 控制面**：用单一协议 `HarnessAdapter`（spawn / turn / stream / permission / stop / capabilities，外加 describe / list_sessions / available）把 Claude Code、CodeBuddy、Codex、OpenCode 等 CLI  harness 归一到 `TurnRequest` / `TurnResult` 与 `HarnessCapabilities` 语义，供进程内直连或独立 HTTP 服务调用。
- **注册与发现**：`HarnessRegistry` + `default_registry()` 懒加载并注册四类内置 adapter；`descriptors()` 产出 `/v1/harnesses` 与 UI 所需的可用性与能力矩阵。
- **上下文交接（SP4）**：`handoff` 子包提供 `HandoffEngine` 流水线（策略 → 八段摘要 → 脱敏 → 持久化 → 目标 harness spawn/resume → 注入 + 首条 turn），`HandoffStore` 以 append-only JSONL 记录交接图，失败以 `HandoffError` fail-closed。
- **Near 集成辅助**：`harness_settings_sync` 将 Studio 侧 provider/model 同步到各 harness 原生配置；`usage` 把外部 turn 用量映射为 Near `token_usage` SSE 形状；`near_cross_harness_swarm_ui` 为 CB↔CC 子 agent 编排合成与原生 `spawn_subagent` 一致的 UI 进度/持久化行；`stream_json_text` / `cc_result_sanitize` 从 NDJSON 行缓冲抽取可见助手文本。
- Explicit non-responsibilities: **不**替代既有 `agx cc-bridge serve` / `agx wb-bridge serve` 的独立 HTTP 应用与路由（adapter 与 bridge 可共享 session manager，但行为 additive）；**不**实现内置 `python-agent` runtime（基线 `default_registry` 仅注册四类 CLI adapter）；**不**承载 Desktop React/Electron UI；Studio 会话级路由、SSE 泵与 `chat_history` 落盘主逻辑在 `agenticx/studio/harness_wiring.py` 与 `server.py`（本模块提供引擎与类型，非完整聊天产品层）；**不**拥有 Near 全局 LLM provider 路由（仅 `*_settings.py` 写各 CLI 侧配置文件）。

## Entry points and public interfaces
- `agenticx.harness`：`HarnessAdapter`、`HarnessRegistry`、`default_registry`；类型层 `HarnessCapabilities`、`HarnessDescriptor`、`TurnRequest`、`TurnResult`、`PermissionDecision`；异常 `CapabilityNotSupported`、`SessionNotFoundError`、`TurnInProgressError`、`UnknownHarnessError`（见 `__all__`）。
- `agenticx.harness.http_app`：`FastAPI` 应用 `app`；`GET /health`（`HARNESS_SURFACE_HEALTH_SCHEMA` = `harness-surface-1`）；Bearer `verify_token`（`HARNESS_SURFACE_TOKEN`）；`GET /v1/harnesses`；会话 CRUD `POST|GET|DELETE /v1/harnesses/{harness_id}/sessions[...]`；`POST .../turn`；能力门控的 `POST .../permission`、`GET .../stream`、`POST .../write`、`POST .../resize`。
- `agenticx.harness.settings`：`harness_surface_base_url()`（默认 `http://127.0.0.1:9744`）、`ensure_harness_surface_token_persisted()` / `harness_surface_token()`、`validate_harness_surface_url()`、`harness_surface_nonlocal_allowed()`。
- `agenticx.harness.handoff`：`HandoffEngine.execute_handoff`、`HandoffStore`、`decide_strategy`、`TemplateSummarizer`、`ContextHandoff` / `SwitchPlan` / `AppThreadSnapshot` 等导出。
- `agenticx.harness.harness_settings_sync`：`maybe_sync_harness_settings`、`apply_harness_settings`（供 Studio `/api/harness/settings/apply`）。
- CLI：`agenticx.cli.harness_surface_commands` 下 `agx harness-surface serve`（uvicorn 加载 `http_app:app`）、`agx harness-surface list`（`default_registry().descriptors()`）。
- 注册 id（基线）：`claude-code`（`ClaudeCodeAdapter`）、`codebuddy`（`CodeBuddyAdapter`）、`codex`（`CodexAdapter`）、`opencode`（`OpenCodeAdapter`）。

## Core execution path
- **独立控制面**：`agx harness-surface serve` 设置 `HARNESS_SURFACE_TOKEN` → uvicorn → `http_app._registry = default_registry()` → 路由 `_adapter(harness_id)` 调具体 adapter；`ValueError`/`FileNotFoundError`/`RuntimeError` 在 spawn 映射为 HTTP 400；`TurnInProgressError` → 409；`CapabilityNotSupported` → 400。
- **Adapter 契约**：`spawn(cwd, options=...)` 返回归一化 session view（各 adapter 校验 harness 专属 options，如 claude-code `mode`/`auto_allow_permissions`，codebuddy `permission_mode`）；`turn` 阻塞至 `wait_seconds` 并返回 `TurnResult`（统一 `TURN_STATUS_*`）；可选能力默认在基类抛 `CapabilityNotSupported`，调用方按 `capabilities()` 降级。
- **实现分层**：`ClaudeCodeAdapter` 多重继承 `BridgeSessionManager` + `HarnessAdapter`，复用 `agenticx.cc_bridge.session_manager`；`CodeBuddyAdapter` 包装 `WbBridgeSessionManager`；`CodexAdapter` 优先 `codex app-server` JSON-RPC（`_codex_app_server.CodexAppServerRpc`），回退 `codex exec --json`（`ExecCliHarnessAdapter`）；`OpenCodeAdapter` 同为 `ExecCliHarnessAdapter` 子类（`opencode run --format json`，`-s` resume）。
- **Studio 内嵌路径（SP5b）**：`harness_wiring.run_external_harness_turn` / `switch_harness` 进程内 `default_registry().require` → spawn/adopt/复用 surface session → `adapter.turn(TurnRequest)` → 结果写入 `chat_history` 并驱动 SSE（含 mid-turn `drain` 与 `usage_metadata_from_harness_detail`）；切换 harness 时 `HandoffEngine` 执行摘要注入与目标 adapter 首 turn。
- **交接策略梯**：`decide_strategy` 在 `STRATEGY_RESUME` / `STRATEGY_DELTA` / `STRATEGY_FULL` / `STRATEGY_MANUAL` 间选择；`resume` 档调用 `HarnessAdapter.adopt_thread`（Codex/OpenCode 声明 `resume=True`）；注入前 `redact_summary` / `summary_to_payload`，再 `adapter_spawn_options` 滤除 `model_provider` 等内部 stamp。

## Data and configuration
- 客户端 URL：`AGX_HARNESS_SURFACE_URL` 或 `~/.agenticx/config.yaml` 键 `harness_surface.url`（默认 `127.0.0.1:9744`）。
- Bearer：`AGX_HARNESS_SURFACE_TOKEN`（不写盘）> `harness_surface.token`（`ensure_harness_surface_token_persisted` 可自动生成并持久化）；HTTP 服务进程读 `HARNESS_SURFACE_TOKEN`（CLI `serve --token` 或从 AGX/config 注入）。
- 非本机调用：`AGX_HARNESS_SURFACE_ALLOW_NONLOCAL` 与 `validate_harness_surface_url` 门禁。
- Handoff 持久化：`HandoffStore` 在 `<agx_home>/handoffs/` 每 AppThread 一条 JSONL（handoff / invalidation 记录，默认 retention 30 天逻辑在 store 内）。
- 各 harness 原生配置：`claude_code_settings.py`、`codex_settings.py`、`codebuddy_settings.py`、`codebuddy_auth.py` / `codebuddy_oauth_login.py`；Codex 传输 `AGX_CODEX_TRANSPORT`、可执行文件 `AGX_*_EXECUTABLE` 等由 adapter 与 bridge 共享约定。
- 统一 turn 元数据：`TurnResult.detail` 承载 Claude `usage`、CodeBuddy `usage_totals`、Codex/OpenCode 事件解析字段；`usage.usage_metadata_from_harness_detail` 归一化为 ChatPane 可消费的 token 字段。

## Dependencies
- Upstream: `agenticx.cc_bridge.session_manager`（`BridgeSessionManager` / `BridgeSession`）、`agenticx.wb_bridge.session_manager`（`WbBridgeSessionManager`）、`agenticx.cli.config_manager.ConfigManager`、`agenticx.utils.agx_home`、`agenticx.harness.adapters._codex_app_server`（Codex RPC）、`agenticx.llms` 中 Codex gateway 解析（`codex_settings`）；FastAPI / uvicorn / ujson / pydantic。
- Downstream: `agenticx.cli.harness_surface_commands`；`agenticx.studio.harness_wiring`（turn 路由、handoff、`spawn_options`）；`agenticx.studio.server`（`_external_harness_chat_stream`、`maybe_sync_harness_settings`）；`agenticx.studio.session_manager`（harness binding 字段）；`agenticx.cc_bridge.session_manager` 反向依赖 `stream_json_text` 做 mid-turn 可见文本泵。

## Tests and operations
- 覆盖面：`tests/test_harness_surface.py`（HTTP 控制面与鉴权）；`tests/test_harness_handoff.py`（引擎 / store / 策略）；`tests/test_studio_harness_wiring.py`（Studio 集成与 mock adapter）；`tests/test_harness_exec_adapters.py`、`tests/test_codex_app_server.py`（Codex/OpenCode CLI 层）；`tests/test_harness_settings_sync.py`、`tests/test_codex_settings.py`、`tests/test_codebuddy_settings.py`（配置同步）；`tests/test_harness_usage_sse.py`、`tests/test_harness_stream_json_text.py`、`tests/test_cc_result_sanitize.py`（文本与用量）；`tests/test_session_harness_binding.py`、`tests/test_near_cross_harness_swarm_ui.py`、`tests/test_harness_turn_error_surface.py` 等。
- 运维：`agx harness-surface serve --host 127.0.0.1 --port 9744`；探活 `GET /health` 校验 `schema: harness-surface-1`；列 harness `agx harness-surface list` 或带 Bearer 的 `GET /v1/harnesses`；客户端请求须 `Authorization: Bearer <token>`，未设置 `HARNESS_SURFACE_TOKEN` 时 `verify_token` 返回 503。
- 与 Studio 并存：Near 默认**进程内**调 registry，不必单独起 harness-surface；独立服务用于调试、远程或与非 Studio 客户端集成。
- 冒烟：`tests/test_smoke_openharness_features.py` 等跨特性用例；修改 `http_app` 或 adapter 契约后应跑 harness 相关 pytest 子集并确认 legacy bridge 仍可 `agx cc-bridge serve` / `agx wb-bridge serve` 独立启动。