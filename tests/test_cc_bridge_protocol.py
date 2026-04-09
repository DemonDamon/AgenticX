#!/usr/bin/env python3
"""Unit tests for CC bridge NDJSON helpers.

Author: Damon Li
"""

from __future__ import annotations

import ujson

from agenticx.cc_bridge.ndjson import (
    build_control_response_allow,
    build_control_response_deny,
    build_user_message_line,
    line_looks_like_result_success,
    parse_control_request,
)


def test_build_user_message_line_is_valid_json() -> None:
    line = build_user_message_line("hello")
    assert line.endswith("\n")
    obj = ujson.loads(line.strip())
    assert obj["type"] == "user"
    assert obj["message"]["content"] == "hello"


def test_parse_control_request_positive() -> None:
    raw = (
        '{"type":"control_request","request_id":"rid",'
        '"request":{"subtype":"can_use_tool","tool_name":"Read","input":{"p":1},"tool_use_id":"tid"}}'
    )
    obj = parse_control_request(raw)
    assert obj is not None
    assert obj["request_id"] == "rid"
    assert obj["request"]["tool_name"] == "Read"


def test_parse_control_request_negative() -> None:
    assert parse_control_request("") is None
    assert parse_control_request("not json") is None
    assert parse_control_request('{"type":"user"}') is None


def test_build_control_response_allow_roundtrip_shape() -> None:
    line = build_control_response_allow("rid", {"x": 1}, "tid")
    assert "control_response" in line
    assert "rid" in line
    assert "allow" in line


def test_build_control_response_deny_contains_message() -> None:
    line = build_control_response_deny("r2", "no", None)
    assert "deny" in line
    assert "no" in line


def test_line_looks_like_result_success() -> None:
    assert line_looks_like_result_success('{"type":"result","subtype":"success"}')
    assert not line_looks_like_result_success('{"type":"result","subtype":"error"}')
    assert not line_looks_like_result_success("")
