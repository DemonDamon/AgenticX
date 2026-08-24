#!/usr/bin/env python3
"""Session context-usage API cache payload (per-session last row + totals).

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.usage_store import UsageStore
from agenticx.studio.context_usage import load_session_cache_payload


def test_load_session_cache_payload_reads_session_totals(tmp_path, monkeypatch) -> None:
    store = UsageStore(db_path=tmp_path / "usage.sqlite")
    store.record_sync(
        session_id="sid-a",
        avatar_id="",
        provider="kimi",
        model="kimi-k2.6",
        input_tokens=1000,
        output_tokens=10,
        cached_tokens=400,
        reasoning_tokens=0,
        total_tokens=1010,
    )
    monkeypatch.setattr("agenticx.runtime.usage_store.get_usage_store", lambda: store)
    payload = load_session_cache_payload("sid-a")
    assert payload["session_input_tokens"] == 1000
    assert payload["session_cached_tokens"] == 400
    assert abs(float(payload["session_cache_ratio"]) - 0.4) < 1e-9
    assert payload["last_cached_tokens"] == 400
    assert payload["last_input_tokens"] == 1000
    assert payload["requests"] == 1


def test_load_session_cache_payload_unknown_session_is_zeros(tmp_path, monkeypatch) -> None:
    store = UsageStore(db_path=tmp_path / "usage.sqlite")
    monkeypatch.setattr("agenticx.runtime.usage_store.get_usage_store", lambda: store)
    payload = load_session_cache_payload("missing-session")
    assert payload["session_input_tokens"] == 0
    assert payload["session_cached_tokens"] == 0
    assert payload["session_cache_ratio"] == 0.0
    assert payload["last_input_tokens"] == 0
    assert payload["last_cached_tokens"] == 0
    assert payload["requests"] == 0
    assert payload["zero_cache_requests"] == 0
