# Happy Coder × Machi（AgenticX）集成：研读结论

本文档落实「Machi × HappyCoder × Claude Code：学习与集成路径」计划中的 **阶段 A 研读** 与 **上游沟通要点**，源码依据为本地克隆的 `slopus/happy-server`、`slopus/happy-cli`（置于被 gitignore 的 `research/` 下，需自行 `git clone`）。

## 1. 组件与仓库

| 组件 | 仓库 / 包 | 作用 |
|------|-----------|------|
| 桌面 CLI | [slopus/happy-cli](https://github.com/slopus/happy-cli)（npm `happy-coder`，二进制 `happy`） | 包装 Claude Code / Codex / Gemini；tmux、会话、与云端同步 |
| 中继后端 | [slopus/happy-server](https://github.com/slopus/happy-server) | Socket.IO、会话元数据、加密消息落库、用户维度路由 |
| MCP 桥（Codex 侧） | `happy-mcp` → `src/codex/happyMcpStdioBridge.ts` | STDIO MCP → 转发到 **已存在的 HTTP MCP**（`HAPPY_HTTP_MCP_URL`），当前仅注册 `change_title` |

## 2. 配对与加密（客户端）

- 凭证与密钥落在 **`~/.happy/`**（可由 `HAPPY_HOME` 覆盖）：`access.key`、`settings.json`、`daemon.state.json` 等（见 `happy-cli/src/configuration.ts`、`persistence.ts`）。
- `src/ui/auth.ts` 等使用 **TweetNaCl box**、临时公钥 + nonce 的解密流程，与官方「E2E、relay 不读明文」叙述一致。
- **移动端/Web**：通过 QR 等与桌面 CLI 完成密钥交换；第三方桌面若要成为「另一台设备」，需实现 **与官方客户端相同的加密载荷与 Socket 事件**（计划中的 **C1**，工作量大）。

## 3. 云端协议要点（happy-server）

- WebSocket/Socket.IO 侧处理会话元数据、`session-alive`、以及 **`message` 事件**：服务端将客户端提交的 `message` 存为 `{ t: 'encrypted', c: message }`（Base64 密文），见 `sources/app/api/socket/sessionUpdateHandler.ts`。
- **`rpc-register` / `rpc-call` / `rpc-unregister`**（`rpcHandler.ts`）：同一 `userId` 下不同 socket 之间转发 RPC，用于桌面与移动端能力互补（例如一端注册方法、另一端调用）。
- 结论：**没有**面向「任意第三方自动化」的独立 REST「发一句自然语言给 CC」接口；控制面在 **已认证 Socket 连接 + 加密 blob**。

## 4. 本机 Daemon HTTP 控制面（与 C2 强相关）

`happy-cli` 在 **`127.0.0.1` 随机端口** 上启动 Fastify **控制面**（`src/daemon/controlServer.ts`），端口写入 `daemon.state.json`，`controlClient.ts` 用 `fetch` 调用。

当前暴露的 **POST** 路径（代码级核对）：

| 路径 | 作用 |
|------|------|
| `/session-started` | 子会话回报 `sessionId` + `metadata` |
| `/list` | 列出 tracked sessions（`happySessionId`, `pid`, `startedBy`） |
| `/stop-session` | 按 `sessionId` 停止 |
| `/spawn-session` | body: `{ directory, sessionId? }`，可 409 要求目录创建审批 |
| `/stop` | 关闭 daemon |

**安全注意**：未见 Bearer token；仅靠 **回环绑定**。任何本机进程均可调用 → 与 Machi `bash_exec` 同机时等价于「本机高权限」，需在 AgenticX 侧 **勿远程暴露** 该端口。

**缺口**：上述 API **不能**向已运行的 Claude Code 会话 **注入一条用户消息**或订阅完整终端流；要实现计划中的「Machi 发指令 → 同一 CC 会话内执行」，仍需 **上游增加受控 IPC**（例如在 daemon 上增加鉴权后的 `enqueue-input`）或走完整 **C1 协议客户端**。

## 5. 第三方桌面接入点结论

| 路径 | 是否具备「第二桌面控制端」 | 说明 |
|------|---------------------------|------|
| **C1** 复用 Socket + 加密 | 理论上可行 | 需对齐移动端/CLI 的握手、密钥与事件类型；维护成本高 |
| **C2** 扩展 daemon HTTP | **推荐争取** | 在 `controlServer.ts` 增加鉴权 + 与 tmux/CC 输入路径挂钩，Machi 仅连 `127.0.0.1` |
| **C3** `happy-mcp` | 仅窄场景 | 当前为 Codex HTTP MCP 的 STDIO 桥，且工具几乎只有 `change_title`；**不是**通用 CC 会话控制台 |

## 6. 与 Machi（AgenticX）现状的衔接

- **共享工作目录**：Machi 侧 **taskspace** 与 `happy` 启动目录指向同一仓库即可（文件级一致）。
- **共享会话 transcript**：必须通过 **Happy 协议或 daemon 扩展**，不能仅靠 `bash_exec` 起新 `claude` 进程。
- **`claude` 与 SAFE_COMMANDS**：AgenticX 中 `claude` 不在白名单；即便 `bash_exec` 调用，也是 **新进程** 与 **确认流**，与 Happy 会话无关。

## 7. 上游沟通（Touchpoint）— 建议议题

在 [slopus/happy-cli/issues](https://github.com/slopus/happy-cli/issues) 开 **Discussion 或 Feature**，标题可类似：

> **Feature request: Authenticated localhost IPC for automation (e.g. enqueue prompt / subscribe session logs)**

正文建议包含：

1. **场景**：另一桌面应用（Machi）与本机 `happy` daemon 同机，希望在用户已授权前提下向 **当前 Happy 管理的 CC 会话** 提交输入或拉取状态。
2. **约束**：仅 `127.0.0.1`、**随机 token** 写入 `daemon.state.json` 或独立文件、与现有无鉴权 `/list` 兼容迁移。
3. **非目标**：不弱化 E2E；不把明文交给 relay。

**近期相关 Issue（说明社区已在关注 MCP/HTTP 路径）**：

- [#162](https://github.com/slopus/happy-cli/issues/162)、[#165](https://github.com/slopus/happy-cli/issues/165)：MCP / `change_title` 与 SDK 1.26.0、HTTP 500 等（集成 MCP 前建议跟踪）。

## 8. 本地验证脚本

仓库内提供 **不依赖克隆源码** 的探针：`examples/happy-coder-machi-probe/happy_daemon_probe.py`（读取 `~/.happy/daemon.state.json`，调用 `POST /list`）。详见该目录 `README.md`。

---

*研读基于 happy-cli 与 happy-server 的浅层克隆阅读；协议细节以官方更新为准。*
