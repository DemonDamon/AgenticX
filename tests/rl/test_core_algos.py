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

from agenticx.rl.core_algos import (
    clipped_policy_loss, grpo_loss, kl_k1, kl_k3, masked_mean,
)

def test_policy_loss_on_policy_ratio_one():
    # old==current → ratio=1 → per-token loss = -adv
    loss = clipped_policy_loss([0.0, 0.0], [0.0, 0.0], [1.0, -2.0])
    assert np.allclose(loss, [-1.0, 2.0])

def test_policy_loss_clip_activates():
    # old=0, logp=ln(1.3) → ratio=1.3 > 1+0.2 → clip 生效
    logp = [np.log(1.3)]
    loss = clipped_policy_loss(logp, [0.0], [1.0], clip_eps=0.2)
    assert np.allclose(loss, [-1.2])          # -min(1.3, 1.2)*1.0
    # 负向：logp=ln(0.5) ratio=0.5 < 0.8, adv=-1 → min(-0.5, -0.8) → clip 下界生效
    loss2 = clipped_policy_loss([np.log(0.5)], [0.0], [-1.0], clip_eps=0.2)
    assert np.allclose(loss2, [0.8])

def test_kl_estimators():
    assert np.allclose(kl_k1([0.0], [-1.0]), [-1.0])          # ref - logp
    # k3 = exp(ref-logp) - (ref-logp) - 1；ref-logp=-1 → e^-1 +1 -1
    assert np.allclose(kl_k3([0.0], [-1.0]), [np.exp(-1.0)])
    assert np.allclose(kl_k3([0.0], [0.0]), [0.0])            # 相等→0
    # k3 恒非负
    assert (kl_k3([-2.0, 1.0, 3.0], [0.0, 0.0, 0.0]) >= 0).all()

def test_masked_mean_ignores_padding():
    assert masked_mean([1.0, 5.0, 100.0], [1, 1, 0]) == 3.0
    assert masked_mean([1.0, 2.0], [0, 0]) == 0.0             # 全 mask 防 0 除

def test_grpo_loss_combines_pg_and_kl():
    # 2 token，mask 掉第 2 个；ratio=1、kl=0 → 纯 PG 项
    total = grpo_loss(
        logprobs=[0.0, 9.0], old_logprobs=[0.0, 0.0],
        ref_logprobs=[0.0, 0.0], advantages=[1.0, -1.0],
        response_mask=[1, 0], kl_beta=0.04)
    assert np.allclose(total, -1.0)
    # 加 KL：kl_beta * k3(ref-logp=-1) = 0.04 * e^-1
    total2 = grpo_loss(
        logprobs=[0.0], old_logprobs=[0.0], ref_logprobs=[-1.0],
        advantages=[0.0], response_mask=[1], kl_beta=0.04)
    assert np.allclose(total2, 0.04 * np.exp(-1.0))
