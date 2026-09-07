"""Smoke tests for investigation tools (on by default; env/config can disable).

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

from tests.test_smoke_telemetry_query import _write_failed_session, _write_obs_only_session


def test_ops_tools_in_studio_by_default(monkeypatch):
    monkeypatch.delenv("AGENTICX_OPS_TOOLS", raising=False)
    from agenticx.ops.tools import merge_ops_tools_into

    merged = merge_ops_tools_into([{"type": "function", "function": {"name": "knowledge_search"}}])
    names = {t["function"]["name"] for t in merged}
    assert {"get_trace", "get_logs", "get_recent_changes", "get_session_review", "get_umodel"} <= names


def test_ops_tools_disabled_when_env_off(monkeypatch):
    monkeypatch.setenv("AGENTICX_OPS_TOOLS", "0")
    from agenticx.ops.tools import merge_ops_tools_into

    merged = merge_ops_tools_into([{"type": "function", "function": {"name": "knowledge_search"}}])
    names = {t["function"]["name"] for t in merged}
    assert "get_trace" not in names
    assert "get_logs" not in names
    assert "get_recent_changes" not in names
    assert "get_session_review" not in names
    assert "get_umodel" not in names


def test_ops_tools_disabled_when_config_false(monkeypatch):
    monkeypatch.delenv("AGENTICX_OPS_TOOLS", raising=False)
    cfg_dir = Path.home() / ".agenticx"
    cfg_dir.mkdir(parents=True, exist_ok=True)
    (cfg_dir / "config.yaml").write_text("ops:\n  tools_enabled: false\n", encoding="utf-8")
    from agenticx.cli.config_manager import ConfigManager

    ConfigManager._invalidate_yaml_cache()
    from agenticx.ops.tools import merge_ops_tools_into

    names = {t["function"]["name"] for t in merge_ops_tools_into([])}
    assert "get_trace" not in names


def test_ops_tools_merge_when_enabled(monkeypatch):
    from agenticx.ops.tools import merge_ops_tools_into

    monkeypatch.setenv("AGENTICX_OPS_TOOLS", "1")
    merged = merge_ops_tools_into([])
    assert {t["function"]["name"] for t in merged} >= {
        "get_trace",
        "get_logs",
        "get_recent_changes",
        "get_session_review",
        "get_umodel",
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
    monkeypatch.delenv("AGENTICX_OPS_TOOLS", raising=False)
    from agenticx.ops.tools import merge_ops_tools_into
    from agenticx.runtime.meta_tools import visible_meta_agent_tools

    names = {t["function"]["name"] for t in merge_ops_tools_into(list(visible_meta_agent_tools()))}
    assert {"get_trace", "get_logs", "get_recent_changes", "get_session_review", "get_umodel"} <= names


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
    assert "get_session_review" not in names
    assert "get_umodel" not in names


def test_dispatch_get_session_review_obs_only(tmp_path, monkeypatch):
    from agenticx.ops.tools import dispatch_ops_tool

    _write_obs_only_session(tmp_path)
    monkeypatch.setenv("AGENTICX_SESSIONS_ROOT", str(tmp_path / "sessions"))
    raw = dispatch_ops_tool("get_session_review", {"session_id": "sess-obs"}, session=None)
    body = json.loads(raw)
    assert body["reason"] == ""
    assert body["source"] == "loop_review"
    assert body["items"]
    review = body["items"][0]
    assert isinstance(review.get("overall"), int)
    dims = {d["key"]: d for d in review.get("dimensions") or []}
    assert dims["controlled_execution"]["score"] <= 30


def test_dispatch_get_session_review_empty_scope():
    from agenticx.ops.tools import dispatch_ops_tool

    body = json.loads(dispatch_ops_tool("get_session_review", {}, session=None))
    assert body["reason"] == "invalid_scope"
    assert body["items"] == []


def test_get_trace_description_mentions_observations_and_review():
    from agenticx.ops.tools import OPS_TOOLS

    spec = next(t for t in OPS_TOOLS if t["function"]["name"] == "get_trace")
    desc = spec["function"]["description"]
    assert "tool_call_observations" in desc
    assert "get_session_review" in desc
