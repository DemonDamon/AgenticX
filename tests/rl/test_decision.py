# tests/rl/test_decision.py
"""SP25 决策点标注层测试。

覆盖: schema 校验 / TokenRollout join 对齐 / 标签优先级 / outcome 回填 /
held-out 守卫 / 确定性切分(rollout 粒度隔离) / teacher 补标 / jsonl 往返。
"""
from __future__ import annotations

import pytest

from agenticx.rl.decision import (
    DECISION_TYPES,
    DecisionLabel,
    DecisionLog,
    DecisionQuestion,
    assign_split,
    assert_trainable_decisions,
    backfill_teacher,
    load_trainable_decisions,
)
from agenticx.rl.rollout import TokenRollout, TokenStamp
from agenticx.trainer.heldout import HeldoutViolation

_FAKE_SPLIT = {
    "seed": "tb40-v1", "ratio": 0.2,
    "train": ["train-task-1", "train-task-2"],
    "heldout": ["exam-task-1"],
}


def _tool_q() -> DecisionQuestion:
    return DecisionQuestion(
        qid="q_tool", type="choice", question="下一步调用哪个工具",
        options=("read_file", "run_test", "search_code"),
        distractor_source="neg-v1")


def _score_q() -> DecisionQuestion:
    return DecisionQuestion(
        qid="q_screen", type="score", question="当前 patch 通过验证的可能性")


def _add_record(log: DecisionLog, *, rollout_id="r-1", turn=0,
                task_id="train-task-1") -> None:
    log.add(rollout_id=rollout_id, turn=turn, task_id=task_id,
            decision_type="tool_selection", state="<state>",
            state_compressor="compress-v1", questions=[_tool_q(), _score_q()])


class TestSchema:
    def test_choice_requires_options(self):
        with pytest.raises(ValueError, match="choice 题必须提供 options"):
            DecisionQuestion(qid="q", type="choice", question="?", options=())

    def test_unknown_type_rejected(self):
        with pytest.raises(ValueError, match="未知题型"):
            DecisionQuestion(qid="q", type="ranking", question="?")

    def test_yes_no_options_fixed(self):
        q = DecisionQuestion(qid="q", type="yes_no", question="继续吗")
        assert q.symbols == ("yes", "no")

    def test_score_symbols(self):
        assert _score_q().symbols == ("0", "1", "2", "3", "4", "5")

    def test_state_compressor_required(self):
        from agenticx.rl.decision import DecisionRecord
        with pytest.raises(ValueError, match="state_compressor 必填"):
            DecisionRecord(decision_id="d", rollout_id="r", turn=0,
                           task_id="t", decision_type="tool_selection",
                           state="s", state_compressor="")

    def test_teacher_label_requires_model(self):
        with pytest.raises(ValueError, match="teacher_model"):
            DecisionLabel(qid="q", source="teacher", probs=(0.5, 0.5))

    def test_label_qid_must_belong(self):
        log = DecisionLog()
        rec = log.records[0] if log.records else None
        log2 = DecisionLog()
        _add_record(log2)
        rec = log2.records[0]
        with pytest.raises(ValueError, match="不属于该决策点"):
            rec.add_label(DecisionLabel(qid="q_ghost", source="execution",
                                        hard="read_file"))


class TestJoinAlignment:
    def test_join_to_token_rollout_turn(self):
        """决策点经 (rollout_id, turn) 能 join 回 SP24 记录层的对应轮。"""
        r = TokenRollout(rollout_id="r-join", model="test")
        s0 = TokenStamp.mint("system", (1, 2))
        u0 = TokenStamp.mint("user", (3,))
        a0 = TokenStamp.mint("assistant", (9,))
        r.add_turn((s0, u0), a0, (-0.1,))
        u1 = TokenStamp.mint("user", (4,))
        r.add_turn((s0, u0, a0, u1), None)

        log = DecisionLog()
        rec = log.add(rollout_id="r-join", turn=1, task_id="train-task-1",
                      decision_type="tool_selection", state="<state>",
                      state_compressor="compress-v1", questions=[_tool_q()])

        turns = r.to_turn_samples()
        assert rec.turn < len(turns)
        assert turns[rec.turn].rollout_id == rec.rollout_id  # join 可解


class TestLabelPriority:
    def test_execution_beats_teacher(self):
        log = DecisionLog()
        _add_record(log)
        rec = log.records[0]
        rec.add_label(DecisionLabel(qid="q_tool", source="teacher",
                                    probs=(0.9, 0.05, 0.05),
                                    teacher_model="t1"))
        rec.add_label(DecisionLabel(qid="q_tool", source="execution",
                                    hard="run_test"))
        best = rec.label_for("q_tool")
        assert best is not None and best.source == "execution"

    def test_self_beats_teacher(self):
        log = DecisionLog()
        _add_record(log)
        rec = log.records[0]
        rec.add_label(DecisionLabel(qid="q_tool", source="teacher",
                                    probs=(0.9, 0.05, 0.05),
                                    teacher_model="t1"))
        rec.add_label(DecisionLabel(qid="q_tool", source="self",
                                    probs=(0.1, 0.8, 0.1)))
        assert rec.label_for("q_tool").source == "self"

    def test_no_label_returns_none(self):
        log = DecisionLog()
        _add_record(log)
        assert log.records[0].label_for("q_tool") is None


