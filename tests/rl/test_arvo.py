# tests/rl/test_arvo.py
"""SP20 ARVO 惩罚体系单测：数学性质 + 边界语义。

钉死（对齐 MiMo verl fork @ e2b9fc0 语义）:
  1. adv_signed 正/负两侧独立质量守恒（未 clamp 时）
  2. 正样本 hit 优势清零、负样本 hit 优势×kappa
  3. clamp 边界与退化组（sign=0）不动
  4. 长度惩罚: 只罚通过轨迹、锚点分位、死区、min_pass_rate 跳组
  5. trainer 集成: 长度惩罚在 shaping 前作用于 reward（M4 复合）、
     infra episode 豁免工具惩罚、默认关闭时行为不变
"""
from __future__ import annotations

import numpy as np
import pytest
import torch

from agenticx.rl.arvo import (LengthPenaltyConfig, apply_tool_penalty,
                              compute_group_length_penalty, episode_signals,
                              grouped_length_penalty, signed_rebalance)
from agenticx.rl.rollout import LocalRolloutEngine, RolloutSample, TinyLM
from agenticx.rl.trainer import GRPOTrainer


# ------------------------------------------------------------- signed_rebalance

def test_signed_rebalance_mass_conservation():
    """未 clamp 时正负两侧质量各自守恒——不注入净质量。"""
    # 正: 两条序列各 3 token（1 个 hit）；负: 一条序列 4 token（1 个 hit, κ=2）
    adv = np.array([1.0, 1.0, 1.0, 2.0, 2.0, 2.0,
                    -1.0, -1.0, -1.0, -1.0])
    hit = np.array([0, 1.0, 0, 0, 0, 0, 0, 2.0, 0, 0])  # kappa 直接给乘数
    sign = np.array([1, 1, 1, 1, 1, 1, -1, -1, -1, -1], dtype=float)
    out, m = signed_rebalance(adv, hit, sign)
    assert abs(out[sign > 0].sum() - adv[sign > 0].sum()) < 1e-6
    assert abs(out[sign < 0].sum() - adv[sign < 0].sum()) < 1e-6
    # 正样本 hit 优势清零
    assert out[1] == 0.0
    # 负样本 hit 优势 ×kappa(2)
    assert out[7] == pytest.approx(-2.0)
    assert not m["arvo/pos_clamped"] and not m["arvo/neg_clamped"]


def test_signed_rebalance_zero_adv_group_untouched():
    """退化组（全零优势）不参与守恒、优势不变。"""
    adv = np.array([0.0, 0.0, 1.0])
    hit = np.array([1.0, 0, 0])
    sign = np.array([0, 0, 1], dtype=float)
    out, m = signed_rebalance(adv, hit, sign)
    assert out[0] == 0.0 and out[1] == 0.0
    assert out[2] == 1.0          # 无正侧可回填 → alpha 恒 1
    assert m["arvo/hit_tokens"] == 1


def test_signed_rebalance_clamp():
    """干净 token 质量不足以回填时 clamp 并放弃守恒（不崩溃）。"""
    adv = np.array([5.0, 0.1, 0.1])    # 正侧 hit 质量远大于干净质量
    hit = np.array([2.0, 0, 0])
    sign = np.ones(3)
    out, m = signed_rebalance(adv, hit, sign, max_scale=1.5)
    assert m["arvo/pos_clamped"] == 1
    assert out[0] == 0.0
    assert out[1] == pytest.approx(0.15)   # 0.1 × alpha(=1.5 clamp)
    assert out[2] == pytest.approx(0.15)


# ------------------------------------------------------------ apply_tool_penalty

