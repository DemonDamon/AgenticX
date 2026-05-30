#!/usr/bin/env python3
"""Repair session "last message timestamp" pollution from a bulk backfill.

Background
----------
A historical ``message_timestamp_backfill`` run anchored the last message of
many sessions to a polluted ``metadata.updated_at`` (bumped by non-message
touches such as taskspace sync). The signature of that bulk operation is that
dozens of *independent* sessions ended up sharing the exact same "last message
timestamp" — statistically impossible for genuinely independent conversations.

This module detects those shared anchor values (per-second buckets reached by
``>= min_cluster`` distinct sessions) and rolls the anchored trailing messages
back to just after the previous *real* timestamp in the same session, so the
session list re-buckets into "last 30 days" / "older" correctly.

Default is dry-run. ``--apply`` rewrites messages.json (after a full backup of
the sessions root) and re-indexes the ``session_messages`` FTS table so the
session list resolver no longer reads the polluted timestamps from FTS.

Author: Damon Li
"""

from __future__ import annotations

import argparse
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agenticx.memory.message_timestamp_backfill import (
    load_messages,
    read_timestamp_ms,
)
from agenticx.memory.session_store import SessionStore
from agenticx.utils.atomic_writer import atomic_write_json

DEFAULT_SESSIONS_ROOT = Path("~/.agenticx/sessions")
DEFAULT_DB_PATH = Path("~/.agenticx/memory/sessions.sqlite")
DEFAULT_MIN_CLUSTER = 3
DEFAULT_MIN_GAP_SECONDS = 3600


def _last_real_ts_ms(messages: list[dict[str, Any]]) -> int | None:
    stamps = [read_timestamp_ms(m) for m in messages]
    real = [t for t in stamps if t is not None and t > 0]
    return max(real) if real else None


def detect_anchor_seconds(
    sessions: list[tuple[str, list[dict[str, Any]]]],
    *,
    min_cluster: int,
) -> set[int]:
    """Return per-second values shared by >= min_cluster sessions as their last ts."""
    by_second: dict[int, set[str]] = {}
    for sid, messages in sessions:
        last_ms = _last_real_ts_ms(messages)
        if last_ms is None:
            continue
        sec = last_ms // 1000
        by_second.setdefault(sec, set()).add(sid)
    return {sec for sec, sids in by_second.items() if len(sids) >= min_cluster}


