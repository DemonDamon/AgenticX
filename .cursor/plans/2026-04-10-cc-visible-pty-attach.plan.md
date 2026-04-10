---
name: cc-visible-pty-attach
overview: 将 Visible TUI 从 tail 日志升级为真 PTY 交互：Electron 终端 attach bridge 会话 PTY（stream/write/resize），保留日志解析与 parsed_response 回填。
todos:
  - id: bridge-stream-api
    content: visible_tui 的 stream/write/resize HTTP 端点与鉴权
    status: completed
  - id: session-broadcast
    content: session_manager PTY 输出广播与 write/resize 接口
    status: completed
  - id: desktop-remote-terminal
    content: Electron + TerminalEmbed bridge-pty 会话
    status: completed
  - id: chatpane-attach-switch
    content: ChatPane 以 ccBridgePty 挂载为主，无 token 时 tail 兜底
    status: completed
  - id: tests-e2e-smoke
    content: test_cc_bridge_pty_stream 与 desktop build
    status: completed
isProject: false
---

# CC Visible PTY Attach 实施计划（归档）

## 目标
内嵌 xterm 直接接收/发送 PTY 原始字节，而非 `tail -f` 会话日志；`cc_bridge_send` 与 `/write` 语义分离（前者带 Machi 锚点注入，后者为用户键盘）。

## HTTP（Bearer 同现有）
- `GET /v1/sessions/{id}/stream` — `application/octet-stream`
- `POST /v1/sessions/{id}/write` — `{"data":"..."}`
- `POST /v1/sessions/{id}/resize` — `{"cols","rows"}`

## 关键路径
- Bridge：`session_manager` 广播 + `http_app` 端点
- Desktop：`terminal-bridge-attach` IPC、`TerminalEmbed` + `PaneTerminalTab.ccBridgePty`、`ChatPane` 取 Studio config 中 url/token

## 风险（后续可增强）
- 长连接心跳/重连；会话结束时流与订阅清理（已在 stop/wait 路径唤醒 listener）。
