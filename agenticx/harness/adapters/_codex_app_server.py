#!/usr/bin/env python3
"""Codex app-server JSON-RPC client (JSONL over stdio) for Near.

``codex exec --json`` (0.167) only emits assistant text as a single
``item.completed`` line, so Near cannot stream tokens. The reserved
app-server transport emits ``item/agentMessage/delta`` notifications
which this module forwards as mid-turn ``kind=text`` items for the
existing 200ms SSE pump in ``_external_harness_chat_stream``.

Wire format (Codex 0.167 stdio): newline-delimited JSON-RPC 2.0 with
the ``"jsonrpc":"2.0"`` member omitted. Handshake is ``initialize``
then the ``initialized`` notification, then ``thread/start`` or
``thread/resume``, then ``turn/start``. The turn ends on
``turn/completed``.

Author: Damon Li
"""

from __future__ import annotations

import os
import queue
import subprocess
import threading
import time
from typing import Any, Callable, Dict, List, Optional

import ujson

_RESULT_TEXT_MAX_CHARS = 4000
_HANDSHAKE_SECONDS = 20.0
_STDERR_TAIL_MAX = 40

# Notification methods (stable v2 surface).
METHOD_AGENT_MESSAGE_DELTA = "item/agentMessage/delta"
METHOD_ITEM_STARTED = "item/started"
METHOD_ITEM_COMPLETED = "item/completed"
METHOD_TURN_STARTED = "turn/started"
METHOD_TURN_COMPLETED = "turn/completed"
METHOD_THREAD_STARTED = "thread/started"
METHOD_THREAD_TOKEN_USAGE = "thread/tokenUsage/updated"
METHOD_ERROR = "error"
METHOD_WARNING = "warning"
METHOD_CONFIG_WARNING = "configWarning"

# Server-initiated requests we can auto-resolve so a non-interactive
# Near turn cannot stall on an unexpected approval prompt.
_AUTO_ACCEPT_METHODS = {
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "execCommandApproval",
    "applyPatchApproval",
}

# Tool-like item types that should surface as mid-turn tool rows.
_TOOL_ITEM_TYPES = {
    "commandExecution": "bash",
    "command_execution": "bash",
    "fileChange": "patch",
    "file_change": "patch",
    "mcpToolCall": "mcp",
    "mcp_tool_call": "mcp",
    "webSearch": "web_search",
    "web_search": "web_search",
    "dynamicToolCall": "tool",
    "dynamic_tool_call": "tool",
}

TRANSPORT_ENV = "AGX_CODEX_TRANSPORT"


class AppServerUnavailable(Exception):
    """Raised when app-server cannot be started or initialized.

    The Codex adapter falls back to ``codex exec --json`` for the turn.
    Do not use this after a turn has already been started on app-server.
    """


def preferred_transport() -> str:
    raw = str(os.environ.get(TRANSPORT_ENV, "app-server") or "").strip().lower()
    if raw in {"exec", "exec-json", "json", "exec_json"}:
        return "exec"
    return "app-server"


def build_app_server_argv(executable: str) -> List[str]:
    """CLI used to start a stdio app-server.

    ``--skip-git-repo-check`` is an ``exec``-only flag. Passing
    ``-c skip_git_repo_check=true`` to app-server 0.167 is ignored
    (``session-flags: skip_git_repo_check is ignored``) and just
    emits a config warning. App-server itself does not enforce that
    trusted-git gate, so a Near non-git taskspace can start a thread
    without the flag. The exec --json fallback still passes
    ``--skip-git-repo-check`` (#331). Never forward the internal
    ``model_provider`` stamp (#337).
    """
    return [executable, "app-server", "--stdio"]


def _client_version() -> str:
    try:
        from agenticx._version import __version__

        return str(__version__)
    except Exception:  # pragma: no cover - extremely defensive
        return "0.0.0"


def initialize_params() -> Dict[str, Any]:
    return {
        "clientInfo": {
            "name": "agenticx_near",
            "title": "Near",
            "version": _client_version(),
        }
    }


