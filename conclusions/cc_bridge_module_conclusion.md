# AgenticX CC Bridge 模块总结

> 结论生成时间：2026-11-14（target `cebdabd5`）

## 模块概述

AgenticX CC Bridge 模块是本机 **Claude Code（CC）桥接层**，把本地安装的 `claude` CLI 封装为一个受 Bearer Token 保护的 FastAPI HTTP 控制面。Studio/Machi 通过该 HTTP 接口创建并驱动 CC 子进程，统一管理会话生命周期、消息收发与工具权限审批。模块支持两种运行模式：

- **headless**：以 stream-json（NDJSON over stdin/stdout）方式驱动 CC，权限审批通过 `--permission-prompt-tool stdio` 协议在程序间自动应答。
- **visible_tui**：通过 Unix PTY 拉起交互式 CC 终端，原始终端流可被前端 attach（用于 Desktop 内嵌 PTY），权限在终端内交互确认。

CLI 入口为 `agx cc-bridge serve`，协议说明见 `docs/cc-bridge-protocol.md`。

## 目录结构

```
agenticx/cc_bridge/
├── __init__.py            # 导出 NDJSON 协议构造/解析辅助函数
├── settings.py            # Studio 侧 HTTP 客户端配置解析（mode/url/token/loopback 校验）
├── http_app.py            # FastAPI 控制面（/v1/sessions* 路由 + Bearer 鉴权）
├── session_manager.py     # CC 子进程会话管理（headless + visible_tui，PTY 与 NDJSON 双路）
├── pending_permissions.py # headless can_use_tool 待审批队列、工具风险分级与参数摘要
├── ndjson.py              # stream-json 行协议构造与解析（user message / control request/response）
└── tui_parser.py          # visible_tui 终端转录的启发式解析（去 ANSI、锚点定位、置信度）
```

## 核心组件分析

### NDJSON 协议辅助 (ndjson.py)

**文件功能**：封装 Claude Code stream-json stdio 协议的行级编解码（基于 `ujson`）。

**关键函数**：
- `build_user_message_line()`：构造一行 `type=user` 的 SDK 用户消息 JSON。
- `parse_control_request()`：识别 `type=control_request` 且 `subtype=can_use_tool` 的权限请求对象。
- `build_control_response_allow()` / `build_control_response_deny()`：构造 allow/deny 的 `control_response`，支持 `updatedInput` 与 `toolUseID`。
- `line_looks_like_result_success()`：启发式判定一行是否为 `type=result, subtype=success` 的回合完成标志。

### 待审批权限 (pending_permissions.py)

**文件功能**：在 `auto_allow` 关闭时，将 headless `control_request`（`can_use_tool`）结构化入队，供 Near/Studio SSE 拉起确认 UI，避免静默丢弃导致 CLI 挂起。

**关键类型与函数**：
- `PendingPermission`：单条未答权限（`request_id`、工具名/展示名、`tool_use_id`、`input_summary`、`risk`、`emitted`）；`to_public_dict()` 供列表/SSE 暴露。
- `classify_cc_tool_risk()`：将工具分为 `low` / `protected`（未知默认 protected），对齐 Near 确认策略。
- `summarize_tool_input()`：压缩工具参数供 UI 展示，避免大块 args 灌入气泡。
- `pending_permission_from_control_request()`：从已解析的 `control_request` 构造 `PendingPermission`。

### HTTP 控制面 (http_app.py)

**文件功能**：基于 FastAPI 暴露会话控制 REST 接口，所有 `/v1/*` 路由经 `verify_token` 依赖做 Bearer Token 校验（Token 来自环境变量 `CC_BRIDGE_TOKEN`，使用 `secrets.compare_digest` 恒定时间比较）。

