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
from agenticx.learning.trajectory.schema import RewardRecord, RSITrajectory  # noqa: E402
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
                     dry=True, evolve=False, skip_split_guard=True)
    assert len(rep1["results"]) == 2
    assert all("reward" in r and "hints" in r for r in rep1["results"])
    assert rep1["results"][0]["hints"] == ""    # 第 1 轮无记忆 → 不注入
    assert m1.is_frozen                         # 轮末冻结
    assert len(m1.all_lessons()) >= 2           # 2 任务各产出经验

    m2 = ExperienceMemory(exp_dir / "round_2.json")
    rep2 = run_round(2, tasks, m2, store, trials_root=trials_root,
                     dry=True, evolve=False, skip_split_guard=True)
    # 第 1 轮错误经验注入第 2 轮
    assert "FileNotFoundError" in rep2["results"][0]["hints"]
    # 新一轮记忆是独立实例（驱动器每轮独立轮次文件, 注入读上一轮冻结文件）
    n_traj = sum(1 for _ in store.iter_trajectories())
    assert n_traj == 4                         # 2 轮 × 2 任务全部入库


def test_run_round_evolve_smoke(tmp_path):
    memory = ExperienceMemory(tmp_path / "exp.json")
    store = TrajectoryStore(tmp_path / "store")
    report = run_round(1, _tasks(tmp_path), memory, store,
                       trials_root=tmp_path / "trials", dry=True, evolve=True,
                       skip_split_guard=True)
    assert report["evolution"] is not None     # evolve_loop 真实执行
    assert "accepted" in report["evolution"]


def test_run_round_rejects_stale_memory_from_previous_run(tmp_path):
    """真跑踩坑回归门: 既往运行的冻结记忆必须响亮报错, 不许静默丢新经验。"""
    import pytest
    from agenticx.learning.trajectory.memory import Lesson

    exp_dir = tmp_path / "experience"
    stale = ExperienceMemory(exp_dir / "round_1.json")
    stale.add([Lesson("old-task", "failure_pattern", "stale lesson")], 1)
    stale.freeze()

    store = TrajectoryStore(tmp_path / "store")
    with pytest.raises(RuntimeError, match="残留既往运行状态"):
        run_round(1, _tasks(tmp_path), stale, store,
                  trials_root=tmp_path / "trials", dry=True)
    assert sum(1 for _ in store.iter_trajectories()) == 0   # 失败在 trial 之前


# --- SP17: 对比感知提取 + 投票过滤注入 ---


def _seed_pass_traj(store, task_name: str):
    store.append(RSITrajectory(
        source="history", task_id=task_name, session_id=f"hist-{task_name}",
        model="m", status="pass",
        reward=RewardRecord(label=1.0),
        messages=[{"role": "user", "content": "go"},
                  {"role": "tool", "content": "ok done"}]))


def test_round_uses_contrastive_when_history_mixed(tmp_path):
    """store 里 fakeA 已有 pass 轨迹, dry 失败(带 FileNotFoundError) → 走对比提取。"""
    memory = ExperienceMemory(tmp_path / "experience" / "round_1.json")
    store = TrajectoryStore(tmp_path / "store")
    _seed_pass_traj(store, "fakeA")          # 历史成功且无报错

    rep = run_round(1, ["/tmp/fakeA"], memory, store,
                    trials_root=tmp_path / "trials", dry=True,
                    skip_split_guard=True)
    kinds = [l["kind"] for l in
             __import__("json").loads(
                 (tmp_path / "experience" / "round_1.json").read_text())["lessons"]]
    assert "contrastive_failure" in kinds    # 失败独有报错被对比捕获
    assert rep["results"][0]["reward"] == 0.0


def test_min_votes_filters_hints(tmp_path):
    """dry 两任务同报 FileNotFoundError → 后 add 快照 2 票; min_votes=3 全过滤。"""
    tasks = ["/tmp/fakeA", "/tmp/fakeB"]
    for r in (1,):
        memory = ExperienceMemory(tmp_path / "experience" / f"round_{r}.json")
        store = TrajectoryStore(tmp_path / "store")
        run_round(r, tasks, memory, store,
                  trials_root=tmp_path / "trials", dry=True,
                  skip_split_guard=True)

    store = TrajectoryStore(tmp_path / "store")
    m2 = ExperienceMemory(tmp_path / "experience" / "round_2.json")
    rep = run_round(2, tasks, m2, store,
                    trials_root=tmp_path / "trials", dry=True, min_votes=3,
                    skip_split_guard=True)
    assert rep["results"][0]["hints"] == ""   # 快照最高 2 票 < 3 → 全过滤

    m2b = ExperienceMemory(tmp_path / "experience" / "round_2b.json")
    rep2 = run_round(2, tasks, m2b, store,
                     trials_root=tmp_path / "trials", dry=True, min_votes=2,
                     skip_split_guard=True)
    assert "FileNotFoundError" in rep2["results"][0]["hints"]  # 快照 2 票 ≥ 2 → 注入


# --- SP22: hints 分期（Dream-RSI 5.1: 探索期关注入） ---


def test_hints_mode_explore_skips_injection(tmp_path):
    """explore 模式: 上轮冻结经验存在也不进 prompt; 经验提取入库不受影响。"""
    tasks = ["/tmp/fakeA", "/tmp/fakeB"]
    store = TrajectoryStore(tmp_path / "store")
    m1 = ExperienceMemory(tmp_path / "experience" / "round_1.json")
    run_round(1, tasks, m1, store, trials_root=tmp_path / "trials", dry=True,
              skip_split_guard=True)

    m2 = ExperienceMemory(tmp_path / "experience" / "round_2.json")
    rep = run_round(2, tasks, m2, store, trials_root=tmp_path / "trials",
                    dry=True, skip_split_guard=True, hints_mode="explore")
    assert rep["results"][0]["hints"] == ""        # 不注入
    assert rep["results"][0]["hints_mode"] == "explore"
    assert len(m2.all_lessons()) >= 2              # 经验仍照常提取入库

    # 对照臂: 默认(exploit)仍注入
    m2b = ExperienceMemory(tmp_path / "experience" / "round_2b.json")
    rep2 = run_round(2, tasks, m2b, store, trials_root=tmp_path / "trials",
                     dry=True, skip_split_guard=True)
    assert "FileNotFoundError" in rep2["results"][0]["hints"]


def test_run_round_evolve_scheduler_smoke(tmp_path):
    """--evolve-scheduler: 轮末在 train 区回放上演化调度器, 报告字段就位。"""
    memory = ExperienceMemory(tmp_path / "exp.json")
    store = TrajectoryStore(tmp_path / "store")
    report = run_round(1, _tasks(tmp_path), memory, store,
                       trials_root=tmp_path / "trials", dry=True,
                       evolve_scheduler=True, skip_split_guard=True)
    assert report["scheduler_evolution"] is not None
    assert "accepted" in report["scheduler_evolution"]
    assert (tmp_path / "schedulers.json").exists()
