#!/usr/bin/env python3
"""Backfill missing message timestamps in session messages.json snapshots.

Author: Damon Li
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agenticx.memory.session_store import SessionStore
from agenticx.utils.atomic_writer import atomic_write_json


def normalize_epoch_ms(value: Any) -> int | None:
    """Return Unix milliseconds, or None if unusable."""
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            dt = datetime.fromisoformat(text)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return int(dt.timestamp() * 1000)
        except ValueError:
            pass
    try:
        ts = float(value)
    except (TypeError, ValueError):
        return None
    if ts <= 0:
        return None
    if ts > 1e11:
        return int(ts)
    return int(ts * 1000)


def message_has_timestamp(msg: dict[str, Any]) -> bool:
    for key in ("timestamp", "created_at", "ts"):
        if normalize_epoch_ms(msg.get(key)) is not None:
            return True
    return False


def read_timestamp_ms(msg: dict[str, Any]) -> int | None:
    for key in ("timestamp", "created_at", "ts"):
        ts = normalize_epoch_ms(msg.get(key))
        if ts is not None:
            return ts
    return None


def raw_timestamp_ms(msg: dict[str, Any]) -> int:
    """Read timestamp field without unit conversion (for in-memory rows we just wrote)."""
    v = msg.get("timestamp")
    try:
        return int(v) if v is not None else 0
    except (TypeError, ValueError):
        return 0


def load_messages(path: Path) -> list[dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return [m for m in raw if isinstance(m, dict)]
    if isinstance(raw, dict):
        inner = raw.get("messages")
        if isinstance(inner, list):
            return [m for m in inner if isinstance(m, dict)]
    return []


def load_fts_timestamps_ms(db_path: Path, session_id: str) -> list[int | None]:
    """Per-message timestamps from session_messages ordered by row id."""
    if not db_path.is_file():
        return []
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT timestamp
            FROM session_messages
            WHERE session_id = ?
            ORDER BY id ASC
            """,
            (session_id,),
        ).fetchall()
    out: list[int | None] = []
    for (ts_raw,) in rows:
        if ts_raw is None:
            out.append(None)
            continue
        try:
            sec = float(ts_raw)
        except (TypeError, ValueError):
            out.append(None)
            continue
        if sec <= 0:
            out.append(None)
        elif sec > 1e11:
            out.append(int(sec))
        else:
            out.append(int(sec * 1000))
    return out


def existing_timestamp_bounds_ms(
    messages: list[dict[str, Any]],
) -> tuple[int | None, int | None]:
    """Min/max of timestamps already present in the transcript (ms), or (None, None)."""
    stamps = [read_timestamp_ms(m) for m in messages]
    real = [t for t in stamps if t is not None and t > 0]
    if not real:
        return None, None
    return min(real), max(real)


def load_session_bounds_ms(
    store: SessionStore,
    session_id: str,
    messages_path: Path,
    message_count: int,
    *,
    messages: list[dict[str, Any]] | None = None,
) -> tuple[int, int]:
    """Infer [start_ms, end_ms] window for spreading missing timestamps.

    The transcript's own real timestamps are authoritative for the upper bound:
    we must NOT anchor a synthetic last-message timestamp later than the newest
    real message just because ``metadata.updated_at`` was bumped by a non-message
    touch (taskspace sync, session restore). Doing so used to shove old sessions
    into the "last 7 days" bucket. Metadata / file mtime are only a fallback when
    the transcript carries no real timestamp at all.
    """
    real_min_ms, real_max_ms = (
        existing_timestamp_bounds_ms(messages) if messages is not None else (None, None)
    )
    meta = store._load_latest_session_metadata_sync(session_id)
    created_ms = normalize_epoch_ms(meta.get("created_at"))
    updated_ms = normalize_epoch_ms(meta.get("updated_at"))
    last_ms = normalize_epoch_ms(meta.get("last_activity_at"))

    if real_max_ms is not None:
        # Real data wins: never push the anchor past the newest real message.
        end_ms = real_max_ms
    else:
        end_ms = max(v for v in (updated_ms, last_ms) if v is not None) if (
            updated_ms or last_ms
        ) else None
        if end_ms is None:
            try:
                end_ms = int(messages_path.stat().st_mtime * 1000)
            except OSError:
                end_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    if real_min_ms is not None:
        start_ms = real_min_ms
    else:
        start_ms = created_ms
    if start_ms is None:
        start_ms = end_ms - max(1, message_count) * 60_000
    if start_ms >= end_ms:
        start_ms = end_ms - max(1, message_count) * 60_000
    if start_ms < 0:
        start_ms = 0
    return start_ms, end_ms


def _last_assistant_index(messages: list[dict[str, Any]]) -> int | None:
    for i in range(len(messages) - 1, -1, -1):
        if str(messages[i].get("role") or "").strip().lower() == "assistant":
            return i
    return None


