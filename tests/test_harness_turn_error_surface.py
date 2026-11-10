#!/usr/bin/env python3
"""One assistant surface for a failed external-harness turn.

Stream-json can emit an assistant line such as ``401 Unauthorized`` before
``result`` / ``error_during_execution``. That text must not become a second
bubble next to ``[harness … turn error]``.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import pytest

from agenticx.harness.stream_json_text import visible_assistant_text_from_lines
from agenticx.harness.types import TURN_STATUS_ERROR, TURN_STATUS_SUCCESS, TurnResult
from agenticx.studio.harness_turn_text import format_external_harness_assistant_content
from agenticx.wb_bridge.session_manager import WbBridgeSession
from tests.test_smoke_wb_bridge import _FakeProc


_ASSISTANT_401 = (
    '{"type":"assistant","message":{"role":"assistant","content":'
    '[{"type":"text","text":"401 Unauthorized"}]}}'
)
_RESULT_ERROR = (
    '{"type":"result","subtype":"error_during_execution","is_error":true,'
    '"result":null,"permission_denials":[]}'
)


def test_visible_text_is_the_error_assistant_line_not_the_result() -> None:
    text = visible_assistant_text_from_lines(
        [
            '{"type":"system","subtype":"init"}',
            _ASSISTANT_401,
            _RESULT_ERROR,
        ]
    )
    assert text == "401 Unauthorized"


def test_codebuddy_login_required_replaces_harness_error_banner() -> None:
    result = TurnResult(
        harness="codebuddy",
        session_id="s",
        status=TURN_STATUS_ERROR,
        result_text="",
        detail={
            "error_visible_text": "400 Invalid request: invalid JSON request body",
            "codebuddy_login_required": True,
        },
    )
    text = format_external_harness_assistant_content("codebuddy", result)
    assert "[harness codebuddy turn error]" not in text
    assert "invalid JSON" not in text


def test_failed_turn_display_is_one_banner_with_visible_detail() -> None:
    result = TurnResult(
        harness="codebuddy",
        session_id="s",
        status=TURN_STATUS_ERROR,
        result_text="",
        detail={
            "error_visible_text": "401 Unauthorized",
            "terminal_detail": "error_during_execution",
        },
    )
    text = format_external_harness_assistant_content("codebuddy", result)
    assert text == "[harness codebuddy turn error] 401 Unauthorized"
    assert text.count("401 Unauthorized") == 1
    assert "error_during_execution" not in text


def test_success_display_stays_the_result_text() -> None:
    result = TurnResult(
        harness="codebuddy",
        session_id="s",
        status=TURN_STATUS_SUCCESS,
        result_text="hello",
    )
    assert format_external_harness_assistant_content("codebuddy", result) == "hello"


def test_failure_without_visible_text_uses_terminal_detail() -> None:
    result = TurnResult(
        harness="claude-code",
        session_id="s",
        status="timeout",
        result_text="",
        detail={"terminal_detail": "timeout"},
    )
    assert (
        format_external_harness_assistant_content("claude-code", result)
        == "[harness claude-code turn timeout] timeout"
    )


def test_failure_uses_structured_error_when_no_visible_text() -> None:
    result = TurnResult(
        harness="codex",
        session_id="s1",
        status=TURN_STATUS_ERROR,
        result_text="",
        detail={
            "error": "Not inside a trusted directory and --skip-git-repo-check was not specified.",
        },
    )
    assert (
        format_external_harness_assistant_content("codex", result)
        == "[harness codex turn error] Not inside a trusted directory and --skip-git-repo-check was not specified."
    )


def test_codebuddy_error_turn_records_visible_text(monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.harness.adapters.codebuddy import CodeBuddyAdapter

    adapter = CodeBuddyAdapter()
    session = WbBridgeSession(session_id="sid", cwd="/tmp", proc=_FakeProc())
    session.turn_line_start = 0
    session.append_line(_ASSISTANT_401)
    session.append_line(_RESULT_ERROR)
    session.observe_line(_RESULT_ERROR)
    adapter._sessions["sid"] = session

    result = adapter._turn_result(
        "sid",
        "error",
        {
            "tail": _ASSISTANT_401,
            "terminal_detail": "error_during_execution",
            "turn_seq": 1,
        },
        deduplicated=False,
    )
    assert result.status == TURN_STATUS_ERROR
    assert result.result_text == ""
    assert result.detail.get("error_visible_text") == "401 Unauthorized"


def test_claude_code_failure_records_visible_text() -> None:
    from agenticx.cc_bridge.session_manager import BridgeSession
    from agenticx.harness.adapters.claude_code import _failure_visible_text

    session = BridgeSession(session_id="sid", cwd="/tmp", proc=_FakeProc())
    session._result_wait_watermark = 0
    session.append_line(_ASSISTANT_401)
    session.append_line(_RESULT_ERROR)
    assert _failure_visible_text(session) == "401 Unauthorized"


def test_wiring_persists_single_error_surface(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    import agenticx.studio.harness_wiring as hw
    from agenticx.harness.registry import HarnessRegistry
    from agenticx.harness.types import TurnRequest
    from tests.test_studio_harness_wiring import FakeManager, RecordingAdapter, make_session

    class ErrorAdapter(RecordingAdapter):
        def turn(self, session_id: str, request: TurnRequest) -> TurnResult:
            return TurnResult(
                harness=self.harness_id,
                session_id=session_id,
                status=TURN_STATUS_ERROR,
                result_text="",
                detail={"error_visible_text": "401 Unauthorized"},
            )

    adapter = ErrorAdapter("codebuddy")
    reg = HarnessRegistry()
    reg.register(adapter)
    monkeypatch.setattr(hw, "_registry", reg)
    monkeypatch.setattr(hw, "_inflight_turns", {})
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="codebuddy")

    result = hw.run_external_harness_turn(manager, "sess-1", "question")
    assert not result.ok
    assistants = [m for m in session.chat_history if m["role"] == "assistant"]
    assert len(assistants) == 1
    assert assistants[0]["content"] == "[harness codebuddy turn error] 401 Unauthorized"
