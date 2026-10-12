# agenticx/learning/trajectory/task_split.py
"""任务集拆分查询/守卫薄层（SP18, SP23 扩多域）。

数据源:
- datasets/task_split.json  TB4.0 66 题（seed=tb40-v1, 54 训练 / 12 考试）
- datasets/task_pool.json   多域任务池（SP23: MiMo code/cyber, 全训练）

考试题（heldout）禁止进入任何训练/自探索环节——与 trainer.heldout 同红线。
多域池任务 ID 带域前缀（code-/cyber-/general-）, 与 TB 裸名空间无交集。
"""
from __future__ import annotations

import json
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_CONFIG = _REPO_ROOT / "datasets" / "task_split.json"
_DEFAULT_POOL = _REPO_ROOT / "datasets" / "task_pool.json"


def load_split(path: Path | None = None) -> dict:
    p = Path(path) if path else _DEFAULT_CONFIG
    data = json.loads(p.read_text())
    for key in ("seed", "ratio", "train", "heldout"):
        if key not in data:
            raise ValueError(f"拆分配置缺字段 {key}: {p}")
    return data


def load_pool_tasks(path: Path | None = None) -> set[str]:
    """多域任务池全量 task_id（全部可训练, 无 held-out）。"""
    p = Path(path) if path else _DEFAULT_POOL
    if not p.exists():
        return set()
    data = json.loads(p.read_text())
    return {t["task_id"] for t in data.get("tasks", [])}


def is_eval_task(task_name: str, split: dict) -> bool:
    return task_name in split["heldout"]


def assert_trainable_task(task_name: str, split: dict) -> None:
    pool = load_pool_tasks()
    in_pool = task_name in pool
    all_tasks = set(split["train"]) | set(split["heldout"])
    if task_name not in all_tasks and not in_pool:
        raise ValueError(
            f"task '{task_name}' 不在任务名单（TB 66 题拆分 seed={split['seed']}"
            f"或多域任务池 {len(pool)} 题）——先确认任务来源, 或重新生成"
            f"datasets/task_split.json / datasets/task_pool.json")
    if task_name in all_tasks and is_eval_task(task_name, split):
        # 复用 P0 的评测隔离异常语义
        from agenticx.trainer.heldout import HeldoutViolation
        raise HeldoutViolation(
            f"task '{task_name}' 在 held-out 考试集（seed={split['seed']}），"
            f"禁止进入训练/自探索数据")
