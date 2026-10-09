# agenticx/rl/decision_eval.py
"""决策头评测指标（SP26）：top-1 accuracy / ECE / 温度缩放 / 分型汇总。

纪律（plans/decision-layer/MASTER-PLAN.md 第四节）：
- 温度只在 calib 划分拟合，不改变 argmax；test 冻结后只读一次
- gold 取 label_for 优先级（execution > self > teacher）的 hard 标签——
  基线 accuracy 只对 execution 真值负责
- probs 来源由调用方注入（teacher_probs_getter / scorer_probs_getter），
  评测库不关心打分是谁做的；getter 返回 None 即跳过（计入 skipped）
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable

from agenticx.rl.decision import DecisionRecord
from agenticx.rl.decision_scorers import Scorer

# getter(record, question) -> 与 symbols 等长 probs；None=跳过
ProbsGetter = Callable[..., "tuple[float, ...] | None"]


def teacher_probs_getter(teacher_model: str = "") -> ProbsGetter:
    """从已补标记录读 teacher 软标签；teacher_model 非空时按标识过滤。"""
    def getter(rec: "DecisionRecord", q) -> "tuple[float, ...] | None":
        for l in rec.labels:
            if (l.qid == q.qid and l.source == "teacher" and l.probs
                    and (not teacher_model or l.teacher_model == teacher_model)):
                return tuple(l.probs)
        return None
    return getter


def scorer_probs_getter(scorer: Scorer) -> ProbsGetter:
    """现场打分：每 record 一次调用（决策点内多题共享 state），
    decision_id 缓存——test 划分单次读取红线由此保证。"""
    cache: dict[str, dict[str, tuple[float, ...]]] = {}

    def getter(rec: "DecisionRecord", q) -> "tuple[float, ...] | None":
        if rec.decision_id not in cache:
            cache[rec.decision_id] = scorer(rec) or {}
        return cache[rec.decision_id].get(q.qid)
    return getter


@dataclass
class Sample:
    decision_type: str
    decision_id: str
    qid: str
    probs: tuple[float, ...]
    gold_idx: int      # label_for().hard 在 symbols 中的下标


def _collect(records: list[DecisionRecord], getter: ProbsGetter):
    """收集可评样本 + 跳过统计。"""
    samples: list[Sample] = []
    skipped = {"no_probs": 0, "bad_len": 0, "no_gold": 0, "gold_off_vocab": 0}
    n_questions = 0
    for rec in records:
        for q in rec.questions:
            n_questions += 1
            probs = getter(rec, q)
            if probs is None:
                skipped["no_probs"] += 1
                continue
            probs = tuple(float(p) for p in probs)
            if len(probs) != len(q.symbols):
                skipped["bad_len"] += 1
                continue
            label = rec.label_for(q.qid)
            gold = label.hard if label else None
            if gold is None:
                skipped["no_gold"] += 1
                continue
            if gold not in q.symbols:
                skipped["gold_off_vocab"] += 1
                continue
            samples.append(Sample(
                decision_type=rec.decision_type, decision_id=rec.decision_id,
                qid=q.qid, probs=probs, gold_idx=q.symbols.index(gold)))
    return samples, skipped, n_questions


def _pred_idx(s: Sample) -> int:
    return max(range(len(s.probs)), key=lambda i: s.probs[i])


def _conf(s: Sample) -> float:
    return max(s.probs)


def top1_accuracy(samples: list[Sample]) -> float:
    if not samples:
        return float("nan")
    return sum(1 for s in samples if _pred_idx(s) == s.gold_idx) / len(samples)


def expected_calibration_error(samples: list[Sample], n_bins: int = 15) -> float:
    """等频宽分桶 ECE：Σ (n_b/N)·|acc_b − conf_b|。"""
    if not samples:
        return float("nan")
    bins: list[list[Sample]] = [[] for _ in range(n_bins)]
    for s in samples:
        b = min(int(_conf(s) * n_bins), n_bins - 1)
        bins[b].append(s)
    ece = 0.0
    for b in bins:
        if not b:
            continue
        acc = sum(1 for s in b if _pred_idx(s) == s.gold_idx) / len(b)
        conf = sum(_conf(s) for s in b) / len(b)
        ece += len(b) / len(samples) * abs(acc - conf)
    return ece


def apply_temperature(probs: tuple[float, ...], t: float) -> tuple[float, ...]:
    """单参数温度缩放：softmax(log(p)/T)。不改变 argmax（数学性质）。"""
    logits = [math.log(p + 1e-12) for p in probs]
    m = max(logits)
    exps = [math.exp((l - m) / t) for l in logits]
    z = sum(exps)
    return tuple(e / z for e in exps)


def _nll(samples: list[Sample], t: float) -> float:
    nll = 0.0
    for s in samples:
        p = apply_temperature(s.probs, t)[s.gold_idx]
        nll -= math.log(p + 1e-12)
    return nll / max(len(samples), 1)


def fit_temperature(samples: list[Sample], *, lo: float = 0.05, hi: float = 20.0,
                    n_grid: int = 200) -> float:
    """对数均匀网格搜 NLL 最优温度。只在 calib 划分上调用（红线）。"""
    if not samples:
        return 1.0
    ts = [math.exp(math.log(lo) + (math.log(hi) - math.log(lo)) * i / (n_grid - 1))
          for i in range(n_grid)] + [1.0]
    return min(ts, key=lambda t: _nll(samples, t))


def _bucket_stats(samples: list[Sample], temperature: float) -> dict:
    return {
        "n": len(samples),
        "top1": round(top1_accuracy(samples), 4) if samples else None,
        "ece": round(expected_calibration_error(samples), 4) if samples else None,
        "ece_temp": (round(expected_calibration_error(
            [Sample(**{**s.__dict__, "probs": apply_temperature(s.probs, temperature)})
             for s in samples]), 4) if samples else None),
    }


def eval_split(records: list[DecisionRecord], getter: ProbsGetter, *,
               temperature: float = 1.0, n_bins: int = 15) -> dict:
    """一个划分的完整评测：分 decision_type 汇总 + overall + 跳过统计。"""
    del n_bins  # ECE 桶数固定 15（v1 口径，避免报告间口径漂移）
    samples, skipped, n_questions = _collect(records, getter)
    by_type: dict[str, list[Sample]] = defaultdict(list)
    for s in samples:
        by_type[s.decision_type].append(s)
    return {
        "n_records": len(records),
        "n_questions": n_questions,
        "n_evaluated": len(samples),
        "temperature": round(temperature, 4),
        "overall": _bucket_stats(samples, temperature),
        "by_type": {dt: _bucket_stats(ss, temperature)
                    for dt, ss in sorted(by_type.items())},
        "skipped": skipped,
    }
