#!/usr/bin/env python3
"""Strip Studio-only message fields before upstream chat completions.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.agent_runtime import _strip_non_llm_message_fields


def test_strips_metadata_and_attachments_keeps_openai_fields() -> None:
    messages = [
        {
            "role": "system",
            "content": "sys",
            "metadata": {"internal": True},
        },
        {
            "role": "user",
            "content": "把整个html设计美化一下，参考苹果官网",
            "attachments": [
                {
                    "name": "断舍离待办清单.html",
                    "mime_type": "application/octet-stream",
                    "kind": "context_file",
                }
            ],
            "metadata": {"client_turn_id": "af4815cc-76a2-4353-b125-157b8dd62434"},
            "timestamp": 123,
            "agent_id": "meta",
        },
        {
            "role": "assistant",
            "content": " ",
            "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "file_read"}}],
            "avatar_name": "Machi",
        },
        {
            "role": "tool",
            "content": "ok",
            "tool_call_id": "c1",
            "name": "file_read",
            "metadata": {"kind": "should_not_reach_llm"},
        },
    ]
    out = _strip_non_llm_message_fields(messages)
    assert out == [
        {"role": "system", "content": "sys"},
        {
            "role": "user",
            "content": "把整个html设计美化一下，参考苹果官网",
        },
        {
            "role": "assistant",
            "content": " ",
            "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "file_read"}}],
        },
        {
            "role": "tool",
            "content": "ok",
            "tool_call_id": "c1",
            "name": "file_read",
        },
    ]


def test_skips_rows_without_role() -> None:
    assert _strip_non_llm_message_fields([{"content": "x"}, "bad"]) == []
