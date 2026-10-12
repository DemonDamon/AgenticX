# tests/rl/test_decision_scorers.py
"""SP26 决策头 scorer 库测试。

覆盖: mock 确定性 / v1 prompt 模板 pin / 字母位与数字键映射 / 候选上限 /
受限 softmax 归一与 -30 兜底 / fake client 端到端 / 工厂标识。
"""
from __future__ import annotations

import math
from types import SimpleNamespace

import pytest

from agenticx.rl.decision import DecisionLabel, DecisionLog, DecisionQuestion
from agenticx.rl.decision_scorers import (
    _MISS_LOGPROB,
    _systemone_spec,
    OpenAICompatScorer,
    SystemOneScorer,
    build_prompt,
    candidate_keys,
    make_scorer,
    mock_scorer,
    probs_from_logprobs,
)


def _rec():
    log = DecisionLog()
    q = DecisionQuestion(qid="q_tool", type="choice", question="下一步调用哪个工具",
                         options=("read_file", "run_test", "search_code"))
    rec = log.add(rollout_id="r-1", turn=1, task_id="t-1",
                  decision_type="tool_selection", state="user:帮我读文件",
                  state_compressor="msg-tail-1200-v1", questions=[q])
    rec.add_label(DecisionLabel(qid="q_tool", source="execution", hard="read_file"))
    return rec


class TestMockScorer:
    def test_deterministic(self):
        r = _rec()
        assert mock_scorer(r) == mock_scorer(r)

    def test_normalized_and_aligned(self):
        probs = mock_scorer(_rec())["q_tool"]
        assert len(probs) == 3
        assert math.isclose(sum(probs), 1.0, rel_tol=1e-9)

    def test_matches_sp25_script_semantics(self):
        # sha256 决策 id|qid|symbol 前 4 hex 加权 /4096 softmax——抽查首值
        import hashlib
        r = _rec()
        probs = mock_scorer(r)["q_tool"]
        ws = [int(hashlib.sha256(f"{r.decision_id}|q_tool|{s}".encode())
                  .hexdigest()[:4], 16) for s in r.questions[0].symbols]
        m = max(ws)
        exps = [math.exp((w - m) / 4096.0) for w in ws]
        assert math.isclose(probs[0], exps[0] / sum(exps), rel_tol=1e-12)


class TestPromptV1:
    """v1 模板 pin——换版即换数据集，任何改动都必须显式升版本。"""

    def test_choice_prompt_pinned(self):
        q = DecisionQuestion(qid="q", type="choice", question="下一步调用哪个工具",
                             options=("read_file", "run_test"))
        assert build_prompt("<S>", q) == (
            "给定状态与问题，从候选中选择最可能正确的选项。"
            "只输出选项字母，不要解释。\n\n"
            "状态:\n<S>\n\n问题: 下一步调用哪个工具\n候选:\n"
            "A. read_file\nB. run_test\n答案:")

    def test_score_prompt_pinned(self):
        q = DecisionQuestion(qid="q", type="score", question="输出质量打分")
        assert build_prompt("<S>", q) == (
            "给定状态与问题，给出 0-5 分评分。只输出一个数字，不要解释。\n\n"
            "状态:\n<S>\n\n问题: 输出质量打分\n候选:\n0\n1\n2\n3\n4\n5\n答案:")

    def test_yes_no_renders_letters(self):
        q = DecisionQuestion(qid="q", type="yes_no", question="继续吗")
        assert "A. yes\nB. no" in build_prompt("<S>", q)

    def test_candidate_keys(self):
        assert candidate_keys(DecisionQuestion(
            qid="q", type="choice", question="?", options=("a", "b", "c"))) == ("A", "B", "C")
        assert candidate_keys(DecisionQuestion(
            qid="q", type="yes_no", question="?")) == ("A", "B")
        assert candidate_keys(DecisionQuestion(
            qid="q", type="score", question="?")) == ("0", "1", "2", "3", "4", "5")

    def test_option_cap_explicit(self):
        with pytest.raises(ValueError, match="候选上限"):
            candidate_keys(DecisionQuestion(
                qid="q", type="choice", question="?",
                options=tuple(f"tool_{i}" for i in range(9))))


class TestRestrictedSoftmax:
    def test_missing_candidate_near_zero(self):
        q = DecisionQuestion(qid="q", type="choice", question="?",
                             options=("a", "b", "c"))
        probs = probs_from_logprobs(q, {"A": -0.2, "B": -1.3})
        assert math.isclose(probs[0] + probs[1] + probs[2], 1.0, rel_tol=1e-9)
        assert probs[2] < 1e-9          # C 未命中 → -30 兜底
        assert probs[0] > probs[1] > probs[2]
        expected = math.exp(-0.2) / (math.exp(-0.2) + math.exp(-1.3) + math.exp(_MISS_LOGPROB))
        assert math.isclose(probs[0], expected, rel_tol=1e-9)

    def test_token_whitespace_stripped(self):
        # strip 发生在 OpenAICompatScorer（token 归一），fake client 走真实路径
        from agenticx.rl.decision import DecisionQuestion as Q
        q = Q(qid="q", type="score", question="?")
        log = DecisionLog()
        rec = log.add(rollout_id="r", turn=0, task_id="t",
                      decision_type="judge_prescreen", state="s",
                      state_compressor="c-v1", questions=[q])
        client, _ = _fake_client([(" 3", -0.5)])
        probs = OpenAICompatScorer(model="m", client=client)(rec)["q"]
        assert probs[3] > 0.99


