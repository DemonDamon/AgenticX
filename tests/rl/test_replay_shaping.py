# tests/rl/test_replay_shaping.py
import numpy as np
import pytest

from agenticx.rl.core_algos import grpo_outcome_advantage
from agenticx.rl.replay_shaping import replay_shaped_advantage


def test_weight_zero_equals_group_baseline():
    r = [1.0, 0.0, 0.0, 1.0]
    t = ["a", "a", "b", "b"]
    adv = replay_shaped_advantage(r, t, {"a": 0.9, "b": 0.1}, replay_weight=0.0)
    assert np.allclose(adv, grpo_outcome_advantage(r, group_size=2))


def test_weight_one_uses_replay_baseline():
    # task a: rewards [1,0], replay=0.5 → baseline=0.5 → adv=[+0.5,-0.5]/std(0.5)=[1,-1]
    adv = replay_shaped_advantage([1.0, 0.0], ["a", "a"], {"a": 0.5},
                                  replay_weight=1.0)
    assert np.allclose(adv, [1.0, -1.0])


def test_mixed_weight_hand_computed():
    # task a: rewards [1,0] mean=0.5 std=0.5; replay=0.7, w=0.5 → baseline=0.6
    # adv = [0.4, -0.6]/0.5 = [0.8, -1.2]
    adv = replay_shaped_advantage([1.0, 0.0], ["a", "a"], {"a": 0.7},
                                  replay_weight=0.5)
    assert np.allclose(adv, [0.8, -1.2])


def test_missing_replay_score_falls_back_to_group():
    r = [1.0, 0.0, 1.0, 0.0]
    t = ["a", "a", "b", "b"]
    adv = replay_shaped_advantage(r, t, {"a": 0.9}, replay_weight=1.0)  # b 无分数
    want = grpo_outcome_advantage(r, group_size=2)
    assert np.allclose(adv[2:], want[2:])              # b 组回退组内归一化
    assert not np.allclose(adv[:2], want[:2])          # a 组确实用了回放基线


def test_single_episode_with_replay_baseline():
    """论文点：单条 rollout + 回放基线也有学习信号。"""
    adv = replay_shaped_advantage([1.0], ["a"], {"a": 0.4}, replay_weight=1.0)
    # std=0 → eps 保护；baseline 路径: (1.0-0.4)/max(std,eps)... 单样本组内 std=0
    # 语义: 基线偏移在、尺度退化 → 用 eps
    assert adv[0] > 0.0


def test_invalid_weight_raises():
    with pytest.raises(ValueError):
        replay_shaped_advantage([1.0], ["a"], {}, replay_weight=1.5)
