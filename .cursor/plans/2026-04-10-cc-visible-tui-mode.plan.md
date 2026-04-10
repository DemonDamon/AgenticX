---
name: cc-visible-tui-mode
overview: 新增 Claude Code Visible TUI 全局模式：在 Machi 内嵌终端可见执行，TUI 日志解析回填聊天；保留 headless 可切换；Settings 与 Studio API 承载 mode。
todos:
  - id: config-mode
    content: 扩展 cc_bridge 配置与 /api/cc-bridge/config，新增 mode 并接入 Settings
    status: completed
  - id: bridge-visible-session
    content: session_manager 实现 visible_tui PTY 会话、注入消息、状态管理
    status: completed
  - id: tui-parser
    content: tui_parser ANSI 清洗、锚点后提取、置信度与完成判定
    status: completed
  - id: api-compat
    content: /v1/sessions 与 /message 兼容 headless/visible_tui
    status: completed
  - id: desktop-integration
    content: ChatPane/ChatView 回填与工具结果文案；内嵌终端联动
    status: completed
  - id: tests-smoke
    content: Python 单测（parser、HTTP、Studio config）与 Desktop build 冒烟
    status: completed
isProject: false
---

# CC Visible TUI 模式实施计划（归档）

## 目标
- 提供有头模式：Machi 内嵌终端可见 Claude TUI，并由 Machi 将消息发送到该会话。
- V1：Visible TUI + 自动解析回填；模式切换仅在 Settings 全局。

## 验收要点
- `mode: headless | visible_tui` 持久化；Visible TUI 下 `cc_bridge_send` 可在内嵌终端观察执行。
- 解析成功回填气泡；低置信度明确回退提示。
- 权限在 TUI 内确认；headless 行为不变。

后续 **PTY 字节流直连** 见 `.cursor/plans/2026-04-10-cc-visible-pty-attach.plan.md`。
