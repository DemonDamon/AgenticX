# agenticx/rl/replay_bridge.py
"""回放分数桥（P1 · M4 收尾）：harness-lab 真实轨迹 → per-task 回放基线分。

per-task 分数 = 森林内该任务全部 attempt 的 reward 均值（任务难度先验，
[0,1] 尺度与 GRPO reward 同尺度，直接喂 replay_shaped_advantage）。
数据源: collect_jobs（默认 *tb40* 口径，排除 broken-tb21mix 旧实验）。
"""
from __future__ import annotations

from pathlib import Path

from ..learning.trajectory.forest import TrialForest
from ..learning.trajectory.harbor_collector import collect_jobs


def task_replay_scores(forest: TrialForest) -> dict[str, float]:
    """森林 → {task_id: 历史 reward 均值}。空树（无 attempt）不出现在结果里。"""
    scores: dict[str, float] = {}
    for task_id, tree in forest.trees.items():
        labels = [a.reward_label for a in tree.attempts]
        if labels:
            scores[task_id] = sum(labels) / len(labels)
    return scores


def task_replay_scores_from_jobs(jobs_dir: Path,
                                 job_pattern: str = "*tb40*") -> dict[str, float]:
    """harness-lab/jobs → 真实 per-task 回放分数（轨迹采集 → 森林 → 统计）。"""
    trajs = collect_jobs(Path(jobs_dir), job_pattern=job_pattern)
    return task_replay_scores(TrialForest.from_trajectories(trajs))
