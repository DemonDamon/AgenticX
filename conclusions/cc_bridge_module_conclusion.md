# AgenticX CC Bridge 模块总结

> 结论生成时间：2026-05-29（首次创建，覆盖当前代码）

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
- `BridgeSession` 数据类：保存 `proc`、滚动行缓冲（上限 2000 行）、日志落盘路径、`session_kind`、PTY master fd 与监听队列，以及 visible_tui 的锚点/活动时间等状态。
- `start_session()`：按 mode 分派到 `_start_session_headless()`（`claude --print --verbose --input-format stream-json --output-format stream-json --permission-prompt-tool stdio`）或 `_start_session_visible_tui()`（`pty.openpty()` 拉起交互式 `claude`）。
- 读取线程：`_reader_thread`（headless stdout，识别 control_request 并按 `auto_allow` 自动放行）、`_stderr_thread`、`_pty_reader_thread`（PTY 输出广播给监听队列并按行落盘）。
- `send_user_message()`：headless 写 NDJSON user 行；visible_tui 写入文本 + `\r` 并打入锚点（`[agx_tui_anchor] <uuid>`）用于后续转录定位。
- `wait_for_success_result()`：轮询 headless 行缓冲直到出现 result/success、进程退出或超时。
- `wait_for_visible_tui_result()`：基于锚点后文本 + 空闲时间 + 置信度阈值判定 TUI 回合完成。
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

1. **协议级权限闭环**：headless 通过 `control_request`/`control_response` 实现工具权限的程序化 allow/deny，可由 `auto_allow` 自动放行。
2. **PTY 直连交互体验**：visible_tui 以真实 PTY 复刻 CC 原生终端，支持原始流 attach、按键写入与 `TIOCSWINSZ` 尺寸同步，赋能 Desktop 内嵌终端。
3. **稳健的回合完成判定**：headless 依据 result/success 行，visible_tui 依据锚点 + 空闲时间 + 置信度，规避无终止符的流式 TUI 误判。
4. **安全默认**：Bearer Token 恒定时间比较、UUID 强校验、默认仅 loopback 可达，非环回需显式开关。
5. **可观测性**：每会话独立日志落盘，行缓冲限长防止内存膨胀。

## 应用场景

1. **本机 Claude Code 编排**：Studio/Machi 通过 `cc_bridge_start`/`cc_bridge_send` 等工具驱动本机 CC 执行编码任务。
2. **移动端远程确认**：headless 权限请求可经 HTTP 转交移动端（飞书/IM）审批后回写。
3. **Desktop 内嵌可见终端**：visible_tui 模式将 CC 终端嵌入桌面工作区，保留人工交互与权限确认。

## 总结

CC Bridge 模块以一套受 Token 保护的 HTTP 控制面，桥接了本机 Claude Code CLI 的 headless（stream-json）与 visible_tui（PTY）两种形态，统一了会话生命周期、消息收发、权限审批与结果判定。它是 AgenticX 将外部成熟编码 Agent 内化进自身运行时与桌面体验的关键集成层，兼顾了自动化协作与人工可见交互两类需求。
