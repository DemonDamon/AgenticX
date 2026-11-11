#!/usr/bin/env python3
"""Codex adapter for the unified harness control surface (SP2).

Wraps the local ``codex`` CLI in its ``codex exec`` form (BYOS)::

    codex exec --json --skip-git-repo-check [-C cwd] [-m model] [--sandbox MODE] TEXT
    codex exec resume <THREAD_ID> --json --skip-git-repo-check [...] TEXT

``--skip-git-repo-check`` is always passed because Near chooses the cwd
(session taskspaces are often empty, non-git, untrusted directories).
Without the flag, Codex 0.167+ exits immediately with
``Not inside a trusted directory and --skip-git-repo-check was not specified.``

Event lines are NDJSON. Two layouts are accepted:

- Legacy envelope (older CLIs / recorded stubs)::

    {"id":"...","msg":{"type":"thread.started","thread_id":"..."},
     "timestamp":"..."}
    {"msg":{"type":"agent_message","message":"text"}}
    {"msg":{"type":"task_complete","last_agent_message":"text"}}

- Flat events from Codex 0.167+::

    {"type":"thread.started","thread_id":"..."}
    {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
    {"type":"turn.completed","usage":{...}}

An ``item.type=error`` (for example a missing-model-metadata warning) is
recorded as a warning and is not fatal if the turn later completes.

The ``app-server`` JSON-RPC protocol is intentionally left for a later
batch (master plan: "exec --json to start, app-server reserved"); the
envelope parsing lives in :meth:`_consume_event` so swapping the transport
does not touch the engine.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from agenticx.harness.adapters._exec_cli import ExecCliHarnessAdapter, ExecCliSession
from agenticx.harness.spawn_options import adapter_spawn_options
from agenticx.harness.types import HarnessCapabilities

_RESULT_TEXT_MAX_CHARS = 4000

_CODEX_SANDBOXES = frozenset(
    {"read-only", "workspace-write", "danger-full-access"}
)


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
        if session.native_thread_id:
            return [
                "exec",
                "resume",
                *common,
                session.native_thread_id,
                text,
            ]
        tail = [*common, "-C", session.cwd]
        sandbox = opts.get("sandbox")
        if sandbox:
            tail += ["--sandbox", str(sandbox)]
        if opts.get("full_auto"):
            tail += ["--full-auto"]
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
