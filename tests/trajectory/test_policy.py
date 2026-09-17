# tests/trajectory/test_policy.py
from agenticx.learning.trajectory.forest import StepFeatures
from agenticx.learning.trajectory.policy import (
    NeverAbortPolicy, FixedHorizonPolicy, ErrorStreakPolicy, ProgressStallPolicy,
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
