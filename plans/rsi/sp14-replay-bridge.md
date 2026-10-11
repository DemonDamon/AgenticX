# SP14: 工程收尾 — 真实回放分数接入（替换占位）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** M4 冒烟里的占位回放分（`{task: 0.0}`）替换为**真实来源**：harness-lab 已有轨迹 → TrialForest → per-task 历史 pass 率（任务难度先验，[0,1] 尺度，与 reward 同尺度可直接混合）。纯工程收尾，之后提交分支。

**已验证的数据事实（2026-09-17）:**
- `collect_jobs(jobs_dir, job_pattern="*tb40*")` 收 10 条轨迹 / 9 任务（188 条 trial 中 tb40 口径）
- task_id 形态 `terminal-bench/<name>`（来自 result.json 的 task_name）
- music-harmony 不在数据内 → 冒烟将走 replay_shaping 的"缺失回放分回退组内归一化"路径（该回退已有单测，冒烟做真实验证）
- `AttemptNode.passed`（forest.py）= 该 attempt reward≥1.0

**语义决策:** per-task 回放分数 = **该任务在森林内全部 attempt 的 pass 率**（任务难度先验：模型群在这个任务上的历史成功率）。不用 evaluate_policy 的策略视角——10 条轨迹下两者近似，历史 pass 率零额外计算且平滑（多 attempt 任务得非 0/1 值）。

**Tech Stack:** 既有栈零新增依赖。pytest 一律 `-o addopts="--import-mode=importlib"`。

---

### Task 1: replay_bridge.py — 森林/轨迹 → per-task 回放分数

**Files:**
- Create: `agenticx/rl/replay_bridge.py`
- Test: `tests/rl/test_replay_bridge.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/rl/test_replay_bridge.py
import json

from agenticx.learning.trajectory.forest import TrialForest
from agenticx.learning.trajectory.schema import RewardRecord, RSITrajectory
from agenticx.rl.replay_bridge import (
    task_replay_scores, task_replay_scores_from_jobs,
)


def _traj(task, label):
    return RSITrajectory(
        source="harbor-tb40", task_id=task, session_id=f"s-{task}-{label}",
        model="m", status="pass" if label >= 1 else "fail",
        reward=RewardRecord(label=label, source="verifier",
                            components={"verifier": label}),
        messages=[], tool_calls=[], decision_lineage=[], token_usage={},
        created_at="", metadata={},
    )


def test_task_replay_scores_pass_rate():
    f = TrialForest.from_trajectories(
        [_traj("terminal-bench/a", 1.0), _traj("terminal-bench/a", 0.0),
         _traj("terminal-bench/b", 1.0)])
    s = task_replay_scores(f)
    assert s["terminal-bench/a"] == 0.5
    assert s["terminal-bench/b"] == 1.0


def test_task_replay_scores_empty_forest():
    assert task_replay_scores(TrialForest.from_trajectories([])) == {}


def test_task_replay_scores_partial_reward_counts():
    # partial（0.5）按连续值平均，不是 0/1
    f = TrialForest.from_trajectories(
        [_traj("t/a", 0.5), _traj("t/a", 1.0)])
    assert task_replay_scores(f)["t/a"] == 0.75


def _make_job(jobs, task_name, label):
    d = jobs / "job-tb40" / f"{task_name}__h{abs(hash(task_name + str(label))) % 9999:04x}"
    (d / "agent").mkdir(parents=True)
    (d / "result.json").write_text(json.dumps({
        "task_name": f"terminal-bench/{task_name}",
        "verifier_result": {"rewards": {"reward": label}}}))
    (d / "config.json").write_text(json.dumps(
        {"task": {"name": f"terminal-bench/{task_name}"}}))
    (d / "agent" / "agenticx.trajectory.json").write_text(json.dumps(
        {"agent": "agenticx", "model": "m", "success": label >= 1,
         "messages": [], "totals": {}}))
    return d


def test_task_replay_scores_from_jobs(tmp_path):
    _make_job(tmp_path, "alpha", 1.0)
    _make_job(tmp_path, "alpha", 0.0)
    _make_job(tmp_path, "beta", 1.0)
    s = task_replay_scores_from_jobs(tmp_path)
    assert s["terminal-bench/alpha"] == 0.5
    assert s["terminal-bench/beta"] == 1.0


def test_task_replay_scores_from_jobs_pattern(tmp_path):
    _make_job(tmp_path, "alpha", 1.0)
    d = tmp_path / "job-other" / "gamma__h0001"
    (d / "agent").mkdir(parents=True)
    (d / "result.json").write_text(json.dumps({
        "task_name": "terminal-bench/gamma",
        "verifier_result": {"rewards": {"reward": 1.0}}}))
    (d / "config.json").write_text(json.dumps({"task": {"name": "x"}}))
    (d / "agent" / "agenticx.trajectory.json").write_text(json.dumps(
        {"messages": [], "totals": {}}))
    s = task_replay_scores_from_jobs(tmp_path)                # 默认 *tb40*
    assert "terminal-bench/gamma" not in s
    s2 = task_replay_scores_from_jobs(tmp_path, job_pattern="*other*")
    assert "terminal-bench/gamma" in s2


def test_bridge_feeds_replay_shaping_end_to_end():
    """桥接输出直接可作 replay_shaped_advantage 的 replay_scores。"""
    from agenticx.rl.replay_shaping import replay_shaped_advantage
    f = TrialForest.from_trajectories(
        [_traj("t/a", 1.0), _traj("t/a", 0.0)])
    scores = task_replay_scores(f)
    adv = replay_shaped_advantage([1.0, 0.0], ["t/a", "t/a"], scores,
                                  replay_weight=1.0)
    assert adv.shape == (2,)          # 基线 0.5：+0.5/-0.5（std=0.5 → [1,-1]）
    assert adv[0] > 0 > adv[1]
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/rl/test_replay_bridge.py -v -o addopts="--import-mode=importlib"`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
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
        labels = [a.reward for a in tree.attempts if a.n_steps > 0]
        if labels:
            scores[task_id] = sum(labels) / len(labels)
    return scores


