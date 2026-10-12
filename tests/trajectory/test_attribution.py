"""SP30 T2：路由事件 × 结局 → 每条经验的后验胜率账本（规则版归因）。

口径：
- 只统计路由事件（memory_recall/skill_select/adapter_route），且每条轨迹对同一
  ref 最多计一次（反复召回同一条经验不算多票）
- label==1.0 → pass 1 票；==0.0 → fail 1 票；partial（0<label<1）→ 0.5 票
- 未标注（label<0）轨迹整条排除
- held-out 任务直接抛 HeldoutViolation（红线）
"""
import pytest

from agenticx.learning.attribution import AttributionLedger, credit_trajectory
from agenticx.learning.trajectory.schema import (
    DecisionStep,
    RewardRecord,
    RSITrajectory,
)


def traj(status, label, refs, task_id="t"):
    return RSITrajectory(
        source="harbor-tb40", task_id=task_id, session_id=f"{task_id}-{status}-{label}",
        model="m", status=status, reward=RewardRecord(label=label),
        messages=[{"role": "user", "content": "q"}],
        decision_lineage=[DecisionStep(kind=k, ref=r, version=v)
                          for k, r, v in refs],
    )


def test_posterior_winrate_with_beta_smoothing_and_unknown_bucket():
    led = AttributionLedger()
    credit_trajectory(led, traj("pass", 1.0, [
        ("skill_select", "skill:a@1", "1"),
        ("memory_recall", "memory:b", "unknown")]))
    credit_trajectory(led, traj("fail", 0.0, [
        ("skill_select", "skill:a@1", "1")]))
    row_a = led.row("skill:a@1")
    assert row_a.uses == 2 and row_a.pass_count == 1
    # Beta(1,1) 平滑：(1+1)/(2+2)=0.5，不许裸除
    assert row_a.winrate == pytest.approx(0.5)
    unk = [r for r in led.rows if r.version == "unknown"]
    assert unk and unk[0].uses == 1


def test_partial_label_counts_half_vote():
    led = AttributionLedger()
    credit_trajectory(led, traj("partial", 0.6, [
        ("skill_select", "skill:a@1", "1")]))
    r = led.row("skill:a@1")
    assert r.uses == 1
    assert r.pass_count == pytest.approx(0.6)
    assert r.winrate == pytest.approx((0.6 + 1) / 3)   # (pass+1)/(uses+2)


def test_same_ref_deduped_within_one_trajectory():
    led = AttributionLedger()
    credit_trajectory(led, traj("pass", 1.0, [
        ("memory_recall", "memory:b", "1"),
        ("memory_recall", "memory:b", "1")]))
    assert led.row("memory:b").uses == 1


def test_non_routing_steps_ignored():
    led = AttributionLedger()
    credit_trajectory(led, traj("pass", 1.0, [
        ("tool_call", "bash", ""),
        ("verification", "verifier", "")]))
    assert led.rows == []


def test_unlabeled_trajectory_excluded():
    led = AttributionLedger()
    credit_trajectory(led, traj("unlabeled", -1.0, [
        ("skill_select", "skill:a@1", "1")]))
    assert led.row("skill:a@1") is None


def test_heldout_trajectory_rejected():
    from agenticx.trainer.heldout import HeldoutViolation
    led = AttributionLedger(heldout_tasks={"t"})
    with pytest.raises(HeldoutViolation):
        credit_trajectory(led, traj("pass", 1.0, [
            ("skill_select", "skill:a@1", "1")]))


def test_ledger_persistence_roundtrip(tmp_path):
    led = AttributionLedger()
    credit_trajectory(led, traj("pass", 1.0, [
        ("skill_select", "skill:a@1", "1")]))
    out = led.save(tmp_path)
    led2 = AttributionLedger.load(tmp_path)
    assert led2.row("skill:a@1").uses == 1
    md = (tmp_path / "ledger.md").read_text()
    assert "skill:a@1" in md
    assert out.name == "ledger.json"
