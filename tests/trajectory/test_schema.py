from agenticx.learning.trajectory.schema import (
    RSITrajectory, RewardRecord, ToolCallRecord, DecisionStep,
)

def _traj():
    return RSITrajectory(
        source="harbor-tb40",
        task_id="fin-saccr-rwa",
        session_id="job1/fin-saccr-rwa__abc123",
        model="openai/glm-5.3-flash",
        status="pass",
        reward=RewardRecord(label=1.0, source="verifier", components={"verifier": 1.0}),
        messages=[{"role": "user", "content": "solve"}, {"role": "assistant", "content": "done"}],
        tool_calls=[ToolCallRecord(name="bash", arguments={"cmd": "ls"}, ok=True)],
        decision_lineage=[DecisionStep(kind="tool_call", ref="bash", note="列目录")],
        token_usage={"input": 100, "output": 50},
    )

def test_trajectory_id_is_stable_16char():
    t = _traj()
    assert len(t.trajectory_id) == 16
    assert t.trajectory_id == _traj().trajectory_id  # 同输入同 id

def test_trajectory_id_changes_with_task():
    t = _traj()
    t2 = _traj(); t2.task_id = "other"
    assert t.trajectory_id != t2.trajectory_id

def test_to_from_dict_roundtrip():
    t = _traj()
    d = t.to_dict()
    assert d["trajectory_id"] == t.trajectory_id
    t2 = RSITrajectory.from_dict(d)
    assert t2.trajectory_id == t.trajectory_id
    assert t2.reward.label == 1.0
    assert t2.tool_calls[0].name == "bash"
    assert t2.decision_lineage[0].kind == "tool_call"

def test_reward_sentinel_for_unlabeled():
    r = RewardRecord.unlabeled()
    assert r.label == -1.0 and r.source == "user" and r.components == {}
