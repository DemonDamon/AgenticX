"""SP30 T5：长时程 SLO——人工干预率 / 断点恢复率 / 未采集率。

行业对标：OpenAI 2026-09 披露 4-8h 成功任务 50%+ 至少一次人工干预。
口径纪律：metadata 缺键 = unknown 显式暴露，不许填 0 冒充已采集。
"""
from agenticx.ops.rsi_slo import (
    LONG_TASK_TOOL_THRESHOLD,
    compute_slo,
)


def _tc():
    from agenticx.learning.trajectory.schema import ToolCallRecord
    return ToolCallRecord(name="bash", ok=True)


def _traj(meta, tool_calls=0, status="pass", label=1.0):
    from agenticx.learning.trajectory.schema import RewardRecord, RSITrajectory
    return RSITrajectory(
        source="x", task_id="t", session_id=f"{tool_calls}-{meta}", model="m",
        status=status, reward=RewardRecord(label=label),
        messages=[{"role": "user", "content": "q"}],
        tool_calls=[_tc()] * tool_calls, metadata=meta)


def test_long_task_threshold():
    assert LONG_TASK_TOOL_THRESHOLD == 40


def test_intervention_rate_with_unknown_bucket():
    trajs = [
        _traj({"human_interventions": 1}, tool_calls=50),       # 长任务+干预
        _traj({"human_interventions": 0}, tool_calls=50),       # 长任务无干预
        _traj({}, tool_calls=50),                                # 未采集
        _traj({"human_interventions": 1}, tool_calls=2),        # 短任务不计入
    ]
    slo = compute_slo(trajs)
    assert slo.long_task_count == 3
    assert slo.intervention_rate == 0.5
    assert slo.unknown_rate > 0          # 未采集比例必须显式暴露，不能假装是 0


def test_wall_seconds_defines_long_task():
    trajs = [_traj({"human_interventions": 1, "wall_seconds": 5 * 3600},
                   tool_calls=1)]
    slo = compute_slo(trajs)
    assert slo.long_task_count == 1
    assert slo.intervention_rate == 1.0


def test_resume_success_rate():
    trajs = [
        _traj({"resume_attempts": 1, "resume_completed": 1}, tool_calls=50),
        _traj({"resume_attempts": 2, "resume_completed": 0}, tool_calls=50,
              status="fail", label=0.0),
    ]
    slo = compute_slo(trajs)
    assert slo.resume_success_rate == 0.5


def test_small_sample_flagged():
    slo = compute_slo([_traj({"human_interventions": 0}, tool_calls=50)])
    assert slo.long_task_count == 1
    assert slo.underpowered


def test_no_long_tasks_returns_none_metrics():
    slo = compute_slo([_traj({}, tool_calls=2)])
    assert slo.long_task_count == 0
    assert slo.intervention_rate is None
    assert slo.unknown_rate is None