def spread_missing_timestamps_ms(
    messages: list[dict[str, Any]],
    *,
    start_ms: int,
    end_ms: int,
) -> int:
    """Assign monotone ms timestamps to messages missing one. Returns count filled.

    The last assistant message is anchored to ``end_ms`` so session list ordering
    reflects last model reply time, not merely the final row in the transcript.
    """
    n = len(messages)
    if n == 0:
        return 0
    filled = 0
    last_asst = _last_assistant_index(messages)
    end_anchor_idx = last_asst if last_asst is not None else n - 1

    if n == 1:
        if not message_has_timestamp(messages[0]):
            messages[0]["timestamp"] = int(end_ms)
            return 1
        return 0

    span = max(1, end_ms - start_ms)
    for i, msg in enumerate(messages):
        if message_has_timestamp(msg):
            continue
        if i == end_anchor_idx:
            msg["timestamp"] = int(end_ms)
        elif last_asst is not None and i > last_asst:
            # Trailing user/tool rows after the last model reply stay earlier so
            # session sort uses the assistant completion time, not a later query.
            msg["timestamp"] = int(end_ms) - max(1, (i - last_asst) * 1000)
        elif end_anchor_idx > 0:
            ratio = i / end_anchor_idx
            msg["timestamp"] = int(start_ms + span * ratio)
        else:
            msg["timestamp"] = int(start_ms)
        filled += 1

    prev = 0
    for i, msg in enumerate(messages):
        ts = raw_timestamp_ms(msg)
        if i == end_anchor_idx:
            ts = int(end_ms)
        elif last_asst is not None and i > last_asst:
            ts = min(ts, int(end_ms) - 1000)
        if ts <= prev:
            ts = prev + 1000
        if last_asst is not None and i > last_asst and ts >= int(end_ms):
            ts = int(end_ms) - 1000
        if i == end_anchor_idx:
            ts = int(end_ms)
        msg["timestamp"] = ts
        prev = ts if i != end_anchor_idx else int(end_ms)
    return filled


def backfill_session_messages(
    session_id: str,
    messages_path: Path,
    *,
    store: SessionStore,
    db_path: Path,
    use_fts: bool = True,
) -> dict[str, Any]:
    """Backfill one session; does not write unless caller persists."""
    messages = load_messages(messages_path)
    if not messages:
        return {"session_id": session_id, "messages": 0, "filled": 0, "skipped": True}
    already = sum(1 for m in messages if message_has_timestamp(m))
    if already == len(messages):
        return {
            "session_id": session_id,
            "messages": len(messages),
            "filled": 0,
            "skipped": True,
            "reason": "all_have_timestamp",
        }
    filled = 0
    if use_fts:
        fts_ts = load_fts_timestamps_ms(db_path, session_id)
        if len(fts_ts) == len(messages):
            for msg, ts in zip(messages, fts_ts, strict=True):
                if ts is None or message_has_timestamp(msg):
                    continue
                msg["timestamp"] = ts
                filled += 1
    start_ms, end_ms = load_session_bounds_ms(
        store, session_id, messages_path, len(messages), messages=messages
    )
    filled += spread_missing_timestamps_ms(
        messages, start_ms=start_ms, end_ms=end_ms
    )
    return {
        "session_id": session_id,
        "messages": len(messages),
        "filled": filled,
        "skipped": filled == 0,
        "start_ms": start_ms,
        "end_ms": end_ms,
        "payload": messages,
    }


def run_backfill(
    *,
    sessions_root: Path,
    db_path: Path,
    apply: bool,
    reindex_fts: bool,
    session_id: str | None,
    limit: int | None,
) -> dict[str, Any]:
    store = SessionStore(db_path=db_path)
    root = sessions_root.expanduser().resolve(strict=False)
    if not root.is_dir():
        return {"error": f"sessions root not found: {root}"}

    dirs = sorted(p for p in root.iterdir() if p.is_dir())
    if session_id:
        dirs = [p for p in dirs if p.name == session_id or p.name.startswith(session_id)]
    if limit is not None and limit > 0:
        dirs = dirs[:limit]

    stats: dict[str, Any] = {
        "sessions_scanned": 0,
        "sessions_updated": 0,
        "messages_filled": 0,
        "sessions_skipped": 0,
        "errors": 0,
        "dry_run": not apply,
    }

    for session_dir in dirs:
        sid = session_dir.name
        msgs_path = session_dir / "messages.json"
        if not msgs_path.is_file():
            continue
        stats["sessions_scanned"] += 1
        try:
            result = backfill_session_messages(
                sid, msgs_path, store=store, db_path=db_path
            )
        except Exception as exc:
            stats["errors"] += 1
            print(f"[error] {sid[:8]}… {exc}")
            continue
        filled = int(result.get("filled") or 0)
        if result.get("skipped") and filled == 0:
            stats["sessions_skipped"] += 1
            continue
        stats["messages_filled"] += filled
        if apply and filled > 0:
            atomic_write_json(msgs_path, result["payload"])
            stats["sessions_updated"] += 1
            print(f"[ok] {sid[:8]}… filled {filled} / {result['messages']} msgs")
        elif filled > 0:
            print(
                f"[dry-run] {sid[:8]}… would fill {filled} / {result['messages']} msgs "
                f"({result.get('start_ms')} → {result.get('end_ms')})"
            )
        else:
            stats["sessions_skipped"] += 1

    if apply and reindex_fts:
        print("Re-indexing session_messages FTS from disk…")
        fts_stats = store._backfill_from_sessions_root_sync(root, overwrite=True)
        stats["fts"] = fts_stats
        print(f"FTS: {fts_stats}")

    return stats
