---
name: Happy Coder Machi 桥接（后续实施）
overview: 在 happy-cli daemon 已暴露本机 HTTP 控制面、但尚无「注入 CC 输入」能力的前提下，定义 AgenticX 侧最小可行桥接：会话发现、可选 MCP/IPC、权限与白名单策略；深依赖 Happy 上游 C2 或自研 C1。
todos:
  - id: fr-daemon-discover
    content: FR：Desktop 或 agx 工具链读取 ~/.happy/daemon.state.json 并调用 POST /list；无 daemon 时降级提示
    status: pending
  - id: fr-secure-localhost
    content: FR：任何对 happy daemon 的调用必须限制本机且不误暴露到远程 agx serve；远程后端模式下禁止依赖 daemon
    status: pending
  - id: fr-upstream-or-fallback
    content: FR：若上游未提供 enqueue-input，仅文档化 + 探针；不将 claude 全局加入 SAFE_COMMANDS
    status: pending
  - id: fr-mcp-optional
    content: FR（可选）：若使用 happy-mcp，配置 HAPPY_HTTP_MCP_URL 并跟踪 slopus/happy-cli#162 #165 兼容性
    status: pending
  - id: ac-probe-ci
    content: AC：examples/happy-coder-machi-probe/happy_daemon_probe.py 在无 daemon 时 exit 1 且 stderr 可读
    status: pending
isProject: false
---

# Happy Coder × Machi 桥接（后续实施规格）

**前置阅读**：[docs/guides/happy-coder-machi-integration.md](docs/guides/happy-coder-machi-integration.md)

## 背景

- Happy `happy-cli` 在 `127.0.0.1` 提供 daemon HTTP：`/list`、`/spawn-session`、`/stop-session` 等（无 Bearer 鉴权，依赖回环）。
- **当前无** 向已运行 Claude Code 会话 **注入用户消息** 的公开 HTTP 接口；完整「同一会话」体验依赖 **上游 C2** 或 **C1 级 Socket 客户端**。

## 需求（FR）

| ID | 描述 |
|----|------|
| FR-1 | **会话发现**：实现层可从 `~/.happy/daemon.state.json`（或 `HAPPY_HOME`）读取 `httpPort`，调用 `POST /list` 展示 `happySessionId` / `pid`，供 Machi UI 或 Meta 上下文使用。 |
| FR-2 | **安全边界**：仅在 **agx serve 与 Happy 同机** 时启用桥接；若启用 [Desktop 远程后端](.cursor/plans/2026-03-24-desktop-remote-backend.plan.md)，默认 **关闭** daemon 依赖或要求 SSH 到开发机。 |
| FR-3 | **权限**：不把 `claude` 全局加入 `SAFE_COMMANDS`；若新增 `happy_daemon_call` 类工具，走 **confirm_gate** 或固定只读端点（如仅 `/list`）。 |
| FR-4 | **上游就绪路径**：当 Happy 提供鉴权后的 `enqueue-input`（名称以官方为准）时，再在 `agenticx/cli/agent_tools.py` 或 Desktop IPC 中封装 **单次** 调用，并记录审计日志。 |

## 验收（AC）

- AC-1：无 daemon 时，官方探针 [examples/happy-coder-machi-probe/happy_daemon_probe.py](examples/happy-coder-machi-probe/happy_daemon_probe.py) exit 非零且 stderr 说明清晰（已实现）。
- AC-2：有 daemon 时，`/list` 返回 200 且 JSON 可被解析（手工验收）。

## 非目标（本期）

- 实现完整 Socket.IO + E2E 的第三桌面客户端（C1）。
- 替代 Happy 移动端或修改 relay 服务端行为。

## 参考 Issue

- [slopus/happy-cli#162](https://github.com/slopus/happy-cli/issues/162)、[#165](https://github.com/slopus/happy-cli/issues/165)（MCP / HTTP 工具链稳定性）。
