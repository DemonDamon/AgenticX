# agenticx/learning/trajectory/task_split.py
"""任务集拆分查询/守卫薄层（SP18）。

数据源: datasets/task_split.json（checked-in, 由 heldout_split 确定性生成,
seed="tb40-v1" ratio=0.2 → 54 训练 / 12 考试）。
考试题（heldout）禁止进入任何训练/自探索环节——与 trainer.heldout 同红线。
"""
from __future__ import annotations

import json
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_CONFIG = _REPO_ROOT / "datasets" / "task_split.json"


def load_split(path: Path | None = None) -> dict:
    p = Path(path) if path else _DEFAULT_CONFIG
    data = json.loads(p.read_text())
    for key in ("seed", "ratio", "train", "heldout"):
        if key not in data:
            raise ValueError(f"拆分配置缺字段 {key}: {p}")
    return data


def is_eval_task(task_name: str, split: dict) -> bool:
    return task_name in split["heldout"]


def assert_trainable_task(task_name: str, split: dict) -> None:
    all_tasks = set(split["train"]) | set(split["heldout"])
    if task_name not in all_tasks:
        raise ValueError(
            f"task '{task_name}' 不在任务名单（66 题拆分, seed={split['seed']}）——"
            f"先确认任务目录存在, 或重新生成 datasets/task_split.json")
    if is_eval_task(task_name, split):
        # 复用 P0 的评测隔离异常语义
        from agenticx.trainer.heldout import HeldoutViolation
        raise HeldoutViolation(
            f"task '{task_name}' 在 held-out 考试集（seed={split['seed']}），"
            f"禁止进入训练/自探索数据")
