#!/usr/bin/env python3
"""Codex adapter for the unified harness control surface (SP2).

The default Near path uses Codex app-server JSON-RPC so assistant text
can stream as ``item/agentMessage/delta`` notifications::

    codex app-server --stdio

Handshake: ``initialize`` → ``initialized`` → ``thread/start`` or
``thread/resume`` → ``turn/start``. Mid-turn deltas are queued for
``drain_midturn_stream_items`` and forwarded by Near's existing 200ms
SSE ``token`` pump. ``turn/completed`` ends the turn.

``codex exec --json`` cannot stream tokens: 0.167 only emits assistant
text as a single ``item.completed`` line. That transport is kept as a
fallback when app-server cannot start or handshake, and for tests that
set ``AGX_CODEX_TRANSPORT=exec``::

    codex exec --json --skip-git-repo-check [-C cwd] [-m model] [--sandbox MODE] TEXT
    codex exec resume <THREAD_ID> --json --skip-git-repo-check [...] TEXT

The exec fallback always passes ``--skip-git-repo-check`` because Near
chooses the cwd (session taskspaces are often empty, non-git directories).
App-server 0.167 does not honor that flag as a config override and does
not enforce the same trusted-git gate. Resume still omits ``-C`` / ``--cd``
and ``--sandbox`` (#332); app-server resume sends only ``threadId``.
The internal ``model_provider`` stamp is never a spawn/CLI option
(#337). An ``item.type=error`` metadata warning is not fatal.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from agenticx.harness.adapters._codex_app_server import (
    AppServerUnavailable,
    CodexAppServerRpc,
    RpcError,
    build_app_server_argv,
    preferred_transport,
    thread_id_from_result,
    thread_resume_params,
    thread_start_params,
    turn_start_params,
)
from agenticx.harness.adapters._exec_cli import ExecCliHarnessAdapter, ExecCliSession
from agenticx.harness.spawn_options import adapter_spawn_options
from agenticx.harness.types import (
    TURN_STATUS_ERROR,
    TURN_STATUS_SUCCESS,
    TURN_STATUS_TIMEOUT,
    SessionNotFoundError,
    TurnInProgressError,
    TurnRequest,
    TurnResult,
    HarnessCapabilities,
)

_RESULT_TEXT_MAX_CHARS = 4000

_CODEX_SANDBOXES = frozenset(
    {"read-only", "workspace-write", "danger-full-access"}
)

# Official 0.167 config override: workspace-write has no network by default.
_NETWORK_ACCESS_CONFIG = "sandbox_workspace_write.network_access={value}"


def _exec_network_access_config_args(opts: Dict[str, Any]) -> List[str]:
    """``-c sandbox_workspace_write.network_access=...`` for exec argv.

    Only relevant for ``workspace-write``. danger-full-access already has
    network; read-only ignores this table. An explicit boolean is always
    written so a user config.toml cannot silently grant or deny network
    when Near mapped this mode.
    """
    sandbox = opts.get("sandbox")
    if sandbox != "workspace-write":
        return []
    enabled = bool(opts.get("network_access"))
    return ["-c", _NETWORK_ACCESS_CONFIG.format(value="true" if enabled else "false")]


def _event_payload(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return the inner message, supporting both envelope layouts."""
    msg = event.get("msg")
    if isinstance(msg, dict):
        return msg
    # Codex 0.167+ emits flat {type, ...} lines without the msg envelope.
    if isinstance(event.get("type"), str):
        return event
    return None


