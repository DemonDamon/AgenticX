# tests/rl/test_core_algos.py
import numpy as np
from agenticx.rl.core_algos import grpo_outcome_advantage

def test_advantage_hand_computed_g2():
    # G=2, rewards [1,0]: mean=0.5 std=0.5 → [+1, -1]
    adv = grpo_outcome_advantage([1.0, 0.0], group_size=2)
    assert np.allclose(adv, [1.0, -1.0])

def test_advantage_hand_computed_g3():
    # G=3, [1,0,0]: mean=1/3, std=sqrt(2/9)≈0.4714 → [1.4142, -0.7071, -0.7071]
    adv = grpo_outcome_advantage([1.0, 0.0, 0.0], group_size=3)
    assert np.allclose(adv, [np.sqrt(2.0), -np.sqrt(0.5), -np.sqrt(0.5)])

def test_advantage_zero_std_clamped():
    # 组内全同 reward → std=0，eps 保护 → 优势全 0
    adv = grpo_outcome_advantage([0.5, 0.5, 0.5, 0.5], group_size=4)
    assert np.allclose(adv, [0.0, 0.0, 0.0, 0.0])

def test_advantage_no_center_keeps_raw():
    adv = grpo_outcome_advantage([1.0, 0.0], group_size=2,
                                 center=False, normalize_by_std=False)
    assert np.allclose(adv, [1.0, 0.0])

def test_advantage_multi_prompt_batches():
    # 2 组各 G=2，逐组归一化不串组
    adv = grpo_outcome_advantage([1.0, 0.0, 0.0, 0.0], group_size=2)
    assert np.allclose(adv, [1.0, -1.0, 0.0, 0.0])
