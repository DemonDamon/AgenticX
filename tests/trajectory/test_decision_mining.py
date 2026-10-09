# tests/trajectory/test_decision_mining.py
"""SP25 决策点挖掘测试：tool_selection 提取 / state 纯函数压缩 /
候选集构建 / execution 真值 / outcome 回填衔接。"""
from __future__ import annotations

from agenticx.learning.trajectory.decision_mining import (
    compress_state,
    mine_tool_decisions,
    state_compressor_version,
)
from agenticx.rl.decision import DecisionLog

_MSGS = [
    {"role": "user", "content": "solve the task"},
    {"role": "assistant", "content": "", "tool_calls": [
        {"id": "1", "type": "function",
         "function": {"name": "read_file", "arguments": '{"path": "a"}'}}]},
    {"role": "tool", "content": "ok: file content"},
    {"role": "assistant", "content": "", "tool_calls": [
        {"id": "2", "type": "function",
         "function": {"name": "run_test", "arguments": "{}"}},
        {"id": "3", "type": "function",
         "function": {"name": "search_code", "arguments": "{}"}}]},
    {"role": "tool", "content": "error: command failed"},
    {"role": "assistant", "content": "final answer"},
]


def _tc(name: str, cid: str) -> dict:
    return {"id": cid, "type": "function",
            "function": {"name": name, "arguments": "{}"}}


def test_mine_counts_and_turn_alignment():
    log = DecisionLog()
    n = mine_tool_decisions(log, _MSGS, rollout_id="r-1", task_id="t-1")
    assert n == 2  # 两条含 tool_calls 的 assistant 消息
    turns = [r.turn for r in log.records]
    assert turns == [1, 3]  # turn = 消息索引，join 回轨迹


def test_execution_labels_and_vocab():
    log = DecisionLog()
    mine_tool_decisions(log, _MSGS, rollout_id="r-1", task_id="t-1")
    first, second = log.records
    q = first.questions[0]
    assert q.qid == "q_tool"
    assert first.label_for("q_tool").hard == "read_file"
    # 候选集 = 全轨迹观测到的工具（后续消息的工具也在 vocab）
    assert set(q.options) == {"read_file", "run_test", "search_code"}
    assert q.distractor_source == "trace-observed-v1"
    # 多调用消息：q_tool_0/q_tool_1 共享同一 state
    assert [x.qid for x in second.questions] == ["q_tool_0", "q_tool_1"]
    assert second.label_for("q_tool_0").hard == "run_test"
    assert second.label_for("q_tool_1").hard == "search_code"


def test_state_pure_function_and_version():
    log = DecisionLog()
    mine_tool_decisions(log, _MSGS, rollout_id="r-1", task_id="t-1")
    rec = log.records[0]
    # state 只含决策点之前的前缀消息，且为确定性纯函数
    assert rec.state == compress_state(_MSGS, 1)
    assert rec.state_compressor == state_compressor_version()
    assert rec.state_compressor == "msg-tail-1200-v1"
    assert "solve the task" in rec.state
    # 后缀截断生效（msg-tail-N）
    short = compress_state(_MSGS, 4, state_chars=30)
    assert len(short) == 30


def test_no_tool_calls_returns_zero():
    log = DecisionLog()
    msgs = [{"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"}]
    assert mine_tool_decisions(log, msgs, rollout_id="r", task_id="t") == 0
    assert mine_tool_decisions(log, [], rollout_id="r", task_id="t") == 0


def test_extra_options_enrich_vocab():
    log = DecisionLog()
    msgs = [{"role": "user", "content": "go"},
            {"role": "assistant", "tool_calls": [_tc("read_file", "1")]}]
    mine_tool_decisions(log, msgs, rollout_id="r", task_id="t",
                        extra_options=("submit_patch",))
    assert set(log.records[0].questions[0].options) == {
        "read_file", "submit_patch"}


def test_outcome_backfill_after_mining():
    """挖掘 + 终局回填衔接：决策好坏由 trial 终态定义。"""
    log = DecisionLog()
    mine_tool_decisions(log, _MSGS, rollout_id="r-1", task_id="t-1")
    n = log.backfill_outcome("r-1", task_status="fail")
    assert n == 2
    assert all(r.outcome.task_status == "fail" for r in log.records)


def test_join_key_convention():
    """rollout_id 用 trial session 名——与 RSITrajectory.session_id 同源。"""
    log = DecisionLog()
    mine_tool_decisions(log, _MSGS, rollout_id="taskA__dry1_42", task_id="taskA")
    assert log.records[0].rollout_id == "taskA__dry1_42"


# ---------- SP29d: error_classification ----------

from agenticx.learning.trajectory.decision_mining import (  # noqa: E402
    ERROR_OPTIONS, error_action, mine_error_decisions)

_ERR_MSGS = [
    {"role": "user", "content": "fix the build"},
    {"role": "assistant", "content": "", "tool_calls": [_tc("bash", "1")]},
    {"role": "tool", "content": "error: AssertionError: expected 1 got 2"},
    {"role": "assistant", "content": "", "tool_calls": [_tc("bash", "2")]},
    {"role": "tool", "content": "error: ConnectionTimeout to registry"},
    {"role": "assistant", "content": "", "tool_calls": [_tc("bash", "3")]},
    {"role": "tool", "content": "error: something odd happened here"},
    {"role": "tool", "content": "ok: normal result"},          # 非 error
    {"role": "assistant", "content": "done"},
]


def test_error_action_rule_mapping():
    assert error_action("error: AssertionError: expected 1") == "abort"
    assert error_action("error: ConnectionTimeout to host") == "retry"
    assert error_action("error: something odd") == "backoff"
    assert error_action("ok: fine") == ""            # 非 error → 空串


def test_mine_error_decisions_points_and_labels():
    log = DecisionLog()
    n = mine_error_decisions(log, _ERR_MSGS, rollout_id="r-1", task_id="t-1")
    assert n == 3                                   # 3 条 error tool result
    recs = log.records
    assert [r.turn for r in recs] == [2, 4, 6]      # error 消息索引
    assert all(r.decision_type == "error_classification" for r in recs)
    assert all(r.questions[0].options == ERROR_OPTIONS for r in recs)
    # 规则真值（execution 硬标签）
    assert [r.label_for("q_err").hard for r in recs] == \
        ["abort", "retry", "backoff"]
    # state 压缩与 tool_selection 同版本（纯函数，msg-tail）
    assert recs[0].state_compressor == state_compressor_version()


def test_mine_error_decisions_zero_on_clean():
    log = DecisionLog()
    clean = [m for m in _ERR_MSGS if "error" not in str(m.get("content"))[:5]]
    assert mine_error_decisions(log, clean, rollout_id="r", task_id="t") == 0
    assert mine_error_decisions(log, [], rollout_id="r", task_id="t") == 0


def test_error_and_tool_selection_coexist():
    """两种决策类型同一 log 共存（各自 decision_type/join 语义独立）。"""
    log = DecisionLog()
    mine_tool_decisions(log, _ERR_MSGS, rollout_id="r-1", task_id="t-1")
    mine_error_decisions(log, _ERR_MSGS, rollout_id="r-1", task_id="t-1")
    types = {r.decision_type for r in log.records}
    assert types == {"tool_selection", "error_classification"}
    # 同 turn 允许共存（不同决策点的视角不同）
    assert sum(1 for r in log.records if r.turn == 2) == 1