**主要路由**：
- `POST /v1/sessions`：创建会话（body 含 `cwd`、`auto_allow_permissions`、`mode`），返回 `session_id`/`pid`/`mode`。
- `GET /v1/sessions`、`GET /v1/sessions/{id}`：列举与单会话权威视图（供 `cc_bridge_send` 路由与 Desktop 判定 mode/state）。
- `POST /v1/sessions/{id}/message`：发送用户消息并按 mode 等待结果（headless 等 result/success；visible_tui 等终端空闲稳定后的解析文本 + 置信度）。
- `GET /v1/sessions/{id}/stream`：visible_tui 原始 PTY 输出（`application/octet-stream` 流）。
- `POST .../write`、`POST .../resize`：visible_tui 终端按键写入与窗口尺寸同步。
- `POST .../permission`：headless 会话的工具权限应答（visible_tui 明确拒绝，须在终端内确认）。
- `DELETE /v1/sessions/{id}`、`GET /health`。

**安全约束**：`session_id` 强制按 UUID 解析；mode 仅允许 `headless`/`visible_tui`。

### 会话管理器 (session_manager.py)

**文件功能**：`BridgeSessionManager` 持有所有 CC 子进程及其 stdin/stdout/PTY 接线，是模块的核心。

**核心组件分析**：
- `BridgeSession` 数据类：保存 `proc`、滚动行缓冲（上限 2000 行）、日志落盘路径、`session_kind`、`model`（spawn 时 CLI `--model`）、`permission_policy`（`ask` | `allowlist` | `auto`）、`pending_permissions`、`auto_allow`、PTY master fd 与监听队列；headless 另含 `_result_wait_watermark`、`_stream_generation` 及 `VisibleTextTracker`/`ToolProgressTracker` 驱动的回合内流式游标。
- `start_session()`：支持 `permission_policy`、`model`；按 mode 分派到 `_start_session_headless()`（含 `--include-partial-messages`，`permission-prompt-tool stdio`）或 `_start_session_visible_tui()`（`pty.openpty()`）。
- `_on_control_request()`：`auto_allow` 或 `permission_policy=allowlist` 且 `risk=low` 时自动写 `control_response`；否则写入 `pending_permissions` 等待 `respond_permission()`。
- 读取线程：`_reader_thread`（headless stdout，解析 control_request 并交 `_on_control_request`）、`_stderr_thread`、`_pty_reader_thread`（PTY 输出广播）。
- `send_user_message()`：headless 在写 stdin 前抬高 `_result_wait_watermark` 并重置回合内流式 tracker；visible_tui 仍用锚点 + `\r`。
- `respond_permission()`：按 `request_id` 出队并写 allow/deny NDJSON（优先复用队列内 `tool_input`/`tool_use_id`）。
- `list_pending_permissions()` / `drain_pending_permissions()`：查询或一次性拉出未 `emitted` 的待审批行（供 Near SSE，避免重复弹窗）。
- `drain_midturn_stream_items()` / `drain_visible_stream_text()` / `list_turn_tool_progress()`：基于 `agenticx.harness.stream_json_text` 从行缓冲增量解析可见文本与工具起止，供阻塞等待期间的 SSE 泵。
- `wait_for_success_result()`：仅统计索引 ≥ watermark 的 `result/success`，避免多轮对话误用上一轮结果。
- `wait_for_visible_tui_result()`：基于锚点后文本 + 空闲时间 + 置信度阈值判定 TUI 回合完成。
- `_session_to_dict()`：会话视图含 `model`、`pending_permission_count`。
- 日志：每会话写 `~/.agenticx/logs/cc-bridge/<sid>.log`（可经 `CC_BRIDGE_LOG_DIR` 覆盖）。

### TUI 解析 (tui_parser.py)

**文件功能**：visible_tui 模式下对终端转录做启发式解析。`strip_ansi_and_controls()` 去除 ANSI/OSC/控制字符，`extract_after_anchor()` 取最后一个锚点之后的文本并去重连续行，`parse_visible_tui_tail()` 依据文本长度与空闲秒数计算置信度（封顶 0.95）。

