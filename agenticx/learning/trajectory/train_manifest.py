# agenticx/learning/trajectory/train_manifest.py
"""训练/评测 manifest 构建（RSI 开训前置，SP31）。

三条硬规则：
1. held-out 永不出现在 train——先经 normalize_task_id 归一化再比对
   （harbor 的 task_name 带 ``terminal-bench/`` 前缀，直接比会漏配）；
2. 按实测墙钟分层（short / medium / long），**未实测任务单列**，不静默混入，
   避免把 11802s 的长尾任务当短任务塞进 GRPO 一步里；
3. 输出可复现：排序稳定、采样用显式 seed。
"""
from __future__ import annotations

import json
import statistics
from pathlib import Path
from typing import Iterable

from agenticx.learning.trajectory.task_split import (
    load_pool_tasks,
    load_split,
    normalize_task_id,
)

SHORT_MAX = 900.0
MEDIUM_MAX = 1800.0


def collect_durations(result_root: str | Path = "results") -> dict[str, dict]:
    """从 calibration 结果里取每任务的实测墙钟与 reward（多轮取中位数）。"""
    root = Path(result_root)
    walls: dict[str, list[float]] = {}
    rewards: dict[str, list[float]] = {}
    for summary in root.glob("*/summary.json"):
        try:
            data = json.loads(summary.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        for row in data.get("rows", []):
            task = normalize_task_id(row.get("task", ""))
            if not task:
                continue
            if isinstance(row.get("duration_sec"), (int, float)):
                walls.setdefault(task, []).append(float(row["duration_sec"]))
            if isinstance(row.get("reward"), (int, float)):
                rewards.setdefault(task, []).append(float(row["reward"]))
    out: dict[str, dict] = {}
    for task, vals in walls.items():
        out[task] = {
            "wall_seconds": statistics.median(vals),
            "samples": len(vals),
            "reward": statistics.mean(rewards.get(task, []) or [0.0]),
        }
    return out


def _tier(wall: float, short_max: float, medium_max: float) -> str:
    if wall < short_max:
        return "short"
    if wall < medium_max:
        return "medium"
    return "long"


def build_manifest(
    durations: dict[str, dict],
    *,
    pool_path: str | Path | None = None,
    split_path: str | Path | None = None,
    short_max: float = SHORT_MAX,
    medium_max: float = MEDIUM_MAX,
    exclude_solved: bool = False,
) -> dict:
    """构建 train/eval manifest。exclude_solved=True 时剔除 reward==1 的任务（无梯度）。"""
    split = load_split(Path(split_path) if split_path else None)
    pool = load_pool_tasks(Path(pool_path) if pool_path else None)
    eval_ids = {normalize_task_id(t) for t in split["heldout"]}

    tiers: dict[str, list[str]] = {"short": [], "medium": [], "long": [], "unmeasured": []}
    observed: dict[str, dict] = {}
    excluded = {"heldout_overlap": [], "solved": []}

    for task in sorted(pool):
        norm = normalize_task_id(task)
        if norm in eval_ids:
            excluded["heldout_overlap"].append(task)
            continue
        info = durations.get(norm)
        if exclude_solved and info and info.get("reward", 0.0) >= 1.0:
            excluded["solved"].append(task)
            continue
        if info is None:
            tiers["unmeasured"].append(task)
            continue
        tiers[_tier(info["wall_seconds"], short_max, medium_max)].append(task)
        observed[task] = info

    train = tiers["short"] + tiers["medium"] + tiers["long"]
    return {
        "seed": split["seed"],
        "thresholds": {"short_max": short_max, "medium_max": medium_max},
        "source": {
            "pool": str(pool_path or "datasets/task_pool.json"),
            "split": str(split_path or "datasets/task_split.json"),
            "durations": len(durations),
        },
        "summary": {
            "train": len(train),
            "eval": len(eval_ids),
            "short": len(tiers["short"]),
            "medium": len(tiers["medium"]),
            "long": len(tiers["long"]),
            "unmeasured": len(tiers["unmeasured"]),
            "excluded": {k: len(v) for k, v in excluded.items()},
        },
        "tiers": tiers,
        "train": train,
        "eval": sorted(eval_ids),
        "observed": observed,
        "excluded": excluded,
    }


def write_manifest(manifest: dict, path: str | Path) -> Path:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return p


def curriculum_order(manifest: dict, rounds: int = 1) -> list[str]:
    """按 short → medium → long 推进的课程顺序；rounds>1 时重复但每轮打乱。"""
    import random

    seq: list[str] = []
    for r in range(rounds):
        batch: list[str] = []
        for tier in ("short", "medium", "long"):
            items = list(manifest["tiers"][tier])
            random.Random(f"{manifest['seed']}-{tier}-{r}").shuffle(items)
            batch.extend(items)
        seq.extend(batch)
    return seq
