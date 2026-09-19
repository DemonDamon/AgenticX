#!/usr/bin/env python3
"""对比经验挖掘 CLI（SP17）：harness-lab 真实轨迹 → 对比式 Lesson 清单。

对齐 ModularRSI 的对比蒸馏设定: 同任务成败对比提取系统缺陷信号,
跨任务投票过滤单任务噪声。只做只读分析, 不写训练管线。

用法:
  python3 scripts/mine_lessons.py                       # tb40 口径(默认, 无对比对)
  python3 scripts/mine_lessons.py --pattern '*'         # 全量 jobs(8 个对比组)
  python3 scripts/mine_lessons.py --pattern '*' --min-votes 2
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.learning.trajectory.harbor_collector import collect_jobs  # noqa: E402
from agenticx.learning.trajectory.memory import (        # noqa: E402
    Lesson, _vote_key, contrastive_lessons_from_trajectories,
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs-dir", default="harness-lab/jobs")
    ap.add_argument("--pattern", default="*tb40*",
                    help="job 目录 glob（'*' 为全量含旧实验）")
    ap.add_argument("--min-votes", type=int, default=1,
                    help="跨任务票数门槛（1=不过滤）")
    ap.add_argument("--max-lessons", type=int, default=3)
    args = ap.parse_args()

    trajs = list(collect_jobs(Path(args.jobs_dir), job_pattern=args.pattern))
    passes = sum(1 for t in trajs if t.status == "pass")
    fails = sum(1 for t in trajs if t.status == "fail")
    print(f"轨迹 {len(trajs)} 条（pass {passes} / fail {fails}），"
          f"pattern={args.pattern!r}")

    lessons = contrastive_lessons_from_trajectories(
        trajs, max_lessons_per_task=args.max_lessons)
    print(f"对比式经验 {len(lessons)} 条\n")

    votes: Counter[str] = Counter()
    for l in lessons:
        votes[_vote_key(l.content)] += 1
    kept = [l for l in lessons
            if votes[_vote_key(l.content)] >= args.min_votes]
    for l in kept:
        v = votes[_vote_key(l.content)]
        tag = f" [跨 {v} 任务复现]" if v > 1 else ""
        print(f"- [{l.kind}] {l.task_id}{tag}: {l.content}")
    dropped = len(lessons) - len(kept)
    if args.min_votes > 1:
        print(f"\n票数门槛 min_votes={args.min_votes}: "
              f"保留 {len(kept)} / 丢弃 {dropped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
