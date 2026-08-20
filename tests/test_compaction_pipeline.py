#!/usr/bin/env python3
"""压缩流水线：0.8 触发、0.16 保留、先剪枝后摘要、摘要重放前缀。

参考 DeepSeek Harness 的分工，但几处按我们自己的形态改了，都在下面各自的用例里写明。
"""

from __future__ import annotations

import json

import pytest

from agenticx.runtime import compaction_journal as cj
from agenticx.runtime.compactor import (
    DEFAULT_COMPACT_TRIGGER_RATIO,
    DEFAULT_RETAIN_SURFACE_RATIO,
    PRUNE_MARKER,
    ContextCompactor,
)


class _Resp:
    def __init__(self, content):
        self.content = content


class _LLM:
    def __init__(self, reply="摘要正文"):
        self.reply = reply
        self.calls: list[dict] = []

    def invoke(self, messages, **kwargs):
        self.calls.append({"messages": list(messages), "kwargs": dict(kwargs)})
        return _Resp(self.reply)


class _Session:
    def __init__(self, session_id="sess-compact"):
        self.session_id = session_id


@pytest.fixture
def rooted(tmp_path, monkeypatch):
    monkeypatch.setattr(cj, "_sessions_root", lambda: tmp_path)
    return tmp_path


def _journal(root, session_id="sess-compact"):
    path = root / session_id / cj.JOURNAL_FILENAME
    if not path.is_file():
        return []
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x]


# --------------------------------------------------------------------------
# 触发与保留：按比例，跨窗口尺寸一致
# --------------------------------------------------------------------------
@pytest.mark.parametrize("window", [128_000, 256_000, 1_000_000])
def test_trigger_is_a_ratio_of_the_routed_window(monkeypatch, window):
    """原来只有"window − reserve − buffer"这条绝对式，128k 上是 0.74、256k 上却到
    0.87、32k 上只有 0.34。比例式跨尺寸一致。"""
    monkeypatch.delenv("AGX_AUTOCOMPACT_PCT", raising=False)
    monkeypatch.delenv("AGX_COMPACT_BUFFER_TOKENS", raising=False)
    monkeypatch.delenv("AGX_COMPACT_SUMMARY_RESERVE_TOKENS", raising=False)
    threshold = ContextCompactor(_LLM())._compute_autocompact_threshold(window)
    assert threshold == int(window * DEFAULT_COMPACT_TRIGGER_RATIO)


def test_small_windows_keep_the_absolute_safety_net(monkeypatch):
    """32k 窗口留 20% 只有 6.4k，不够摘要调用周转，绝对余量仍然更紧。"""
    monkeypatch.delenv("AGX_AUTOCOMPACT_PCT", raising=False)
    threshold = ContextCompactor(_LLM())._compute_autocompact_threshold(32_000)
    assert threshold < int(32_000 * DEFAULT_COMPACT_TRIGGER_RATIO)


def test_config_can_only_make_compaction_earlier(monkeypatch):
    base = ContextCompactor(_LLM())._compute_autocompact_threshold(128_000)
    monkeypatch.setenv("AGX_AUTOCOMPACT_PCT", "0.5")
    tight = ContextCompactor(_LLM())._compute_autocompact_threshold(128_000)
    assert tight < base


def test_retain_budget_is_a_ratio_of_the_window():
    compactor = ContextCompactor(_LLM())
    assert compactor._retained_token_budget(128_000) == int(
        128_000 * DEFAULT_RETAIN_SURFACE_RATIO
    )


def test_retention_counts_tokens_not_messages():
    """8 条纯文本和 8 条塞满工具结果的消息差两个数量级，而窗口压力只认 token。"""
    compactor = ContextCompactor(_LLM())
    thin = [{"role": "user", "content": "短" * 20} for _ in range(200)]
    to_compact, retained = compactor._split_for_compaction(thin, retain_tokens=4_000)
    assert to_compact and retained
    assert compactor._estimate_token_usage(retained) >= 4_000
    # 按条数的老口径只会留 8 条；token 口径下这些短消息该留得多得多。
    assert len(retained) > compactor.retain_recent_messages


def test_retention_never_drops_below_the_message_floor():
    """一条巨大的工具结果就能吃满 token 预算——不设下限的话整段对话上下文就没了。"""
    compactor = ContextCompactor(_LLM())
    fat = [{"role": "user", "content": "x" * 4000} for _ in range(40)]
    _to_compact, retained = compactor._split_for_compaction(fat, retain_tokens=4_000)
    assert len(retained) == compactor.retain_recent_messages


