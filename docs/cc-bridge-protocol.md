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

## References (upstream)

- `src/cli/print.ts` — `runHeadless`, `stream-json` + `installStreamJsonStdoutGuard`
- `src/cli/structuredIO.ts` — stdin/out control messages
- `src/bridge/sessionRunner.ts` — spawn + line parse + `control_request` (cloud variant adds `--sdk-url`; local bridge omits that)
