"""Tests for message timestamp backfill."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.memory.message_timestamp_backfill import (
    backfill_session_messages,
    message_has_timestamp,
    normalize_epoch_ms,
    spread_missing_timestamps_ms,
)


def test_normalize_epoch_ms_seconds_and_millis() -> None:
    assert normalize_epoch_ms(1_700_000_000) == 1_700_000_000_000
    assert normalize_epoch_ms(1_700_000_000_000) == 1_700_000_000_000
    assert normalize_epoch_ms("2024-01-15T10:30:00Z") is not None


def test_spread_missing_timestamps_monotone_and_last_is_end() -> None:
    start_ms = 1_700_000_000_000
    end_ms = 1_700_003_600_000
    msgs = [
        {"role": "user", "content": "a"},
        {"role": "assistant", "content": "b"},
        {"role": "user", "content": "c"},
        {"role": "assistant", "content": "d"},
    ]
    n = spread_missing_timestamps_ms(msgs, start_ms=start_ms, end_ms=end_ms)
    assert n == 4
    for i in range(len(msgs) - 1):
        assert msgs[i]["timestamp"] <= msgs[i + 1]["timestamp"]
    assert msgs[-1]["timestamp"] == end_ms


def test_spread_last_assistant_gets_end_even_if_user_is_last() -> None:
    start_ms = 1_700_000_000_000
    end_ms = 1_700_003_600_000
    msgs = [
        {"role": "user", "content": "q1"},
        {"role": "assistant", "content": "a1"},
        {"role": "user", "content": "q2 interrupted"},
    ]
    spread_missing_timestamps_ms(msgs, start_ms=start_ms, end_ms=end_ms)
    assert msgs[1]["timestamp"] == end_ms
    assert msgs[2]["timestamp"] < msgs[1]["timestamp"]


def test_spread_skips_existing_timestamps() -> None:
    msgs = [
        {"role": "user", "content": "a", "timestamp": 1_700_000_000_000},
        {"role": "assistant", "content": "b"},
    ]
    start_ms = 1_700_000_000_000
    end_ms = 1_700_003_600_000
    n = spread_missing_timestamps_ms(msgs, start_ms=start_ms, end_ms=end_ms)
    assert n == 1
    assert msgs[0]["timestamp"] == 1_700_000_000_000
    assert msgs[1]["timestamp"] == end_ms


def test_backfill_session_writes_bounds_from_metadata(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agenticx.memory.session_store import SessionStore

    db = tmp_path / "sessions.sqlite"
    store = SessionStore(db_path=db)
    sid = "sess-backfill-001"
    store._save_session_summary_sync(
        sid,
        "summary",
        {
            "created_at": 1_700_000_000,
            "updated_at": 1_700_010_000,
            "chat_messages": 2,
        },
    )
    session_dir = tmp_path / "sessions" / sid
    session_dir.mkdir(parents=True)
    msgs_path = session_dir / "messages.json"
    msgs_path.write_text(
        json.dumps(
            [
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "hello"},
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    result = backfill_session_messages(
        sid, msgs_path, store=store, db_path=db, use_fts=False
    )
    assert result["filled"] == 2
    payload = result["payload"]
    assert message_has_timestamp(payload[0])
    assert message_has_timestamp(payload[1])
    assert payload[1]["timestamp"] >= payload[0]["timestamp"]


def test_backfill_does_not_anchor_past_existing_real_timestamp(
    tmp_path: Path,
) -> None:
    """Stop-bleed: a polluted metadata.updated_at must not push the synthetic
    last-message timestamp later than the newest real message already present."""
    from agenticx.memory.session_store import SessionStore

    db = tmp_path / "sessions.sqlite"
    store = SessionStore(db_path=db)
    sid = "sess-stopbleed-001"
    real_old_ms = 1_715_000_000_000  # the genuine last activity (older)
    polluted_updated_s = 1_716_000_000  # metadata bumped by a non-message touch (newer)
    store._save_session_summary_sync(
        sid,
        "summary",
        {
            "created_at": real_old_ms // 1000 - 600,
            "updated_at": polluted_updated_s,
            "chat_messages": 3,
        },
    )
    session_dir = tmp_path / "sessions" / sid
    session_dir.mkdir(parents=True)
    msgs_path = session_dir / "messages.json"
    msgs_path.write_text(
        json.dumps(
            [
                {"role": "user", "content": "q", "timestamp": real_old_ms - 2000},
                {"role": "tool", "content": "t", "timestamp": real_old_ms},
                {"role": "assistant", "content": "a"},  # missing -> will be filled
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    result = backfill_session_messages(
        sid, msgs_path, store=store, db_path=db, use_fts=False
    )
    payload = result["payload"]
    # The filled assistant timestamp must stay anchored near real data, never the
    # polluted metadata.updated_at.
    assert payload[-1]["timestamp"] <= real_old_ms + 5000
    assert payload[-1]["timestamp"] < polluted_updated_s * 1000
