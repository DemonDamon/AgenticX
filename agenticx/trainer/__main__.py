"""④蒸馏层 CLI。

用法:
  python -m agenticx.trainer collect --jobs-dir harness-lab/jobs --store datasets/trajectories
  python -m agenticx.trainer build --store datasets/trajectories --format sft --out datasets --name tb40-sft-v1
  python -m agenticx.trainer build --store datasets/trajectories --format dpo --out datasets --name tb40-dpo-v1
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from agenticx.learning.trajectory.harbor_collector import collect_jobs
from agenticx.learning.trajectory.store import TrajectoryStore
from .builders import build_sft, build_dpo
from .heldout import heldout_split
from .quality import score_trajectory
from .exporters import export_llama_factory, write_card
from .registry import ModelRegistry

def _cmd_collect(args) -> int:
    store = TrajectoryStore(Path(args.store))
    n = sum(store.append(t) == "written" for t in collect_jobs(Path(args.jobs_dir)))
    print(json.dumps({"written": n}))
    return 0

def _cmd_build(args) -> int:
    store = TrajectoryStore(Path(args.store))
    trajs = list(store.iter_trajectories())
    split = heldout_split([t.task_id for t in trajs if t.task_id], seed=args.seed)
    for t in trajs:
        if not t.task_id:
            continue
        q = score_trajectory(t)
        t.metadata["quality"] = q.score
    kept = [t for t in trajs if t.task_id and t.metadata.get("quality", 0) >= args.min_quality]
    if args.format == "sft":
        samples, kind = build_sft(kept, split), "sft"
    else:
        samples, kind = build_dpo(kept, split), "dpo"
    export_llama_factory(samples, Path(args.out), args.name)
    write_card(Path(args.out), name=args.name, kind=kind, n_samples=len(samples),
               tasks=list(split.train), heldout=list(split.heldout),
               scrub_hits=0, seed=args.seed)
    print(json.dumps({"n_samples": len(samples), "heldout": len(split.heldout)}))
    return 0

def _make_reg(path: str) -> ModelRegistry:
    return ModelRegistry(Path(path))

def _cmd_registry(args) -> int:
    reg = _make_reg(args.registry)
    if args.action == "register":
        vid = reg.register(args.alias, model_spec=args.model, backend=args.backend)
        print(json.dumps({"registered": vid}))
    elif args.action == "promote":
        print(json.dumps({"promoted": reg.promote(args.alias)}))
    elif args.action == "rollback":
        print(json.dumps({"rollback_to": reg.rollback(args.alias)}))
    elif args.action == "resolve":
        print(json.dumps(reg.resolve(args.alias), ensure_ascii=False))
    elif args.action == "list":
        print(json.dumps(reg.list(), ensure_ascii=False, indent=2))
    return 0

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="agenticx.trainer")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect")
    c.add_argument("--jobs-dir", default="harness-lab/jobs")
    c.add_argument("--store", default="datasets/trajectories")
    c.set_defaults(func=_cmd_collect)
    b = sub.add_parser("build")
    b.add_argument("--store", default="datasets/trajectories")
    b.add_argument("--format", choices=["sft", "dpo"], required=True)
    b.add_argument("--out", default="datasets")
    b.add_argument("--name", required=True)
    b.add_argument("--seed", default="v1")
    b.add_argument("--min-quality", type=float, default=0.5)
    b.set_defaults(func=_cmd_build)
    r = sub.add_parser("registry")
    r.add_argument("action", choices=["register", "promote", "rollback", "resolve", "list"])
    r.add_argument("alias", nargs="?", default=None)
    r.add_argument("--model", default="")
    r.add_argument("--backend", default="")
    r.add_argument("--registry", default=str(Path.home() / ".agenticx/registry/models.json"))
    r.set_defaults(func=_cmd_registry)
    args = ap.parse_args(argv)
    return args.func(args)

if __name__ == "__main__":
    sys.exit(main())
