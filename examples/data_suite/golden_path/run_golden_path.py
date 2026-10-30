#!/usr/bin/env python3
"""One-command golden path: probe → ops → gov → tags → board → patrol.

Channel variants (hermetic in-memory; no live SFTP/Hive required)::

    python examples/data_suite/golden_path/run_golden_path.py
    python examples/data_suite/golden_path/run_golden_path.py --channel file
    python examples/data_suite/golden_path/run_golden_path.py --channel hive
    AGX_GOLDEN_CHANNEL=file python examples/data_suite/golden_path/run_golden_path.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from examples.data_suite.golden_path.board_stage import run_board_stage
from examples.data_suite.golden_path.governance_stage import run_governance_stage
from examples.data_suite.golden_path.ops_stage import run_ops_stage
from examples.data_suite.golden_path.patrol_stage import run_patrol_stage
from examples.data_suite.golden_path.pipeline import dst_rows
from examples.data_suite.golden_path.probe import (
    VALID_KINDS,
    build_golden_registry,
    load_member_seed,
    probe_src,
)
from examples.data_suite.golden_path.tags_stage import run_tags_stage


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="AgenticX Data Suite golden path")
    parser.add_argument(
        "--channel",
        choices=sorted(VALID_KINDS),
        default=None,
        help="Channel kind: fake (default), file, or hive (in-memory stub)",
    )
    return parser.parse_args(argv)


async def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    env_kind = (os.environ.get("AGX_GOLDEN_CHANNEL") or "").strip().lower()
    kind = (args.channel or env_kind or "fake").strip().lower()
    if kind not in VALID_KINDS:
        print(f"ERROR unsupported channel kind: {kind!r}", file=sys.stderr)
        return 2

    seed = load_member_seed()
    registry = build_golden_registry(seed_rows=seed, kind=kind)
    probe = probe_src(registry)
    print(f"PROBE ok={probe.ok} kind={kind} dialect={getattr(probe, 'dialect', None)} tables={probe.tables}")
    if not probe.ok:
        return 1

    # H6 ops: schedule tick → history → rerun (also executes the DataFlow job)
    ops = await run_ops_stage(registry=registry)
    tick = (ops.get("tick_runs") or [{}])[0]
    rerun = ops.get("rerun") or {}
    print(
        f"OPS job={ops.get('job_id')} cron={ops.get('cron')} "
        f"tick={tick.get('status')} rerun={rerun.get('status')} "
        f"history={len(ops.get('history') or [])}"
    )
    if tick.get("status") != "succeeded" or rerun.get("status") != "succeeded":
        return 1

    out_rows = dst_rows(registry)
    print(f"JOB ok=True written={len(out_rows)} dst_rows={len(out_rows)} via=ops")
    rows = out_rows or seed

    gov = run_governance_stage(rows)
    print(f"GOV fields={gov['catalog_fields']} null_rate={gov['quality']['metrics'].get('null_rate_member_id')}")

    tags = run_tags_stage(rows)
    print(f"TAGS tagged={tags['tagged']} audience={tags['audience_size']}")

    board = run_board_stage(rows, role="analyst")
    print(
        f"BOARD widgets={len(board['widgets'])} "
        f"masked_email={board['masked_sample'].get('email')!r}"
    )

    patrol = run_patrol_stage(rows)
    print(
        f"PATROL webhooks={patrol['webhook_count']} "
        f"kinds={patrol['webhook_kinds']} todos={patrol['todos']}"
    )

    summary = {
        "channel_kind": kind,
        "probe_ok": probe.ok,
        "ops_tick": tick.get("status"),
        "ops_rerun": rerun.get("status"),
        "ops_history": len(ops.get("history") or []),
        "job_written": len(out_rows),
        "audience_size": tags["audience_size"],
        "widgets": len(board["widgets"]),
        "webhook_kinds": patrol["webhook_kinds"],
    }
    print("SUMMARY " + json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
