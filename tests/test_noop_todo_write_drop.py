#!/usr/bin/env python3
"""Tests for dropping no-op todo_write after a visible final body.

Author: Damon Li
"""

from agenticx.runtime.agent_runtime import _should_drop_noop_progress_tools


def _todo_call(arguments: dict | str) -> dict:
    return {
        "id": "call_1",
        "type": "function",
        "function": {
            "name": "todo_write",
            "arguments": arguments,
        },
    }


def test_drop_empty_todo_write_when_body_already_complete() -> None:
    assert (
        _should_drop_noop_progress_tools(
            [_todo_call({})],
            "看完了，团长。结论先说：这是兼容，不是合并。",
        )
        is True
    )
    assert (
        _should_drop_noop_progress_tools(
            [_todo_call('{"todos": []}')],
            "看完了，团长。",
        )
        is True
    )


def test_keep_todo_write_with_real_items() -> None:
    assert (
        _should_drop_noop_progress_tools(
            [
                _todo_call(
                    {
                        "todos": [
                            {"id": "1", "content": "读文章", "status": "in_progress"}
                        ]
                    }
                )
            ],
            "我先按清单推进。",
        )
        is False
    )


def test_keep_empty_todo_write_when_body_empty() -> None:
    assert _should_drop_noop_progress_tools([_todo_call({})], "") is False
    assert _should_drop_noop_progress_tools([_todo_call({})], "   ") is False


def test_drop_top_level_empty_todo_write() -> None:
    call = {"id": "call_1", "name": "todo_write", "arguments": {}}
    assert _should_drop_noop_progress_tools([call], "看完了。") is True


def test_keep_mixed_tools_even_if_todo_is_empty() -> None:
    calls = [
        _todo_call({}),
        {
            "id": "call_2",
            "type": "function",
            "function": {"name": "web_fetch", "arguments": '{"url": "https://example.com"}'},
        },
    ]
    assert _should_drop_noop_progress_tools(calls, "看完了。") is False
