"""SP30 T1：memory/skill/adapter 选择必须作为带版本的路由事件进入 lineage。

路由事件约定（schema docstring 同步）：Harness 层选择记忆/技能/adapter 的动作
在 lineage 留痕，ref 用 URN 风格（memory:/skill:/adapter:），version 拿不到填
"unknown" 不许空着——归因账本把 unknown 单列倒逼补齐埋点。
"""
from agenticx.learning.trajectory.schema import (
    DecisionStep,
    RewardRecord,
    RSITrajectory,
    ToolCallRecord,
    routing_step,
)
from agenticx.learning.trajectory.harbor_collector import _lineage
from agenticx.learning.trajectory.session_collector import collect_session


def _traj(lineage):
    return RSITrajectory(
        source="x", task_id="t", session_id="s", model="m",
        status="pass", reward=RewardRecord(label=1.0),
        messages=[{"role": "user", "content": "q"}],
        decision_lineage=lineage,
    )


def test_routing_step_carries_version_and_outcome():
    s = routing_step("skill_select", "skill:finnews-pull@3", version="3")
    assert s.kind in ("memory_recall", "skill_select", "adapter_route")
    assert s.version == "3" and s.outcome == "used"
    # 拿不到版本必须显式 unknown，不许空串
    u = routing_step("memory_recall", "memory:abc")
    assert u.version == "unknown"


def test_old_dict_without_new_fields_loads():
    # 旧轨迹无 version/outcome 字段，from_dict 必须向前兼容
    d = _traj([DecisionStep(kind="knowledge_ref", ref="doc-a")]).to_dict()
    rt = RSITrajectory.from_dict(d)
    assert rt.decision_lineage[0].version == ""
    assert rt.decision_lineage[0].outcome == ""


def test_harbor_lineage_extracts_routing_tools():
    calls = [
        ToolCallRecord(name="recall_memory",
                       arguments={"query": "期权定价"}, ok=True),
        ToolCallRecord(name="use_skill",
                       arguments={"skill": "finnews-pull", "version": "3"}, ok=True),
        ToolCallRecord(name="bash", arguments={"cmd": "ls"}, ok=True),
    ]
    steps = _lineage(calls, RewardRecord(label=1.0))
    kinds = [s.kind for s in steps]
    assert kinds.count("memory_recall") == 1
    assert kinds.count("skill_select") == 1
    assert kinds.count("tool_call") == 1          # 普通工具不受影响
    skill = next(s for s in steps if s.kind == "skill_select")
    assert "finnews-pull" in skill.ref and skill.version == "3"
    mem = next(s for s in steps if s.kind == "memory_recall")
    assert mem.ref.startswith("memory:") and mem.version == "unknown"


def test_harbor_lineage_adapter_route():
    calls = [ToolCallRecord(name="adapter_route",
                            arguments={"alias": "finnews-sentiment"}, ok=True)]
    steps = _lineage(calls, RewardRecord(label=1.0))
    a = next(s for s in steps if s.kind == "adapter_route")
    assert a.ref == "adapter:finnews-sentiment"


def test_session_collector_extracts_routing(tmp_path):
    import json
    d = tmp_path / "sess-1"
    d.mkdir()
    (d / "messages.json").write_text(json.dumps([
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "ok"},
    ]))
    (d / "tool_call_observations.json").write_text(json.dumps([
        {"tool_name": "skill_search", "arguments": {"skill": "csv-clean@2"},
         "success": True, "result": "..."},
        {"tool_name": "read_file", "arguments": {"path": "/tmp/x"},
         "success": True, "result": "..."},
    ]))
    t = collect_session(d)
    kinds = [s.kind for s in t.decision_lineage]
    assert "skill_select" in kinds
    sk = next(s for s in t.decision_lineage if s.kind == "skill_select")
    assert "csv-clean" in sk.ref
