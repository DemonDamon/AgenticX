"""SPR 奖励层: strict 与 partial 分离 + λ 调度（playbook §7.3）。"""
import json

import pytest

from agenticx.rl.spr import (SPRReward, extract_partial_credit,
                             lambda_schedule, spr_reward)


def test_lambda_schedule_linear_decay():
    assert lambda_schedule(0, 60) == 0.5
    assert lambda_schedule(30, 60) == pytest.approx(0.3)
    assert lambda_schedule(60, 60) == 0.1
    assert lambda_schedule(99, 60) == 0.1          # 越界按端点
    assert lambda_schedule(0, 0) == 0.5           # 非法 total 不炸


def test_spr_reward_success_dominates():
    # 通过题不受 λ 影响；失败题只拿 λ·p 的部分信用
    assert spr_reward(1.0, None, lam=0.5) == 1.0
    assert spr_reward(1.0, 0.2, lam=0.5) == 1.0
    assert spr_reward(0.0, 0.8, lam=0.5) == pytest.approx(0.4)


def test_spr_reward_lambda_squeeze():
    # λ 收紧后，同一失败轨迹的部分信用被压掉一半多
    r_early = spr_reward(0.0, 0.8, lam=0.5)
    r_late = spr_reward(0.0, 0.8, lam=0.1)
    assert r_early == pytest.approx(0.4)
    assert r_late == pytest.approx(0.08)


def test_spr_reward_clamps_dirty_partial():
    assert spr_reward(0.0, 1.7, lam=0.5) == pytest.approx(0.5)   # 越界 clamp
    assert spr_reward(0.0, -3, lam=0.5) == 0.0


def test_spr_reward_strict_is_binary_forced():
    assert spr_reward(0.6, None, lam=0.5) == 1.0   # 0.6 也算过（终判非零即过）
    assert spr_reward(0.0, None, lam=0.5) == 0.0


def test_extract_partial_credit_missing_returns_none(tmp_path):
    (tmp_path / "result.json").write_text(json.dumps(
        {"verifier_result": {"rewards": {"reward": 1.0}}}))
    assert extract_partial_credit(tmp_path) is None


def test_extract_partial_credit_explicit_field(tmp_path):
    (tmp_path / "result.json").write_text(json.dumps(
        {"verifier_result": {"rewards": {"reward": 0.0, "partial": 0.7}}}))
    assert extract_partial_credit(tmp_path) == 0.7


def test_extract_partial_credit_checks_ratio(tmp_path):
    (tmp_path / "result.json").write_text(json.dumps(
        {"verifier_result": {"rewards": {"reward": 0.0},
                             "checks": {"passed": 3, "total": 5}}}))
    assert extract_partial_credit(tmp_path) == pytest.approx(0.6)


def test_extract_partial_credit_parser_results(tmp_path):
    (tmp_path / "result.json").write_text(json.dumps(
        {"verifier_result": {"rewards": {"reward": 0.0},
                             "parser_results": {"a": {"reward": 1.0},
                                                "b": {"reward": 0.0},
                                                "c": {"reward": 1.0}}}}))
    assert extract_partial_credit(tmp_path) == pytest.approx(2 / 3)


def test_extract_partial_credit_no_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        extract_partial_credit(tmp_path)


def test_spr_reward_wrapper_tracks_steps():
    spr = SPRReward(total_steps=60)
    assert spr.lam == 0.5
    spr.advance(30)
    assert spr.lam == pytest.approx(0.3)
    assert spr.score(0.0, 0.8) == pytest.approx(0.24)
    assert spr.score(1.0, 0.0) == 1.0


def test_spr_score_trial_end_to_end(tmp_path):
    (tmp_path / "result.json").write_text(json.dumps(
        {"verifier_result": {"rewards": {"reward": 0.0},
                             "checks": {"passed": 1, "total": 4}}}))
    spr = SPRReward(total_steps=60)            # λ=0.5
    # strict=0, p=0.25 → R = 0.5·0.25 = 0.125
    assert spr.score_trial(tmp_path) == pytest.approx(0.125)
    (tmp_path / "result.json").write_text(json.dumps(
        {"verifier_result": {"rewards": {"reward": 1.0}}}))
    assert spr.score_trial(tmp_path) == 1.0    # partial 缺失退化 p=S
