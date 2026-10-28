#!/usr/bin/env python3
"""One-command golden path: probe → job → gov → tags → board → patrol."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Allow running as script from repo root or this directory
REPO = ROOT.parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from examples.data_suite.golden_path.board_stage import run_board_stage
from examples.data_suite.golden_path.governance_stage import run_governance_stage
from examples.data_suite.golden_path.patrol_stage import run_patrol_stage
from examples.data_suite.golden_path.pipeline import dst_rows, run_job_stage
from examples.data_suite.golden_path.probe import build_golden_registry, load_member_seed, probe_src
from examples.data_suite.golden_path.tags_stage import run_tags_stage


async def main() -> int:
    seed = load_member_seed()
    registry = build_golden_registry(seed_rows=seed)
    probe = probe_src(registry)
    print(f"PROBE ok={probe.ok} tables={probe.tables}")

    job = await run_job_stage(registry=registry)
    out_rows = dst_rows(registry)
    print(f"JOB ok={job.ok} written={job.written} dst_rows={len(out_rows)} error={job.error!r}")
    if not job.ok:
        return 1

    # Prefer dst rows for downstream; fall back to seed
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
        "probe_ok": probe.ok,
        "job_written": job.written,
        "audience_size": tags["audience_size"],
        "widgets": len(board["widgets"]),
        "webhook_kinds": patrol["webhook_kinds"],
    }
    print("SUMMARY " + json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