def plan_session_repair(
    messages: list[dict[str, Any]],
    *,
    anchor_seconds: set[int],
    min_gap_seconds: int,
) -> dict[str, Any] | None:
    """Compute a repair for one session, or None if not polluted / unrecoverable.

    Strategy: if the session's max timestamp falls in an anchor second, find the
    latest *clean* prior timestamp (not in an anchor second). If the gap exceeds
    ``min_gap_seconds`` we roll every anchored trailing message down to just after
    that prior timestamp, preserving order and monotonicity.
    """
    indexed = [(i, read_timestamp_ms(m)) for i, m in enumerate(messages)]
    real = [(i, ts) for i, ts in indexed if ts is not None and ts > 0]
    if not real:
        return None
    last_ms = max(ts for _, ts in real)
    if (last_ms // 1000) not in anchor_seconds:
        return None

    clean_prior = [ts for _, ts in real if (ts // 1000) not in anchor_seconds]
    if not clean_prior:
        return {"recoverable": False, "reason": "no_clean_prior", "last_ms": last_ms}
    prior_ms = max(clean_prior)
    if (last_ms - prior_ms) < min_gap_seconds * 1000:
        return None

    # Anchored tail = messages whose ts is in an anchor second and >= prior_ms.
    targets = [
        i
        for i, ts in real
        if ts >= prior_ms and (ts // 1000) in anchor_seconds
    ]
    if not targets:
        return None
    new_ts: dict[int, int] = {}
    for k, idx in enumerate(sorted(targets), start=1):
        new_ts[idx] = prior_ms + k * 1000
    return {
        "recoverable": True,
        "last_ms": last_ms,
        "prior_ms": prior_ms,
        "new_last_ms": prior_ms + len(targets) * 1000,
        "changed": len(targets),
        "new_ts": new_ts,
    }


def _fmt(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")


def run_repair(
    *,
    sessions_root: Path,
    db_path: Path,
    apply: bool,
    min_cluster: int,
    min_gap_seconds: int,
    reindex_fts: bool = True,
) -> dict[str, Any]:
    root = sessions_root.expanduser().resolve(strict=False)
    if not root.is_dir():
        return {"error": f"sessions root not found: {root}"}

    loaded: list[tuple[str, Path, list[dict[str, Any]]]] = []
    for session_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        msgs_path = session_dir / "messages.json"
        if not msgs_path.is_file():
            continue
        try:
            messages = load_messages(msgs_path)
        except Exception as exc:  # noqa: BLE001 - corrupt file shouldn't abort scan
            print(f"[skip] {session_dir.name[:8]}… unreadable: {exc}")
            continue
        if messages:
            loaded.append((session_dir.name, msgs_path, messages))

    anchor_seconds = detect_anchor_seconds(
        [(sid, m) for sid, _, m in loaded], min_cluster=min_cluster
    )

    stats: dict[str, Any] = {
        "sessions_scanned": len(loaded),
        "anchor_clusters": len(anchor_seconds),
        "anchor_seconds": sorted(_fmt(s * 1000) for s in anchor_seconds),
        "polluted": 0,
        "repaired": 0,
        "unrecoverable": 0,
        "messages_changed": 0,
        "dry_run": not apply,
    }
    if not anchor_seconds:
        print("No bulk-anchor clusters detected; nothing to repair.")
        return stats

    backup_done = False
    if apply:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = root.with_name(f"{root.name}.bak-{ts}")
        print(f"Backing up {root} → {backup} …")
        shutil.copytree(root, backup)
        stats["backup"] = str(backup)
        backup_done = True

    changed_payloads: list[tuple[Path, list[dict[str, Any]]]] = []
    for sid, msgs_path, messages in loaded:
        plan = plan_session_repair(
            messages, anchor_seconds=anchor_seconds, min_gap_seconds=min_gap_seconds
        )
        if plan is None:
            continue
        stats["polluted"] += 1
        if not plan.get("recoverable"):
            stats["unrecoverable"] += 1
            print(f"[skip] {sid[:8]}… polluted but no clean prior timestamp")
            continue
        for idx, ts_ms in plan["new_ts"].items():
            messages[idx]["timestamp"] = int(ts_ms)
        stats["repaired"] += 1
        stats["messages_changed"] += int(plan["changed"])
        verb = "repair" if apply else "would repair"
        print(
            f"[{'ok' if apply else 'dry-run'}] {sid[:8]}… {verb}: "
            f"{_fmt(plan['last_ms'])} → {_fmt(plan['new_last_ms'])} "
            f"({plan['changed']} msg)"
        )
        if apply:
            changed_payloads.append((msgs_path, messages))

    if apply and changed_payloads:
        for msgs_path, messages in changed_payloads:
            atomic_write_json(msgs_path, messages)
        if reindex_fts:
            print("Re-indexing session_messages FTS from disk…")
            store = SessionStore(db_path=db_path.expanduser().resolve(strict=False))
            fts_stats = store._backfill_from_sessions_root_sync(root, overwrite=True)
            stats["fts"] = fts_stats
            print(f"FTS: {fts_stats}")

    if not apply and backup_done is False:
        print("\n(dry-run) re-run with --apply to write changes (a backup is made first).")
    return stats


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sessions-root", default=str(DEFAULT_SESSIONS_ROOT))
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--apply", action="store_true", help="write changes (backup first)")
    parser.add_argument("--min-cluster", type=int, default=DEFAULT_MIN_CLUSTER)
    parser.add_argument("--min-gap-seconds", type=int, default=DEFAULT_MIN_GAP_SECONDS)
    parser.add_argument("--no-reindex-fts", action="store_true")
    args = parser.parse_args(argv)

    stats = run_repair(
        sessions_root=Path(args.sessions_root),
        db_path=Path(args.db_path),
        apply=args.apply,
        min_cluster=args.min_cluster,
        min_gap_seconds=args.min_gap_seconds,
        reindex_fts=not args.no_reindex_fts,
    )
    print("\n=== summary ===")
    for key, value in stats.items():
        print(f"{key}: {value}")
    return 0 if "error" not in stats else 1


if __name__ == "__main__":
    raise SystemExit(main())