def _fake_client(top: list[tuple[str, float]]):
    resp = SimpleNamespace(choices=[SimpleNamespace(
        logprobs=SimpleNamespace(content=[SimpleNamespace(
            top_logprobs=[SimpleNamespace(token=t, logprob=lp) for t, lp in top])]))])
    calls = []

    class _Completions:
        def create(self, **kwargs):
            calls.append(kwargs)
            return resp

    class _Client:
        chat = SimpleNamespace(completions=_Completions())
    return _Client(), calls


class TestOpenAICompatScorer:
    def test_end_to_end_with_fake_client(self):
        r = _rec()
        client, calls = _fake_client([("A", -0.1), ("B", -2.0)])
        scorer = OpenAICompatScorer(model="m", client=client, temperature=0.0)
        probs = scorer(r)["q_tool"]
        assert math.isclose(sum(probs), 1.0, rel_tol=1e-9)
        assert probs[0] > 0.8
        # 请求侧：单 token + logprobs + v1 prompt
        kw = calls[0]
        assert kw["max_tokens"] == 1 and kw["logprobs"] is True
        assert kw["top_logprobs"] == 20 and kw["model"] == "m"
        assert "A. read_file" in kw["messages"][0]["content"]
        assert "帮我读文件" in kw["messages"][0]["content"]  # state 进 prompt

    def test_one_call_per_record_question(self):
        r = _rec()
        client, calls = _fake_client([("A", -0.1)])
        scorer = OpenAICompatScorer(model="m", client=client)
        scorer(r)
        assert len(calls) == len(r.questions)


class TestSystemOne:
    """官方 /v1/systemone 协议适配器（fake transport）。"""

    @staticmethod
    def _fake_transport(responses):
        calls = []

        def transport(url, payload):
            calls.append((url, payload))
            return {"answers": responses(payload)}
        return transport, calls

    def _rec(self, questions):
        log = DecisionLog()
        return log.add(rollout_id="r", turn=0, task_id="t",
                       decision_type="tool_selection", state="user:读配置文件",
                       state_compressor="c-v1", questions=questions)

    def test_choice_spec_and_probs(self):
        q = DecisionQuestion(qid="q1", type="choice", question="下一步调用哪个工具",
                             options=("read_file", "run_test"))
        rec = self._rec([q])

        def resp(payload):
            assert payload["state"] == "user:读配置文件"
            spec = payload["questions"]["q1"]
            assert spec["type"] == "choice"
            assert list(spec["criteria"]) == ["read_file", "run_test"]
            assert spec["instructions"] == "下一步调用哪个工具"
            return {"q1": {"type": "choice", "choice": "read_file",
                           "probabilities": {"read_file": 0.8, "run_test": 0.2}}}
        transport, _ = self._fake_transport(resp)
        scorer = SystemOneScorer(transport=transport)
        probs = scorer(rec)["q1"]
        assert probs == (0.8, 0.2)

    def test_noul_maps_yes_no(self):
        q = DecisionQuestion(qid="q", type="yes_no", question="继续吗")
        rec = self._rec([q])
        transport, calls = self._fake_transport(
            lambda p: {"q": {"type": "noul", "noul": 0.3}})
        probs = SystemOneScorer(transport=transport)(rec)["q"]
        assert probs == (0.3, 0.7)      # (yes, no)
        assert calls[0][1]["questions"]["q"]["type"] == "noul"

    def test_score_levels(self):
        q = DecisionQuestion(qid="q", type="score", question="打分")
        rec = self._rec([q])
        transport, calls = self._fake_transport(
            lambda p: {"q": {"type": "score", "score": 2.0,
                             "probabilities": {str(i): 0.1 * (i + 1) for i in range(6)}}})
        probs = SystemOneScorer(transport=transport)(rec)["q"]
        assert len(probs) == 6 and abs(sum(probs) - 2.1) < 1e-9
        assert len(calls[0][1]["questions"]["q"]["criteria"]) == 6

    def test_score_levels_cap(self):
        with pytest.raises(ValueError, match="score 档数"):
            _systemone_spec(DecisionQuestion(
                qid="q", type="score", question="?", scale=(0, 12)))


class TestFactory:
    def test_mock_identity(self):
        scorer, tid = make_scorer("mock")
        assert tid == "mock-v1"
        assert callable(scorer)

    def test_openai_requires_model(self):
        with pytest.raises(ValueError, match="需要 model"):
            make_scorer("openai")

    def test_startlux_uses_systemone(self):
        scorer, tid = make_scorer("startlux", transport=object())
        assert tid == "startlux:StartLux-Decision-4B-Q4_K_M:systemone"
        assert isinstance(scorer, SystemOneScorer)

    def test_startlux_model_override(self):
        _, tid = make_scorer("startlux", model="StartLux-Decision-0.8B-Q8_0",
                             transport=object())
        assert "0.8B-Q8_0" in tid

    def test_unknown(self):
        with pytest.raises(ValueError, match="未知 scorer"):
            make_scorer("nope")
