"""Smoke tests for investigation tools gated behind AGENTICX_OPS_TOOLS.

Author: Damon Li
"""

from __future__ import annotations

import json

from tests.test_smoke_telemetry_query import _write_failed_session


def test_ops_tools_not_in_studio_by_default(monkeypatch):
    monkeypatch.delenv("AGENTICX_OPS_TOOLS", raising=False)
    from agenticx.ops.tools import merge_ops_tools_into

    merged = merge_ops_tools_into([{"type": "function", "function": {"name": "knowledge_search"}}])
    names = {t["function"]["name"] for t in merged}
    assert "get_trace" not in names


def test_ops_tools_merge_when_enabled(monkeypatch):
    from agenticx.ops.tools import merge_ops_tools_into

    monkeypatch.setenv("AGENTICX_OPS_TOOLS", "1")
    merged = merge_ops_tools_into([])
    assert {t["function"]["name"] for t in merged} >= {
        "get_trace",
        "get_logs",
        "get_recent_changes",
    }


def test_dispatch_get_trace_failed_session(tmp_path, monkeypatch):
    from agenticx.ops.tools import dispatch_ops_tool

    _write_failed_session(tmp_path)
    monkeypatch.setenv("AGENTICX_SESSIONS_ROOT", str(tmp_path / "sessions"))
    monkeypatch.delenv("SIGNOZ_API_URL", raising=False)
    monkeypatch.setenv("AGENTICX_TELEMETRY_BACKEND", "first_party")
    raw = dispatch_ops_tool("get_trace", {"session_id": "sess-fail"}, session=None)
    body = json.loads(raw)
    assert body["items"]
    assert any("bash_exec" in json.dumps(it) for it in body["items"])


def test_ops_tools_merge_onto_visible_meta_tools(monkeypatch):
    """Desktop chat builds from visible_meta_agent_tools, not STUDIO_TOOLS."""
    monkeypatch.setenv("AGENTICX_OPS_TOOLS", "1")
    from agenticx.ops.tools import merge_ops_tools_into
    from agenticx.runtime.meta_tools import visible_meta_agent_tools

    names = {t["function"]["name"] for t in merge_ops_tools_into(list(visible_meta_agent_tools()))}
    assert {"get_trace", "get_logs", "get_recent_changes"} <= names


def test_studio_tools_body_does_not_list_ops_tools():
    from agenticx.cli.agent_tools import STUDIO_TOOLS

    names = {
        str(t.get("function", {}).get("name", ""))
        for t in STUDIO_TOOLS
        if isinstance(t, dict)
    }
    assert "get_trace" not in names
    assert "get_logs" not in names
    assert "get_recent_changes" not in names
