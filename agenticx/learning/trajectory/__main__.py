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
from dataclasses import asdict
from pathlib import Path

from .evolution import (
    SEED_POLICY_SOURCE, PolicyRegistry, compile_policy, evolve_loop,
    make_llm_proposer, mutate_policy_source,
)
from .forest import TrialForest
from .harbor_collector import collect_jobs
from .policy import policy_report
from .replay import evaluate_policy, forest_score
from .session_collector import collect_sessions
from .store import TrajectoryStore
from agenticx.trainer.heldout import heldout_split

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

def _cmd_evolve(args) -> int:
    store = TrajectoryStore(Path(args.store))
    forest = TrialForest.from_trajectories(store.iter_trajectories())
    if not forest.trees:
        print("evolve 错误: 轨迹库无轨迹, 请先 collect", file=sys.stderr)
        return 1
    split = heldout_split(sorted(forest.trees), seed=args.seed)
    train_ids = list(split.train)

    def evaluate_fn(policy) -> float:
        # 纪律: 演化评分只绑定 train 区（SP7 隔离）
        return forest_score(evaluate_policy(policy, forest, task_ids=train_ids,
                                            max_attempts=args.max_attempts))

    registry = PolicyRegistry(Path(args.out))
    if registry.current() is None:
        v = registry.register(SEED_POLICY_SOURCE,
                              score=evaluate_fn(compile_policy(SEED_POLICY_SOURCE)),
                              lineage="seed")
        registry.promote(v)
    if args.dry_run:
        def propose(current_source: str, feedback: str) -> str:
            return mutate_policy_source(current_source)
    else:
        from types import SimpleNamespace
        from agenticx.llms.llm_factory import LlmFactory
        cfg = SimpleNamespace(type="litellm", model=args.llm_model,
                              api_key=args.api_key, base_url=args.base_url,
                              drop_params=True)
        propose = make_llm_proposer(LlmFactory.create_llm(cfg))
    report = evolve_loop(registry, evaluate_fn=evaluate_fn, propose_fn=propose,
                         n_iters=args.iters)
    cur = registry.current()
    final = policy_report([compile_policy(cur["source"])], forest, seed=args.seed,
                          max_attempts=args.max_attempts)
    print(json.dumps({
        "evolution": asdict(report),
        "registry": {"promoted_version": cur["version"],
                     "promoted_name": compile_policy(cur["source"]).name,
                     "n_versions": len(registry.versions())},
        "final_report": final,
    }, ensure_ascii=False, indent=2))
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
    e = sub.add_parser("evolve")
    e.add_argument("--store", default="datasets/trajectories")
    e.add_argument("--out", default="datasets/policies.json")
    e.add_argument("--iters", type=int, default=5)
    e.add_argument("--max-attempts", type=int, default=3)
    e.add_argument("--seed", default="v1")
    e.add_argument("--dry-run", action="store_true")
    e.add_argument("--llm-model", default="openai/glm-5.3-flash")
    e.add_argument("--api-key", default=None)
    e.add_argument("--base-url", default=None)
    e.set_defaults(func=_cmd_evolve)
    args = ap.parse_args(argv)
    return args.func(args)

if __name__ == "__main__":
    sys.exit(main())
