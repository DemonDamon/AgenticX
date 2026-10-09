# tests/rl/test_decision_head.py
"""SP29b 轻量决策头测试。

覆盖: state 解析一致性(往返) / 三路标签训练收敛 / 保存加载 round-trip /
scorer 注册与 fail-open 语义 / AUC·ECE 指标正确性。
"""
from __future__ import annotations

import math

import pytest
import torch

from agenticx.learning.trajectory.decision_policy import render_step_state
from agenticx.learning.trajectory.forest import StepFeatures
from agenticx.learning.trajectory.replay import AttemptContext
from agenticx.rl.decision import (DecisionLabel, DecisionLog,
                                  DecisionQuestion)
from agenticx.rl.decision_head import (
    FEATURE_NAMES,
    TrainedHead,
    auc_score,
    ece_score,
    feature_importance,
    parse_step_state,
    train_head)
from agenticx.rl.decision_scorers import make_scorer


def _obs(step=3, n_messages=10, n_tool_calls=4, rate=0.75, fails=0,
         stall=2, tokens=1200) -> StepFeatures:
    return StepFeatures(step=step, n_messages=n_messages,
                        n_tool_calls=n_tool_calls, tool_success_rate=rate,
                        consecutive_failures=fails,
                        rounds_since_progress=stall, est_tokens=tokens)


def _ctx(task_id="tb/demo-task", attempt_index=0, remaining=2,
         spent=0) -> AttemptContext:
    return AttemptContext(task_id=task_id, attempt_index=attempt_index,
                          attempts_remaining=remaining, spent_so_far=spent)


def _rec(log: DecisionLog, *, rollout_id="tb/x#0", turn=0, state: str = "",
         outcome=None, teacher_probs=None) -> None:
    q = DecisionQuestion(qid="q_abort", type="yes_no",
                         question="该尝试已无成功希望，应立即止损放弃吗？")
    rec = log.add(rollout_id=rollout_id, turn=turn, task_id="tb/x",
                  decision_type="continue_stop",
                  state=state or render_step_state(_obs(step=turn), _ctx()),
                  state_compressor="step-features-v1", questions=[q])
    if outcome is not None:
        from agenticx.rl.decision import DecisionOutcome
        rec.outcome = DecisionOutcome(ok=outcome,   # 单条直赋，避免
                                      task_status="pass" if outcome else "fail")
    if teacher_probs is not None:
        rec.add_label(DecisionLabel(
            qid="q_abort", source="teacher", probs=teacher_probs,
            teacher_model="mock-teacher-v1"))


class TestParseStepState:
    def test_roundtrip_render_parse(self):
        """render_step_state → parse_step_state 往返：特征值逐项还原。"""
        obs = _obs(step=7, n_messages=19, n_tool_calls=6, rate=0.42,
                   fails=3, stall=5, tokens=9876)
        ctx = _ctx(attempt_index=1, remaining=1, spent=5000)
        f = parse_step_state(render_step_state(obs, ctx))
        assert f["step"] == 7.0 and f["n_messages"] == 19.0
        assert f["n_tool_calls"] == 6.0
        assert abs(f["tool_success_rate"] - 0.42) < 1e-9
        assert f["consecutive_failures"] == 3.0
        assert f["rounds_since_progress"] == 5.0
        assert f["est_tokens"] == 9876.0
        assert f["attempt_index"] == 1.0
        assert f["attempts_remaining"] == 1.0
        assert f["spent_so_far"] == 5000.0
        assert f["task_id"] == "tb/demo-task"

    def test_missing_rate_becomes_neutral(self):
        f = parse_step_state(render_step_state(
            _obs(rate=-1.0), _ctx()))
        assert f["tool_success_rate"] == 0.5

    def test_format_drift_raises(self):
        with pytest.raises(ValueError, match="格式漂移"):
            parse_step_state("task: t\nbogus line here")
        with pytest.raises(ValueError, match="缺特征行"):
            parse_step_state("task: t\nstep: 1 of 2 messages")