def test_retention_falls_back_to_counting_when_history_is_small():
    """条数/字符/force 触发时历史可能远小于保留预算——那时按 token 保留会变成
    "什么都不压"，决定了要压就得真的压掉点什么。"""
    compactor = ContextCompactor(_LLM())
    tiny = [{"role": "user", "content": "hi"} for _ in range(30)]
    to_compact, retained = compactor._split_for_compaction(tiny, retain_tokens=20_000)
    assert to_compact
    assert len(retained) == compactor.retain_recent_messages


# --------------------------------------------------------------------------
# 剪枝优先
# --------------------------------------------------------------------------
def test_prune_threshold_is_tighter_than_the_ingest_budget():
    """micro_compact_tool_result 入库时已经截到 4000 字符，照搬 dsh 的 8192 阈值会
    一条都命中不了、白跑一趟。"""
    from agenticx.runtime.compactor import DEFAULT_PRUNE_THRESHOLD_CHARS

    assert DEFAULT_PRUNE_THRESHOLD_CHARS < 4_000


def test_prune_walks_oldest_first_and_stops_when_pressure_clears():
    """保留的尾巴是按 token 算的连续区间，把最近那几条工具结果也剪掉等于自己削自己
    的近期上下文。所以从旧的开始剪，够了就停。"""
    compactor = ContextCompactor(_LLM())
    rows = [
        {"role": "tool", "name": "bash_exec", "content": f"{i}" + "y" * 6000}
        for i in range(6)
    ]
    target = compactor._estimate_token_usage(rows) - 2_000
    out, pruned, _chars = compactor.prune_tool_results(rows, target_tokens=target)
    assert 0 < pruned < len(rows)
    # 被剪的是靠前的，最近的原样留着。
    assert PRUNE_MARKER in out[0]["content"]
    assert PRUNE_MARKER not in out[-1]["content"]


def test_prune_leaves_structured_payloads_alone():
    """截断 stock_chart JSON 不是"内容变少"，是渲染直接坏掉。"""
    compactor = ContextCompactor(_LLM())
    rows = [{"role": "tool", "name": "show_widget", "content": "z" * 9000}]
    _out, pruned, _ = compactor.prune_tool_results(rows)
    assert pruned == 0


def test_prune_is_idempotent():
    compactor = ContextCompactor(_LLM())
    rows = [{"role": "tool", "name": "bash_exec", "content": "y" * 9000}]
    once, n1, _ = compactor.prune_tool_results(rows)
    _twice, n2, _ = compactor.prune_tool_results(once)
    assert n1 == 1 and n2 == 0


@pytest.mark.asyncio
async def test_pruning_alone_skips_the_summary_call(rooted):
    """摘要要花一次 LLM 调用，而且正好花在上下文最大的时候——能不花就别花。"""
    llm = _LLM()
    compactor = ContextCompactor(llm)
    # 一堆过大的工具结果：剪完就能降到阈值以下。
    history = [{"role": "user", "content": "开始"}]
    for i in range(30):
        history.append({"role": "assistant", "content": "", "tool_calls": [{"id": str(i)}]})
        history.append({"role": "tool", "name": "bash_exec", "content": "y" * 9000})
    out, did, summary, count, _ = await compactor.maybe_compact(
        history, model="glm-5", session=_Session()
    )
    assert did is True
    assert count == 0 and llm.calls == []       # 一次模型调用都没花
    assert "剪除" in summary
    assert compactor.last_trigger_reason == "tool_result_prune"
    events = _journal(rooted)
    assert events[-1]["outcome"] == "pruned" and events[-1]["pruned_messages"] > 0


