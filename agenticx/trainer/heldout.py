# agenticx/trainer/heldout.py
"""③评测隔离：种子化确定性任务分裂。

严谨性红线（飞书规划 3.3 节）：训练任务与评测任务物理隔离，
held-out 任务禁止进入任何训练数据集——构建器调用 assert_trainable 守卫。
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass

@dataclass(frozen=True)
class TaskSplit:
    seed: str
    ratio: float
    train: tuple[str, ...]
    heldout: tuple[str, ...]

class HeldoutViolation(Exception):
    pass

def heldout_split(task_ids: list[str], seed: str = "v1", ratio: float = 0.2) -> TaskSplit:
    """sha256(task_id|seed) 首字节 < ratio*256 → heldout。确定性、可复现、无顺序依赖。"""
    heldout, train = [], []
    for t in sorted(set(task_ids)):
        h = int(hashlib.sha256(f"{t}|{seed}".encode()).hexdigest()[:2], 16)
        (heldout if h < ratio * 256 else train).append(t)
    return TaskSplit(seed=seed, ratio=ratio, train=tuple(train), heldout=tuple(heldout))

def assert_trainable(task_id: str, split: TaskSplit) -> None:
    if task_id in split.heldout:
        raise HeldoutViolation(
            f"task '{task_id}' 在 held-out 评测集（seed={split.seed}），禁止进入训练数据"
        )
