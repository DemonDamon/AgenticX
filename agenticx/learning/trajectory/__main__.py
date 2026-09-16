# agenticx/learning/trajectory/__main__.py
"""②采集层 CLI。

用法:
  python -m agenticx.learning.trajectory collect --source harbor --jobs-dir harness-lab/jobs --out datasets/trajectories
  python -m agenticx.learning.trajectory collect --source session --sessions-dir ~/.agenticx/sessions --out datasets/trajectories
  python -m agenticx.learning.trajectory stats --store datasets/trajectories
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .harbor_collector import collect_jobs
from .session_collector import collect_sessions
from .store import TrajectoryStore

def _cmd_collect(args) -> int:
    store = TrajectoryStore(Path(args.out))
    if args.source == "harbor":
        trajs = collect_jobs(Path(args.jobs_dir), job_pattern=args.pattern)
    else:
        trajs = collect_sessions(Path(args.sessions_dir))
    written = duplicates = 0
    for t in trajs:
        r = store.append(t)
        written += r == "written"
        duplicates += r == "duplicate"
    print(json.dumps({"written": written, "duplicate": duplicates}, ensure_ascii=False))
    return 0

def _cmd_stats(args) -> int:
    print(json.dumps(TrajectoryStore(Path(args.store)).stats(), ensure_ascii=False, indent=2))
    return 0

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="agenticx.learning.trajectory")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect")
    c.add_argument("--source", choices=["harbor", "session"], required=True)
    c.add_argument("--jobs-dir", default="harness-lab/jobs")
    c.add_argument("--pattern", default="*tb40*")
    c.add_argument("--sessions-dir", default="~/.agenticx/sessions")
    c.add_argument("--out", default="datasets/trajectories")
    c.set_defaults(func=_cmd_collect)
    s = sub.add_parser("stats")
    s.add_argument("--store", default="datasets/trajectories")
    s.set_defaults(func=_cmd_stats)
    args = ap.parse_args(argv)
    return args.func(args)

if __name__ == "__main__":
    sys.exit(main())
