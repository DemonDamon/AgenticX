#!/usr/bin/env python3
"""CLI: backfill missing message timestamps in ~/.agenticx/sessions/*/messages.json.

Usage (from repo root):
  python scripts/backfill_message_timestamps.py --dry-run
  python scripts/backfill_message_timestamps.py --apply
  python scripts/backfill_message_timestamps.py --apply --reindex-fts

Author: Damon Li
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from agenticx.memory.message_timestamp_backfill import run_backfill
from agenticx.memory.session_store import DEFAULT_SESSION_DB_PATH

DEFAULT_SESSIONS_ROOT = Path.home() / ".agenticx" / "sessions"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill missing message timestamps in AgenticX session messages.json files."
    )
    parser.add_argument(
        "--sessions-root",
        type=Path,
        default=DEFAULT_SESSIONS_ROOT,
        help=f"Sessions directory (default: {DEFAULT_SESSIONS_ROOT})",
    )
    parser.add_argument(
        "--db-path",
        type=Path,
        default=DEFAULT_SESSION_DB_PATH,
        help=f"SQLite session store (default: {DEFAULT_SESSION_DB_PATH})",
    )
    parser.add_argument(
        "--session-id",
        type=str,
        default=None,
        help="Only process sessions whose id equals or starts with this prefix",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process at most N session directories (for testing)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write messages.json (default is dry-run)",
    )
    parser.add_argument(
        "--reindex-fts",
        action="store_true",
        help="After --apply, rebuild session_messages FTS from messages.json",
    )
    args = parser.parse_args()
    if args.reindex_fts and not args.apply:
        print("--reindex-fts requires --apply", file=sys.stderr)
        return 2

    stats = run_backfill(
        sessions_root=args.sessions_root,
        db_path=args.db_path,
        apply=args.apply,
        reindex_fts=args.reindex_fts,
        session_id=args.session_id,
        limit=args.limit,
    )
    if stats.get("error"):
        print(stats["error"], file=sys.stderr)
        return 1
    print(
        f"Done: scanned={stats['sessions_scanned']} updated={stats['sessions_updated']} "
        f"filled_msgs={stats['messages_filled']} skipped={stats['sessions_skipped']} "
        f"errors={stats['errors']} dry_run={stats['dry_run']}"
    )
    return 0 if stats["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
