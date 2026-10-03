# tests/rl/test_decision_eval.py
"""SP26 决策评测库测试。

覆盖: top-1 vs execution 真值 / ECE 手算 fixture / 温度缩放（不改 argmax、
NLL 改善）/ 分型汇总与跳过统计 / getter（teacher 过滤、scorer 单次读取）。
"""
from __future__ import annotations

import math

import pytest

from agenticx.rl.decision import DecisionLabel, DecisionLog, DecisionQuestion
from agenticx.rl.decision_eval import (
    Sample,
    _collect,
    apply_temperature,
    eval_split,
    expected_calibration_error,
    fit_temperature,
    scorer_probs_getter,
    teacher_probs_getter,
    top1_accuracy,
)


def _mk(log, qid, options, probs, hard, decision_type="tool_selection",
        teacher_model="teacher-x", rollout="r-1"):
    q = DecisionQuestion(qid=qid, type="choice", question="下一步调用哪个工具",
                         options=tuple(options))
    rec = log.add(rollout_id=rollout, turn=1, task_id="t-1",
                  decision_type=decision_type, state="s",
                  state_compressor="msg-tail-1200-v1", questions=[q])
    if hard:
        rec.add_label(DecisionLabel(qid=qid, source="execution", hard=hard))
    if probs:
        rec.add_label(DecisionLabel(qid=qid, source="teacher", probs=tuple(probs),
                                    teacher_model=teacher_model))
    return rec


def _log_with_records():
    log = DecisionLog()
    _mk(log, "q1", ("a", "b", "c"), (0.7, 0.2, 0.1), "a")   # 对
    _mk(log, "q2", ("a", "b", "c"), (0.3, 0.6, 0.1), "a")   # 错
    _mk(log, "q3", ("a", "b", "c"), (0.5, 0.3, 0.2), None)  # 无 execution 真值
    _mk(log, "q4", ("a", "b"), (0.1, 0.9), "b", rollout="r-2")  # 对
    return log


class TestCollectAndAccuracy:
    def test_top1_vs_execution_truth(self):
        log = _log_with_records()
        getter = teacher_probs_getter()
        samples, skipped, n_q = _collect(log.records, getter)
        assert n_q == 4
        assert len(samples) == 3              # q3 无真值跳过
        assert skipped["no_gold"] == 1
        assert math.isclose(top1_accuracy(samples), 2 / 3)

    def test_teacher_model_filter(self):
        log = _log_with_records()
        _mk(log, "q5", ("a", "b"), (0.9, 0.1), "a", teacher_model="teacher-y",
            rollout="r-3")
        samples_all, _, _ = _collect(log.records, teacher_probs_getter())
        samples_x, _, _ = _collect(log.records, teacher_probs_getter("teacher-x"))
        assert len(samples_all) == 4 and len(samples_x) == 3

    def test_bad_len_skipped(self):
        log = DecisionLog()
        _mk(log, "q1", ("a", "b", "c"), (0.5, 0.5), "a")    # 长度不符
        _, skipped, _ = _collect(log.records, teacher_probs_getter())
        assert skipped["bad_len"] == 1

    def test_gold_off_vocab_skipped(self):
        log = DecisionLog()
        _mk(log, "q1", ("a", "b"), (0.5, 0.5), "zzz")       # 真值不在候选集
        _, skipped, _ = _collect(log.records, teacher_probs_getter())
        assert skipped["gold_off_vocab"] == 1


class TestECE:
    def test_perfect_calibration_zero(self):
        # 10 个 conf=0.8 样本，8 对 2 错 → acc=conf → ECE=0
        samples = [Sample("t", str(i), "q", (0.8, 0.2), 0 if i < 8 else 1)
                   for i in range(10)]
        assert math.isclose(expected_calibration_error(samples), 0.0, abs_tol=1e-9)

    def test_overconfident_wrong_hand_computed(self):
        # 单样本 conf=1.0 且错 → ECE = |0 - 1| = 1
        samples = [Sample("t", "1", "q", (1.0, 0.0), 1)]
        assert math.isclose(expected_calibration_error(samples), 1.0, abs_tol=1e-9)

    def test_bins_split_by_confidence(self):
        # 两个桶：conf=0.65 全对、conf=0.95 全错 → ECE = 0.5*|1-0.65| + 0.5*|0-0.95|
        samples = ([Sample("t", str(i), "q", (0.65, 0.35), 0) for i in range(2)]
                   + [Sample("t", f"w{i}", "q", (0.95, 0.05), 1) for i in range(2)])
        assert math.isclose(expected_calibration_error(samples), 0.65, abs_tol=1e-9)


class TestTemperature:
    def test_argmax_invariant(self):
        for probs in [(0.6, 0.4), (0.34, 0.33, 0.33), (0.05, 0.9, 0.05)]:
            for t in (0.1, 1.0, 5.0):
                scaled = apply_temperature(probs, t)
                assert scaled.index(max(scaled)) == probs.index(max(probs))
                assert math.isclose(sum(scaled), 1.0, rel_tol=1e-9)

    def test_fit_improves_nll_on_mixed(self):
        # 同 conf 一对一错 → 最优 T>1；NLL(拟合) ≤ NLL(1)
        from agenticx.rl.decision_eval import _nll
        samples = [Sample("t", "1", "q", (0.9, 0.1), 0),
                   Sample("t", "2", "q", (0.9, 0.1), 1)]
        t = fit_temperature(samples)
        assert 1.0 < t <= 20.0
        assert _nll(samples, t) <= _nll(samples, 1.0) + 1e-9

    def test_fit_empty_returns_one(self):
        assert fit_temperature([]) == 1.0


class TestEvalSplit:
    def test_grouping_and_overall(self):
        log = _log_with_records()
        _mk(log, "q6", ("yes", "no"), (0.8, 0.2), "yes",
            decision_type="continue_stop", rollout="r-4")
        report = eval_split(log.records, teacher_probs_getter())
        assert set(report["by_type"]) == {"tool_selection", "continue_stop"}
        assert report["n_evaluated"] == 4
        assert report["overall"]["n"] == 4
        assert report["skipped"]["no_gold"] == 1
        # ece_temp 与 ece 独立成列（T=1 时相等）
        assert report["overall"]["ece"] == report["overall"]["ece_temp"]

    def test_scorer_getter_reads_each_record_once(self):
        log = _log_with_records()
        calls = []

        def scorer(rec):
            calls.append(rec.decision_id)
            return {q.qid: tuple(1 / len(q.symbols) for _ in q.symbols)
                    for q in rec.questions}
        getter = scorer_probs_getter(scorer)
        for rec in log.records:
            for q in rec.questions:
                getter(rec, q)
        assert len(calls) == len(log.records)   # 单次读取红线
        assert len(set(calls)) == len(calls)


class TestSplitDiscipline:
    def test_eval_only_on_given_records(self):
        # eval_split 不做切分选择——切分纪律由 CLI 层强制（见 SP26 验收）
        log = _log_with_records()
        report = eval_split([r for r in log.records if r.rollout_id == "r-2"],
                            teacher_probs_getter())
        assert report["n_records"] == 1