class CodexAdapter(ExecCliHarnessAdapter):
    """``codex`` CLI (BYOS; app-server streaming, exec --json fallback)."""

    harness_id = "codex"
    display_name = "Codex"
    description = "OpenAI Codex CLI (BYOS; app-server token stream, resume thread)"

    def capabilities(self) -> HarnessCapabilities:
        return HarnessCapabilities(
            permission=False,  # non-interactive; sandbox / approvalPolicy=never
            pty=False,
            streaming=True,  # app-server item/agentMessage/delta → SSE tokens
            turn_snapshots=True,
            idempotency=False,
            resume=True,  # thread/resume or exec resume <thread_id>
            handoff_injection=False,  # enabled with SP4
        )

    def _default_executable(self) -> str:
        return "codex"

    def _env_var(self) -> str:
        return "AGX_CODEX_EXECUTABLE"

    # ------------------------------------------------------------------
    # spawn options
    # ------------------------------------------------------------------
    def _validate_options(self, options: Dict[str, Any]) -> None:
        allowed = {"model", "sandbox", "full_auto", "network_access"}
        # Internal stamps (e.g. model_provider) stay on harness_options
        # for skip-resume, but are not Codex CLI/spawn flags.
        unknown = sorted(set(adapter_spawn_options(options)) - allowed)
        if unknown:
            raise ValueError(f"unknown spawn options for codex: {unknown}")
        model = options.get("model")
        if model is not None and not isinstance(model, str):
            raise ValueError("model must be a string")
        sandbox = options.get("sandbox")
        if sandbox is not None:
            if not isinstance(sandbox, str) or sandbox not in _CODEX_SANDBOXES:
                raise ValueError(
                    f"sandbox must be one of {sorted(_CODEX_SANDBOXES)}, "
                    f"got: {sandbox!r}"
                )
        full_auto = options.get("full_auto")
        if full_auto is not None and not isinstance(full_auto, bool):
            raise ValueError("full_auto must be a boolean")
        network_access = options.get("network_access")
        if network_access is not None and not isinstance(network_access, bool):
            raise ValueError("network_access must be a boolean")

    # ------------------------------------------------------------------
    # command shape
    # ------------------------------------------------------------------
    def _build_args(self, session: ExecCliSession, text: str) -> List[str]:
        opts = session.options
        # Always skip the trusted-git-repo gate: Near already chose cwd,
        # and session taskspaces are typically empty non-git directories.
        # Codex 0.167: `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]`.
        # Resume does not accept `-C` / `--cd`, `--sandbox`, or `--full-auto`.
        common = ["--json", "--skip-git-repo-check"]
        model = opts.get("model")
        if model:
            common += ["-m", str(model)]
        network_override = _exec_network_access_config_args(opts)
        if session.native_thread_id:
            # Resume rejects --sandbox / --full-auto / -C (#332). -c config
            # overrides are still accepted and can enable network on an
            # already workspace-write thread.
            return [
                "exec",
                "resume",
                *common,
                *network_override,
                session.native_thread_id,
                text,
            ]
        tail = [*common, "-C", session.cwd]
        sandbox = opts.get("sandbox")
        if sandbox:
            tail += ["--sandbox", str(sandbox)]
        if opts.get("full_auto"):
            tail += ["--full-auto"]
        tail += network_override
        return ["exec", *tail, text]

    # ------------------------------------------------------------------
    # event translation
    # ------------------------------------------------------------------
    def _consume_event(
        self, event: Dict[str, Any], session: ExecCliSession, acc: Dict[str, Any]
    ) -> None:
        msg = _event_payload(event)
        if msg is None:
            # Envelope-less lines (e.g. plain errors) still surface in tail.
            return
        mtype = str(msg.get("type") or "")
        detail: Dict[str, Any] = acc.setdefault("detail", {})

        if mtype == "thread.started":
            thread_id = msg.get("thread_id")
            if thread_id and not acc.get("native_thread_id"):
                acc["native_thread_id"] = str(thread_id)
        elif mtype in {"item.completed", "item.updated"}:
            item = msg.get("item")
            if isinstance(item, dict):
                self._consume_item(
                    item, acc, detail, replace=(mtype == "item.completed")
                )
        elif mtype == "turn.completed":
            detail["task_complete"] = True
            tokens = _usage_tokens(msg.get("usage"))
            if tokens:
                detail["tokens"] = tokens
        elif mtype == "turn.failed":
            message = msg.get("error") or msg.get("message") or "turn failed"
            acc["error"] = str(message)[:500]
        elif mtype == "agent_message":
            chunk = msg.get("message") or msg.get("text")
            if isinstance(chunk, str) and chunk:
                current = str(acc.get("result_text") or "")
                acc["result_text"] = (current + chunk)[:_RESULT_TEXT_MAX_CHARS]
        elif mtype == "task_complete":
            final = msg.get("last_agent_message")
            if isinstance(final, str) and final:
                acc["result_text"] = final[:_RESULT_TEXT_MAX_CHARS]
            detail["task_complete"] = True
        elif mtype == "exec_command_begin":
            _record_command(detail, msg.get("command"))
        elif mtype == "patch_apply_begin":
            tools = detail.setdefault("observed_tools", [])
            if "patch" not in tools:
                tools.append("patch")
        elif mtype == "error":
            message = msg.get("message") or msg.get("error")
            if message:
                acc["error"] = str(message)[:500]
        elif mtype == "token_count":
            info = msg.get("info")
            if isinstance(info, dict):
                total = info.get("total_token_usage") or {}
                if isinstance(total, dict):
                    last = total.get("last_token_usage") or {}
                    if isinstance(last, dict):
                        detail["tokens"] = {
                            k: last.get(k)
                            for k in ("input", "cached_input", "output")
                            if last.get(k) is not None
                        }

    def _consume_item(
        self,
        item: Dict[str, Any],
        acc: Dict[str, Any],
        detail: Dict[str, Any],
        *,
        replace: bool,
    ) -> None:
        itype = str(item.get("type") or "")
        if itype == "agent_message":
            chunk = item.get("text") or item.get("message")
            if isinstance(chunk, str) and chunk:
                if replace or not acc.get("result_text"):
                    acc["result_text"] = chunk[:_RESULT_TEXT_MAX_CHARS]
                else:
                    current = str(acc.get("result_text") or "")
                    acc["result_text"] = (current + chunk)[:_RESULT_TEXT_MAX_CHARS]
        elif itype == "error":
            # Metadata warnings (e.g. unknown model id) must not fail a
            # turn that later emits agent_message + turn.completed.
            message = item.get("message") or item.get("error")
            if message:
                warnings = detail.setdefault("warnings", [])
                text = str(message)[:500]
                if text not in warnings:
                    warnings.append(text)
        elif itype in {"command_execution", "command"}:
            _record_command(detail, item.get("command"))
        elif itype in {"file_change", "patch", "apply_patch"}:
            tools = detail.setdefault("observed_tools", [])
            if "patch" not in tools:
                tools.append("patch")


    # ------------------------------------------------------------------
    # mid-turn streaming (app-server)
    # ------------------------------------------------------------------
    def drain_midturn_stream_items(self, session_id: str) -> List[Dict[str, Any]]:
        """Return queued mid-turn text/tool items since the last drain."""
        try:
            session = self._get(session_id)
        except SessionNotFoundError:
            return []
        with session.midturn_lock:
            items = list(session.midturn_items)
            session.midturn_items.clear()
        return items

    def _enqueue_midturn(self, session: ExecCliSession, item: Dict[str, Any]) -> None:
        with session.midturn_lock:
            session.midturn_items.append(item)

    def _clear_midturn(self, session: ExecCliSession) -> None:
        with session.midturn_lock:
            session.midturn_items.clear()

    def _close_app_server(self, session: ExecCliSession) -> None:
        rpc = session.app_server_rpc
        session.app_server_rpc = None
        session.app_server_ready = False
        session.app_server_thread_loaded = False
        if rpc is not None:
            try:
                rpc.close()
            except Exception:
                pass
        proc = session.proc
        session.proc = None
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass

    def stop(self, session_id: str) -> bool:
        with self._lock:
            session = self._sessions.get(session_id)
        if session is not None:
            self._close_app_server(session)
        return super().stop(session_id)

    def turn(self, session_id: str, request: TurnRequest) -> TurnResult:
        if preferred_transport() == "exec":
            return super().turn(session_id, request)
        try:
            return self._app_server_turn(session_id, request)
        except AppServerUnavailable:
            session = self._get(session_id)
            # Handshake/startup failed: drop the broken process and use
            # exec --json rather than failing the user's turn.
            self._close_app_server(session)
            with self._lock:
                if session.state == "running":
                    session.state = "idle"
            return super().turn(session_id, request)

    def _app_server_turn(
        self, session_id: str, request: TurnRequest
    ) -> TurnResult:
        session = self._get(session_id)
        with self._lock:
            if session.state == "running":
                raise TurnInProgressError(session_id)
            session.state = "running"
        self._clear_midturn(session)
        started_rpc = False
        try:
            rpc = self._ensure_app_server(session)
            started_rpc = True
            rpc.enqueue = lambda item: self._enqueue_midturn(session, item)
            rpc.begin_turn()
            thread_id = session.native_thread_id
            if thread_id and session.app_server_thread_loaded:
                pass
            elif thread_id:
                try:
                    result = rpc.request(
                        "thread/resume",
                        thread_resume_params(thread_id),
                        timeout=30.0,
                    )
                except RpcError as exc:
                    return self._turn_error_result(
                        session, session_id, request, str(exc), rpc
                    )
                resumed = thread_id_from_result(result) or thread_id
                session.native_thread_id = resumed
                session.app_server_thread_loaded = True
                thread_id = resumed
            else:
                opts = session.options or {}
                try:
                    result = rpc.request(
                        "thread/start",
                        thread_start_params(
                            cwd=session.cwd,
                            model=opts.get("model"),
                            sandbox=opts.get("sandbox"),
                            full_auto=bool(opts.get("full_auto")),
                            network_access=opts.get("network_access"),
                        ),
                        timeout=30.0,
                    )
                except RpcError as exc:
                    return self._turn_error_result(
                        session, session_id, request, str(exc), rpc
                    )
                thread_id = thread_id_from_result(result)
                if not thread_id:
                    thread_id = rpc.acc.get("native_thread_id")
                if not thread_id:
                    raise AppServerUnavailable(
                        "thread/start did not return a thread id"
                    )
                session.native_thread_id = str(thread_id)
                session.app_server_thread_loaded = True
            opts = session.options or {}
            try:
                started = rpc.request(
                    "turn/start",
                    turn_start_params(
                        str(thread_id),
                        request.text,
                        model=opts.get("model"),
                        sandbox=opts.get("sandbox"),
                        full_auto=bool(opts.get("full_auto")),
                        network_access=opts.get("network_access"),
                    ),
                    timeout=30.0,
                )
            except RpcError as exc:
                return self._turn_error_result(
                    session, session_id, request, str(exc), rpc
                )
            turn = started.get("turn") if isinstance(started, dict) else None
            if isinstance(turn, dict) and turn.get("id"):
                rpc.acc["turn_id"] = str(turn["id"])
            wait = request.wait_seconds if request.wait_seconds > 0 else None
            try:
                rpc.wait_for_turn(wait)
            except TimeoutError:
                self._interrupt_turn(rpc)
                return self._finish_app_server_turn(
                    session,
                    session_id,
                    rpc,
                    timed_out=True,
                    wait_seconds=request.wait_seconds,
                )
            return self._finish_app_server_turn(session, session_id, rpc)
        except AppServerUnavailable:
            if started_rpc and session.app_server_thread_loaded:
                # The thread may already have begun; do not double-submit
                # the same user turn on exec --json.
                return self._turn_error_result(
                    session,
                    session_id,
                    request,
                    "app-server became unavailable mid-turn",
                    session.app_server_rpc,
                )
            raise
        finally:
            with self._lock:
                if session.state == "running":
                    session.state = "idle"

    def _ensure_app_server(self, session: ExecCliSession) -> CodexAppServerRpc:
        current_provider = str((session.options or {}).get("model_provider") or "")
        rpc = session.app_server_rpc
        if (
            rpc is not None
            and session.app_server_ready
            and rpc.alive()
            and (session.app_server_provider or "") == current_provider
        ):
            return rpc
        # Provider-stamp change means config.toml was rewritten; the
        # running app-server still has the previous provider definitions.
        self._close_app_server(session)
        session.app_server_thread_loaded = False
        argv = build_app_server_argv(self.executable())
        rpc = CodexAppServerRpc(
            argv,
            cwd=session.cwd,
            enqueue=lambda item: self._enqueue_midturn(session, item),
        )
        rpc.start()
        session.app_server_rpc = rpc
        session.app_server_ready = True
        session.app_server_provider = current_provider or None
        session.proc = rpc.proc
        return rpc

    def _interrupt_turn(self, rpc: CodexAppServerRpc) -> None:
        thread_id = rpc.acc.get("native_thread_id")
        turn_id = rpc.acc.get("turn_id")
        if not thread_id or not turn_id:
            return
        try:
            rpc.request(
                "turn/interrupt",
                {"threadId": thread_id, "turnId": turn_id},
                timeout=5.0,
            )
        except Exception:
            return

    def _finish_app_server_turn(
        self,
        session: ExecCliSession,
        session_id: str,
        rpc: CodexAppServerRpc,
        *,
        timed_out: bool = False,
        wait_seconds: float = 0.0,
    ) -> TurnResult:
        acc = rpc.acc
        native_id = acc.get("native_thread_id") or session.native_thread_id
        if native_id:
            session.native_thread_id = str(native_id)
            acc["native_thread_id"] = session.native_thread_id
        session.turn_count += 1
        result_text = str(acc.get("result_text") or "")
        error_text = str(acc.get("error") or "")
        session.last_result_text = result_text
        tail = rpc.stderr_tail()
        session.last_tail = tail
        detail: Dict[str, Any] = dict(acc.get("detail") or {})
        detail["native_thread_id"] = session.native_thread_id
        detail["turn_count"] = session.turn_count
        detail["transport"] = "app-server"
        if rpc.proc is not None:
            detail["exit_code"] = rpc.proc.poll()
        if timed_out:
            timeout_detail = dict(detail, wait_seconds=wait_seconds)
            if tail and not timeout_detail.get("terminal_detail"):
                timeout_detail["terminal_detail"] = tail[:500]
            return TurnResult(
                harness=self.harness_id,
                session_id=session_id,
                status=TURN_STATUS_TIMEOUT,
                result_text="",
                tail=tail,
                detail=timeout_detail,
            )
        if error_text:
            err_detail = dict(detail, error=error_text[:500])
            if not err_detail.get("terminal_detail"):
                err_detail["terminal_detail"] = error_text[:500]
            return TurnResult(
                harness=self.harness_id,
                session_id=session_id,
                status=TURN_STATUS_ERROR,
                result_text="",
                tail=tail,
                detail=err_detail,
            )
        return TurnResult(
            harness=self.harness_id,
            session_id=session_id,
            status=TURN_STATUS_SUCCESS,
            result_text=result_text,
            tail=tail,
            detail=detail,
        )

    def _turn_error_result(
        self,
        session: ExecCliSession,
        session_id: str,
        request: TurnRequest,
        error_text: str,
        rpc: Optional[CodexAppServerRpc],
    ) -> TurnResult:
        session.turn_count += 1
        tail = rpc.stderr_tail() if rpc is not None else ""
        session.last_tail = tail
        detail = {
            "native_thread_id": session.native_thread_id,
            "turn_count": session.turn_count,
            "transport": "app-server",
            "error": error_text[:500],
        }
        if tail and "error" in detail:
            detail["terminal_detail"] = tail[:500]
        if error_text and not detail.get("terminal_detail"):
            detail["terminal_detail"] = error_text[:500]
        return TurnResult(
            harness=self.harness_id,
            session_id=session_id,
            status=TURN_STATUS_ERROR,
            result_text="",
            tail=tail,
            detail=detail,
        )




def _record_command(detail: Dict[str, Any], command: Any) -> None:
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


def _usage_tokens(usage: Any) -> Dict[str, Any]:
    if not isinstance(usage, dict):
        return {}
    mapping = (
        ("input_tokens", "input"),
        ("cached_input_tokens", "cached_input"),
        ("output_tokens", "output"),
    )
    tokens: Dict[str, Any] = {}
    for src, dest in mapping:
        value = usage.get(src)
        if value is not None:
            tokens[dest] = value
    return tokens


__all__ = ["CodexAdapter"]