def resolved_codex_sandbox_mode(
    sandbox: Optional[str] = None,
    full_auto: bool = False,
) -> Optional[str]:
    """Sandbox mode sent to thread/start or ``codex exec --sandbox``.

    ``full_auto`` still means ``danger-full-access`` when no explicit
    sandbox is set. Near 「全部允许」 must not use that path: it maps to
    ``workspace-write`` plus network instead.
    """
    mode = str(sandbox or "").strip() or None
    if full_auto and not mode:
        return "danger-full-access"
    return mode


def sandbox_policy_params(
    sandbox: Optional[str] = None,
    *,
    network_access: Optional[bool] = None,
    full_auto: bool = False,
) -> Optional[Dict[str, Any]]:
    """Structured ``sandboxPolicy`` for turn/start (0.167 app-server).

    Workspace-write defaults to no network; ``networkAccess`` must be
    set explicitly when Near auto/「全部允许」 needs outbound tools.
    """
    mode = resolved_codex_sandbox_mode(sandbox, full_auto)
    if mode == "danger-full-access":
        return {"type": "dangerFullAccess"}
    if mode == "read-only":
        policy: Dict[str, Any] = {"type": "readOnly"}
        if network_access is True:
            policy["networkAccess"] = True
        return policy
    if mode == "workspace-write":
        policy = {"type": "workspaceWrite"}
        if network_access is True:
            policy["networkAccess"] = True
        return policy
    return None


def workspace_write_network_config(network_access: Optional[bool]) -> Optional[Dict[str, Any]]:
    """Config.toml-shaped override for thread/start ``config``."""
    if network_access is not True:
        return None
    return {"sandbox_workspace_write": {"network_access": True}}


def thread_start_params(
    *,
    cwd: str,
    model: Optional[str] = None,
    sandbox: Optional[str] = None,
    full_auto: bool = False,
    network_access: Optional[bool] = None,
) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "cwd": cwd,
        "approvalPolicy": "never",
        "serviceName": "agenticx_near",
    }
    if model:
        params["model"] = model
    mode = resolved_codex_sandbox_mode(sandbox, full_auto)
    if mode:
        params["sandbox"] = mode
    config = workspace_write_network_config(
        network_access if mode == "workspace-write" else None
    )
    if config:
        params["config"] = config
    return params


def thread_resume_params(thread_id: str) -> Dict[str, Any]:
    """Resume by thread id only.

    Do not send cwd / sandbox on resume: the same constraint as
    ``codex exec resume`` rejecting ``-C`` / ``--sandbox`` (#332).
    ``excludeTurns`` avoids a deprecated full-history payload.
    """
    return {"threadId": thread_id, "excludeTurns": True}


def turn_start_params(
    thread_id: str,
    text: str,
    *,
    model: Optional[str] = None,
    sandbox: Optional[str] = None,
    full_auto: bool = False,
    network_access: Optional[bool] = None,
) -> Dict[str, Any]:
    """Build turn/start params.

    ``sandboxPolicy`` is sent when Near mapped a sandbox so a resumed
    thread (which cannot take ``--sandbox`` on ``codex exec resume``,
    and whose app-server ``thread/resume`` still omits sandbox to stay
    compatible with #332) still picks up the current permission mode
    for this turn and subsequent turns.
    """
    params: Dict[str, Any] = {
        "threadId": thread_id,
        "input": [{"type": "text", "text": text}],
    }
    if model:
        params["model"] = model
    policy = sandbox_policy_params(
        sandbox, network_access=network_access, full_auto=full_auto
    )
    if policy:
        params["sandboxPolicy"] = policy
    return params


def _item_type(item: Dict[str, Any]) -> str:
    return str(item.get("type") or "")


def _item_id(item: Dict[str, Any]) -> str:
    return str(item.get("id") or "").strip()


def _usage_tokens(token_usage: Any) -> Dict[str, Any]:
    if not isinstance(token_usage, dict):
        return {}
    last = token_usage.get("last") or token_usage
    if not isinstance(last, dict):
        return {}
    mapping = (
        ("inputTokens", "input"),
        ("input_tokens", "input"),
        ("cachedInputTokens", "cached_input"),
        ("cached_input_tokens", "cached_input"),
        ("outputTokens", "output"),
        ("output_tokens", "output"),
    )
    tokens: Dict[str, Any] = {}
    for src, dest in mapping:
        value = last.get(src)
        if value is not None:
            tokens[dest] = value
    return tokens


