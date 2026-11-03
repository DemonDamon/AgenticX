#!/usr/bin/env python3
"""Codex adapter for the unified harness control surface (SP2).

Wraps the local ``codex`` CLI in its ``codex exec`` form (BYOS):

    codex exec --json [-C cwd] [-m model] [--sandbox MODE] [--full-auto] TEXT
    codex exec resume <THREAD_ID> --json [...] TEXT

Event lines are NDJSON with one envelope per line::

    {"id":"...","msg":{"type":"thread.started","thread_id":"..."},
     "timestamp":"..."}
    {"msg":{"type":"agent_message","message":"text"}}
    {"msg":{"type":"task_complete","last_agent_message":"text"}}

The ``app-server`` JSON-RPC protocol is intentionally left for a later
batch (master plan: "exec --json to start, app-server reserved"); the
envelope parsing lives in :meth:`_consume_event` so swapping the transport
does not touch the engine.

The CLI is not installed on this machine, so tests and E2E exercise this
adapter against a recorded/stubbed protocol stream (master-plan discipline
#6); real-CLI verification re-runs the same script once ``codex`` is
installed and logged in.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List

from agenticx.harness.adapters._exec_cli import ExecCliHarnessAdapter, ExecCliSession
from agenticx.harness.types import HarnessCapabilities

_RESULT_TEXT_MAX_CHARS = 4000

_CODEX_SANDBOXES = frozenset(
    {"read-only", "workspace-write", "danger-full-access"}
)


class CodexAdapter(ExecCliHarnessAdapter):
    """``codex`` CLI (BYOS; exec --json events) as adapter #3."""

    harness_id = "codex"
    display_name = "Codex"
    description = "OpenAI Codex CLI (BYOS; exec --json events, resume thread)"

    def capabilities(self) -> HarnessCapabilities:
        return HarnessCapabilities(
            permission=False,  # exec is non-interactive; sandbox is the knob
            pty=False,
            streaming=False,
            turn_snapshots=True,
            idempotency=False,
            resume=True,  # codex exec resume <thread_id>
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
        allowed = {"model", "sandbox", "full_auto"}
        unknown = sorted(set(options) - allowed)
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

    # ------------------------------------------------------------------
    # command shape
    # ------------------------------------------------------------------
    def _build_args(self, session: ExecCliSession, text: str) -> List[str]:
        opts = session.options
        tail = ["--json", "-C", session.cwd]
        model = opts.get("model")
        if model:
            tail += ["-m", str(model)]
        sandbox = opts.get("sandbox")
        if sandbox:
            tail += ["--sandbox", str(sandbox)]
        if opts.get("full_auto"):
            tail += ["--full-auto"]
        if session.native_thread_id:
            return [
                "exec",
                "resume",
                session.native_thread_id,
                *tail,
                text,
            ]
        return ["exec", *tail, text]

    # ------------------------------------------------------------------
    # event translation
    # ------------------------------------------------------------------
    def _consume_event(
        self, event: Dict[str, Any], session: ExecCliSession, acc: Dict[str, Any]
    ) -> None:
        msg = event.get("msg")
        if not isinstance(msg, dict):
            # Envelope-less lines (e.g. plain errors) still surface in tail.
            return
        mtype = str(msg.get("type") or "")
        detail: Dict[str, Any] = acc.setdefault("detail", {})

        if mtype == "thread.started":
            thread_id = msg.get("thread_id")
            if thread_id and not acc.get("native_thread_id"):
                acc["native_thread_id"] = str(thread_id)
        elif mtype == "agent_message":
            chunk = msg.get("message")
            if isinstance(chunk, str) and chunk:
                current = str(acc.get("result_text") or "")
                acc["result_text"] = (current + chunk)[:_RESULT_TEXT_MAX_CHARS]
        elif mtype == "task_complete":
            final = msg.get("last_agent_message")
            if isinstance(final, str) and final:
                acc["result_text"] = final[:_RESULT_TEXT_MAX_CHARS]
            detail["task_complete"] = True
        elif mtype == "exec_command_begin":
            tools = detail.setdefault("observed_tools", [])
            if "bash" not in tools:
                tools.append("bash")
            commands = detail.setdefault("commands", [])
            command = msg.get("command")
            if isinstance(command, list):
                commands.append(
                    " ".join(str(part) for part in command)[:200]
                )
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


__all__ = ["CodexAdapter"]
