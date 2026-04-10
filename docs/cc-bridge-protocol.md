# CC local bridge protocol (AgenticX)

This document locks the **local** Claude Code headless contract used by `agenticx.cc_bridge`. It is derived from upstream `sessionRunner.ts`, `structuredIO.ts`, and `print.ts` under `research/codedeepresearch/claude-code/upstream/src` (line numbers drift; use function names when reconciling).

## Child process argv (local, no cloud SDK URL)

Minimum flags for NDJSON stdio with stdin permission forwarding:

- `--print`
- `--verbose` (required when `--output-format stream-json` with `--print`, upstream enforces this)
- `--input-format stream-json`
- `--output-format stream-json`
- `--permission-prompt-tool stdio` (emits `control_request` on stdout; host replies with `control_response` on stdin)

Optional: `--permission-mode`, `--resume`, `--allowed-tools`, etc., aligned with upstream CLI.

Executable path: `CC_BRIDGE_EXECUTABLE` env (default `claude`).

## Stdout: one JSON object per line (NDJSON)

Relevant `type` values observed in bridge flows:

| `type` | Role |
|--------|------|
| `user` | User turn (may be replayed / synthetic) |
| `assistant` | Model output; may contain `tool_use` blocks |
| `result` | Turn/session outcome; `subtype` e.g. `success` |
| `control_request` | Permission or other SDK control; bridge must handle or forward |
| `system` | Diagnostics / hooks (when verbose) |

## Stdin: one JSON object per line

Allowed message shapes include:

- **User message** (initial or follow-up):

```json
{
  "type": "user",
  "session_id": "",
  "message": { "role": "user", "content": "..." },
  "parent_tool_use_id": null
}
```

- **Permission allow** (reply to `can_use_tool`):

```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "<matches control_request.request_id>",
    "response": {
      "behavior": "allow",
      "updatedInput": {},
      "toolUseID": "<optional; from request>"
    }
  }
}
```

- **Permission deny**:

```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "<matches>",
    "response": {
      "behavior": "deny",
      "message": "Denied by bridge",
      "toolUseID": "<optional>"
    }
  }
}
```

`updatedInput` for allow should echo the tool `input` from the request when no modification is intended.

## HTTP surface (127.0.0.1)

- `Authorization: Bearer <CC_BRIDGE_TOKEN>` on all routes.
- Default bind: `127.0.0.1:9742` (configurable).
- Non-loopback bridge URLs are rejected from Studio tools unless `AGX_CC_BRIDGE_ALLOW_NONLOCAL=1`.

## Quick start (Machi / Studio)

1. **Token (本机)**  
   - Machi 首次调用 `cc_bridge_*` 时，若未设置 `AGX_CC_BRIDGE_TOKEN`，会在 `~/.agenticx/config.yaml` 写入 `cc_bridge.token`（随机生成）。  
   - 或在 Machi **设置 → 工具 → Claude Code 本机 Bridge** 中查看/保存/重新生成 token。

2. **启动 Bridge**（另一终端）  
   ```bash
   agx cc-bridge serve
   ```  
   若未设置 `CC_BRIDGE_TOKEN`，进程会读取同上 `cc_bridge.token`（或生成并写入配置），与 Machi 侧一致。

3. **方式 B 工具链**  
   - `cc_bridge_start`（`cwd` 填工作目录，可选 `auto_allow_permissions: true`）  
   - `cc_bridge_send`（`session_id` + `prompt`）  
   - 结束后用 `file_read` 或 `bash_exec` + `test -f` **验收落盘**，勿仅凭模型自然语言判断成功。

4. **方式 A（无 Bridge）**  
   - `bash_exec` 优先使用参数 **`cwd`** 指定目录；`cd subdir && cmd` 在无 `cwd` 时会自动剥壳为 `cwd=subdir` + `cmd`。  
   - 调用 `claude -p` 后同样要做文件存在性检查。

## Visible TUI: PTY attach (Machi 内嵌终端)

当 `POST /v1/sessions` 的 `mode` 为 `visible_tui` 时，子进程在 PTY 中运行交互式 `claude`。除原有 `message` / 日志落盘外，Desktop 可通过以下端点**直连 PTY 字节流**（需与 `message` 使用同一 Bearer token）：

| Method | Path | Body | 说明 |
|--------|------|------|------|
| `GET` | `/v1/sessions/{session_id}/stream` | — | `application/octet-stream`，持续输出 PTY 原始字节；会话结束或 `DELETE` 后流结束 |
| `POST` | `/v1/sessions/{session_id}/write` | `{"data":"<UTF-8 字符串，可含控制字符>"}` | 用户键盘输入写入 PTY（不等同于 `message` 的 Machi 锚点注入） |
| `POST` | `/v1/sessions/{session_id}/resize` | `{"cols":80,"rows":24}` | 同步终端窗口尺寸（`TIOCSWINSZ`） |

非 `visible_tui` 会话调用上述路由返回 **400**。`POST .../permission` 在 `visible_tui` 下仍不可用，权限在 TUI 内确认。

## References (upstream)

- `src/cli/print.ts` — `runHeadless`, `stream-json` + `installStreamJsonStdoutGuard`
- `src/cli/structuredIO.ts` — stdin/out control messages
- `src/bridge/sessionRunner.ts` — spawn + line parse + `control_request` (cloud variant adds `--sdk-url`; local bridge omits that)