def _record_warning(acc: Dict[str, Any], message: str) -> None:
    text = str(message)[:500]
    if not text:
        return
    detail: Dict[str, Any] = acc.setdefault("detail", {})
    warnings = detail.setdefault("warnings", [])
    if text not in warnings:
        warnings.append(text)


def _record_command(acc: Dict[str, Any], command: Any) -> None:
    detail: Dict[str, Any] = acc.setdefault("detail", {})
    tools = detail.setdefault("observed_tools", [])
    if "bash" not in tools:
        tools.append("bash")
    if command is None:
        return
    commands = detail.setdefault("commands", [])
    if isinstance(command, list):
        rendered = " ".join(str(part) for part in command)[:200]
    else:
        rendered = str(command)[:200]
    if rendered:
        commands.append(rendered)


def _tool_name_for_item(item: Dict[str, Any]) -> Optional[str]:
    itype = _item_type(item)
    if itype in _TOOL_ITEM_TYPES:
        if itype in {"mcpToolCall", "mcp_tool_call"}:
            return str(item.get("tool") or item.get("server") or "mcp")
        if itype in {"dynamicToolCall", "dynamic_tool_call"}:
            return str(item.get("tool") or "tool")
        if itype in {"webSearch", "web_search"}:
            return "web_search"
        if itype in {"fileChange", "file_change", "patch", "apply_patch"}:
            return "patch"
        return "bash"
    return None


def _tool_is_error(item: Dict[str, Any]) -> bool:
    status = str(item.get("status") or "").lower()
    if status in {"failed", "declined", "error"}:
        return True
    if item.get("success") is False:
        return True
    exit_code = item.get("exitCode")
    if exit_code is None:
        exit_code = item.get("exit_code")
    if isinstance(exit_code, int) and exit_code != 0:
        return True
    return bool(item.get("error"))