def test_apply_tool_penalty_infra_and_mask():
    """infra token 的 hit 清零；无效位（padding）不参与重平衡。"""
    adv = np.array([1.0, 1.0, -1.0, -1.0, 9.9])
    hit = np.array([1, 0, 1, 0, 0])         # 仅首个正 token 与负样本 token 标记
    is_infra = np.array([0, 0, 1, 0, 0])     # 负样本 hit 是 infra → 豁免
    valid = np.array([1, 1, 1, 1, 0])        # 末位 padding
    out, m = apply_tool_penalty(adv, hit, kappa=2.0,
                                is_infra=is_infra, response_mask=valid)
    assert out[0] == 0.0                       # 正样本 hit 清零
    assert out[1] == 2.0                       # 回填: alpha=1+1/1=2（恰触界不 clamp）
    assert out[2] == -1.0                      # infra 豁免：原优势保留
    assert out[4] == 9.9                       # padding 位原样保留
    assert out[:2].sum() == pytest.approx(2.0)  # 正侧守恒


# ------------------------------------------------------------ 组内长度惩罚

def _sig(turns, inp, out):
    return {"turn_count": turns, "input_tokens": inp, "output_tokens": out}


def test_length_penalty_only_passed_and_anchor():
    """只罚通过轨迹；锚点 = 通过组 p30；失败轨迹不动。"""
    cfg = LengthPenaltyConfig()
    rewards = [1.0, 1.0, 1.0, 0.0]
    # 三条通过的 turns: 10/10/40 → p30 锚点 = 10；40 超额 300%
    signals = [_sig(10, 100, 100), _sig(10, 100, 100), _sig(40, 100, 100),
               _sig(99, 99, 99)]
    deltas, stats = compute_group_length_penalty(rewards, signals, cfg)
    assert deltas[0] == 0.0 and deltas[1] == 0.0
    assert deltas[3] == 0.0                       # 失败轨迹不罚
    assert deltas[2] == pytest.approx(-cfg.max_penalty)  # 超额 3.0 > saturate 1.0 → 罚满
    assert stats["penalized"] == 1.0


def test_length_penalty_deadzone_and_ramp():
    cfg = LengthPenaltyConfig(excess_threshold=0.5, excess_saturate=1.5,
                              penalty_exponent=2.0, max_penalty=0.2)
    rewards = [1.0, 1.0, 1.0, 1.0]
    # 通过轨迹 turns=[100,100,130,180] → p30 锚点=100（两条并列最短）
    signals = [_sig(100, 0, 0), _sig(100, 0, 0), _sig(130, 0, 0), _sig(180, 0, 0)]
    deltas, _ = compute_group_length_penalty(rewards, signals, cfg)
    assert deltas[0] == 0.0 and deltas[1] == 0.0  # 锚点本身
    assert deltas[2] == 0.0                       # 超额 0.3 ≤ 0.5 死区
    t = (0.8 - 0.5) / (1.5 - 0.5)                 # 180 超额 0.8 → t=0.3
    assert deltas[3] == pytest.approx(-cfg.max_penalty * t ** 2)


def test_length_penalty_min_pass_rate_skips_group():
    cfg = LengthPenaltyConfig(min_pass_rate=0.5)
    rewards = [1.0, 0.0, 0.0]                      # 通过率 1/3 ≤ 0.5
    deltas, stats = compute_group_length_penalty(
        rewards, [_sig(10, 0, 0), _sig(999, 0, 0), _sig(1, 0, 0)], cfg)
    assert deltas == [0.0, 0.0, 0.0]


def test_grouped_length_penalty_by_task():
    cfg = LengthPenaltyConfig()
    rewards = [1.0, 1.0, 1.0, 1.0]
    tasks = ["A", "A", "B", "B"]
    signals = [_sig(10, 0, 0), _sig(30, 0, 0), _sig(10, 0, 0), _sig(10, 0, 0)]
    deltas = grouped_length_penalty(rewards, tasks, signals, cfg)
    assert deltas[1] < 0.0                          # A 组的超长通过轨迹被罚
    assert deltas[2] == 0.0 and deltas[3] == 0.0    # B 组无超额


# ------------------------------------------------------------- trainer 集成

class _Episode:
    def __init__(self, task, reward, segments):
        self.task, self.reward, self.segments = task, reward, segments


def _sample(p_len=3, r_len=4, seed=0):
    g = torch.Generator().manual_seed(seed)
    return RolloutSample(
        prompt_ids=torch.randint(0, 32, (p_len,), generator=g),
        response_ids=torch.randint(0, 32, (r_len,), generator=g),
        old_logprobs=torch.randn(r_len, generator=g) * 0.01)


