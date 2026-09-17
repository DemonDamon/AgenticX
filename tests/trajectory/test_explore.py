# tests/trajectory/test_explore.py
"""BRS-lite 驱动器 dry 全流程: 2 轮自探索 → 经验冻结 → hints 进第 2 轮注入。

实现注意: run_round 返回 dict 报告（{"round", "results", "evolution"}）,
断言按该结构书写; 每轮经验写独立轮次文件 round_N.json（目录 = trials_root
的同父 experience/）, 注入读上一轮冻结文件, 故两轮 trials_root 同父目录。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from rsi_explore import run_round   # noqa: E402

from agenticx.learning.trajectory.memory import ExperienceMemory   # noqa: E402
from agenticx.learning.trajectory.store import TrajectoryStore     # noqa: E402


def _tasks(tmp_path):
    return [str(tmp_path / "taskA"), str(tmp_path / "taskB")]


def test_two_rounds_dry(tmp_path):
    store = TrajectoryStore(tmp_path / "store")
    tasks = _tasks(tmp_path)
    trials_root = tmp_path / "trials"
    exp_dir = tmp_path / "experience"          # = trials_root.parent / "experience"

    m1 = ExperienceMemory(exp_dir / "round_1.json")
    rep1 = run_round(1, tasks, m1, store, trials_root=trials_root,
                     dry=True, evolve=False)
    assert len(rep1["results"]) == 2
    assert all("reward" in r and "hints" in r for r in rep1["results"])
    assert rep1["results"][0]["hints"] == ""    # 第 1 轮无记忆 → 不注入
    assert m1.is_frozen                         # 轮末冻结
    assert len(m1.all_lessons()) >= 2           # 2 任务各产出经验

    m2 = ExperienceMemory(exp_dir / "round_2.json")
    rep2 = run_round(2, tasks, m2, store, trials_root=trials_root,
                     dry=True, evolve=False)
    # 第 1 轮错误经验注入第 2 轮
    assert "FileNotFoundError" in rep2["results"][0]["hints"]
    # 新一轮记忆是独立实例（驱动器每轮独立轮次文件, 注入读上一轮冻结文件）
    n_traj = sum(1 for _ in store.iter_trajectories())
    assert n_traj == 4                         # 2 轮 × 2 任务全部入库


def test_run_round_evolve_smoke(tmp_path):
    memory = ExperienceMemory(tmp_path / "exp.json")
    store = TrajectoryStore(tmp_path / "store")
    report = run_round(1, _tasks(tmp_path), memory, store,
                       trials_root=tmp_path / "trials", dry=True, evolve=True)
    assert report["evolution"] is not None     # evolve_loop 真实执行
    assert "accepted" in report["evolution"]
