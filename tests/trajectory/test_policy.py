# tests/trajectory/test_policy.py
from agenticx.learning.trajectory.forest import (
    AttemptNode, StepFeatures, TaskTree, TrialForest,
)
from agenticx.learning.trajectory.policy import (
    NeverAbortPolicy, FixedHorizonPolicy, ErrorStreakPolicy, ProgressStallPolicy,
    baseline_policies, policy_report,
)
from agenticx.learning.trajectory.replay import AttemptContext

def _obs(step=0, streak=0, stall=0):
    return StepFeatures(step=step, n_messages=step + 1, n_tool_calls=0,
                        tool_success_rate=-1.0, consecutive_failures=streak,
                        rounds_since_progress=stall, est_tokens=100)

def _ctx():
    return AttemptContext(task_id="t", attempt_index=0,
                          attempts_remaining=1, spent_so_far=0)

def test_never_abort_is_paper_baseline():
    p = NeverAbortPolicy()
    assert p.name == "never_abort"
    assert all(p.act(_obs(step=i), _ctx()) == "continue" for i in range(50))

def test_fixed_horizon_aborts_after_max_steps():
    p = FixedHorizonPolicy(max_steps=5)
    assert p.act(_obs(step=4), _ctx()) == "continue"
    assert p.act(_obs(step=5), _ctx()) == "abort"
    assert p.name == "fixed_horizon_5"

def test_error_streak_aborts_on_consecutive_failures():
    p = ErrorStreakPolicy(max_streak=3)
    assert p.act(_obs(streak=2), _ctx()) == "continue"
    assert p.act(_obs(streak=3), _ctx()) == "abort"
    assert p.name == "error_streak_3"

def test_progress_stall_aborts_when_no_progress():
    p = ProgressStallPolicy(max_stall=8)
    assert p.act(_obs(stall=7), _ctx()) == "continue"
    assert p.act(_obs(stall=8), _ctx()) == "abort"
    assert p.name == "progress_stall_8"

def _tree(task, labels, tokens=100):
    attempts = []
    for i, label in enumerate(labels):
        n = max(1, len(labels))
        steps = [StepFeatures(step=k, n_messages=k + 1, n_tool_calls=0,
                              tool_success_rate=-1.0, consecutive_failures=0,
                              rounds_since_progress=0,
                              est_tokens=tokens * (k + 1)) for k in range(n)]
        attempts.append(AttemptNode(
            attempt_id=f"{task}-a{i}", task_id=task, model="m",
            status="pass" if label >= 1 else "fail", reward_label=label,
            n_steps=n, total_est_tokens=tokens * n, steps=steps))
    return TaskTree(task_id=task, attempts=attempts)

def test_policy_report_splits_train_and_heldout():
    forest = TrialForest(trees={f"t{i}": _tree(f"t{i}", [1.0] if i % 2 == 0 else [0.0])
                                for i in range(40)})
    report = policy_report(baseline_policies(), forest, seed="v1")
    assert set(report["train"]) == {p.name for p in baseline_policies()}
    assert set(report["heldout"]) == set(report["train"])
    assert 0 < len(report["heldout_tasks"]) < 40
    # never_abort 全程执行 → pass_rate 应恰等于该区记录的 pass 任务占比
    train_ids = [t for t in forest.trees if t not in report["heldout_tasks"]]
    expected = sum(1 for t in train_ids if int(t[1:]) % 2 == 0) / len(train_ids)
    assert report["train"]["never_abort"]["pass_rate"] == expected
    # heldout 任务列表与 seed 确定
    assert report["heldout_tasks"] == sorted(report["heldout_tasks"])

def test_policy_report_heldout_isolated_from_selection():
    forest = TrialForest(trees={f"t{i}": _tree(f"t{i}", [1.0]) for i in range(30)})
    report = policy_report(baseline_policies(), forest, seed="v1")
    train_ids = set(report["train"].keys())
    heldout_ids = set(report["heldout"].keys())
    assert train_ids == heldout_ids               # 同一组策略在两个区都有成绩
    # 但报告结构必须把两区分开, 演化循环只允许读 train 区（由 SP8 保证）
    assert report["train"] is not report["heldout"]

def test_baseline_policies_catalog():
    names = [p.name for p in baseline_policies()]
    assert "never_abort" in names
    assert len(names) >= 4
