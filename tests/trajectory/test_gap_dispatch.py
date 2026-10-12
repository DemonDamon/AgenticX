"""SP30 T4：高频失败且无高胜率经验覆盖的聚类 → 派发提案（只提案，不自动开训）。"""
import json

from agenticx.learning.attribution import AttributionLedger, CreditRow
from agenticx.learning.gap_dispatch import GapProposal, find_gaps


def _fail_traj(task_id, err_text, session_suffix=""):
    from agenticx.learning.trajectory.schema import RSITrajectory, RewardRecord
    return RSITrajectory(
        source="harbor-tb40", task_id=task_id,
        session_id=f"{task_id}{session_suffix}", model="m",
        status="fail", reward=RewardRecord(label=0.0),
        messages=[{"role": "user", "content": "q"},
                  {"role": "assistant", "content": err_text}],
    )


def _ledger_with_skill(ref, winrate_source=5, winrate_pass=5):
    led = AttributionLedger()
    row = CreditRow(ref=ref, kind="skill_select", version="1",
                    uses=winrate_source + 1, pass_count=winrate_pass,
                    fail_count=1)
    led.rows.append(row)
    led._index[ref] = row
    return led


def test_repeated_failure_without_covering_skill_emits_proposal():
    trajs = [_fail_traj(f"t{i}", "RuntimeError: CUDA out of memory")
             for i in range(4)]
    proposals = find_gaps(trajs, AttributionLedger(), min_cluster=3)
    assert proposals and proposals[0].failure_count >= 4
    assert proposals[0].covering_refs == []          # 账本里没有高胜率经验
    assert proposals[0].suggested_action in ("collect_more", "new_skill",
                                             "verifier_suspect")


def test_cluster_below_threshold_not_dispatched():
    trajs = [_fail_traj("t1", "RuntimeError: CUDA out of memory"),
             _fail_traj("t2", "RuntimeError: CUDA out of memory")]
    assert find_gaps(trajs, AttributionLedger(), min_cluster=3) == []


def test_covered_cluster_not_dispatched():
    # 账本里有一条覆盖该失败域的高胜率技能（ref 词元与失败片段词元交集）
    # 注：规则版关键词关联不做同义词猜测（"oom"≠"out of memory"），
    # 关联不到的仍会出提案，由人审兜底——口径宁松勿漏
    led = _ledger_with_skill("skill:cuda-memory-recovery@2",
                             winrate_source=5, winrate_pass=5)
    trajs = [_fail_traj(f"t{i}", "RuntimeError: CUDA out of memory")
             for i in range(4)]
    proposals = find_gaps(trajs, led, min_cluster=3)
    cuda = [p for p in proposals if "cuda" in p.cluster_key]
    assert cuda == []                       # 被高胜率经验覆盖 → 不派发


def test_low_winrate_skill_does_not_cover():
    # 胜率不够的经验不算覆盖——缺口照常派发
    led = _ledger_with_skill("skill:cuda-memory-recovery@2",
                             winrate_source=1, winrate_pass=1)   # winrate≈0.5
    trajs = [_fail_traj(f"t{i}", "RuntimeError: CUDA out of memory")
             for i in range(4)]
    proposals = find_gaps(trajs, led, min_cluster=3)
    assert any("cuda" in p.cluster_key for p in proposals)


def test_pass_trajectories_excluded():
    from agenticx.learning.trajectory.schema import RewardRecord, RSITrajectory
    ok = RSITrajectory(
        source="harbor-tb40", task_id="ok", session_id="ok", model="m",
        status="pass", reward=RewardRecord(label=1.0),
        messages=[{"role": "user", "content": "q"},
                  {"role": "assistant", "content": "RuntimeError: CUDA"}])
    trajs = [ok] + [_fail_traj(f"t{i}", "RuntimeError: CUDA out of memory")
                    for i in range(3)]
    proposals = find_gaps(trajs, AttributionLedger(), min_cluster=3)
    assert len(proposals) == 1 and proposals[0].failure_count == 3


def test_proposal_id_is_content_hash_and_stable():
    trajs = [_fail_traj(f"t{i}", "RuntimeError: CUDA out of memory")
             for i in range(4)]
    p1 = find_gaps(trajs, AttributionLedger(), min_cluster=3)[0]
    p2 = find_gaps(trajs, AttributionLedger(), min_cluster=3)[0]
    assert p1.proposal_id == p2.proposal_id
    assert len(p1.proposal_id) == 12


def test_proposal_serializes_to_json(tmp_path):
    trajs = [_fail_traj(f"t{i}", "RuntimeError: CUDA out of memory")
             for i in range(4)]
    p = find_gaps(trajs, AttributionLedger(), min_cluster=3)[0]
    data = json.loads(json.dumps(p.to_dict()))
    assert data["status"] == "proposed"
    assert data["cluster_key"] and data["sample_messages"]
    assert len(data["sample_messages"]) <= 3