def _episodes():
    """两任务各两 episode；T1 的第二条通过但冗长。"""
    return [
        _Episode("T1", 1.0, [_sample(seed=1)]),
        _Episode("T1", 1.0, [_sample(seed=2)]),
        _Episode("T2", 0.0, [_sample(seed=3)]),
        _Episode("T2", 0.0, [_sample(seed=4)]),
    ]


def test_episode_signals():
    eps = [_Episode("T", 1.0, [_sample(3, 4), _sample(5, 6)])]
    s = episode_signals(eps)
    assert s[0] == {"turn_count": 2, "input_tokens": 8, "output_tokens": 10}


def test_trainer_arvo_off_by_default():
    """未配置 ARVO 时 train_step_episodes 行为与旧签名完全一致。"""
    lm = TinyLM()
    trainer = GRPOTrainer(lm, LocalRolloutEngine(lm), lambda p, r: 1.0)
    eps = _episodes()
    out = trainer.train_step_episodes(eps)
    assert "arvo/length_penalty_sum" not in out
    assert out["n_episodes"] == 4


def test_trainer_length_penalty_feeds_shaping():
    """长度惩罚 delta 加在 shaping 之前——M4 回放基线消费的是塑形后 reward。"""
    lm = TinyLM()
    seen = {}

    def shaping(rewards, task_ids):
        seen["rewards"] = list(map(float, rewards))
        return np.zeros(len(rewards))

    # T1: 两条全通过，第二条 turns 超长（构造差异信号）→ 被罚
    eps = [
        _Episode("T1", 1.0, [_sample(seed=1)]),
        _Episode("T1", 1.0, [_sample(seed=2)] + [_sample(seed=5)] * 5),
        _Episode("T2", 0.0, [_sample(seed=3)]),
        _Episode("T2", 0.0, [_sample(seed=4)]),
    ]
    trainer = GRPOTrainer(lm, LocalRolloutEngine(lm), lambda p, r: 1.0,
                          length_penalty=LengthPenaltyConfig())
    out = trainer.train_step_episodes(eps, shaping=shaping)
    assert out["arvo/length_penalty_sum"] > 0.0
    assert seen["rewards"][1] < 1.0          # 塑形看到的 reward 已含惩罚
    assert seen["rewards"][0] == 1.0


def test_trainer_tool_penalty_infra_exempt():
    """infra episode 的工具错误段豁免惩罚；正常错误段优势被改写且正侧守恒。

    豁免语义: infra token 不作为 hit 被清零/加重，但其优势仍以"干净 token"
    身份参与符号守恒回填（infra episode 是否进 batch 由调用方重试策略决定）。
    """
    # 4 条 episode 各 1 段、每段 4 token；advantage 按 GRPO 语义广播
    adv = np.array([1.0, -1.0, 1.0, -1.0])
    tok_adv = np.repeat(adv, 4)
    hit = np.zeros(16)
    hit[0:4] = 1.0                       # e0（正样本）段错误
    hit[8:12] = 1.0                      # e2（infra）段错误 → 豁免
    is_infra_ep = [False, False, True, False]
    infra_tokens = np.repeat(is_infra_ep, 4)
    out, m = apply_tool_penalty(tok_adv, hit, kappa=2.0, is_infra=infra_tokens)
    assert (out[0:4] == 0.0).all()                   # 正样本 hit 全清零
    assert (out[4:8] == -1.0).all()                  # 负样本无 hit，不变
    assert (out[12:16] == -1.0).all()
    # e2 豁免后是正侧唯一干净 token: 回填全部被清零质量 → 1×(1+4/4)=2
    assert (out[8:12] == 2.0).all()
    # 正侧守恒: pre = 4×1.0 + 4×1.0 = 8 = post 0 + 4×2.0
    assert abs(out[0:4].sum() + out[8:12].sum() - 8.0) < 1e-6
    assert m["arvo/hit_tokens"] == 4                  # 只剩 e0 的 4 个 hit token
