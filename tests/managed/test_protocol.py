"""Protocol model, event batch, and constant tests.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from agenticx.managed.errors import ALL_ERROR_CODES, MAError
from agenticx.managed.protocol import (
    SERVER_EVENT_TYPES,
    EnvironmentRecord,
    StopReason,
    event_to_wire,
    export_json_schemas,
    parse_client_events,
    parse_server_event,
)

REPO = Path(__file__).resolve().parents[2]
EVENT_FIXTURE = REPO / "tests" / "fixtures" / "managed_agents" / "event_cases.json"
EVENT_CASES = json.loads(EVENT_FIXTURE.read_text(encoding="utf-8"))["cases"]

_ZERO_USAGE = {
    "input_tokens": 0,
    "output_tokens": 0,
    "cache_read_input_tokens": 0,
    "tool_calls": 0,
    "runtime_ms": 0,
}


@pytest.mark.parametrize("case", EVENT_CASES, ids=[case["name"] for case in EVENT_CASES])
def test_event_cases(case: dict) -> None:
    if case["ok"]:
        parsed = parse_client_events(case["input"])
        assert len(parsed) == len(case["input"]["events"])
        return
    with pytest.raises(MAError) as caught:
        parse_client_events(case["input"])
    err = caught.value
    assert err.code == case["code"]
    assert err.details.get("index") == case["index"]


def test_server_events_roundtrip() -> None:
    samples: list[dict] = [
        {"type": "agent.message", "content": [{"type": "text", "text": "hi"}]},
        {"type": "agent.thinking", "content": [{"type": "text", "text": "hmm"}]},
        {
            "type": "agent.tool_use",
            "name": "bash_exec",
            "input": {"cmd": "ls"},
            "evaluated_policy": "always_ask",
        },
        {
            "type": "agent.tool_result",
            "tool_use_id": "tu_1",
            "content": [],
            "is_error": False,
        },
        {
            "type": "agent.mcp_tool_use",
            "mcp_server": "github",
            "name": "get_issue",
            "input": {"n": 1},
            "evaluated_policy": "always_allow",
        },
        {
            "type": "agent.mcp_tool_result",
            "mcp_tool_use_id": "m1",
            "content": [],
            "is_error": False,
        },
        {"type": "agent.custom_tool_use", "name": "lookup_order", "input": {"id": "1"}},
        {"type": "session.status_running"},
        {
            "type": "session.status_idle",
            "stop_reason": {"type": "end_turn", "event_ids": []},
        },
        {"type": "session.status_terminated", "reason": "deleted"},
        {
            "type": "session.error",
            "error": {
                "type": "rate_limit",
                "message": "slow",
                "retry_status": {"type": "retrying"},
            },
        },
        {"type": "session.usage", "usage": dict(_ZERO_USAGE)},
        {"type": "span.model_request_start", "model": "openai/gpt-4o"},
        {
            "type": "span.model_request_end",
            "model": "openai/gpt-4o",
            "is_error": False,
            "model_usage": {
                "input_tokens": 1,
                "output_tokens": 2,
                "cache_read_input_tokens": 0,
                "tool_calls": 0,
                "runtime_ms": 3,
            },
        },
        {
            "type": "session.task_created",
            "task_id": "01JB7Q6ZKX0Q3M5H8V2N4R6T8W",
            "tool": {"name": "bash_exec", "tool_use_id": "01JB7Q6YABCDEFGHJKMNPQRS"},
            "summary": "pytest -q tests/",
            "log_path": ".ma/tasks/01JB7Q6ZKX0Q3M5H8V2N4R6T8W.log",
        },
        {
            "type": "session.task_completed",
            "task_id": "01JB7Q6ZKX0Q3M5H8V2N4R6T8W",
            "state": "failed",
            "summary": "pytest -q tests/",
            "result": {"status": "error", "exit_code": 1, "output": "tail"},
            "error": {"type": "exit_code", "message": "exit code 1"},
            "duration_ms": 183402,
        },
        {
            "type": "session.thread_created",
            "agent": {"type": "agent", "agent_id": "member-1", "agent_version": 2, "name": "研究员"},
        },
        {"type": "session.thread_status_running"},
        {
            "type": "session.thread_status_idle",
            "stop_reason": {"type": "end_turn", "event_ids": []},
        },
        {"type": "session.thread_status_terminated", "reason": "completed"},
        {
            "type": "agent.thread_message_sent",
            "to_thread_id": "01JB7Q6ZKX0Q3M5H8V2N4R6T8W",
            "to_agent_name": "研究员",
            "content": [{"type": "text", "text": "go"}],
        },
        {
            "type": "agent.thread_message_received",
            "from_thread_id": "01JB7Q6ZKX0Q3M5H8V2N4R6T8W",
            "from_agent_name": "研究员",
            "content": [{"type": "text", "text": "done"}],
        },
    ]
    assert [sample["type"] for sample in samples] == list(SERVER_EVENT_TYPES)
    for raw in samples:
        parsed = parse_server_event(raw)
        assert event_to_wire(parsed) == raw


def test_stop_reason_requires_action_needs_event_ids() -> None:
    with pytest.raises(ValidationError):
        StopReason.model_validate({"type": "requires_action"})
    with pytest.raises(ValidationError):
        StopReason.model_validate({"type": "requires_action", "event_ids": []})


def test_stop_reason_end_turn_rejects_event_ids() -> None:
    with pytest.raises(ValidationError):
        StopReason.model_validate({"type": "end_turn", "event_ids": ["evt_1"]})
    parsed = StopReason.model_validate({"type": "end_turn"})
    assert parsed.event_ids == []


def test_environment_record_type_mismatch() -> None:
    with pytest.raises(ValidationError):
        EnvironmentRecord.model_validate(
            {
                "id": "env_1",
                "tenant_id": "ten_1",
                "name": "cloud",
                "type": "cloud",
                "config": {"type": "desktop_worker"},
                "status": "active",
            }
        )


def test_export_json_schemas_keys() -> None:
    schemas = export_json_schemas()
    assert set(schemas) == {
        "ClientEvent",
        "ServerEvent",
        "AgentManifest",
        "SessionRecord",
        "EnvironmentRecord",
    }


def test_error_codes_unique() -> None:
    codes = [item.code for item in ALL_ERROR_CODES]
    assert len(codes) == len(set(codes))
    assert len(ALL_ERROR_CODES) == 18


MA00_MODULES = ("__init__.py", "protocol.py", "manifest.py", "errors.py")


def test_module_has_no_runtime_imports() -> None:
    root = Path(__file__).resolve().parents[2] / "agenticx" / "managed"
    for name in MA00_MODULES:
        text = (root / name).read_text(encoding="utf-8")
        assert "agenticx.studio" not in text, name
        assert "agenticx.runtime" not in text, name
