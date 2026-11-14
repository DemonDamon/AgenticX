# agenticx/rl/spr.py
"""SPR 奖励层（playbook §4.2-3）：strict success 与 bounded partial credit 分离。

Terminal-RSI（arXiv:2610.22192）实测：纯 partial credit 下失败轨迹拿走
50.09% 的奖励质量；SPR 把它压到 28.72%。工程要点：
- strict S∈{0,1} 只来自 verifier 的终判（容器内真实执行，零 LLM-judge）；
- partial p∈[0,1] 是检查点完成比例，取不到就退化为 p=S（不编造中间量）；
- λ_t 从 0.5 线性降到 0.1：前段给部分信用保探索，后段压低迫使收敛。
"""
from __future__ import annotations

import json
from pathlib import Path

LAMBDA_START = 0.5
LAMBDA_END = 0.1


def lambda_schedule(step: int, total_steps: int, *,
                    start: float = LAMBDA_START, end: float = LAMBDA_END) -> float:
    """λ_t 线性衰减；端点精确返回（浮点累积不引入 1e-17 级误差）。"""
    if step <= 0 or total_steps <= 0:
        return start
    if step >= total_steps:
        return end
    return start + (end - start) * (step / total_steps)


def spr_reward(strict: float, partial: float | None, lam: float) -> float:
    """R = S + (1-S)·λ·p——严格通过钉死满分，部分信用只给失败轨迹。

    这是 Terminal-RSI 线性混合 R=(1-λ)S+λp 的保守变体：当 S=1 但 p<1
    （终判通过、个别子检查未走全）时，线性混合会罚掉已验证的成功，
    与「success-prioritized」语义矛盾。失败轨迹两者等价（都只剩 λ·p）。
    partial 缺失时退化为 p=S（不编造中间量）；p 夹到 [0,1] 防脏数据。
    """
    s = 1.0 if strict > 0 else 0.0
    if s > 0:
        return 1.0
    p = 0.0 if partial is None else min(max(float(partial), 0.0), 1.0)
    return lam * p


def extract_partial_credit(trial_dir: str | Path) -> float | None:
    """从 harbor trial 的 result.json 提取 partial credit。

    优先级（不同 verifier 输出形态不同，全部尝试，找不到返回 None）：
    1. rewards.partial / rewards.partial_credit 显式字段；
    2. checks 统计：passed/total（或 passed_count/total_count）；
    3. verifier_result 里的 parser_results 逐条二值均值。
    拿不到就是拿不到——绝不编造中间量（playbook §2 纪律）。
    """
    p = Path(trial_dir) / "result.json"
    if not p.exists():
        raise FileNotFoundError(f"缺少 result.json: {p}")
    data = json.loads(p.read_text())
    vr = data.get("verifier_result") or {}
    rewards = vr.get("rewards") or {}

    for key in ("partial", "partial_credit"):
        v = rewards.get(key)
        if isinstance(v, (int, float)):
            return float(v)

    checks = vr.get("checks") or {}
    passed = checks.get("passed", checks.get("passed_count"))
    total = checks.get("total", checks.get("total_count"))
    if isinstance(passed, (int, float)) and isinstance(total, (int, float)) and total > 0:
        return float(passed) / float(total)

    parser = vr.get("parser_results")
    if isinstance(parser, dict) and parser:
        vals = [v for v in parser.values()
                if isinstance(v, dict) and isinstance(v.get("reward"), (int, float))]
        if vals:
            return sum(v["reward"] for v in vals) / len(vals)
    return None


class SPRReward:
    """训练循环用的有状态包装：按全局 step 自动算 λ，逐 trial 打分。

    reward_fn 契约与 GRPOTrainer 对齐：((prompt_ids, response_ids) 由调用侧
    换成 (strict, partial, trial_dir) 三元组注入（harbor_rollout 的
    collect 阶段产出），本类只做纯计算不碰 token。
    """

    def __init__(self, total_steps: int, *, start: float = LAMBDA_START,
                 end: float = LAMBDA_END):
        self.total_steps = total_steps
        self.start, self.end = start, end
        self.step = 0
        self.lam = lambda_schedule(0, total_steps, start=start, end=end)

    def advance(self, step: int) -> None:
        self.step = step
        self.lam = lambda_schedule(step, self.total_steps,
                                   start=self.start, end=self.end)

    def score(self, strict: float, partial: float | None) -> float:
        return spr_reward(strict, partial, self.lam)

    def score_trial(self, trial_dir: str | Path, *, strict: float | None = None) -> float:
        """strict 不传时从 result.json 读终判 reward。"""
        if strict is None:
            strict = extract_strict_reward(trial_dir)
        return self.score(strict, extract_partial_credit(trial_dir))


def extract_strict_reward(trial_dir: str | Path) -> float:
    """harbor result.json 的 verifier 终判（0/1），与 harbor_reward.extract_reward 同源。"""
    from .harbor_reward import extract_reward
    return extract_reward(Path(trial_dir))
