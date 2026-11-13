#!/usr/bin/env python3
"""OpenCode adapter for the unified harness control surface (SP2).

Wraps the local ``opencode`` CLI in its process-per-turn form:
``opencode run <text> --format json [--dir cwd] [-s ses_...]``. Every event
line observed on real OpenCode 1.18.20 looks like::

    {"type":"step_start","timestamp":...,"sessionID":"ses_...",
     "part":{"type":"step-start",...}}
    {"type":"text",...,"part":{"type":"text","text":"Hi",...}}
    {"type":"tool_use",...,"part":{"type":"tool","tool":"write",
     "state":{"status":"completed","input":{...},"output":"..."}}}
    {"type":"step_finish",...,"part":{"type":"step-finish","reason":"stop",
     "tokens":{...},"cost":0}}

The native ``ses_...`` id is carried across turns via ``-s`` (resume).

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List

from agenticx.harness.adapters._exec_cli import ExecCliHarnessAdapter, ExecCliSession
from agenticx.harness.types import HarnessCapabilities

_RESULT_TEXT_MAX_CHARS = 4000


class OpenCodeAdapter(ExecCliHarnessAdapter):
    """``opencode`` CLI (BYOS; run --format json) as adapter #2."""

    harness_id = "opencode"
    display_name = "OpenCode"
    description = "OpenCode CLI (BYOS; run --format json events, -s resume)"

    def capabilities(self) -> HarnessCapabilities:
        return HarnessCapabilities(
            permission=False,  # non-interactive run has no approval channel
            pty=False,
            streaming=False,
            turn_snapshots=True,  # tokens / cost / observed tools from events
            idempotency=False,
            resume=True,  # -s <ses_id> continues the native thread
            handoff_injection=False,  # enabled with SP4
        )

    def _default_executable(self) -> str:
        return "opencode"

    def _env_var(self) -> str:
        return "AGX_OPENCODE_EXECUTABLE"

    # ------------------------------------------------------------------
    # spawn options
    # ------------------------------------------------------------------
    def _validate_options(self, options: Dict[str, Any]) -> None:
        allowed = {"model", "agent", "auto_approve", "title"}
        unknown = sorted(set(options) - allowed)
        if unknown:
            raise ValueError(f"unknown spawn options for opencode: {unknown}")
        model = options.get("model")
        if model is not None and not isinstance(model, str):
            raise ValueError("model must be a string (provider/model)")
        agent = options.get("agent")
        if agent is not None and not isinstance(agent, str):
            raise ValueError("agent must be a string")
        auto = options.get("auto_approve")
        if auto is not None and not isinstance(auto, bool):
            raise ValueError("auto_approve must be a boolean")
        title = options.get("title")
        if title is not None and not isinstance(title, str):
            raise ValueError("title must be a string")

    # ------------------------------------------------------------------
    # command shape
    # ------------------------------------------------------------------
    def _build_args(self, session: ExecCliSession, text: str) -> List[str]:
        args = ["run", text, "--format", "json", "--dir", session.cwd]
        opts = session.options
        model = opts.get("model")
        if model:
            args += ["-m", str(model)]
        agent = opts.get("agent")
        if agent:
            args += ["--agent", str(agent)]
        if opts.get("auto_approve"):
            args += ["--auto"]
        title = opts.get("title")
        if title:
            args += ["--title", str(title)]
        if session.native_thread_id:
            args += ["-s", session.native_thread_id]
        return args

    # ------------------------------------------------------------------
    # event translation (protocol facts from OpenCode 1.18.20)
    # ------------------------------------------------------------------
    def _consume_event(
        self, event: Dict[str, Any], session: ExecCliSession, acc: Dict[str, Any]
    ) -> None:
        etype = str(event.get("type") or "")
        detail: Dict[str, Any] = acc.setdefault("detail", {})

        native_sid = event.get("sessionID")
        if native_sid and not acc.get("native_thread_id"):
            acc["native_thread_id"] = str(native_sid)

        if etype == "text":
            part = event.get("part") or {}
            chunk = part.get("text")
            if isinstance(chunk, str) and chunk:
                current = str(acc.get("result_text") or "")
                acc["result_text"] = (current + chunk)[:_RESULT_TEXT_MAX_CHARS]
        elif etype == "tool_use":
            part = event.get("part") or {}
            state = part.get("state") or {}
            tool = str(part.get("tool") or "unknown")
            tools = detail.setdefault("observed_tools", [])
            if tool not in tools:
                tools.append(tool)
            status = str(state.get("status") or "")
            if status == "error":
                output = str(state.get("output") or "").strip()
                prev = str(acc.get("error") or "")
                acc["error"] = (prev + ("\n" if prev else "") + f"{tool}: {output}").strip()
            tool_events = detail.setdefault("tool_events", [])
            tool_events.append(
                {
                    "tool": tool,
                    "status": status or "unknown",
                    "title": str(state.get("title") or "")[:200],
                }
            )
        elif etype == "step_finish":
            part = event.get("part") or {}
            tokens = part.get("tokens")
            if isinstance(tokens, dict):
                detail["tokens"] = {
                    k: tokens.get(k)
                    for k in ("total", "input", "output", "reasoning")
                    if tokens.get(k) is not None
                }
            cost = part.get("cost")
            if cost is not None:
                detail["cost"] = cost
            detail["finish_reason"] = str(part.get("reason") or "")
        elif etype == "error":
            message = event.get("message") or event.get("error")
            if message:
                acc["error"] = str(message)[:500]


__all__ = ["OpenCodeAdapter"]
