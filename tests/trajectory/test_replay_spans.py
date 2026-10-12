"""SP30 T7：从 lineage 派生学习相关消息区间（LongStraw/AReaL-DTA 选择性重放口径）。

派生量不是采集量：规则纯函数，采集端零负担，P1 长轨迹 RL 消费——
避免全轨迹重放的显存/计算浪费。消息级窗口够 P1 起步（token 级偏移属后续）。
"""
from agenticx.learning.trajectory.replay_spans import derive_replay_spans
from agenticx.learning.trajectory.schema import (
    DecisionStep,
    RewardRecord,
    RSITrajectory,
    ToolCallRecord,
)


def _traj(messages, tool_calls, decision_lineage):
    return RSITrajectory(
        source="x", task_id="t", session_id="s", model="m", status="pass",
        reward=RewardRecord(label=1.0), messages=messages,
        tool_calls=tool_calls, decision_lineage=decision_lineage)


def test_spans_cover_correction_and_failed_tool_windows():
    traj = _traj(
        messages=[
            {"role": "user", "content": "q"},
            {"role": "assistant", "content": "a1"},
            {"role": "tool", "content": "ok"},
            {"role": "assistant", "content": "a2"},
            {"role": "tool", "content": "ERR boom"},
            {"role": "assistant", "content": "fixed"},
        ],
        tool_calls=[ToolCallRecord(name="bash", ok=True),
                    ToolCallRecord(name="bash", ok=False)],
        decision_lineage=[DecisionStep(kind="correction", ref="step-5")])
    spans = derive_replay_spans(traj)
    # 修正点与失败工具窗口必须被覆盖；纯寒暄窗口允许不选
    covered = {i for s in spans for i in range(s.start_msg, s.end_msg + 1)}
    assert {4, 5} <= covered
    assert 0 not in covered                      # user 问题不在学习区间
    assert all(s.reason in ("correction", "failed_tool", "verification")
               for s in spans)


def test_verification_step_anchors_at_tail():
    traj = _traj(
        messages=[{"role": "user", "content": "q"},
                  {"role": "assistant", "content": "done"}],
        tool_calls=[],
        decision_lineage=[DecisionStep(kind="verification", ref="verifier",
                                       note="label=1.0")])
    spans = derive_replay_spans(traj)
    assert any(s.reason == "verification" and s.end_msg == 1 for s in spans)


def test_overlapping_spans_merged():
    traj = _traj(
        messages=[
            {"role": "user", "content": "q"},
            {"role": "assistant", "content": "a1"},
            {"role": "tool", "content": "ERR"},
            {"role": "assistant", "content": "fix"},
            {"role": "assistant", "content": "done"},
        ],
        tool_calls=[ToolCallRecord(name="bash", ok=False)],
        decision_lineage=[DecisionStep(kind="correction", ref="step-3")])
    spans = derive_replay_spans(traj)
    # failed_tool {2,3} 与 correction {2,3,4}（step-3 锚点 ±1）应合并为单个区间
    assert len(spans) == 1
    assert spans[0].start_msg == 2 and spans[0].end_msg == 4


def test_clean_trajectory_has_no_spans():
    traj = _traj(
        messages=[{"role": "user", "content": "q"},
                  {"role": "assistant", "content": "fine"}],
        tool_calls=[ToolCallRecord(name="bash", ok=True)],
        decision_lineage=[])
    assert derive_replay_spans(traj) == []
