# agenticx/trainer/builders.py
"""④蒸馏层构建器：pass→SFT 样本；同任务 pass+fail→DPO 偏好对。

守卫：构建前逐条 assert_trainable，held-out 任务直接抛 HeldoutViolation
（物理隔离，宁可失败也不污染评测集）。
"""
from __future__ import annotations

from collections import defaultdict

from agenticx.learning.trajectory.schema import RSITrajectory
from .heldout import TaskSplit, assert_trainable
from .scrub import scrub_trajectory

_ROLE_MAP = {"system": "system", "user": "human", "assistant": "gpt", "tool": "tool"}

def _to_sharegpt(traj: RSITrajectory) -> dict | None:
    convs = []
    for m in traj.messages:
        role = _ROLE_MAP.get(m.get("role"))
        content = m.get("content")
        if role is None or not isinstance(content, str) or not content.strip():
            continue
        convs.append({"from": role, "value": content})
    if len(convs) < 2 or convs[-1]["from"] != "gpt":
        return None
    return {"conversations": convs}

def _final_answer(traj: RSITrajectory) -> str:
    for m in reversed(traj.messages):
        if m.get("role") == "assistant" and isinstance(m.get("content"), str) and m["content"].strip():
            return m["content"]
    return ""

def build_sft(trajs: list[RSITrajectory], split: TaskSplit,
              scrub: bool = True) -> list[dict]:
    """pass 轨迹 → sharegpt SFT 样本（held-out 守卫 + 脱敏）。"""
    out = []
    for t in trajs:
        assert_trainable(t.task_id, split)
        if t.status != "pass":
            continue
        if scrub:
            scrub_trajectory(t)
        sample = _to_sharegpt(t)
        if sample is not None:
            sample["meta"] = {"task_id": t.task_id, "trajectory_id": t.trajectory_id,
                              "source": t.source}
            out.append(sample)
    return out

def build_dpo(trajs: list[RSITrajectory], split: TaskSplit,
              scrub: bool = True) -> list[dict]:
    """同任务 pass+fail → DPO 偏好对（chosen=pass 终答，rejected=fail 终答）。"""
    by_task: dict[str, dict[str, list[RSITrajectory]]] = defaultdict(
        lambda: {"pass": [], "fail": []})
    for t in trajs:
        assert_trainable(t.task_id, split)
        if t.status in ("pass", "fail"):
            by_task[t.task_id][t.status].append(t)
    pairs = []
    for task, groups in by_task.items():
        for good in groups["pass"]:
            bad = groups["fail"][0] if groups["fail"] else None
            if bad is None:
                continue
            if scrub:
                scrub_trajectory(good); scrub_trajectory(bad)
            prompt = _to_sharegpt(good)
            if prompt is None:
                continue
            pairs.append({
                "conversations": prompt["conversations"][:-1],  # prompt 部分
                "chosen": {"from": "gpt", "value": _final_answer(good)},
                "rejected": {"from": "gpt", "value": _final_answer(bad)},
                "meta": {"task_id": task,
                         "chosen_id": good.trajectory_id, "rejected_id": bad.trajectory_id},
            })
    return pairs
