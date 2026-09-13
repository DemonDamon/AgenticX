#!/usr/bin/env python3
"""Tests for replay-safety policy and BaseTool.effect_class.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import pytest

from agenticx.reliability.call_ledger import Verdict
from agenticx.reliability.replay_policy import ReplayRequest, decide_replay
from agenticx.tools.base import BaseTool


def _req(**overrides: Any) -> ReplayRequest:
    payload: Dict[str, Any] = {
        "call_id": "c1",
        "tool_name": "bump",
        "arguments": {"key": "a"},
        "ledger_verdict": Verdict.AMBIGUOUS,
        "effect_class": "read",
        "output_already_emitted": False,
        "request_is_streaming": False,
        "approve_unsafe_replay": False,
    }
    payload.update(overrides)
    return ReplayRequest(**payload)


def test_fresh_always_replays() -> None:
    for effect in ("none", "read", "local_write", "external_write", "unknown"):
        decision = decide_replay(_req(ledger_verdict=Verdict.FRESH, effect_class=effect))
        assert decision.action == "replay"
        assert decision.veto is None


def test_replay_skip_uses_recorded() -> None:
    decision = decide_replay(_req(ledger_verdict=Verdict.REPLAY_SKIP))
    assert decision.action == "skip_use_recorded"


def test_identity_conflict_aborts() -> None:
    decision = decide_replay(_req(ledger_verdict=Verdict.IDENTITY_CONFLICT))
    assert decision.action == "abort"
    assert decision.veto == "identity_conflict"


def test_identity_conflict_ignores_approval() -> None:
    decision = decide_replay(
        _req(ledger_verdict=Verdict.IDENTITY_CONFLICT, approve_unsafe_replay=True)
    )
    assert decision.action == "abort"
    assert decision.veto == "identity_conflict"
    assert "已忽略" in decision.reason


def test_output_emitted_hard_veto() -> None:
    decision = decide_replay(
        _req(
            ledger_verdict=Verdict.AMBIGUOUS,
            effect_class="read",
            output_already_emitted=True,
            approve_unsafe_replay=True,
        )
    )
    assert decision.action == "mark_unknown"
    assert decision.veto == "output_already_emitted"
    assert decision.approved_override is False


def test_ambiguous_read_replays() -> None:
    decision = decide_replay(_req(effect_class="read"))
    assert decision.action == "replay"


def test_ambiguous_none_replays() -> None:
    decision = decide_replay(_req(effect_class="none"))
    assert decision.action == "replay"


def test_ambiguous_external_write_marks_unknown() -> None:
    decision = decide_replay(_req(effect_class="external_write"))
    assert decision.action == "mark_unknown"
    assert decision.veto == "external_side_effect"


def test_ambiguous_unknown_marks_unknown() -> None:
    decision = decide_replay(_req(effect_class="unknown"))
    assert decision.action == "mark_unknown"
    assert decision.veto == "unknown_side_effect"


def test_ambiguous_local_write_marks_unknown() -> None:
    decision = decide_replay(_req(effect_class="local_write"))
    assert decision.action == "mark_unknown"
    assert decision.veto == "local_write_ambiguous"


def test_approval_overrides_soft_veto() -> None:
    decision = decide_replay(
        _req(
            effect_class="external_write",
            approve_unsafe_replay=True,
            output_already_emitted=False,
            request_is_streaming=False,
        )
    )
    assert decision.action == "replay"
    assert decision.approved_override is True
    assert decision.veto == "external_side_effect"


def test_reason_contains_tool_name() -> None:
    requests = [
        _req(ledger_verdict=Verdict.FRESH, effect_class="external_write"),
        _req(ledger_verdict=Verdict.REPLAY_SKIP),
        _req(ledger_verdict=Verdict.IDENTITY_CONFLICT),
        _req(ledger_verdict=Verdict.IDENTITY_CONFLICT, approve_unsafe_replay=True),
        _req(output_already_emitted=True, approve_unsafe_replay=True),
        _req(effect_class="read"),
        _req(effect_class="none"),
        _req(effect_class="external_write"),
        _req(effect_class="unknown"),
        _req(effect_class="local_write"),
        _req(
            effect_class="external_write",
            approve_unsafe_replay=True,
            request_is_streaming=False,
        ),
        _req(request_is_streaming=True),
    ]
    for req in requests:
        decision = decide_replay(req)
        assert req.tool_name in decision.reason, (req, decision)


def test_veto_order_identity_before_output() -> None:
    decision = decide_replay(
        _req(
            ledger_verdict=Verdict.IDENTITY_CONFLICT,
            output_already_emitted=True,
        )
    )
    assert decision.veto == "identity_conflict"


class _NamedTool(BaseTool):
    def _run(self, **kwargs: Any) -> str:
        return "ok"


class _ReadEmailTool(BaseTool):
    effect_class = "read"

    def _run(self, **kwargs: Any) -> str:
        return "ok"


class _BogusTool(BaseTool):
    effect_class = "totally_bogus"

    def _run(self, **kwargs: Any) -> str:
        return "ok"


def test_declared_effect_class_wins() -> None:
    tool = _ReadEmailTool(name="send_email", description="declared read")
    assert tool.resolve_effect_class({"to": "a@b.c"}) == "read"


def test_falls_back_to_classifier() -> None:
    reader = _NamedTool(name="file_read", description="read")
    pusher = _NamedTool(name="git_push", description="push")
    assert reader.resolve_effect_class() == "read"
    assert pusher.resolve_effect_class() == "external_write"


def test_bash_exec_uses_command() -> None:
    tool = _NamedTool(name="bash_exec", description="shell")
    assert (
        tool.resolve_effect_class({"command": "git push origin main"})
        == "external_write"
    )
    assert tool.resolve_effect_class({"command": "ls -la"}) == "read"


def test_unknown_tool_is_unknown() -> None:
    tool = _NamedTool(name="my_custom_thing", description="custom")
    assert tool.resolve_effect_class() == "unknown"


def test_invalid_declaration_raises() -> None:
    tool = _BogusTool(name="weird", description="bad class")
    with pytest.raises(ValueError):
        tool.resolve_effect_class()