# --------------------------------------------------------------------------
# 摘要重放前缀
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_summary_replays_the_session_prefix(rooted):
    """原来是另起一个单条 user prompt —— 前缀和真实请求完全不同，于是在上下文最大的
    那一刻必然全量重算。被遮蔽区间本来就是真实对话的前缀，原样重放就能命中缓存。"""
    llm = _LLM()
    compactor = ContextCompactor(llm)
    # 被遮蔽区间要放得进窗口，重放才成立——放不下时会（正确地）回落，另有用例覆盖。
    history = [{"role": "user", "content": f"第 {i} 轮" + "字" * 1200} for i in range(120)]
    tools = [{"type": "function", "function": {"name": "bash_exec"}}]
    out, did, _summary, count, _ = await compactor.maybe_compact(
        history,
        model="glm-5",
        session=_Session(),
        system_prompt="我是系统提示词",
        tools=tools,
    )
    assert did is True and count > 0
    assert len(llm.calls) == 1
    sent = llm.calls[0]["messages"]
    assert sent[0] == {"role": "system", "content": "我是系统提示词"}
    # 被遮蔽区间原样在请求里，而不是被序列化进一个大字符串。
    assert sent[1]["content"] == history[0]["content"]
    # 指令是最后一条 user。
    assert sent[-1]["role"] == "user" and "请压缩本次对话中位于本条指令之前" in sent[-1]["content"]
    # 工具表也要带上：它是热前缀的一部分。
    assert llm.calls[0]["kwargs"]["tools"] == tools
    assert compactor.last_summary_replayed_prefix is True


@pytest.mark.asyncio
async def test_summary_falls_back_when_the_replay_would_not_fit(rooted):
    """provider 已经报了 overflow 才强制压缩时，缓存已经无所谓了，算得出摘要才要紧。"""
    llm = _LLM()
    compactor = ContextCompactor(llm)
    history = [{"role": "user", "content": "x" * 20_000} for _ in range(40)]
    await compactor.maybe_compact(
        history,
        force=True,
        model="glm-5",
        declared_context_window=8_000,
        session=_Session(),
        system_prompt="S",
    )
    assert compactor.last_summary_replayed_prefix is False
    assert [m["role"] for m in llm.calls[0]["messages"]] == ["user"]


@pytest.mark.asyncio
async def test_provider_without_tools_kwarg_still_summarizes(rooted):
    """宁可丢掉缓存对齐，也不能让摘要整个失败。"""

    class _Picky(_LLM):
        def invoke(self, messages, **kwargs):
            if "tools" in kwargs:
                raise TypeError("invoke() got an unexpected keyword argument 'tools'")
            return super().invoke(messages, **kwargs)

    llm = _Picky()
    compactor = ContextCompactor(llm)
    history = [{"role": "user", "content": f"第 {i} 轮" + "字" * 3000} for i in range(80)]
    _out, did, _s, count, _ = await compactor.maybe_compact(
        history,
        model="glm-5",
        session=_Session(),
        system_prompt="S",
        tools=[{"type": "function", "function": {"name": "t"}}],
    )
    assert did is True and count > 0 and len(llm.calls) == 1


# --------------------------------------------------------------------------
# 括起来，锁最后释放
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_compaction_is_bracketed_and_releases_the_lock_last(rooted):
    compactor = ContextCompactor(_LLM())
    session = _Session()
    history = [{"role": "user", "content": f"第 {i} 轮" + "字" * 3000} for i in range(80)]
    await compactor.maybe_compact(history, model="glm-5", session=session, system_prompt="S")
    events = _journal(rooted)
    assert [e["event"] for e in events] == [cj.EVENT_START, cj.EVENT_END]
    assert events[1]["outcome"] == "summarized" and events[1]["compacted_count"] > 0
    assert cj.detect_orphan(session) is None


@pytest.mark.asyncio
async def test_a_failing_summary_still_closes_the_bracket(rooted, monkeypatch):
    """崩在中间留下的必须是可检测的孤儿锁，而不是一句"已完成"的谎。"""
    compactor = ContextCompactor(_LLM())
    session = _Session()

    async def _boom(*_a, **_k):
        raise RuntimeError("provider down")

    monkeypatch.setattr(compactor, "_summarize", _boom)
    history = [{"role": "user", "content": f"第 {i} 轮" + "字" * 3000} for i in range(80)]
    with pytest.raises(RuntimeError):
        await compactor.maybe_compact(history, model="glm-5", session=session, system_prompt="S")
    events = _journal(rooted)
    assert events[-1]["event"] == cj.EVENT_END and events[-1]["outcome"] == "failed"
    assert cj.detect_orphan(session) is None


@pytest.mark.asyncio
async def test_no_lock_is_taken_when_nothing_qualifies(rooted):
    """没到阈值就不该在磁盘上留下任何痕迹。"""
    compactor = ContextCompactor(_LLM())
    session = _Session()
    _out, did, *_ = await compactor.maybe_compact(
        [{"role": "user", "content": "hi"}], model="glm-5", session=session
    )
    assert did is False
    assert _journal(rooted) == []
    assert cj.detect_orphan(session) is None