def consume_app_server_message(
    message: Dict[str, Any],
    acc: Dict[str, Any],
    enqueue: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> None:
    """Fold one JSON-RPC message into ``acc`` and optional mid-turn queue.

    Used by the live client and by unit tests that replay recorded
    notifications. ``enqueue`` receives ``{kind, text?}`` / tool rows.
    """
    if not isinstance(message, dict):
        return
    method = message.get("method")
    if not isinstance(method, str) or not method:
        return
    params = message.get("params")
    if not isinstance(params, dict):
        params = {}

    if method == METHOD_THREAD_STARTED:
        thread = params.get("thread")
        if isinstance(thread, dict) and thread.get("id"):
            acc["native_thread_id"] = str(thread["id"])
        return

    if method == METHOD_TURN_STARTED:
        turn = params.get("turn")
        if isinstance(turn, dict) and turn.get("id"):
            acc["turn_id"] = str(turn["id"])
        return

    if method == METHOD_AGENT_MESSAGE_DELTA:
        delta = params.get("delta")
        if isinstance(delta, str) and delta:
            acc["streamed_text"] = True
            current = str(acc.get("result_text") or "")
            acc["result_text"] = (current + delta)[:_RESULT_TEXT_MAX_CHARS]
            if enqueue is not None:
                enqueue({"kind": "text", "text": delta})
        return

    if method in {METHOD_ITEM_STARTED, METHOD_ITEM_COMPLETED}:
        item = params.get("item")
        if not isinstance(item, dict):
            return
        itype = _item_type(item)
        if itype in {"agentMessage", "agent_message"}:
            if method == METHOD_ITEM_COMPLETED:
                chunk = item.get("text") or item.get("message")
                if isinstance(chunk, str) and chunk:
                    acc["result_text"] = chunk[:_RESULT_TEXT_MAX_CHARS]
                    if not acc.get("streamed_text") and enqueue is not None:
                        enqueue({"kind": "text", "text": chunk})
            return
        if itype == "error":
            message_text = item.get("message") or item.get("error")
            if message_text:
                _record_warning(acc, str(message_text))
            return
        tool_name = _tool_name_for_item(item)
        if tool_name is None:
            return
        detail: Dict[str, Any] = acc.setdefault("detail", {})
        tools = detail.setdefault("observed_tools", [])
        label = "bash" if tool_name == "bash" else (
            "patch" if tool_name == "patch" else tool_name
        )
        if label not in tools and label in {"bash", "patch"}:
            tools.append(label)
        elif label not in tools and itype in {"webSearch", "web_search", "mcpToolCall", "mcp_tool_call"}:
            tools.append(label)
        if (
            method == METHOD_ITEM_STARTED
            and itype in {"commandExecution", "command_execution", "command"}
        ):
            _record_command(acc, item.get("command"))
        if enqueue is not None:
            tid = _item_id(item)
            if tid:
                if method == METHOD_ITEM_STARTED:
                    enqueue(
                        {
                            "kind": "tool_start",
                            "tool_call_id": tid,
                            "name": tool_name,
                        }
                    )
                else:
                    enqueue(
                        {
                            "kind": "tool_end",
                            "tool_call_id": tid,
                            "name": tool_name,
                            "is_error": _tool_is_error(item),
                        }
                    )
        return

    if method == METHOD_THREAD_TOKEN_USAGE:
        tokens = _usage_tokens(params.get("tokenUsage") or params.get("token_usage"))
        if tokens:
            acc.setdefault("detail", {})["tokens"] = tokens
        return

    if method == METHOD_TURN_COMPLETED:
        turn = params.get("turn")
        if not isinstance(turn, dict):
            turn = {}
        status = str(turn.get("status") or "")
        acc["turn_done"] = True
        acc["turn_status"] = status
        if turn.get("id"):
            acc["turn_id"] = str(turn["id"])
        detail: Dict[str, Any] = acc.setdefault("detail", {})
        if status == "completed":
            detail["task_complete"] = True
        error = turn.get("error")
        if isinstance(error, dict):
            message_text = error.get("message") or error.get("codexErrorInfo")
            if status in {"failed", "interrupted"} and message_text:
                acc["error"] = str(message_text)[:500]
            elif message_text:
                _record_warning(acc, str(message_text))
        elif status == "failed":
            acc["error"] = acc.get("error") or "turn failed"
        elif status == "interrupted":
            acc["error"] = acc.get("error") or "turn interrupted"
        # Some builds also attach usage on the turn object.
        tokens = _usage_tokens(turn.get("tokenUsage") or turn.get("usage"))
        if tokens:
            detail["tokens"] = tokens
        return

    if method in {METHOD_ERROR, METHOD_WARNING, METHOD_CONFIG_WARNING}:
        error = params.get("error") if isinstance(params.get("error"), dict) else params
        message_text = ""
        if isinstance(error, dict):
            message_text = str(error.get("message") or error.get("summary") or "")
        if not message_text:
            message_text = str(params.get("message") or params.get("summary") or "")
        will_retry = bool(params.get("willRetry") or params.get("will_retry"))
        if message_text and not will_retry:
            # A retryable model error must not fail the turn early.
            # A non-retryable error notification is still a warning until
            # ``turn/completed`` arrives with a terminal status, matching
            # how exec --json treats item.type=error metadata warnings.
            _record_warning(acc, message_text)
        elif message_text:
            _record_warning(acc, message_text)
        return


def auto_approval_result(method: str) -> Optional[Dict[str, Any]]:
    if method in _AUTO_ACCEPT_METHODS:
        return {"decision": "accept"}
    return None


class CodexAppServerRpc:
    """One long-lived ``codex app-server --stdio`` child process."""

    def __init__(
        self,
        argv: List[str],
        *,
        cwd: str,
        env: Optional[Dict[str, str]] = None,
        enqueue: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> None:
        self.argv = argv
        self.cwd = cwd
        self.env = env
        self.enqueue = enqueue
        self.proc: Optional[subprocess.Popen] = None
        self.acc: Dict[str, Any] = {"result_text": "", "detail": {}}
        self._incoming: "queue.Queue[Optional[Dict[str, Any]]]" = queue.Queue()
        self._lock = threading.Lock()
        self._next_id = 1
        self._pending: Dict[Any, "queue.Queue[Dict[str, Any]]"] = {}
        self._stderr_lines: List[str] = []
        self._reader_error: List[str] = []
        self._closed = False

    def start(self, timeout: float = _HANDSHAKE_SECONDS) -> None:
        try:
            self.proc = subprocess.Popen(
                self.argv,
                cwd=self.cwd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        except FileNotFoundError as exc:
            raise AppServerUnavailable(f"failed to spawn app-server: {exc}") from exc
        if self.proc.stdin is None or self.proc.stdout is None:
            self.close()
            raise AppServerUnavailable("app-server stdio is not available")
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()
        try:
            self.request("initialize", initialize_params(), timeout=timeout)
            self.notify("initialized")
        except Exception as exc:
            self.close()
            raise AppServerUnavailable(f"app-server initialize failed: {exc}") from exc

    def alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None and not self._closed

    def request(
        self,
        method: str,
        params: Optional[Dict[str, Any]] = None,
        *,
        timeout: float,
    ) -> Dict[str, Any]:
        if not self.alive():
            raise AppServerUnavailable("app-server process is not running")
        with self._lock:
            req_id = self._next_id
            self._next_id += 1
            waiter: "queue.Queue[Dict[str, Any]]" = queue.Queue()
            self._pending[req_id] = waiter
        payload: Dict[str, Any] = {"method": method, "id": req_id}
        if params is not None:
            payload["params"] = params
        self._write(payload)
        deadline = time.monotonic() + max(timeout, 0.01)
        message = None
        try:
            while message is None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise queue.Empty()
                try:
                    message = waiter.get(timeout=min(remaining, 0.1))
                except queue.Empty:
                    if not self.alive():
                        with self._lock:
                            self._pending.pop(req_id, None)
                        raise AppServerUnavailable(
                            f"app-server exited while waiting for {method}: "
                            f"{self.stderr_tail() or 'no stderr'}"
                        )
                    continue
        except queue.Empty as exc:
            with self._lock:
                self._pending.pop(req_id, None)
            raise AppServerUnavailable(
                f"timed out waiting for {method} response"
            ) from exc
        if "error" in message and message.get("error") is not None:
            raise RpcError(method, message.get("error"))
        result = message.get("result")
        return result if isinstance(result, dict) else {}

    def notify(self, method: str, params: Optional[Dict[str, Any]] = None) -> None:
        payload: Dict[str, Any] = {"method": method}
        if params is not None:
            payload["params"] = params
        self._write(payload)

    def wait_for_turn(self, timeout: Optional[float]) -> None:
        deadline = None if timeout is None or timeout <= 0 else time.monotonic() + timeout
        while not self.acc.get("turn_done"):
            if not self.alive() and self._incoming.empty():
                raise RuntimeError(
                    self.acc.get("error")
                    or self.stderr_tail()
                    or "app-server exited before turn/completed"
                )
            remaining = 0.2
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("app-server turn timed out")
                remaining = min(remaining, 0.2)
            try:
                message = self._incoming.get(timeout=max(remaining, 0.01))
            except queue.Empty:
                continue
            if message is None:
                if self.acc.get("turn_done"):
                    return
                raise RuntimeError(
                    self.acc.get("error")
                    or self.stderr_tail()
                    or "app-server stdout closed before turn/completed"
                )

    def begin_turn(self) -> None:
        self.acc = {"result_text": "", "detail": dict(self.acc.get("detail") or {})}
        self.acc["detail"].pop("task_complete", None)
        self.acc["detail"].pop("warnings", None)

    def stderr_tail(self) -> str:
        return "\n".join(self._stderr_lines[-20:]).strip()

    def close(self) -> None:
        self._closed = True
        proc = self.proc
        if proc is None:
            return
        if proc.poll() is None:
            try:
                if proc.stdin is not None:
                    proc.stdin.close()
            except Exception:
                pass
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:  # pragma: no cover
                    pass
        self.proc = None

    def _write(self, payload: Dict[str, Any]) -> None:
        proc = self.proc
        if proc is None or proc.stdin is None or proc.poll() is not None:
            raise AppServerUnavailable("app-server stdin is closed")
        line = ujson.dumps(payload, ensure_ascii=False) + "\n"
        with self._lock:
            proc.stdin.write(line)
            proc.stdin.flush()

    def _read_stdout(self) -> None:
        proc = self.proc
        try:
            assert proc is not None and proc.stdout is not None
            for raw in proc.stdout:
                stripped = raw.strip()
                if not stripped:
                    continue
                try:
                    message = ujson.loads(stripped)
                except (ValueError, TypeError):
                    continue
                if isinstance(message, dict):
                    self._dispatch(message)
        except Exception as exc:  # pragma: no cover - defensive
            self._reader_error.append(str(exc))
        finally:
            self._incoming.put(None)

    def _read_stderr(self) -> None:
        proc = self.proc
        try:
            assert proc is not None and proc.stderr is not None
            for raw in proc.stderr:
                stripped = raw.strip()
                if not stripped:
                    continue
                self._stderr_lines.append(stripped[-2000:])
                if len(self._stderr_lines) > _STDERR_TAIL_MAX:
                    self._stderr_lines = self._stderr_lines[-_STDERR_TAIL_MAX:]
        except Exception:  # pragma: no cover
            return

    def _dispatch(self, message: Dict[str, Any]) -> None:
        msg_id = message.get("id")
        method = message.get("method")
        # Server request: has method + id and no result/error.
        if (
            isinstance(method, str)
            and msg_id is not None
            and "result" not in message
            and "error" not in message
        ):
            self._handle_server_request(method, msg_id, message.get("params"))
            return
        if msg_id is not None and ("result" in message or "error" in message):
            with self._lock:
                waiter = self._pending.pop(msg_id, None)
            if waiter is not None:
                waiter.put(message)
            return
        consume_app_server_message(message, self.acc, self.enqueue)
        if message.get("method"):
            self._incoming.put(message)

    def _handle_server_request(
        self, method: str, msg_id: Any, params: Any
    ) -> None:
        result = auto_approval_result(method)
        try:
            if result is not None:
                self._write({"id": msg_id, "result": result})
            else:
                self._write(
                    {
                        "id": msg_id,
                        "error": {
                            "code": -32601,
                            "message": f"unsupported server request: {method}",
                        },
                    }
                )
        except AppServerUnavailable:
            return


class RpcError(Exception):
    """JSON-RPC error response from app-server."""

    def __init__(self, method: str, error: Any) -> None:
        self.method = method
        self.error = error
        message = _rpc_error_message(method, error)
        super().__init__(message)
        self.message = message


def _rpc_error_message(method: str, error: Any) -> str:
    if isinstance(error, dict):
        parts = [str(error.get("message") or "").strip()]
        data = error.get("data")
        if isinstance(data, dict):
            dtype = data.get("type") or data.get("reason")
            if dtype:
                parts.append(str(dtype))
            extra = data.get("message")
            if extra:
                parts.append(str(extra))
        text = " ".join(p for p in parts if p)
        if text:
            return f"{method} failed: {text}"
        return f"{method} failed: {ujson.dumps(error)}"
    return f"{method} failed: {error}"


def thread_id_from_result(result: Dict[str, Any]) -> Optional[str]:
    thread = result.get("thread")
    if isinstance(thread, dict) and thread.get("id"):
        return str(thread["id"])
    if result.get("id"):
        return str(result["id"])
    return None


__all__ = [
    "AppServerUnavailable",
    "CodexAppServerRpc",
    "RpcError",
    "TRANSPORT_ENV",
    "build_app_server_argv",
    "consume_app_server_message",
    "preferred_transport",
    "thread_id_from_result",
    "resolved_codex_sandbox_mode",
    "sandbox_policy_params",
    "thread_resume_params",
    "thread_start_params",
    "turn_start_params",
    "workspace_write_network_config",
]
