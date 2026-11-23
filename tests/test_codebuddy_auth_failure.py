#!/usr/bin/env python3
"""CodeBuddy turn failures that need an in-app Tencent login.

A failed turn is an auth failure when tool_result text is a WebSearch 401
Authorization Required, or the turn error mentions 401 / Authorization /
login / apiKeySource copilot.tencent.com. Session init that only reports
apiKeySource is not a failure by itself.
"""

from __future__ import annotations

import json

import pytest

from agenticx.harness.codebuddy_auth import (
    codebuddy_login_required_from_lines,
    is_codebuddy_auth_failure_text,
)
from agenticx.harness.types import TURN_STATUS_ERROR, TURN_STATUS_SUCCESS
from agenticx.wb_bridge.session_manager import WbBridgeSession
from tests.test_smoke_wb_bridge import _FakeProc


_INIT = json.dumps(
    {
        "type": "system",
        "subtype": "init",
        "apiKeySource": "copilot.tencent.com",
        "model": "custom-local:glm-5.3-flash",
        "permissionMode": "default",
    },
    ensure_ascii=False,
)
_TOOL_401 = json.dumps(
    {
        "type": "user",
        "message": {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "ws1",
                    "is_error": True,
                    "content": (
                        "Web Search API request failed with status 401: "
                        "Authorization Required"
                    ),
                }
            ],
        },
    },
    ensure_ascii=False,
)
_ASSISTANT_400 = json.dumps(
    {
        "type": "assistant",
        "message": {
            "role": "assistant",
            "content": [
                {
                    "type": "text",
                    "text": "400 Invalid request: invalid JSON request body",
                }
            ],
        },
    },
    ensure_ascii=False,
)
_ASSISTANT_401 = json.dumps(
    {
        "type": "assistant",
        "message": {
            "role": "assistant",
            "content": [{"type": "text", "text": "401 Unauthorized"}],
        },
    },
    ensure_ascii=False,
)
_RESULT_ERROR = json.dumps(
    {
        "type": "result",
        "subtype": "error_during_execution",
        "is_error": True,
        "result": None,
    },
    ensure_ascii=False,
)


def test_websearch_401_authorization_required_is_auth_failure() -> None:
    text = "Web Search API request failed with status 401: Authorization Required"
    assert is_codebuddy_auth_failure_text(text) is True


def test_harness_banner_401_unauthorized_is_auth_failure() -> None:
    text = "[harness codebuddy turn error] 401 Unauthorized"
    assert is_codebuddy_auth_failure_text(text) is True


def test_error_text_mentioning_apikeysource_copilot_is_auth_failure() -> None:
    text = (
        "[harness codebuddy turn error] login failed "
        'apiKeySource copilot.tencent.com'
    )
    assert is_codebuddy_auth_failure_text(text) is True


def test_plain_400_invalid_json_is_not_auth_failure() -> None:
    text = "[harness codebuddy turn error] 400 Invalid request: invalid JSON request body"
    assert is_codebuddy_auth_failure_text(text) is False


def test_init_apikeysource_alone_is_not_auth_failure() -> None:
    assert is_codebuddy_auth_failure_text(_INIT) is False
    assert codebuddy_login_required_from_lines([_INIT, _ASSISTANT_400, _RESULT_ERROR]) is False


def test_failed_turn_with_websearch_401_needs_login_even_if_banner_is_400() -> None:
    lines = [_INIT, _TOOL_401, _ASSISTANT_400, _RESULT_ERROR]
    assert codebuddy_login_required_from_lines(lines) is True


def test_success_answer_that_only_quotes_init_does_not_need_login() -> None:
    answer = json.dumps(
        {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": "plain chat is fine"}],
            },
        }
    )
    done = json.dumps(
        {"type": "result", "subtype": "success", "is_error": False, "result": "plain chat is fine"}
    )
    assert (
        codebuddy_login_required_from_lines([_INIT, answer, done], turn_failed=False)
        is False
    )


def test_loose_401_on_failed_assistant_line_needs_login() -> None:
    assert (
        codebuddy_login_required_from_lines(
            [_INIT, _ASSISTANT_401, _RESULT_ERROR],
            turn_failed=True,
        )
        is True
    )


def test_adapter_sets_login_required_from_tool_result(monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.harness.adapters.codebuddy import CodeBuddyAdapter

    adapter = CodeBuddyAdapter()
    session = WbBridgeSession(session_id="sid", cwd="/tmp", proc=_FakeProc())
    session.turn_line_start = 0
    session.append_line(_INIT)
    session.append_line(_TOOL_401)
    session.append_line(_ASSISTANT_400)
    session.append_line(_RESULT_ERROR)
    adapter._sessions["sid"] = session

    result = adapter._turn_result(
        "sid",
        "error",
        {"tail": _ASSISTANT_400, "terminal_detail": "error_during_execution", "turn_seq": 1},
        deduplicated=False,
    )
    assert result.status == TURN_STATUS_ERROR
    assert result.detail.get("codebuddy_login_required") is True


def test_adapter_success_does_not_set_login_required() -> None:
    from agenticx.harness.adapters.codebuddy import CodeBuddyAdapter

    adapter = CodeBuddyAdapter()
    session = WbBridgeSession(session_id="sid", cwd="/tmp", proc=_FakeProc())
    session.turn_line_start = 0
    session.append_line(_INIT)
    adapter._sessions["sid"] = session

    result = adapter._turn_result(
        "sid",
        "success",
        {"last_result_text": "hello", "tail": "", "turn_seq": 1},
        deduplicated=False,
    )
    assert result.status == TURN_STATUS_SUCCESS
    assert result.detail.get("codebuddy_login_required") is not True


def test_wiring_persists_login_required_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    import agenticx.studio.harness_wiring as hw
    from agenticx.harness.registry import HarnessRegistry
    from agenticx.harness.types import TurnRequest, TurnResult
    from tests.test_studio_harness_wiring import FakeManager, RecordingAdapter, make_session

    class ErrorAdapter(RecordingAdapter):
        def turn(self, session_id: str, request: TurnRequest) -> TurnResult:
            return TurnResult(
                harness=self.harness_id,
                session_id=session_id,
                status=TURN_STATUS_ERROR,
                result_text="",
                detail={
                    "error_visible_text": "400 Invalid request: invalid JSON request body",
                    "codebuddy_login_required": True,
                },
            )

    adapter = ErrorAdapter("codebuddy")
    reg = HarnessRegistry()
    reg.register(adapter)
    monkeypatch.setattr(hw, "_registry", reg)
    monkeypatch.setattr(hw, "_inflight_turns", {})
    session = make_session()
    manager = FakeManager(session)
    manager.set_session_harness("sess-1", harness_id="codebuddy")

    result = hw.run_external_harness_turn(manager, "sess-1", "search the web")
    assert not result.ok
    assistants = [m for m in session.chat_history if m["role"] == "assistant"]
    assert len(assistants) == 1
    assert assistants[0]["metadata"]["codebuddy_login_required"] is True
    assert assistants[0]["metadata"]["harness"] == "codebuddy"
    assert "[harness codebuddy turn error]" not in assistants[0]["content"]
    assert "invalid JSON" not in assistants[0]["content"]
