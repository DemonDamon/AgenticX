#!/usr/bin/env python3
"""Read-only plugin_usage tool for Jev cards.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from agenticx.cli.agent_tools import STUDIO_TOOLS, _tool_plugin_usage
from agenticx.runtime.plugin_usage import query_plugin_usage


def _studio_tool_names() -> set[str]:
    names: set[str] = set()
    for item in STUDIO_TOOLS:
        fn = item.get("function") or {}
        n = fn.get("name")
        if n:
            names.add(str(n))
    return names


def _write_session(root: Path, session_id: str, messages: list[dict]) -> None:
    folder = root / session_id
    folder.mkdir(parents=True)
    (folder / "messages.json").write_text(
        json.dumps(messages, ensure_ascii=False),
        encoding="utf-8",
    )


def _jev_row(
    *,
    kind: str = "jev_decision",
    purpose: str = "group_routing",
    source: str = "jev",
    action: str = "route_to",
    fallback_reason: str = "",
    latency_ms: int = 120,
    model: str = "jev-1.13.0",
    content: str = "Jev → 派给成员 财务",
) -> dict:
    return {
        "role": "tool",
        "tool_name": "jev",
        "content": content,
        "metadata": {
            "kind": kind,
            "purpose": purpose,
            "source": source,
            "model": model,
            "action": action,
            "target_ids": ["fin"],
            "target_labels": ["财务"],
            "latency_ms": latency_ms,
            "fallback_reason": fallback_reason,
            "confidence": 0.9,
        },
    }


def test_plugin_usage_registered_in_studio_tools() -> None:
    assert "plugin_usage" in _studio_tool_names()


def test_query_counts_timeouts_and_recent(tmp_path: Path) -> None:
    _write_session(
        tmp_path,
        "s1",
        [
            {"role": "user", "content": "hi"},
            _jev_row(content="Jev adopted"),
            _jev_row(
                fallback_reason="jev_timeout",
                source="fallback",
                latency_ms=8000,
                content="Jev timeout",
            ),
            _jev_row(
                kind="jev_kb_gate",
                purpose="kb_auto",
                action="skip",
                fallback_reason="jev_http",
                source="fallback",
                content="Jev kb http",
            ),
        ],
    )
    out = query_plugin_usage(plugin="jev", sessions_root=tmp_path, purpose="all", limit=10)
    assert out["ok"] is True
    assert out["plugin"] == "jev"
    assert out["totals"]["calls"] == 3
    assert out["totals"]["adopted"] == 1
    assert out["totals"]["fallbacks"] == 2
    assert out["totals"]["by_reason"]["jev_timeout"] == 1
    assert out["totals"]["by_reason"]["jev_http"] == 1
    timeouts = query_plugin_usage(plugin="jev", sessions_root=tmp_path, purpose="timeout")
    assert timeouts["totals"]["calls"] == 1
    assert timeouts["recent"][0]["outcome"] == "timeout"
    failed = query_plugin_usage(plugin="jev", sessions_root=tmp_path, purpose="failed")
    assert failed["totals"]["calls"] == 2


def test_query_current_session_and_live_merge(tmp_path: Path) -> None:
    _write_session(tmp_path, "cur", [_jev_row(content="disk")])
    live = [_jev_row(content="live extra", fallback_reason="jev_no_key", source="fallback")]
    out = query_plugin_usage(
        plugin="jev",
        sessions_root=tmp_path,
        scope="current",
        session_id="cur",
        live_messages=live,
        live_session_id="cur",
    )
    assert out["ok"] is True
    assert out["scope"] == "current"
    assert out["totals"]["calls"] == 2
    reasons = {row["fallback_reason"] for row in out["recent"]}
    assert "jev_no_key" in reasons


def test_unknown_plugin_name_is_model_filter(tmp_path: Path) -> None:
    from agenticx.runtime.usage_store import UsageStore

    store = UsageStore(db_path=tmp_path / "usage.sqlite")
    out = query_plugin_usage(
        plugin="not-a-plugin",
        usage_store=store,
        range_key="total",
    )
    assert out["ok"] is True
    assert out["model"] == "not-a-plugin"
    assert out["totals"]["calls"] == 0


def test_tool_wrapper_reads_env_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _write_session(tmp_path, "wrap", [_jev_row()])
    monkeypatch.setenv("AGX_SESSIONS_ROOT", str(tmp_path))
    session = SimpleNamespace(_session_id="wrap", chat_history=[])
    raw = _tool_plugin_usage(
        {"plugin": "jev", "purpose": "adopted", "scope": "current"},
        session,
    )
    out = json.loads(raw)
    assert out["ok"] is True
    assert out["totals"]["calls"] == 1
    assert out["recent"][0]["outcome_zh"] == "已采用"


def test_query_all_models_by_name_date_and_session_fault(tmp_path: Path) -> None:
    from agenticx.runtime.usage_store import UsageStore

    store = UsageStore(db_path=tmp_path / "usage.sqlite")
    store.record_sync(
        session_id="sess-a",
        avatar_id="",
        provider="openai",
        model="gpt-4o-mini",
        input_tokens=100,
        output_tokens=20,
        cached_tokens=0,
        reasoning_tokens=0,
        total_tokens=120,
        ts_ms=1_721_000_000_000,
    )
    store.record_fault_sync(
        session_id="sess-a",
        avatar_id="",
        provider="openai",
        model="gpt-4o-mini",
        kind="timeout",
        phase="timeout",
        attempt=1,
        retryable=True,
        message="no response within 30s",
        ts_ms=1_721_000_100_000,
    )
    store.record_fault_sync(
        session_id="sess-a",
        avatar_id="",
        provider="openai",
        model="gpt-4o-mini",
        kind="timeout",
        phase="timeout",
        attempt=2,
        retryable=True,
        message="no response within 30s",
        ts_ms=1_721_000_200_000,
    )
    out = query_plugin_usage(
        plugin="all",
        model="gpt-4o-mini",
        session_id="sess-a",
        purpose="failed",
        range_key="total",
        usage_store=store,
    )
    assert out["ok"] is True
    assert out["totals"]["calls"] == 1
    assert out["totals"]["faults"] == 2
    assert out["totals"]["by_kind"]["timeout"] == 2
    assert out["diagnosis"]["last_outcome"] == "failed"
    assert out["diagnosis"]["consecutive_failures"] == 2
    assert out["diagnosis"]["latest_kind"] == "timeout"
    assert out["consecutive"][0]["count"] == 2
    assert "重试" in out["diagnosis"]["hint"] or "网络" in out["diagnosis"]["hint"]


def test_query_filters_date_range(tmp_path: Path) -> None:
    from agenticx.runtime.usage_store import UsageStore

    store = UsageStore(db_path=tmp_path / "usage.sqlite")
    store.record_sync(
        session_id="old",
        avatar_id="",
        provider="anthropic",
        model="claude-sonnet-4",
        input_tokens=10,
        output_tokens=5,
        cached_tokens=0,
        reasoning_tokens=0,
        total_tokens=15,
        ts_ms=1_600_000_000_000,
    )
    store.record_sync(
        session_id="new",
        avatar_id="",
        provider="anthropic",
        model="claude-sonnet-4",
        input_tokens=11,
        output_tokens=6,
        cached_tokens=0,
        reasoning_tokens=0,
        total_tokens=17,
        ts_ms=int(__import__("time").time() * 1000),
    )
    out = query_plugin_usage(
        plugin="claude-sonnet-4",
        range_key="week",
        usage_store=store,
    )
    assert out["ok"] is True
    assert out["model"] == "claude-sonnet-4"
    assert out["totals"]["calls"] == 1
    assert out["recent"][0]["session_id"] == "new"
