"""Tests for session timestamp pollution repair."""

from __future__ import annotations

import json
from pathlib import Path

from agenticx.memory.timestamp_pollution_repair import (
    detect_anchor_seconds,
    plan_session_repair,
    run_repair,
)

ANCHOR_MS = 1_716_000_000_000  # the bulk-write anchor shared across sessions
PRIOR_MS = 1_714_000_000_000  # >1h earlier genuine activity


def _msgs(*timestamps: int) -> list[dict]:
    out: list[dict] = []
    for i, ts in enumerate(timestamps):
        role = "assistant" if i % 2 else "user"
        out.append({"role": role, "content": f"m{i}", "timestamp": ts})
    return out


def test_detect_anchor_seconds_finds_shared_last_ts() -> None:
    sessions = [
        ("s1", _msgs(PRIOR_MS, ANCHOR_MS)),
        ("s2", _msgs(PRIOR_MS - 50_000, ANCHOR_MS)),
        ("s3", _msgs(PRIOR_MS - 90_000, ANCHOR_MS)),
        ("lonely", _msgs(PRIOR_MS, PRIOR_MS + 1000)),
    ]
    anchors = detect_anchor_seconds(sessions, min_cluster=3)
    assert (ANCHOR_MS // 1000) in anchors
    assert (PRIOR_MS // 1000) not in anchors


def test_plan_repair_rolls_back_anchored_tail() -> None:
    msgs = _msgs(PRIOR_MS - 2000, PRIOR_MS, ANCHOR_MS)
    plan = plan_session_repair(
        msgs, anchor_seconds={ANCHOR_MS // 1000}, min_gap_seconds=3600
    )
    assert plan is not None and plan["recoverable"] is True
    assert plan["changed"] == 1
    assert plan["new_last_ms"] <= PRIOR_MS + 2000


def test_plan_repair_skips_clean_sessions() -> None:
    msgs = _msgs(PRIOR_MS, PRIOR_MS + 1000)
    plan = plan_session_repair(
        msgs, anchor_seconds={ANCHOR_MS // 1000}, min_gap_seconds=3600
    )
    assert plan is None


def test_plan_repair_unrecoverable_when_no_clean_prior() -> None:
    msgs = _msgs(ANCHOR_MS, ANCHOR_MS + 500)  # both inside the anchor second
    plan = plan_session_repair(
        msgs, anchor_seconds={ANCHOR_MS // 1000}, min_gap_seconds=3600
    )
    assert plan is not None and plan["recoverable"] is False


def _write_session(root: Path, sid: str, messages: list[dict]) -> Path:
    d = root / sid
    d.mkdir(parents=True)
    p = d / "messages.json"
    p.write_text(json.dumps(messages, ensure_ascii=False), encoding="utf-8")
    return p


def test_run_repair_dry_run_and_apply(tmp_path: Path) -> None:
    sessions_root = tmp_path / "sessions"
    sessions_root.mkdir()
    db = tmp_path / "sessions.sqlite"
    # 3 polluted sessions sharing the anchor + 1 clean session.
    for i in range(3):
        _write_session(
            sessions_root,
            f"poll{i}",
            _msgs(PRIOR_MS - i * 1000, ANCHOR_MS),
        )
    _write_session(sessions_root, "clean", _msgs(PRIOR_MS, PRIOR_MS + 1000))

    dry = run_repair(
        sessions_root=sessions_root,
        db_path=db,
        apply=False,
        min_cluster=3,
        min_gap_seconds=3600,
        reindex_fts=False,
    )
    assert dry["repaired"] == 3
    assert dry["dry_run"] is True
    # dry-run must not touch disk
    poll0 = json.loads((sessions_root / "poll0" / "messages.json").read_text())
    assert poll0[-1]["timestamp"] == ANCHOR_MS

    applied = run_repair(
        sessions_root=sessions_root,
        db_path=db,
        apply=True,
        min_cluster=3,
        min_gap_seconds=3600,
        reindex_fts=False,
    )
    assert applied["repaired"] == 3
    assert "backup" in applied
    assert Path(applied["backup"]).is_dir()
    poll0_after = json.loads((sessions_root / "poll0" / "messages.json").read_text())
    assert poll0_after[-1]["timestamp"] < ANCHOR_MS
    # clean session untouched
    clean_after = json.loads((sessions_root / "clean" / "messages.json").read_text())
    assert clean_after[-1]["timestamp"] == PRIOR_MS + 1000
