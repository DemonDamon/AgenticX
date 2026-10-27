#!/usr/bin/env python3
"""Runtime event adapter tests.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from agenticx.managed.budget import BudgetExceededError
from agenticx.managed.events.adapter import (
    TOOL_RESULT_MAX_CHARS,
    TRUNCATION_SUFFIX,
    RuntimeEventAdapter,
)
from agenticx.managed.protocol import Usage, parse_server_event
from agenticx.runtime.agent_runtime import STOP_MESSAGE
from agenticx.runtime.events import RuntimeEvent


def _kind_of(name: str) -> str | None:
    if name == "lookup_order":
        return "custom"
    return None


def _adapter() -> RuntimeEventAdapter:
    adapter = RuntimeEventAdapter(model_ref="openai/gpt-test", kind_of=_kind_of)
    adapter.begin_turn(Usage())
    return adapter


def _runtime(event_type: str, **data: Any) -> RuntimeEvent:
    return RuntimeEvent(type=event_type, data=data)


def test_round_tokens_final() -> None:
    adapter = _adapter()
    persisted: list[dict[str, Any]] = []
    previews: list[dict[str, Any]] = []
    steps = [
        _runtime("round_start", round=1, max_rounds=4),
        _runtime("token", text="he"),
        _runtime("token", text="llo"),
        _runtime(
            "final",
            text="hello",
            usage_metadata={
                "input_tokens": 10,
                "output_tokens": 5,
                "cached_tokens": 2,
                "turn_input_tokens": 10,
                "turn_output_tokens": 5,
            },
        ),
    ]
    for event in steps:
        output = adapter.convert(event)
        persisted.extend(output.events)
        previews.extend(output.previews)
    assert [item["type"] for item in persisted] == [
        "span.model_request_start",
        "span.model_request_end",
        "agent.message",
    ]
    assert previews == [
        {"type": "event_start", "event": {"type": "agent.message"}},
        {"type": "event_delta", "event_type": "agent.message", "content_delta": "he"},
        {"type": "event_delta", "event_type": "agent.message", "content_delta": "llo"},
    ]
    outcome = adapter.finish_turn()
    assert outcome.stop_type == "end_turn"
    assert outcome.events[-1]["type"] == "session.usage"
    assert outcome.usage.input_tokens == 10
    assert outcome.usage.output_tokens == 5
    for event in persisted + outcome.events:
        parse_server_event(event)


def test_announced_tool_use_is_bound_not_duplicated() -> None:
    adapter = _adapter()
    adapter.convert(_runtime("round_start", round=1, max_rounds=2))
    built = adapter.build_tool_use(
        kind="builtin",
        name="bash_exec",
        input={"command": "ls", "__tool_call_id": "x"},
        evaluated_policy="always_ask",
    )
    assert [item["type"] for item in built] == ["span.model_request_end", "agent.tool_use"]
    assert "__tool_call_id" not in built[-1]["input"]
    tool_use_id = built[-1]["id"]
    call = adapter.convert(
        _runtime("tool_call", name="bash_exec", arguments={"command": "ls"}, tool_call_id="c1")
    )
    assert call.events == []
    result = adapter.convert(
        _runtime("tool_result", name="bash_exec", tool_call_id="c1", result="ok")
    )
    assert len(result.events) == 1
    assert result.events[0]["type"] == "agent.tool_result"
    assert result.events[0]["tool_use_id"] == tool_use_id


def test_unannounced_tool_call_fallback() -> None:
    adapter = _adapter()
    output = adapter.convert(
        _runtime("tool_call", name="file_read", arguments={"path": "a"}, tool_call_id="c2")
    )
    assert len(output.events) == 1
    assert output.events[0]["type"] == "agent.tool_use"
    assert output.events[0]["evaluated_policy"] == "always_allow"


def test_custom_tool_use_and_no_result_event() -> None:
    adapter = _adapter()
    output = adapter.convert(
        _runtime("tool_call", name="lookup_order", arguments={"id": "1"}, tool_call_id="c3")
    )
    assert len(output.events) == 1
    assert output.events[0]["type"] == "agent.custom_tool_use"
    assert "evaluated_policy" not in output.events[0]
    event_id = output.events[0]["id"]
    assert adapter.ledger.inflight_custom("lookup_order") == event_id
    result = adapter.convert(
        _runtime("tool_result", name="lookup_order", tool_call_id="c3", result="ok")
    )
    assert result.events == []
    assert adapter.ledger.inflight_custom("lookup_order") is None


def test_error_stash_flush_and_exhausted() -> None:
    retrying = _adapter()
    assert retrying.convert(_runtime("error", text="boom")).events == []
    flushed = retrying.convert(_runtime("round_start", round=1, max_rounds=2))
    errors = [item for item in flushed.events if item["type"] == "session.error"]
    assert len(errors) == 1
    assert errors[0]["error"]["retry_status"]["type"] == "retrying"

    fatal = _adapter()
    fatal.convert(_runtime("error", text="boom"))
    outcome = fatal.finish_turn()
    fatal_errors = [item for item in outcome.events if item["type"] == "session.error"]
    assert len(fatal_errors) == 1
    assert fatal_errors[0]["error"]["retry_status"]["type"] == "exhausted"
    assert outcome.stop_type == "retries_exhausted"

    stopped = _adapter()
    stop_out = stopped.convert(_runtime("error", text=STOP_MESSAGE))
    assert all(item["type"] != "session.error" for item in stop_out.events)
    stop_outcome = stopped.finish_turn()
    assert stop_outcome.stop_type == "end_turn"
    assert all(item["type"] != "session.error" for item in stop_outcome.events)

    exhausted_rounds = _adapter()
    exhausted_rounds.convert(_runtime("error", rounds_exhausted=True, text="out of rounds"))
    assert exhausted_rounds.finish_turn().stop_type == "max_tool_rounds"

    warning = _adapter()
    warned = warning.convert(
        _runtime("error", severity="warning", retryable=True, detector="x", text="warn")
    )
    assert len(warned.events) == 1
    assert warned.events[0]["error"]["type"] == "x"
    assert warned.events[0]["error"]["retry_status"]["type"] == "retrying"

    blocked = _adapter()
    blocked_out = blocked.convert(_runtime("error", text="blocked", tool_call_id="c"))
    assert blocked_out.events == []


def test_gateway_policy_block_maps_to_policy_blocked() -> None:
    bodies = [
        'litellm.BadRequestError: {"error": {"code": "90001", "message": "请求触发合规拦截"}}',
        "{'error': {'code': '90002', 'message': 'x'}}",
        '{"error": {"code": "90001", "message": "\\u8bf7\\u6c42\\u89e6\\u53d1\\u5408\\u89c4\\u62e6\\u622a"}}',
    ]
    for body in bodies:
        adapter = _adapter()
        adapter.convert(_runtime("error", text=body))
        outcome = adapter.finish_turn()
        assert outcome.stop_type == "policy_blocked", body
        errors = [item for item in outcome.events if item["type"] == "session.error"]
        assert errors[0]["error"]["type"] == "policy_blocked"
        assert errors[0]["error"]["retry_status"]["type"] == "terminal"
        parse_server_event(errors[0])

    raised = _adapter()
    outcome = raised.finish_turn(error=RuntimeError('{"error": {"code": "90002"}}'))
    assert outcome.stop_type == "policy_blocked"

    unrelated = _adapter()
    unrelated.convert(_runtime("error", text="upstream 500: code 50001 internal"))
    assert unrelated.finish_turn().stop_type == "retries_exhausted"


def test_tool_result_truncation_and_error_prefix() -> None:
    adapter = _adapter()
    adapter.convert(_runtime("tool_call", name="file_read", arguments={"path": "a"}, tool_call_id="c9"))
    long_result = adapter.convert(
        _runtime("tool_result", tool_call_id="c9", result="y" * 70000)
    )
    text = long_result.events[0]["content"][0]["text"]
    assert len(text) == TOOL_RESULT_MAX_CHARS + len(TRUNCATION_SUFFIX)

    other = _adapter()
    other.convert(_runtime("tool_call", name="file_read", arguments={"path": "a"}, tool_call_id="c10"))
    cancelled = other.convert(_runtime("tool_result", tool_call_id="c10", result="CANCELLED: x"))
    assert cancelled.events[0]["is_error"] is True


def test_finish_turn_with_exception() -> None:
    adapter = _adapter()
    outcome = adapter.finish_turn(error=ValueError("x"))
    error = next(item for item in outcome.events if item["type"] == "session.error")
    assert error["error"]["type"] == "internal_error"
    assert error["error"]["retry_status"]["type"] == "exhausted"
    assert outcome.stop_type == "retries_exhausted"


def _error_event(outcome: Any) -> dict[str, Any]:
    return next(item for item in outcome.events if item["type"] == "session.error")


def test_budget_exceeded_error_maps_stop_reason() -> None:
    adapter = _adapter()
    outcome = adapter.finish_turn(error=BudgetExceededError(period="monthly", used=10, limit=5))
    error = _error_event(outcome)
    assert outcome.stop_type == "budget_exceeded"
    assert error["error"]["type"] == "budget_exceeded"
    assert error["error"]["retry_status"]["type"] == "terminal"
    assert "agx_budget_exceeded" in error["error"]["message"]
    parse_server_event(error)


def test_budget_exceeded_runtime_error_event() -> None:
    adapter = _adapter()
    adapter.convert(
        _runtime(
            "error",
            text="agx_budget_exceeded: daily token quota reached (used=1, limit=1)",
        )
    )
    outcome = adapter.finish_turn()
    error = _error_event(outcome)
    assert outcome.stop_type == "budget_exceeded"
    assert error["error"]["type"] == "budget_exceeded"
    assert error["error"]["retry_status"]["type"] == "terminal"
    parse_server_event(error)


def test_policy_block_still_wins() -> None:
    raised = _adapter()
    outcome = raised.finish_turn(
        error=RuntimeError("code 90001 agx_budget_exceeded: daily token quota reached")
    )
    assert outcome.stop_type == "policy_blocked"
    assert _error_event(outcome)["error"]["type"] == "policy_blocked"

    stashed = _adapter()
    stashed.convert(
        _runtime("error", text="合规拦截 agx_budget_exceeded: monthly token quota reached")
    )
    stashed_outcome = stashed.finish_turn()
    assert stashed_outcome.stop_type == "policy_blocked"
    assert _error_event(stashed_outcome)["error"]["type"] == "policy_blocked"


def test_no_studio_imports() -> None:
    root = Path(__file__).resolve().parents[2]
    paths = [root / "agenticx" / "managed" / "ids.py"]
    paths.extend(sorted((root / "agenticx" / "managed" / "events").glob("*.py")))
    assert len(paths) >= 2
    for path in paths:
        assert "agenticx.studio" not in path.read_text(encoding="utf-8")