def task_replay_scores_from_jobs(jobs_dir: Path,
                                 job_pattern: str = "*tb40*") -> dict[str, float]:
    """harness-lab/jobs → 真实 per-task 回放分数（轨迹采集 → 森林 → 统计）。"""
    trajs = collect_jobs(Path(jobs_dir), job_pattern=job_pattern)
    return task_replay_scores(TrialForest.from_trajectories(trajs))
```

实现注意：`tree.attempts` 的元素是 AttemptNode——确认其 reward 属性名（可能是 `reward`/`label`/`passed`）。若为布尔 passed 或属性名不同，按 forest.py 实际字段调整（`sum(a.passed for ...)/n` 即 pass 率版本），测试 test_task_replay_scores_partial_reward_counts 相应删除或改布尔语义——**以 forest.py 真实 schema 为准，先读再写**。

- [ ] **Step 4: 跑测试确认通过**（6-7 PASS）

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/replay_bridge.py tests/rl/test_replay_bridge.py
git commit -m "feat(rl): replay score bridge — real trajectory forest → per-task baseline scores"
```

---

### Task 2: rl_smoke_m4.py 接真实回放分 + 全量回归 + push

**Files:**
- Modify: `scripts/rl_smoke_m4.py`

- [ ] **Step 1: 脚本改造**

在 argparse 区加参数：

```python
    ap.add_argument("--replay-from-jobs", default="harness-lab/jobs",
                    help="用真实轨迹算回放分（None 时用占位 0.0）")
```

main() 中把占位分数段替换为：

```python
    if args.replay_from_jobs:
        from agenticx.rl.replay_bridge import task_replay_scores_from_jobs
        replay_scores = task_replay_scores_from_jobs(Path(args.replay_from_jobs))
        # episode.task 是路径（harness-lab/terminal-bench/music-harmony）；
        # 回放分 key 是 terminal-bench/<name> —— basename 匹配
        name = Path(args.task).name
        keys = [k for k in replay_scores if k.endswith(f"/{name}") or k == name]
        task_score = replay_scores.get(keys[0]) if keys else None
        print(f"[m4] replay scores: {len(replay_scores)} tasks "
              f"from {args.replay_from_jobs}; this task -> {task_score}")
        replay_scores = {args.task: task_score} if task_score is not None else {}
        # 无该任务回放分 → 空 dict → shaping 回退组内基线（真实验证回退路径）
    else:
        replay_scores = {args.task: 0.0}
```

训练步改用统一 dict（shaping lambda 里 replay_scores 的 key 用 args.task）：

```python
    m = tr.train_step_episodes(
        [ep], shaping=lambda rs, ts: replay_shaped_advantage(
            rs, ts, replay_scores, replay_weight=1.0))
```

（原 vanilla 对照行保留。）music-harmony 无回放分 → 空字典路径：replay_shaped_advantage 对缺分数任务回退组内归一化（单 episode 组内 std=0 → eps 保护）。此时 shaped_adv 与 vanilla_adv 同值——打印行为预期：`this task -> None` + shaped==vanilla。

- [ ] **Step 2: 真跑冒烟（父代理复验同款命令）**

Run: `python3 scripts/rl_smoke_m4.py --task harness-lab/terminal-bench/music-harmony --trials-dir /tmp/agenticx_rl_m4_smoke_r2`
Expected: `replay scores: 9 tasks`、`this task -> None`、episode 采集正常、shaped==vanilla（回退路径）、PASS 退出码 0。

再跑一个**有回放分的任务**（从 9 个 tb40 任务挑一个轻的，如 embedding-drift-monitor 若镜像在本地；若镜像需大量下载则挑本地已有镜像的；都不行则以 music-harmony 的回退路径为准并在报告注明）：
Run: `python3 scripts/rl_smoke_m4.py --task harness-lab/terminal-bench/<name> --trials-dir /tmp/agenticx_rl_m4_smoke_r3`
Expected: `this task -> 0.0 或 1.0`（真实历史分）、shaped≠vanilla、PASS。

- [ ] **Step 3: 全量回归**

Run: `python3 -m pytest tests/rl/ tests/trajectory/ tests/trainer/ -o addopts="--import-mode=importlib" -q`
Expected: 全 PASS（SP13 基线 157 + 新增 6~7 = 163~164）

- [ ] **Step 4: Commit + push**

```bash
git add scripts/rl_smoke_m4.py
git commit -m "feat(rl): M4 smoke consumes real replay scores from trajectory forest"
git push origin feat/rsi-data-flywheel
```
