# tests/trajectory/test_train_manifest.py
"""train/eval manifest 构建的三条硬规则回归。"""
from __future__ import annotations

import json
from pathlib import Path

from agenticx.learning.trajectory.train_manifest import (
    build_manifest,
    collect_durations,
    curriculum_order,
)


def _write(path: Path, payload: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))
    return path


def _fixtures(tmp_path: Path) -> tuple[Path, Path]:
    pool = _write(tmp_path / "pool.json", {
        "summary": {"total": 5},
        "tasks": [{"task_id": t} for t in (
            "code-short-1", "code-short-2", "code-medium-1",
            "cyber-long-1", "code-unmeasured-1",
        )],
    })
    split = _write(tmp_path / "split.json", {
        "seed": "t", "ratio": 0.2,
        "train": [], "heldout": ["code-short-1"],
    })
    return pool, split


def test_heldout_never_enters_train(tmp_path: Path) -> None:
    pool, split = _fixtures(tmp_path)
    m = build_manifest({}, pool_path=pool, split_path=split)
    assert "code-short-1" not in m["train"]
    assert "code-short-1" not in m["tiers"]["unmeasured"]
    assert m["excluded"]["heldout_overlap"] == ["code-short-1"]
    assert "code-short-1" in m["eval"]


def test_tiers_by_wall_seconds_and_unmeasured_isolated(tmp_path: Path) -> None:
    pool, split = _fixtures(tmp_path)
    durations = {
        "code-short-2": {"wall_seconds": 400, "samples": 1, "reward": 1.0},
        "code-medium-1": {"wall_seconds": 1200, "samples": 1, "reward": 0.0},
        "cyber-long-1": {"wall_seconds": 4000, "samples": 1, "reward": 0.0},
    }
    m = build_manifest(durations, pool_path=pool, split_path=split)
    assert m["tiers"]["short"] == ["code-short-2"]
    assert m["tiers"]["medium"] == ["code-medium-1"]
    assert m["tiers"]["long"] == ["cyber-long-1"]
    assert m["tiers"]["unmeasured"] == ["code-unmeasured-1"]
    assert m["summary"]["unmeasured"] == 1


def test_exclude_solved_drops_full_reward(tmp_path: Path) -> None:
    pool, split = _fixtures(tmp_path)
    durations = {"code-short-2": {"wall_seconds": 400, "samples": 1, "reward": 1.0}}
    m = build_manifest(durations, pool_path=pool, split_path=split, exclude_solved=True)
    assert m["tiers"]["short"] == []
    assert m["excluded"]["solved"] == ["code-short-2"]


def test_collect_durations_medians_multi_round(tmp_path: Path) -> None:
    run = tmp_path / "calibration-x"
    _write(run / "summary.json", {"rows": [
        {"task": "terminal-bench/task-a", "duration_sec": 100, "reward": 1},
        {"task": "task-a", "duration_sec": 300, "reward": 0},
    ]})
    got = collect_durations(tmp_path)
    assert got["task-a"]["wall_seconds"] == 200
    assert got["task-a"]["samples"] == 2


def test_curriculum_order_short_first_and_deterministic(tmp_path: Path) -> None:
    pool, split = _fixtures(tmp_path)
    durations = {
        "code-short-2": {"wall_seconds": 400, "samples": 1, "reward": 0.0},
        "code-medium-1": {"wall_seconds": 1200, "samples": 1, "reward": 0.0},
        "cyber-long-1": {"wall_seconds": 4000, "samples": 1, "reward": 0.0},
    }
    m = build_manifest(durations, pool_path=pool, split_path=split)
    a, b = curriculum_order(m), curriculum_order(m)
    assert a == b
    assert a.index("code-short-2") < a.index("code-medium-1") < a.index("cyber-long-1")
