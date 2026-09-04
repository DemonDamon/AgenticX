#!/usr/bin/env python3
"""Retry trim must drop discarded turns from session cumulative usage.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.usage_store import UsageStore
from agenticx.studio.usage_alive import keep_before_ms_from_messages


def _record(store: UsageStore, *, session_id: str, ts_ms: int, inp: int, out: int = 0, cached: int = 0) -> None:
    store.record_sync(
        session_id=session_id,
        avatar_id="",
        provider="zhipu",
        model="glm-5.3-flash",
        input_tokens=inp,
        output_tokens=out,
        cached_tokens=cached,
        reasoning_tokens=0,
        total_tokens=inp + out,
        ts_ms=ts_ms,
    )


def test_keep_before_ms_uses_latest_remaining_timestamp() -> None:
    keep = keep_before_ms_from_messages(
        [
            {"role": "user", "content": "first", "timestamp": 1_788_450_055_132},
            {"role": "assistant", "content": "ans", "timestamp": 1_788_450_060_000},
            {"role": "user", "content": "retry me", "timestamp": 1_788_450_100_000},
        ]
    )
    assert keep == 1_788_450_100_000


def test_keep_before_ms_empty_or_missing_is_zero() -> None:
    assert keep_before_ms_from_messages([]) == 0
    assert keep_before_ms_from_messages([{"role": "user", "content": "x"}]) == 0


def test_cache_stats_excludes_events_between_retry_window(tmp_path) -> None:
    store = UsageStore(db_path=tmp_path / "usage.sqlite")
    sid = "2bbaa24b-36ce-4b5e-b683-9ecebd291d6c"
    _record(store, session_id=sid, ts_ms=1_000, inp=25_800, out=20, cached=10_000)
    _record(store, session_id=sid, ts_ms=2_000, inp=800_000, out=4_000, cached=600_000)
    _record(store, session_id=sid, ts_ms=3_000, inp=1_041_500, out=4_380, cached=736_900)

    all_rows = store.cache_stats(session_id=sid)
    assert all_rows["input_tokens"] == 25_800 + 800_000 + 1_041_500
    assert all_rows["requests"] == 3

    # Retry turn 1: keep only events at/before the first user message, plus
    # the regenerated turn after truncate.
    store.set_session_alive_window(sid, keep_before_ms=500, alive_after_ms=4_000)
    after_trim = store.cache_stats(session_id=sid)
    assert after_trim["input_tokens"] == 0
    assert after_trim["output_tokens"] == 0
    assert after_trim["requests"] == 0

    _record(store, session_id=sid, ts_ms=5_000, inp=25_796, out=20, cached=15_040)
    after_retry = store.cache_stats(session_id=sid)
    assert after_retry["input_tokens"] == 25_796
    assert after_retry["output_tokens"] == 20
    assert after_retry["cached_tokens"] == 15_040
    assert after_retry["requests"] == 1
    assert after_retry["last_input_tokens"] == 25_796


def test_cache_stats_keeps_earlier_turns_when_retrying_later(tmp_path) -> None:
    store = UsageStore(db_path=tmp_path / "usage.sqlite")
    sid = "sid-later"
    _record(store, session_id=sid, ts_ms=1_000, inp=10_000, out=50)
    _record(store, session_id=sid, ts_ms=2_000, inp=20_000, out=60)
    _record(store, session_id=sid, ts_ms=3_000, inp=40_000, out=70)
    store.set_session_alive_window(sid, keep_before_ms=1_500, alive_after_ms=3_500)
    stats = store.cache_stats(session_id=sid)
    assert stats["input_tokens"] == 10_000
    assert stats["output_tokens"] == 50
    assert stats["requests"] == 1


def test_truncate_api_rewinds_session_cache_stats(tmp_path, monkeypatch) -> None:
    store = UsageStore(db_path=tmp_path / "usage.sqlite")
    monkeypatch.setattr("agenticx.runtime.usage_store.get_usage_store", lambda: store)

    from fastapi.testclient import TestClient

    from agenticx.studio.server import create_studio_app

    app = create_studio_app()
    client = TestClient(app)
    session_id = client.get("/api/session").json()["session_id"]
    managed = app.state.session_manager.get(session_id, touch=False)
    assert managed is not None
    managed.studio_session.chat_history = [
        {"role": "user", "content": "first", "timestamp": 1_000},
        {"role": "assistant", "content": "ans1", "timestamp": 1_100},
        {"role": "user", "content": "second", "timestamp": 2_000},
        {"role": "assistant", "content": "ans2", "timestamp": 2_100},
    ]
    managed.studio_session.agent_messages = list(managed.studio_session.chat_history)
    _record(store, session_id=session_id, ts_ms=1_150, inp=10_000, out=40)
    _record(store, session_id=session_id, ts_ms=2_150, inp=90_000, out=80)

    resp = client.post(
        "/api/session/messages/truncate",
        json={
            "session_id": session_id,
            "user_content": "first",
            "mode": "after",
            "user_occurrence": 1,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    window = store.get_session_alive_window(session_id)
    assert window is not None
    keep_before, alive_after = window
    assert keep_before == 1_000
    assert alive_after >= 2_150
    stats = store.cache_stats(session_id=session_id)
    assert stats["input_tokens"] == 0
    assert stats["requests"] == 0


def test_summary_sync_still_counts_discarded_billed_events(tmp_path) -> None:
    store = UsageStore(db_path=tmp_path / "usage.sqlite")
    _record(store, session_id="sid-bill", ts_ms=1_000, inp=100, out=10)
    _record(store, session_id="sid-bill", ts_ms=2_000, inp=200, out=20)
    store.set_session_alive_window("sid-bill", keep_before_ms=500, alive_after_ms=3_000)
    billed = store.summary_sync(0, 10_000)
    assert billed["input"] == 300
    assert billed["output"] == 30