### Studio 客户端配置 (settings.py)

**文件功能**：为 Studio 侧 HTTP 客户端解析运行参数，优先级统一为 **环境变量 > `~/.agenticx/config.yaml` 的 `cc_bridge.*` > 默认值**。
- `cc_bridge_mode()`：解析全局模式（`AGX_CC_BRIDGE_MODE` / `cc_bridge.mode`，默认 `headless`）。
- `cc_bridge_base_url()`：默认 `http://127.0.0.1:9742`。
- `ensure_cc_bridge_token_persisted()` / `cc_bridge_token()`：Token 优先取 `AGX_CC_BRIDGE_TOKEN`（不落盘），否则取/生成并持久化到 config。
- `validate_bridge_url_for_studio()`：默认仅允许 loopback 地址，非环回需显式 `AGX_CC_BRIDGE_ALLOW_NONLOCAL=1`（用于 SSH 隧道/同机远程）。

## 设计模式

### 1. 适配器模式
将外部 `claude` CLI 的 stream-json / 交互式 TUI 两种异构接口，统一适配为一致的 HTTP 会话语义。

### 2. 策略模式（双模式分派）
`session_kind` 驱动 headless 与 visible_tui 在启动、I/O、权限、结果等待上的不同策略。

### 3. 观察者 / 发布-订阅
PTY 输出通过监听队列广播给多个流式消费者（`pty_listeners`），客户端断开时安全摘除。

### 4. 前置鉴权（依赖注入）
FastAPI `Depends(verify_token)` 统一拦截所有受保护路由。

## 技术亮点

1. **协议级权限闭环**：headless 通过 `control_request`/`control_response` 实现工具权限的程序化 allow/deny；`auto_allow`、`permission_policy=allowlist`（低风险只读类）或入队 + `respond_permission` 与 Near 确认 UI 联动，避免无应答时 CLI 阻塞。
2. **回合内流式可观测**：`--include-partial-messages` 与 `drain_midturn_stream_items` 在 `wait_for_success_result` 阻塞期间仍可向外泵送文本/工具进度；`wait_for_success_result` 用水印区分多轮 `result/success`。
3. **PTY 直连交互体验**：visible_tui 以真实 PTY 复刻 CC 原生终端，支持原始流 attach、按键写入与 `TIOCSWINSZ` 尺寸同步，赋能 Desktop 内嵌终端。
4. **稳健的回合完成判定**：headless 依据带水印的 result/success 行，visible_tui 依据锚点 + 空闲时间 + 置信度，规避无终止符的流式 TUI 误判。
5. **安全默认**：Bearer Token 恒定时间比较、UUID 强校验、默认仅 loopback 可达，非环回需显式开关；工具风险未知时 fail-closed 为 `protected`。
6. **可观测性**：每会话独立日志落盘，行缓冲限长防止内存膨胀。

## 应用场景

1. **本机 Claude Code 编排**：Studio/Machi 通过 `cc_bridge_start`/`cc_bridge_send` 等工具驱动本机 CC 执行编码任务。
2. **移动端远程确认**：headless 权限请求可经 HTTP 转交移动端（飞书/IM）审批后回写。
3. **Desktop 内嵌可见终端**：visible_tui 模式将 CC 终端嵌入桌面工作区，保留人工交互与权限确认。

## 总结

CC Bridge 模块以一套受 Token 保护的 HTTP 控制面，桥接了本机 Claude Code CLI 的 headless（stream-json）与 visible_tui（PTY）两种形态，统一了会话生命周期、消息收发、分层权限策略（自动/白名单低风险/入队人工确认）、回合内 SSE 流式旁路与多轮结果水印。它是 AgenticX 将外部成熟编码 Agent 内化进自身运行时与桌面体验的关键集成层，兼顾了自动化协作与人工可见交互两类需求。
