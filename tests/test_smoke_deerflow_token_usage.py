#!/usr/bin/env python3
"""Smoke tests for token usage metadata extraction and SSE token_usage emission.

Author: Damon Li
"""

from __future__ import annotations

import json

from agenticx.runtime.events import EventType, RuntimeEvent
from agenticx.runtime.usage_metadata import usage_metadata_from_llm_response


class _RespWithTokenUsage:
    def __init__(self) -> None:
        self.token_usage = type("TU", (), {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30})()


def test_usage_metadata_from_llm_response_happy() -> None:
    um = usage_metadata_from_llm_response(_RespWithTokenUsage())
    # 返回值后来多了 cached_tokens / reasoning_tokens（上游给了就带上，没给就是 0）。
    # 按子集断言，别把整个 dict 钉死——不然以后再加一个字段又要红一次。
    assert um is not None
    assert {k: um[k] for k in ("input_tokens", "output_tokens", "total_tokens")} == {
        "input_tokens": 10,
        "output_tokens": 20,
        "total_tokens": 30,
    }
    assert um["cached_tokens"] == 0
    assert um["reasoning_tokens"] == 0


def test_usage_metadata_from_llm_response_zeros_returns_none() -> None:
    r = type("R", (), {"token_usage": type("TU", (), {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0})()})()
    assert usage_metadata_from_llm_response(r) is None


def test_usage_metadata_from_llm_response_none() -> None:
    assert usage_metadata_from_llm_response(None) is None


def test_runtime_event_to_sse_lines_includes_token_usage_after_final() -> None:
    from agenticx.studio import server as studio_server

    ev = RuntimeEvent(
        type=EventType.FINAL.value,
        data={"text": "hi", "usage_metadata": {"input_tokens": 1, "output_tokens": 2, "total_tokens": 3}},
        agent_id="meta",
    )
    lines = studio_server._runtime_event_to_sse_lines(ev)
    assert len(lines) == 2
    first = json.loads(lines[0].removeprefix("data: ").strip())
    assert first["type"] == EventType.FINAL.value
    assert "usage_metadata" not in first["data"]
    second = json.loads(lines[1].removeprefix("data: ").strip())
    assert second["type"] == "token_usage"
    assert second["data"]["total_tokens"] == 3


def test_runtime_event_to_sse_lines_no_extra_line_without_usage() -> None:
    from agenticx.studio import server as studio_server

    ev = RuntimeEvent(type=EventType.FINAL.value, data={"text": "only"}, agent_id="meta")
    lines = studio_server._runtime_event_to_sse_lines(ev)
    assert len(lines) == 1


def test_non_final_event_unchanged_single_line() -> None:
    from agenticx.studio import server as studio_server

    ev = RuntimeEvent(type=EventType.TOKEN.value, data={"text": "x"}, agent_id="meta")
    lines = studio_server._runtime_event_to_sse_lines(ev)
    assert len(lines) == 1
    payload = json.loads(lines[0].removeprefix("data: ").strip())
    assert payload["type"] == EventType.TOKEN.value
