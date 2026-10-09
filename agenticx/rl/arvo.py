# agenticx/rl/arvo.py
"""ARVO 组内惩罚体系（SP20）：自 MiMo-V2.6 开源 verl fork 移植，纯 numpy。

移植来源对照（XiaomiMiMo/verl @ e2b9fc0）:
  signed_rebalance        ← verl/trainer/ppo/signed_rebalance.py（adv_signed）
  compute_group_length_penalty ← verl/utils/length_penalty.py
  参考超参               ← recipes/arvo/REFERENCE_PENALTIES.json

三件事，作用在 GRPO 管线的不同位置:
  1) 组内长度惩罚——改 reward（在优势计算之前）: 只罚"通过但冗长"的轨迹，
     锚点 = 同组通过轨迹长度信号的分位数（默认 p30）。
  2) adv_signed 工具错误惩罚——改 advantage（在优势计算之后）: 正样本中带
     工具错误片段的优势清零，负样本中同类片段优势 ×kappa 加重，且按符号
     守恒质量（正负两侧各自回填/扣回），避免注入净质量压平策略。
  3) infra 失败分离——两个惩罚都跳过 is_infra 轨迹: 基础设施错误不应产生
     学习信号（与工程约定"infra 错误重试到消除"对齐）。

MiMo 参考配置: kappa=2, scale∈[0.5,2], 长度罚上限 0.2, 指数 1.5,
锚点 p30, min_pass_rate 0.5, GRPO 不除 std, prompt-mean loss, 无 KL。
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


# ---------------------------------------------------------------- 1) adv_signed

def signed_rebalance(adv, hit, seq_sign, *, min_scale: float = 0.5,
                     max_scale: float = 2.0, weight=None) -> tuple[np.ndarray, dict]:
    """adv_signed 符号守恒惩罚（平坦形式，输入为全部有效 token 拼接）。

    adv: [T] 优势。hit: [T] 惩罚乘数 kappa>=1（0=未标记）。
    seq_sign: [T] ∈{-1,0,+1} 所属序列结局优势的符号；0（退化组）不动不计数。
    weight: [T] 可选 per-token loss 权重（prompt-mean 时质量=weight*adv）。

    语义: 正样本标记 token 优势→0；负样本标记 token 优势×kappa；
    正侧扣掉的质量×alpha 回填给正样本干净 token，负侧加上的质量×beta 从
    负样本干净 token 扣回；两侧独立守恒，clamp 时记录并放弃守恒。
    """
    adv = np.asarray(adv, dtype=np.float64).copy()
    hit = np.asarray(hit, dtype=np.float64)
    sign = np.asarray(seq_sign)
    assert adv.ndim == 1 and hit.shape == adv.shape and sign.shape == adv.shape
    assert np.all((hit == 0) | (hit >= 1.0)), "hit 取值须为 0 或 >=1 的乘数"
    assert 0 < min_scale <= 1.0 <= max_scale
    w = np.ones_like(adv) if weight is None else np.asarray(weight, dtype=np.float64)

    is_hit = hit > 0
    pos, neg = sign > 0, sign < 0
    pos_hit, pos_clean = pos & is_hit, pos & ~is_hit
    neg_hit, neg_clean = neg & is_hit, neg & ~is_hit

    mass = w * adv
    pos_pre, neg_pre = float(mass[pos].sum()), float(mass[neg].sum())
    removed = float(mass[pos_hit].sum())            # 正侧清零的质量
    pos_base = float(mass[pos_clean].sum())         # 正侧干净 token 质量
    added = float(-((hit[neg_hit] - 1.0) * mass[neg_hit]).sum())  # (κ-1)|A|
    neg_base = float(-mass[neg_clean].sum())

    alpha, a_cl = 1.0, False
    if removed != 0.0 and pos_base > 0.0:
        alpha = 1.0 + removed / pos_base
        if alpha > max_scale:
            alpha, a_cl = max_scale, True
    elif removed != 0.0:
        a_cl = True
    beta, b_cl = 1.0, False
    if added > 0.0 and neg_base > 0.0:
        beta = 1.0 - added / neg_base
        if beta < min_scale:
            beta, b_cl = min_scale, True
    elif added > 0.0:
        b_cl = True

    adv[pos_hit] = 0.0
    adv[pos_clean] *= alpha
    adv[neg_hit] *= hit[neg_hit]
    adv[neg_clean] *= beta

    mass = w * adv
    if not a_cl:
        assert abs(mass[pos].sum() - pos_pre) <= 1e-6 * max(1.0, abs(pos_pre))
    if not b_cl:
        assert abs(mass[neg].sum() - neg_pre) <= 1e-6 * max(1.0, abs(neg_pre))
    metrics = {"arvo/pos_mass_removed": removed, "arvo/pos_scale": alpha,
               "arvo/neg_mass_added": added, "arvo/neg_scale": beta,
               "arvo/pos_clamped": int(a_cl), "arvo/neg_clamped": int(b_cl),
               "arvo/hit_tokens": int(is_hit.sum())}
    return adv.astype(np.float32), metrics


def apply_tool_penalty(advantages, hit, *, kappa: float = 2.0,
                       min_scale: float = 0.5, max_scale: float = 2.0,
                       is_infra=None, response_mask=None):
    """GRPO 之后施加 adv_signed。批量输入均为"序列级展开的平坦 token"形式。

    advantages: [T] token 级优势（GRPO 广播）。
    hit: [T] 布尔/0-1，该 token 是否属于含工具调用错误的片段（×kappa 由本函数施加）。
    is_infra: [T] 逐 token infra 标记；标记位的 hit 强制清零（infra 不学）。
    response_mask: [T] 有效 token 位；提供时仅在有效位上重平衡。
    返回 (新优势, metrics)。序列符号 = 逐 token 优势符号（GRPO 广播下
    序列内优势同号，二者等价；零优势 token 符号为 0，不参与守恒）。
    """
    adv = np.asarray(advantages, dtype=np.float64).reshape(-1)
    hit_bool = np.asarray(hit).astype(bool).reshape(-1)
    assert adv.shape == hit_bool.shape, "advantages 与 hit 须同为平坦 token 形"
    valid = (np.ones_like(adv, dtype=bool) if response_mask is None
             else np.asarray(response_mask).astype(bool).reshape(-1))
    if is_infra is not None:                       # infra token 不产生学习信号
        is_infra = np.asarray(is_infra).astype(bool).reshape(-1)
        assert is_infra.shape == hit_bool.shape, "is_infra 须为逐 token 形"
        hit_bool = hit_bool & ~is_infra
    hit_flat = np.where(valid & hit_bool, float(kappa), 0.0)
    # 序列符号: GRPO 广播下序列内优势同号，逐 token 符号即序列符号
    sign = np.where(valid, np.sign(adv), 0.0)
    new_adv, metrics = signed_rebalance(
        np.where(valid, adv, 0.0), hit_flat, sign,
        min_scale=min_scale, max_scale=max_scale)
    return np.where(valid, new_adv, adv), metrics


# ------------------------------------------------------------ 2) 组内长度惩罚

@dataclass
class LengthPenaltyConfig:
    """组内长度惩罚配置。默认值 = MiMo REFERENCE_PENALTIES.json。"""
    enabled: bool = True
    max_penalty: float = 0.2
    excess_threshold: float = 0.0          # 死区：组合超额≤此值不罚
    excess_saturate: float = 1.0           # 超额达此值罚满 max_penalty
    penalty_exponent: float = 1.5          # 凸 ramp t**exp
    metrics: tuple = ("turns", "input_tokens", "output_tokens")
    combine: str = "max"                   # max/mean/weighted
    pass_threshold: float = 0.5
    anchor_quantile: float = 0.3           # 锚点 = 通过组内该分位数
    min_pass_rate: float = 0.5             # 组通过率≤此值整组跳过
    weights: dict | None = field(default=None)

    def __post_init__(self):
        if self.excess_threshold >= self.excess_saturate:
            raise ValueError("excess_threshold 须严格小于 excess_saturate")
        if self.anchor_quantile <= 0 or self.anchor_quantile >= 1:
            raise ValueError("anchor_quantile ∈ (0,1)")


def _signal(signals: dict | None, metric: str) -> float | None:
    if not signals:
        return None
    if metric == "turns":
        v = signals.get("turn_count", signals.get("turns"))
    elif metric == "input_tokens":
        v = signals.get("input_tokens", signals.get("prefill_length"))
    else:
        v = signals.get("output_tokens", signals.get("decode_length"))
    return None if v is None else float(v)


def compute_group_length_penalty(rewards, signals, cfg: LengthPenaltyConfig
                                 ) -> tuple[list[float], dict]:
    """单组（同一 prompt 的 n 条 rollout）长度惩罚，返回逐条 delta（≤0）。

    只罚通过轨迹（reward ≥ pass_threshold）；锚点取通过轨迹长度信号的
    anchor_quantile 分位；组合超额 = max/mean/weighted(各维超额)；凸 ramp
    到 max_penalty。失败轨迹不动；组通过率≤min_pass_rate 整组跳过。
    """
    rewards = [float(r) for r in rewards]
    n = len(rewards)
    deltas = [0.0] * n
    stats = {"groups_total": 1.0, "passed": 0.0, "penalized": 0.0,
             "penalty_sum": 0.0}
    if not cfg.enabled or n == 0:
        return deltas, stats
    passed = [i for i in range(n) if rewards[i] >= cfg.pass_threshold]
    stats["passed"] = float(len(passed))
    if not passed or len(passed) / n <= cfg.min_pass_rate:
        stats["groups_skipped"] = 1.0
        return deltas, stats

    # 锚点：各维度通过轨迹分位数
    anchors = {}
    for m in cfg.metrics:
        vals = [_signal(signals[i], m) for i in passed]
        vals = [v for v in vals if v is not None]
        anchors[m] = float(np.percentile(vals, cfg.anchor_quantile * 100)) if vals else None

    for i in passed:
        excess = {}
        for m in cfg.metrics:
            a, v = anchors[m], _signal(signals[i], m)
            if a is None or v is None or a <= 0:
                continue
            e = max(0.0, (v - a) / a)
            if e > 0:
                excess[m] = e
        if not excess:
            continue
        if cfg.combine == "mean":
            combined = sum(excess.values()) / len(excess)
        elif cfg.combine == "weighted":
            ws = cfg.weights or {m: 1.0 for m in excess}
            combined = sum(excess[m] * ws.get(m, 0.0) for m in excess) / sum(
                ws.get(m, 0.0) for m in excess)
        else:
            combined = max(excess.values())
        if combined <= cfg.excess_threshold:
            continue
        t = min((combined - cfg.excess_threshold)
                / (cfg.excess_saturate - cfg.excess_threshold), 1.0)
        pen = cfg.max_penalty * (t ** cfg.penalty_exponent)
        if pen > 0:
            deltas[i] = -float(pen)
            stats["penalized"] += 1.0
            stats["penalty_sum"] += float(pen)
    return deltas, stats


def grouped_length_penalty(rewards, task_ids, signals, cfg: LengthPenaltyConfig
                           ) -> list[float]:
    """按任务分组施加组内长度惩罚，返回与输入同序的 delta 列表（加到 reward 上）。"""
    rewards = list(map(float, rewards))
    deltas = [0.0] * len(rewards)
    for task in dict.fromkeys(task_ids):
        idx = [i for i, t in enumerate(task_ids) if t == task]
        d, _ = compute_group_length_penalty(
            [rewards[i] for i in idx], [signals[i] for i in idx], cfg)
        for i, di in zip(idx, d):
            deltas[i] = di
    return deltas


def episode_signals(episodes) -> list[dict]:
    """从 Episode（harbor_rollout 鸭子类型）提取长度信号。

    turn_count=段数; input_tokens=各段 prompt 长度和; output_tokens=各段
    response 长度和。多轮轨迹的"轮次"以 LLM 生成段计。
    """
    out = []
    for e in episodes:
        segs = list(getattr(e, "segments", []))
        out.append({
            "turn_count": len(segs),
            "input_tokens": int(sum(s.prompt_ids.shape[0] for s in segs)),
            "output_tokens": int(sum(s.response_ids.shape[0] for s in segs)),
        })
    return out
