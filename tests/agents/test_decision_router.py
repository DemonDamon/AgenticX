# tests/agents/test_decision_router.py
"""SP27 DecisionRouter 测试：阈值/升级/降级/fail-open/遥测 +
ReActAgent decision_gate 接入（observe/nudge/关闭等价性）。

验收（sp27 plan T1/T2）：
- flag off：不产生新调用路径（scorer 零调用、消息序列与无门 agent 一致）
- fail-open：scorer 异常 → pass + degraded，agent 运行不受影响
- nudge 注入：仅错配且高置信，且在工具结果落盘后（只影响下一轮）
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import pytest

from agenticx.agents import ReActAgent, ReActResult
from agenticx.agents.decision_router import DecisionRouter, NUDGE, PASS
from agenticx.llms.base import BaseLLMProvider
from agenticx.llms.response import LLMChoice, LLMResponse, TokenUsage
from agenticx.tools.base import BaseTool

SYM = ("bash", "search", "edit")


# --------------------------------------------------------------------------- #
# 测试替身
# --------------------------------------------------------------------------- #

def _scorer(probs_by_len: Dict[int, tuple] | Exception):
    """按候选数返回固定分布：{2: (0.9, 0.1), ...}；Exception 则抛出。"""
    calls: List[Any] = []

    def scorer(rec):
        calls.append(rec)
        if isinstance(probs_by_len, Exception):
            raise probs_by_len
        q = rec.questions[0]
        return {q.qid: probs_by_len[len(q.symbols)]}
    scorer.calls = calls
    return scorer


class EchoTool(BaseTool):
    def __init__(self):
        super().__init__(name="echo", description="Echo text.")

    def _run(self, **kwargs):
        return f"echoed:{kwargs.get('text', '')}"


class SearchTool(BaseTool):
    def __init__(self):
        super().__init__(name="search", description="Search.")

    def _run(self, **kwargs):
        return "results"


class MockFCProvider(BaseLLMProvider):
    """脚本化 FC provider：逐条返回预置响应（对齐 smoke 测试模式）。"""

    model: str = "mock-fc"

    def __init__(self, responses: List[LLMResponse], **data: Any):
        super().__init__(**data)
        object.__setattr__(self, "_responses", list(responses))
        object.__setattr__(self, "_calls", 0)

    async def ainvoke(self, prompt, tools=None, **kwargs) -> LLMResponse:
        idx = object.__getattribute__(self, "_calls")
        object.__setattr__(self, "_calls", idx + 1)
        rs = object.__getattribute__(self, "_responses")
        return rs[idx] if idx < len(rs) else LLMResponse(
            id="fallback", model_name=self.model, created=0,
            content="fallback", choices=[LLMChoice(index=0, content="fallback")],
            token_usage=TokenUsage())

    def invoke(self, prompt, **kwargs):  # type: ignore[override]
        raise NotImplementedError

    def stream(self, prompt, **kwargs):  # type: ignore[override]
        raise NotImplementedError

    async def astream(self, prompt, **kwargs):  # type: ignore[override]
        raise NotImplementedError


def _tc(name: str, tc_id: str = "c1") -> Dict[str, Any]:
    return {"id": tc_id, "type": "function",
            "function": {"name": name, "arguments": "{}"}}


def _tool_call_resp(name: str, rid: str) -> LLMResponse:
    return LLMResponse(id=rid, model_name="mock", created=0, content="",
                       choices=[], token_usage=TokenUsage(),
                       tool_calls=[_tc(name, rid)])


def _final_resp(text: str = "done") -> LLMResponse:
    return LLMResponse(id="f", model_name="mock", created=0, content=text,
                       choices=[LLMChoice(index=0, content=text)],
                       token_usage=TokenUsage())


def _run(agent: ReActAgent, query: str) -> ReActResult:
    return asyncio.run(agent.arun(query))


def _agent(llm, gate=None, tools=None) -> ReActAgent:
    return ReActAgent(llm=llm, tools=tools or [EchoTool(), SearchTool()],
                      system_prompt="T.", max_iterations=5, decision_gate=gate)


# --------------------------------------------------------------------------- #
# T1 单元：DecisionRouter
# --------------------------------------------------------------------------- #

class TestRouter:
    def test_agree_high_conf_passes(self):
        r = DecisionRouter(_scorer({3: (0.05, 0.90, 0.05)}))
        v = r.check("state", expected="search", symbols=SYM)
        assert v.action == PASS and v.argmax == "search" and not v.degraded

    def test_mismatch_high_conf_nudges(self):
        r = DecisionRouter(_scorer({3: (0.95, 0.03, 0.02)}), tau_high=0.8)
        v = r.check("state", expected="search", symbols=SYM)
        assert v.action == NUDGE and v.argmax == "bash" and v.confidence >= 0.8

    def test_mismatch_low_conf_passes(self):
        r = DecisionRouter(_scorer({3: (0.5, 0.3, 0.2)}), tau_high=0.8)
        v = r.check("state", expected="search", symbols=SYM)
        assert v.action == PASS and v.confidence < r.tau_high

    def test_degenerate_single_option_passes(self):
        r = DecisionRouter(_scorer({}))
        v = r.check("state", expected="bash", symbols=("bash",))
        assert v.action == PASS and "degenerate" in v.reason
        assert len(r.telemetry) == 1 and r.telemetry[0]["n_options"] == 1

    def test_scorer_error_fail_open(self):
        r = DecisionRouter(_scorer(RuntimeError("boom")))
        v = r.check("state", expected="bash", symbols=SYM)
        assert v.action == PASS and v.degraded and r.n_degraded == 1

    def test_telemetry_row_complete(self):
        r = DecisionRouter(_scorer({3: (0.9, 0.05, 0.05)}))
        r.check("state", expected="search", symbols=SYM)
        row = r.telemetry[0]
        assert set(row) >= {"decision_id", "decision_type", "expected", "argmax",
                            "confidence", "action", "degraded", "latency_ms",
                            "reason", "n_options"}
        assert row["decision_type"] == "tool_selection"
        assert row["latency_ms"] >= 0.0

    def test_dump_writes_jsonl(self, tmp_path: Path):
        r = DecisionRouter(_scorer({3: (0.9, 0.05, 0.05)}))
        r.check("state", expected="search", symbols=SYM)
        out = tmp_path / "tel" / "gate.jsonl"
        assert r.dump(out) == 1
        rows = [json.loads(l) for l in out.read_text().splitlines()]
        assert rows[0]["expected"] == "search"

    def test_nudge_message_mentions_both(self):
        r = DecisionRouter(_scorer({3: (0.95, 0.03, 0.02)}))
        v = r.check("state", expected="search", symbols=SYM)
        msg = r.nudge_message(v)
        assert "search" in msg and "bash" in msg and "decision-gate" in msg


# --------------------------------------------------------------------------- #
# T2 集成：ReActAgent decision_gate
# --------------------------------------------------------------------------- #

def _patch_scorer(monkeypatch, scorer):
    """让 agent 懒构造 router 时拿到受控 scorer。"""
    import agenticx.rl.decision_scorers as ds
    monkeypatch.setattr(ds, "make_scorer", lambda *a, **k: (scorer, "fake-v1"))


class TestAgentGate:
    def test_gate_off_is_byte_equivalent(self):
        """无门 vs gate=None：消息序列完全一致（现状等价红线）。"""
        resp = [_tool_call_resp("echo", "1"), _final_resp()]
        r1 = _run(_agent(MockFCProvider(list(resp))), "q")
        r2 = _run(_agent(MockFCProvider(list(resp)), gate=None), "q")
        assert r1.messages == r2.messages
        assert r1.output == r2.output == "done"

    def test_observe_never_injects_but_records(self, monkeypatch):
        spy = _scorer({2: (0.95, 0.05)})   # 无论分布如何
        _patch_scorer(monkeypatch, spy)
        gate = {"mode": "observe", "scorer": "mock"}
        resp = [_tool_call_resp("echo", "1"), _final_resp()]
        result = _run(_agent(MockFCProvider(list(resp)), gate=gate), "q")
        assert result.success
        assert not any(m.get("role") == "system" and
                       "[decision-gate]" in str(m.get("content"))
                       for m in result.messages)
        assert len(spy.calls) == 1          # 一次工具选择 → 一次校验

    def test_nudge_injected_after_tool_result(self, monkeypatch):
        # echo 被选，决策头强置信偏 search（错配且 ≥tau）→ nudge
        _patch_scorer(monkeypatch, _scorer({2: (0.05, 0.95)}))
        gate = {"mode": "nudge", "scorer": "mock", "tau_high": 0.8}
        resp = [_tool_call_resp("echo", "1"), _final_resp()]
        result = _run(_agent(MockFCProvider(list(resp)), gate=gate), "q")
        sys_msgs = [i for i, m in enumerate(result.messages)
                    if m.get("role") == "system" and
                    "[decision-gate]" in str(m.get("content"))]
        assert len(sys_msgs) == 1
        # 注入位置：tool 结果之后（下一轮可见，本轮已执行）
        prev = result.messages[sys_msgs[0] - 1]
        assert prev.get("role") == "tool"

    def test_nudge_agree_no_injection(self, monkeypatch):
        _patch_scorer(monkeypatch, _scorer({2: (0.95, 0.05)}))
        gate = {"mode": "nudge", "scorer": "mock", "tau_high": 0.8}
        resp = [_tool_call_resp("echo", "1"), _final_resp()]
        result = _run(_agent(MockFCProvider(list(resp)), gate=gate), "q")
        assert not any("[decision-gate]" in str(m.get("content", ""))
                       for m in result.messages)

    def test_unknown_tool_skipped(self, monkeypatch):
        spy = _scorer({2: (0.95, 0.05)})
        _patch_scorer(monkeypatch, spy)
        gate = {"mode": "nudge", "scorer": "mock"}
        resp = [_tool_call_resp("ghost", "1"), _final_resp()]  # 未注册工具
        result = _run(_agent(MockFCProvider(list(resp)), gate=gate), "q")
        assert result.success
        assert len(spy.calls) == 0           # expected 不在 symbols：不误报

    def test_scorer_crash_fail_open(self, monkeypatch):
        _patch_scorer(monkeypatch, _scorer(RuntimeError("network")))
        gate = {"mode": "nudge", "scorer": "mock"}
        resp = [_tool_call_resp("echo", "1"), _final_resp()]
        result = _run(_agent(MockFCProvider(list(resp)), gate=gate), "q")
        assert result.success and result.output == "done"
        assert not any("[decision-gate]" in str(m.get("content", ""))
                       for m in result.messages)

    def test_telemetry_dumped_to_out(self, monkeypatch, tmp_path: Path):
        _patch_scorer(monkeypatch, _scorer({2: (0.95, 0.05)}))
        out = tmp_path / "gate.jsonl"
        gate = {"mode": "observe", "scorer": "mock", "out": str(out)}
        resp = [_tool_call_resp("echo", "1"), _final_resp()]
        _run(_agent(MockFCProvider(list(resp)), gate=gate), "q")
        assert out.exists()
        rows = [json.loads(l) for l in out.read_text().splitlines()]
        assert len(rows) == 1 and rows[0]["expected"] == "echo"
        assert rows[0]["action"] in (PASS, NUDGE)
