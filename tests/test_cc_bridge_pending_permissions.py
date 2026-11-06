#!/usr/bin/env python3
"""Unit tests for CC bridge pending can_use_tool queue + SSE payload shape.

Author: Damon Li
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock

import ujson

from agenticx.cc_bridge.ndjson import build_control_response_allow, parse_control_request
from agenticx.cc_bridge.pending_permissions import (
    PendingPermission,
    classify_cc_tool_risk,
    pending_permission_from_control_request,
    summarize_tool_input,
)
from agenticx.cc_bridge.session_manager import BridgeSession, BridgeSessionManager


def _control_line(
    *,
    request_id: str = "rid-1",
    tool_name: str = "mcp__bocha-search-mcp__bocha_web_search",
    display_name: str = "Bocha Web Search",
    tool_use_id: str = "call_abc",
    tool_input: Optional[Dict[str, Any]] = None,
) -> str:
    payload = {
        "type": "control_request",
        "request_id": request_id,
        "request": {
            "subtype": "can_use_tool",
            "tool_name": tool_name,
            "display_name": display_name,
            "input": tool_input
            if tool_input is not None
            else {"count": 10, "query": "特朗普 最新新闻"},
            "tool_use_id": tool_use_id,
        },
    }
    return ujson.dumps(payload, ensure_ascii=False)


def test_summarize_tool_input_keeps_short_and_truncates_long() -> None:
    short = summarize_tool_input({"query": "hello", "count": 3})
    assert short["query"] == "hello"
    assert short["count"] == 3
    long_val = "x" * 500
    summarized = summarize_tool_input({"query": long_val, "blob": long_val})
    assert len(str(summarized["query"])) < 200
    assert "…" in str(summarized["query"]) or len(str(summarized["query"])) <= 120
    # Never paste the full megabyte-style arg.
    assert long_val not in json.dumps(summarized, ensure_ascii=False)


def test_classify_cc_tool_risk_read_low_network_protected() -> None:
    assert classify_cc_tool_risk("Read") == "low"
    assert classify_cc_tool_risk("Glob") == "low"
    assert classify_cc_tool_risk("Grep") == "low"
    assert classify_cc_tool_risk("Bash") == "protected"
    assert classify_cc_tool_risk("Write") == "protected"
    assert (
        classify_cc_tool_risk("mcp__bocha-search-mcp__bocha_web_search")
        == "protected"
    )
    assert classify_cc_tool_risk("WebSearch") == "protected"


def test_pending_permission_from_control_request_shape() -> None:
    raw = _control_line()
    obj = parse_control_request(raw)
    assert obj is not None
    pending = pending_permission_from_control_request(obj)
    assert pending is not None
    assert pending.request_id == "rid-1"
    assert pending.tool_name == "mcp__bocha-search-mcp__bocha_web_search"
    assert pending.display_name == "Bocha Web Search"
    assert pending.tool_use_id == "call_abc"
    assert "query" in pending.input_summary
    assert pending.risk == "protected"


def test_on_control_request_queues_when_not_auto_allow() -> None:
    mgr = BridgeSessionManager()
    written: List[str] = []

    def _fake_write(session: BridgeSession, data: str) -> None:
        written.append(data)

    mgr._write_stdin = _fake_write  # type: ignore[method-assign]
    proc = MagicMock()
    proc.pid = 1
    proc.poll.return_value = None
    proc.stdin = MagicMock()
    session = BridgeSession(
        session_id="s1",
        cwd="/tmp",
        proc=proc,
        auto_allow=False,
        permission_policy="ask",
    )
    mgr._sessions["s1"] = session
    req = parse_control_request(_control_line())
    assert req is not None
    mgr._on_control_request(session, req)
    assert written == []
    pending = mgr.list_pending_permissions("s1")
    assert len(pending) == 1
    assert pending[0]["request_id"] == "rid-1"
    assert pending[0]["display_name"] == "Bocha Web Search"
    assert pending[0]["tool_use_id"] == "call_abc"


def test_on_control_request_auto_allows_when_flag_set() -> None:
    mgr = BridgeSessionManager()
    written: List[str] = []

    def _fake_write(session: BridgeSession, data: str) -> None:
        written.append(data)

    mgr._write_stdin = _fake_write  # type: ignore[method-assign]
    proc = MagicMock()
    proc.pid = 1
    proc.poll.return_value = None
    session = BridgeSession(
        session_id="s2",
        cwd="/tmp",
        proc=proc,
        auto_allow=True,
        permission_policy="auto",
    )
    mgr._sessions["s2"] = session
    req = parse_control_request(_control_line(request_id="rid-auto"))
    assert req is not None
    mgr._on_control_request(session, req)
    assert len(written) == 1
    assert "allow" in written[0]
    assert mgr.list_pending_permissions("s2") == []


def test_allowlist_auto_allows_low_risk_only() -> None:
    mgr = BridgeSessionManager()
    written: List[str] = []

    def _fake_write(session: BridgeSession, data: str) -> None:
        written.append(data)

    mgr._write_stdin = _fake_write  # type: ignore[method-assign]
    proc = MagicMock()
    proc.pid = 1
    proc.poll.return_value = None
    session = BridgeSession(
        session_id="s3",
        cwd="/tmp",
        proc=proc,
        auto_allow=False,
        permission_policy="allowlist",
    )
    mgr._sessions["s3"] = session

    read_req = parse_control_request(
        _control_line(
            request_id="rid-read",
            tool_name="Read",
            display_name="Read",
            tool_use_id="t-read",
            tool_input={"path": "a.py"},
        )
    )
    assert read_req is not None
    mgr._on_control_request(session, read_req)
    assert len(written) == 1
    assert mgr.list_pending_permissions("s3") == []

    search_req = parse_control_request(
        _control_line(request_id="rid-search")
    )
    assert search_req is not None
    mgr._on_control_request(session, search_req)
    assert len(written) == 1  # no second auto-allow
    pending = mgr.list_pending_permissions("s3")
    assert len(pending) == 1
    assert pending[0]["request_id"] == "rid-search"


def test_drain_pending_permissions_emits_once_then_empty() -> None:
    mgr = BridgeSessionManager()
    mgr._write_stdin = lambda *_a, **_k: None  # type: ignore[method-assign]
    proc = MagicMock()
    proc.pid = 1
    proc.poll.return_value = None
    session = BridgeSession(
        session_id="s4",
        cwd="/tmp",
        proc=proc,
        auto_allow=False,
        permission_policy="ask",
    )
    mgr._sessions["s4"] = session
    req = parse_control_request(_control_line())
    assert req is not None
    mgr._on_control_request(session, req)
    first = mgr.drain_pending_permissions("s4")
    assert len(first) == 1
    assert first[0]["request_id"] == "rid-1"
    second = mgr.drain_pending_permissions("s4")
    assert second == []
    # Still listed until respond_permission clears it.
    assert len(mgr.list_pending_permissions("s4")) == 1


def test_respond_permission_clears_pending() -> None:
    mgr = BridgeSessionManager()
    written: List[str] = []

    def _fake_write(session: BridgeSession, data: str) -> None:
        written.append(data)

    mgr._write_stdin = _fake_write  # type: ignore[method-assign]
    proc = MagicMock()
    proc.pid = 1
    proc.poll.return_value = None
    session = BridgeSession(
        session_id="s5",
        cwd="/tmp",
        proc=proc,
        auto_allow=False,
        permission_policy="ask",
    )
    mgr._sessions["s5"] = session
    req = parse_control_request(_control_line())
    assert req is not None
    mgr._on_control_request(session, req)
    mgr.respond_permission(
        "s5",
        "rid-1",
        True,
        tool_input={"count": 10, "query": "特朗普 最新新闻"},
        tool_use_id="call_abc",
    )
    assert len(written) == 1
    assert "allow" in written[0]
    assert mgr.list_pending_permissions("s5") == []


def test_confirm_required_sse_payload_shape() -> None:
    """Studio should map a drained pending permission to confirm_required."""
    from agenticx.studio.harness_permissions import (
        pending_permission_to_confirm_sse_data,
    )

    pending = PendingPermission(
        request_id="rid-1",
        tool_name="mcp__bocha-search-mcp__bocha_web_search",
        display_name="Bocha Web Search",
        tool_use_id="call_abc",
        tool_input={"count": 10, "query": "特朗普 最新新闻"},
        input_summary={"query": "特朗普 最新新闻", "count": 10},
        risk="protected",
    )
    data = pending_permission_to_confirm_sse_data(pending)
    assert data["id"] == "rid-1"
    assert "Bocha Web Search" in data["question"]
    assert data["context"]["tool"] == "mcp__bocha-search-mcp__bocha_web_search"
    assert data["context"]["display_name"] == "Bocha Web Search"
    assert data["context"]["tool_use_id"] == "call_abc"
    assert data["context"]["source"] == "claude_code_permission"
    assert data["context"]["risk"] == "protected"
    # Must not dump huge args into the confirm bubble context.
    assert "input_summary" in data["context"]
    dumped = json.dumps(data, ensure_ascii=False)
    assert len(dumped) < 2000


def test_harness_options_from_run_mode_cc_and_cb() -> None:
    from agenticx.studio.harness_permissions import (
        harness_spawn_options_for_run_mode,
    )

    assert harness_spawn_options_for_run_mode("claude-code", "auto") == {
        "auto_allow_permissions": True
    }
    assert harness_spawn_options_for_run_mode("claude-code", "ask") == {
        "auto_allow_permissions": False,
        "permission_policy": "ask",
    }
    assert harness_spawn_options_for_run_mode("claude-code", "allowlist") == {
        "auto_allow_permissions": False,
        "permission_policy": "allowlist",
    }
    assert harness_spawn_options_for_run_mode("codebuddy", "auto") == {
        "permission_mode": "acceptEdits"
    }
    # ask/allowlist leave CB default (no interactive channel).
    assert harness_spawn_options_for_run_mode("codebuddy", "ask") == {}
