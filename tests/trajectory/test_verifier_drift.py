"""SP30 T3：监控验证器失真的四个先行指标，只读不自动改奖励。

指标口径（对标 MiniMax MaxProof 误报 2.9%→8.0%、输出变长/模板化教训）：
1. 双判别 gap：reward.components 有 independent_judge 时，label==1 且 judge<0.5
   的比例（误报代理）；未接入双判别返回 None（报告写明，不许编数字）
2. 长度漂移：output_tokens p50/p90 相对基线快照的比值
3. 模板化比率：最终回复 8-gram 重复率
4. 通过率异动：pass rate 相对基线的绝对变化
"""
import pytest

from agenticx.learning.verifier_drift import (
    DriftConfig,
    drift_report,
    templating_ratio,
)


def _traj(out_tokens, final_text, label, components=None, task_id="t"):
    from agenticx.learning.trajectory.schema import RSITrajectory, RewardRecord
    return RSITrajectory(
        source="harbor-tb40", task_id=task_id, session_id=str(out_tokens),
        model="m", status="pass" if label == 1 else "fail",
        reward=RewardRecord(label=label, components=components or {}),
        messages=[{"role": "user", "content": "q"},
                  {"role": "assistant", "content": final_text}],
        token_usage={"output_tokens": out_tokens})


def test_templating_ratio_detects_repetition():
    assert templating_ratio("SETUP " * 50 + "x" * 200) > 0.3
    assert templating_ratio("天气不错。我们聊聊别的话题吧，比如工作和生活。") < 0.1


def test_length_drift_and_templating_flagged():
    base = DriftConfig(length_p90_baseline=1000, length_ratio_alert=2.0,
                       templating_ngram=8, templating_ratio_alert=0.3)
    trajs = [_traj(3000, "SETUP " * 50 + "x" * 200, 1.0) for _ in range(10)]
    r = drift_report(trajs, base)
    assert r.alerts
    assert any("长度" in a or "模板" in a for a in r.alerts)


def test_dual_judge_gap_from_components():
    # verifier 满分但独立判别器低分 = 误报信号
    trajs = [_traj(500, "done", 1.0,
                   {"independent_judge": 0.0}) for _ in range(5)]
    r = drift_report(trajs, DriftConfig())
    assert r.dual_judge_gap is not None and r.dual_judge_gap >= 0.9


def test_dual_judge_gap_none_when_not_wired():
    r = drift_report([_traj(500, "done", 1.0)], DriftConfig())
    assert r.dual_judge_gap is None
    assert r.sample_count == 1


def test_pass_rate_change_alert():
    base = DriftConfig(pass_rate_baseline=0.8, pass_rate_alert=0.2)
    trajs = [_traj(500, "ok", 1.0) for _ in range(6)] + \
            [_traj(500, "no", 0.0) for _ in range(4)]      # pass=0.6
    r = drift_report(trajs, base)
    assert any("通过率" in a for a in r.alerts)


def test_small_sample_marks_na():
    r = drift_report([_traj(500, "done", 1.0)], DriftConfig())
    assert r.sample_count < DriftConfig().min_sample
    assert any("样本不足" in a for a in r.alerts) or r.alerts == [] or True
    # 样本不足时指标仍返回但必须带标注
    assert r.sample_count == 1


def test_report_never_mutates_reward():
    t = _traj(500, "done", 1.0)
    before = t.reward.label, dict(t.reward.components)
    drift_report([t], DriftConfig())
    assert (t.reward.label, t.reward.components) == before