class TestOutcomeBackfill:
    def test_backfill_by_rollout_id(self):
        log = DecisionLog()
        _add_record(log, rollout_id="r-a", turn=0)
        _add_record(log, rollout_id="r-a", turn=3)
        _add_record(log, rollout_id="r-b", turn=0)
        n = log.backfill_outcome("r-a", ok=True, task_status="pass")
        assert n == 2
        by_rollout = {r.rollout_id: r for r in log.records}
        assert by_rollout["r-a"].outcome.task_status == "pass"
        assert by_rollout["r-b"].outcome is None


class TestHeldoutGuard:
    def test_heldout_task_rejected(self):
        log = DecisionLog()
        _add_record(log, task_id="exam-task-1")
        with pytest.raises(HeldoutViolation, match="held-out"):
            assert_trainable_decisions(log.records, _FAKE_SPLIT)

    def test_train_task_passes(self):
        log = DecisionLog()
        _add_record(log, task_id="train-task-1")
        assert_trainable_decisions(log.records, _FAKE_SPLIT)  # 不抛即通过

    def test_load_trainable_decisions_guarded(self, tmp_path):
        log = DecisionLog()
        _add_record(log, task_id="exam-task-1")
        p = tmp_path / "decisions.jsonl"
        log.save(p)
        with pytest.raises(HeldoutViolation):
            load_trainable_decisions(p, _FAKE_SPLIT)


class TestSplit:
    def test_rollout_level_isolation(self):
        """同一 rollout 的决策点必须落在同一划分——防校准泄漏。"""
        log = DecisionLog()
        for turn in range(6):
            _add_record(log, rollout_id=f"r-{turn % 3}", turn=turn)
        assign_split(log.records)
        by_rollout: dict[str, set[str]] = {}
        for rec in log.records:
            assert rec.split in ("train", "calib", "test")
            by_rollout.setdefault(rec.rollout_id, set()).add(rec.split)
        assert all(len(v) == 1 for v in by_rollout.values())

    def test_deterministic(self):
        log1, log2 = DecisionLog(), DecisionLog()
        for i in range(5):
            _add_record(log1, rollout_id=f"r-{i}")
            _add_record(log2, rollout_id=f"r-{i}")
        assign_split(log1.records)
        assign_split(log2.records)
        assert [r.split for r in log1.records] == [r.split for r in log2.records]


class TestTeacherBackfill:
    def test_backfill_appends_teacher_label(self):
        log = DecisionLog()
        _add_record(log)
        rec = log.records[0]
        # 已有 execution 真值，teacher 补标不得覆盖
        rec.add_label(DecisionLabel(qid="q_tool", source="execution",
                                    hard="read_file"))

        def scorer(r):
            return {"q_tool": (0.7, 0.2, 0.1), "q_screen": tuple([0.1] * 6)}

        n = backfill_teacher(log.records, scorer, teacher_model="glm-5.3")
        assert n == 2
        assert rec.label_for("q_tool").source == "execution"  # 真值优先
        teacher = [l for l in rec.labels
                   if l.source == "teacher" and l.qid == "q_tool"][0]
        assert teacher.teacher_model == "glm-5.3"
        assert teacher.probs == (0.7, 0.2, 0.1)

    def test_backfill_length_mismatch_rejected(self):
        log = DecisionLog()
        _add_record(log)

        def scorer(r):
            return {"q_tool": (0.5, 0.5)}  # 3 个候选只给 2 个

        with pytest.raises(ValueError, match="不一致"):
            backfill_teacher(log.records, scorer, teacher_model="t")

    def test_backfill_unknown_qid_rejected(self):
        log = DecisionLog()
        _add_record(log)

        def scorer(r):
            return {"q_ghost": (1.0,)}

        with pytest.raises(ValueError, match="未知 qid"):
            backfill_teacher(log.records, scorer, teacher_model="t")

    def test_backfill_idempotent_same_teacher(self):
        """同 teacher_model 重跑不重复补标。"""
        log = DecisionLog()
        _add_record(log)

        def scorer(r):
            return {"q_tool": (0.6, 0.3, 0.1), "q_screen": tuple([1 / 6] * 6)}

        n1 = backfill_teacher(log.records, scorer, teacher_model="t")
        n2 = backfill_teacher(log.records, scorer, teacher_model="t")
        assert (n1, n2) == (2, 0)
        assert len([l for l in log.records[0].labels if l.source == "teacher"]) == 2


class TestJsonlRoundtrip:
    def test_save_load_roundtrip(self, tmp_path):
        log = DecisionLog()
        _add_record(log)
        rec = log.records[0]
        rec.add_label(DecisionLabel(qid="q_tool", source="execution",
                                    hard="run_test"))
        log.backfill_outcome(rec.rollout_id, ok=True, task_status="pass")
        assign_split(log.records)

        p = tmp_path / "decisions.jsonl"
        assert log.save(p) == 1
        loaded = DecisionLog.load(p)
        r2 = loaded.records[0]
        assert r2.decision_id == rec.decision_id
        assert r2.state_compressor == "compress-v1"
        assert r2.questions[0].options == ("read_file", "run_test", "search_code")
        assert r2.questions[0].distractor_source == "neg-v1"
        assert r2.label_for("q_tool").hard == "run_test"
        assert r2.outcome.task_status == "pass"
        assert r2.split == rec.split

    def test_decision_types_cover_v1_inventory(self):
        """v1 决策清单：tool_selection/judge_prescreen 在列。"""
        assert "tool_selection" in DECISION_TYPES
        assert "judge_prescreen" in DECISION_TYPES