class TestTrainHead:
    def _dataset(self, n=60, seed=7):
        """可分合成集：fails>=3 → 死路（ok=False），否则 pass。"""
        g = torch.Generator().manual_seed(seed)
        log = DecisionLog()
        for i in range(n):
            fails = int(torch.randint(0, 6, (1,), generator=g))
            dead = fails >= 3
            _rec(log, rollout_id=f"tb/syn#0", turn=i,
                 state=render_step_state(
                     _obs(step=i, fails=fails), _ctx()),
                 outcome=not dead,
                 teacher_probs=(0.9, 0.1) if dead else (0.1, 0.9))
        return log.records

    def test_execution_head_learns_separable_signal(self):
        head = train_head(self._dataset(), label_source="execution")
        p_fail = head.p_abort(render_step_state(_obs(fails=5), _ctx()))
        p_pass = head.p_abort(render_step_state(_obs(fails=0), _ctx()))
        assert p_fail > 0.8 and p_pass < 0.2
        imp = feature_importance(head)
        assert imp and max(imp, key=imp.get) == "consecutive_failures"

    def test_teacher_distillation_fits_teacher(self):
        head = train_head(self._dataset(), label_source="teacher", epochs=400)
        # teacher 概率与特征强相关（fails>=3 → 0.9）——蒸馏头应复现方向
        assert (head.p_abort(render_step_state(_obs(fails=5), _ctx()))
                - head.p_abort(render_step_state(_obs(fails=0), _ctx()))) > 0.3

    def test_mixed_source_runs(self):
        head = train_head(self._dataset(), label_source="mixed")
        assert head.meta["label_source"] == "mixed"
        assert head.meta["n_samples"] == 60

    def test_insufficient_samples_raise(self):
        log = DecisionLog()
        _rec(log, outcome=True)
        with pytest.raises(ValueError, match="样本不足"):
            train_head(log.records, label_source="execution")

    def test_unknown_source_raise(self):
        with pytest.raises(ValueError, match="label_source"):
            train_head(self._dataset(), label_source="bogus")


class TestScorerIntegration:
    def _head_path(self, tmp_path):
        head = train_head(_mk_records(), label_source="execution")
        p = tmp_path / "head.pt"
        head.save(p)
        return p, head

    def test_roundtrip_and_make_scorer(self, tmp_path):
        p, head = self._head_path(tmp_path)
        h2 = TrainedHead.load(p)
        rec = _mk_records()[0]
        assert h2(rec)["q_abort"] == pytest.approx(
            head(rec)["q_abort"], abs=1e-6)
        scorer, sid = make_scorer("trained", model=str(p))
        assert sid.startswith("trained:execution")
        out = scorer(rec)
        assert len(out["q_abort"]) == 2 and abs(sum(out["q_abort"]) - 1) < 1e-6

    def test_wrong_question_and_version_raise(self, tmp_path):
        p, _ = self._head_path(tmp_path)
        scorer, _ = make_scorer("trained", model=str(p))
        bad_q = DecisionQuestion(qid="q_tool", type="choice",
                                 question="?", options=("a", "b"))
        log = DecisionLog()
        rec = log.add(rollout_id="r", turn=0, task_id="t",
                      decision_type="tool_selection", state="s",
                      state_compressor="step-features-v1",
                      questions=[bad_q])
        with pytest.raises(ValueError, match="只答 q_abort"):
            scorer(rec)

    def test_missing_model_arg_raise(self):
        with pytest.raises(ValueError, match="head 文件路径"):
            make_scorer("trained")


def _mk_records(n=40, seed=3) -> list:
    g = torch.Generator().manual_seed(seed)
    log = DecisionLog()
    for i in range(n):
        fails = int(torch.randint(0, 6, (1,), generator=g))
        dead = fails >= 3
        _rec(log, rollout_id=f"tb/syn#0", turn=i,
             state=render_step_state(_obs(step=i, fails=fails), _ctx()),
             outcome=not dead,
             teacher_probs=(0.9, 0.1) if dead else (0.1, 0.9))
    return log.records


class TestMetrics:
    def test_auc_perfect_and_random(self):
        assert auc_score([0.9, 0.8, 0.1, 0.2],
                         [True, True, False, False]) == 1.0
        assert auc_score([0.5, 0.5], [True, False]) == 0.5
        assert math.isnan(auc_score([0.5], [True]))

    def test_ece_perfect_calibration(self):
        # 4 个 p=0.75 的预测命中 3/4 → ECE=0
        assert ece_score([0.75] * 4, [1.0, 1.0, 1.0, 0.0]) == 0.0
        assert ece_score([0.9] * 4, [0.0] * 4) == pytest.approx(0.9)


import math  # noqa: E402  (TestMetrics 用)
