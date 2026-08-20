#!/usr/bin/env python3
"""Guards for the prompt/tool token diet.

每一条都对应一个实测到的浪费，注释里记着当时的数字，将来回退了看得见。
"""

from __future__ import annotations

import json
import time

import pytest

from agenticx.cli.agent_tools import STUDIO_TOOLS, studio_tools_for_session
from agenticx.runtime import AgentRuntime, ConfirmGate
from agenticx.runtime.prompts.current_time import (
    build_current_time_block,
    build_current_time_reminder,
    get_current_time_facts,
)
from agenticx.runtime.prompts.meta_agent import (
    MAX_SKILL_DESCRIPTION_CHARS,
    build_meta_agent_system_prompt,
    build_meta_agent_volatile_sections,
)
from agenticx.runtime.prompts.session_context import (
    build_deferred_tools_manifest,
    build_session_context_message,
    pop_volatile_sections,
)
from agenticx.runtime.tool_search import (
    CORE_ALWAYS_LOAD_TOOLS,
    ToolSearchConfig,
    estimate_schema_tokens,
    is_deferred_builtin,
    known_unloaded_names,
    project_tools_for_round,
)
from agenticx.runtime.tool_search_runtime import build_runtime_context
from agenticx.studio.session_manager import StudioSession


# --------------------------------------------------------------------------
# 1. 时钟：system prompt 一整天字节不变
# --------------------------------------------------------------------------
def test_time_block_is_byte_stable_across_seconds():
    """原来这里打到秒，于是隔 1 秒重建就在第 3416 字符处分叉，整段历史缓存作废。"""
    first = build_current_time_block()
    time.sleep(1.1)
    assert build_current_time_block() == first


def test_time_block_keeps_the_date_and_drops_the_clock():
    block = build_current_time_block()
    facts = get_current_time_facts()
    assert facts["date"] in block
    # 精确时刻不该出现在 system prompt 里，它归尾部注入。
    assert facts["local_iso"] not in block
    assert facts["local_iso"] in build_current_time_reminder()


# --------------------------------------------------------------------------
# 2. 易变状态搬出 system prompt
# --------------------------------------------------------------------------
def test_static_prompt_is_byte_stable_when_session_state_changes():
    """一次 todo_write 原来会把稳定前缀砍到 9.6%；现在应当完全不动。"""
    session = StudioSession()
    before = build_meta_agent_system_prompt(session, include_volatile=False)
    pop_volatile_sections(session)

    todo_manager = getattr(session, "todo_manager", None)
    assert todo_manager is not None
    todo_manager.update(
        [{"content": "验证 token diet", "status": "in_progress", "activeForm": "验证中"}]
    )

    after = build_meta_agent_system_prompt(session, include_volatile=False)
    sections = pop_volatile_sections(session)
    assert after == before
    # 内容没丢，只是搬了地方。
    assert any("验证 token diet" in body for _, body in sections)


def test_volatile_sections_are_popped_once():
    session = StudioSession()
    build_meta_agent_system_prompt(session, include_volatile=False)
    assert pop_volatile_sections(session)
    assert pop_volatile_sections(session) == []


def test_include_volatile_true_keeps_state_in_the_prompt():
    """默认行为不变，供自己拼 prompt、不走 <session-context> 的调用方使用。"""
    session = StudioSession()
    full = build_meta_agent_system_prompt(session)
    static = build_meta_agent_system_prompt(session, include_volatile=False)
    pop_volatile_sections(session)
    assert "## 已注册能力" in full
    assert "## 已注册能力" not in static
    assert len(static) < len(full)


# --------------------------------------------------------------------------
# 3. 技能目录只渲染一次
# --------------------------------------------------------------------------
def test_skill_catalog_is_not_rendered_twice():
    """``### Skills（共 N 个）`` 和 ``## Available Skills`` 原来把同样的技能列了两遍
    （实测 4770 + 5013 = 9783 字符）。"""
    session = StudioSession()
    prompt = build_meta_agent_system_prompt(session)
    assert prompt.count("## Available Skills") == 0
    assert prompt.count("### Skills（共") == 1


def test_skill_descriptions_are_capped():
    session = StudioSession()
    sections = build_meta_agent_volatile_sections(session)
    catalog = next(body for title, body in sections if title == "已注册能力")
    for line in catalog.splitlines():
        if line.startswith("- ") and ": " in line:
            assert len(line.split(": ", 1)[1]) <= MAX_SKILL_DESCRIPTION_CHARS


# --------------------------------------------------------------------------
# 4. 延迟闸门反过来了 + 名字清单兜底
# --------------------------------------------------------------------------
def test_defer_gate_defaults_to_deferrable():
    """新工具默认可延迟：默认省 token，要常驻必须显式写进 CORE。"""
    assert is_deferred_builtin("a_brand_new_tool_nobody_listed")
    for name in CORE_ALWAYS_LOAD_TOOLS:
        assert not is_deferred_builtin(name)


def test_previously_leaked_always_load_tools_are_now_deferred():
    """这 10 个当年是从 allowlist 的缝里漏成常驻的，白占 1969 token。"""
    for name in (
        "analyze_image",
        "feature_complete",
        "feature_select",
        "get_current_datetime",
        "progress_append",
        "project_init",
        "project_status",
        "show_widget",
        "skill_market_install",
        "verify_run",
    ):
        assert is_deferred_builtin(name), name


def test_deferred_tools_are_announced_by_name():
    """延迟加载的前提是模型知道这些工具存在，否则等于静默阉割功能。"""
    session = StudioSession()
    pool = studio_tools_for_session(session)
    ctx = build_runtime_context(
        session=session, full_openai_tools=pool, config=ToolSearchConfig(mode="always")
    )
    projected = project_tools_for_round(ctx, full_openai_tools=pool)
    sent = {t["function"]["name"] for t in projected}
    unloaded = known_unloaded_names(ctx)
    assert unloaded, "should have deferred something"
    manifest = build_deferred_tools_manifest(unloaded)
    for name in sorted(unloaded):
        assert name not in sent
        assert name in manifest


def test_session_context_message_carries_clock_and_manifest():
    msg = build_session_context_message(
        [("当前 Todo 列表", "1. foo")], deferred_tool_names=["web_fetch"]
    )
    assert msg is not None and msg["role"] == "system"
    body = msg["content"]
    assert body.startswith("<session-context>") and body.endswith("</session-context>")
    assert "当前时刻：" in body and "1. foo" in body and "web_fetch" in body


def test_session_context_message_is_none_when_empty():
    assert build_session_context_message([], deferred_tool_names=[], include_clock=False) is None


# --------------------------------------------------------------------------
# 5. 单工具用法细则跟着工具走
# --------------------------------------------------------------------------
@pytest.mark.parametrize(
    "tool_name,marker",
    [
        ("show_widget", "CDN 白名单"),
        ("query_data_source", "days:60"),
        ("skill_manage", "discoverable=true"),
    ],
)
def test_tool_usage_rules_live_in_the_description_not_the_prompt(tool_name, marker):
    """用法细则搬进 description 之后，工具被延迟时它们一起消失。"""
    by_name = {
        str((t.get("function") or {}).get("name", "")): t
        for t in STUDIO_TOOLS
        if isinstance(t, dict)
    }
    assert marker in str((by_name[tool_name].get("function") or {}).get("description") or "")
    session = StudioSession()
    prompt = build_meta_agent_system_prompt(session, include_volatile=False)
    pop_volatile_sections(session)
    assert marker not in prompt


def test_show_widget_trigger_rules_stay_in_the_prompt():
    """细则可以延迟，"什么时候必须出图"不行——模型得先知道该出图才会去调。"""
    session = StudioSession()
    prompt = build_meta_agent_system_prompt(session, include_volatile=False)
    pop_volatile_sections(session)
    assert "强制触发" in prompt
    assert "show_widget" in prompt


# --------------------------------------------------------------------------
# 6. 端到端预算
# --------------------------------------------------------------------------
def test_fixed_request_overhead_stays_under_budget():
    """改造前实测：system prompt 10172 tok + 工具 schema 13504 tok = 23676 tok。

    改造后实测约 11772 tok（prompt 6223 + session-context 1929 + schema 3620）。
    闸门留在 16000，给工具集和技能目录长大的余量，但明显回退能看见。
    """
    session = StudioSession()
    pool = studio_tools_for_session(session)
    ctx = build_runtime_context(
        session=session, full_openai_tools=pool, config=ToolSearchConfig(mode="always")
    )
    projected = project_tools_for_round(ctx, full_openai_tools=pool)
    prompt = build_meta_agent_system_prompt(session, include_volatile=False)
    msg = build_session_context_message(
        pop_volatile_sections(session), deferred_tool_names=sorted(known_unloaded_names(ctx))
    )
    total = (
        int(len(prompt) / 3.5)
        + (int(len(msg["content"]) / 3.5) if msg else 0)
        + estimate_schema_tokens(projected)
    )
    assert total < 16_000, f"fixed overhead regressed to {total} tokens"
    assert estimate_schema_tokens(projected) < estimate_schema_tokens(pool)


# --------------------------------------------------------------------------
# 7. 端到端：真的走一遍 run_turn，看发给 provider 的 messages
# --------------------------------------------------------------------------
class _FakeResponse:
    def __init__(self, content: str, tool_calls):
        self.content = content
        self.tool_calls = tool_calls


class _CaptureMessagesLLM:
    """记下每一轮发给 provider 的 messages。"""

    def __init__(self) -> None:
        self.turns: list[list[dict]] = []

    def invoke(self, messages, **_kwargs):
        self.turns.append([dict(item) for item in messages])
        return _FakeResponse("ok", [])


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question, context=None) -> bool:
        return True


@pytest.mark.asyncio
async def test_run_turn_sends_session_context_after_history_and_keeps_prompt_stable():
    llm = _CaptureMessagesLLM()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()

    async for _ in runtime.run_turn("第一轮", session):
        pass
    first = llm.turns[-1]

    system_prompt = first[0]
    assert system_prompt["role"] == "system"
    # 易变状态不在 messages[0] 里了。
    assert "## 当前 Todo 列表" not in system_prompt["content"]
    assert "## 可用元 Skills 摘要" not in system_prompt["content"]

    ctx_rows = [
        m for m in first if str(m.get("content", "")).startswith("<session-context>")
    ]
    assert len(ctx_rows) == 1, "exactly one <session-context> per request"
    assert "当前时刻：" in ctx_rows[0]["content"]
    # 它坐在最后一条 user 消息之前：历史在它前面照常命中缓存，它离用户的问题最近。
    # （中间还会插一条 [user-goal-anchor]，同样是本轮临时消息，位置不做强断言。）
    ctx_idx = first.index(ctx_rows[0])
    last_user_idx = max(i for i, m in enumerate(first) if m.get("role") == "user")
    assert 0 < ctx_idx < last_user_idx

    # 它是本轮临时的，不能进持久历史——否则下一轮的历史前缀跟着变，等于白搬。
    for row in list(session.agent_messages) + list(session.chat_history):
        assert not str(row.get("content", "")).startswith("<session-context>")

    # 改一堆会话状态，再走一轮：system prompt 必须一字不差。
    session.todo_manager.update(
        [{"content": "第二轮任务", "status": "in_progress", "activeForm": "干活中"}]
    )
    session.scratchpad["note"] = "something new"
    async for _ in runtime.run_turn("第二轮", session):
        pass
    second = llm.turns[-1]

    assert second[0]["content"] == system_prompt["content"]
    second_ctx = next(
        m for m in second if str(m.get("content", "")).startswith("<session-context>")
    )
    assert "第二轮任务" in second_ctx["content"]
    assert "something new" in second_ctx["content"]
    # 第二轮已经有历史了：<session-context> 必须排在历史之后，否则历史前缀又要被它
    # 顶开——搬家就白搬了。
    second_ctx_idx = second.index(second_ctx)
    history_idx = [
        i
        for i, m in enumerate(second)
        if m.get("role") in {"assistant", "tool"} or m.get("content") == "第一轮"
    ]
    assert history_idx, "second turn should replay the first turn"
    assert second_ctx_idx > max(history_idx)
    assert sum(
        1 for m in second if str(m.get("content", "")).startswith("<session-context>")
    ) == 1, "第一轮那条不能被带进历史里重复发送"


# --------------------------------------------------------------------------
# 8. 身份/长期上下文与 provider 隔离也不许钉在 messages[0] 的开头
# --------------------------------------------------------------------------
def test_memory_append_does_not_move_the_system_prompt(monkeypatch):
    """一次 memory_append 原来能从**第 0 字节**炸掉缓存。

    workspace_context（全局用户偏好 / 身份定义 / 行为准则 / 长期记忆 / 今日记忆）
    过去钉在整段 prompt 的最开头，而 prompt 自己就在鼓励模型"会话结束前主动
    memory_append"——写一次，整段对话历史的前缀缓存全废。
    """
    state = {"memory": "旧的长期记忆"}

    def _fake_loader(avatar_id=None, *, session=None, subject_label=""):
        return {
            "global_user": "用户偏好：说中文",
            "subject_label": subject_label or "元智能体",
            "is_meta_subject": True,
            "identity": "身份定义",
            "soul": "行为准则",
            "memory": state["memory"],
            "daily_memory": "今日记忆",
        }

    monkeypatch.setattr(
        "agenticx.runtime.prompts.meta_agent.load_subject_workspace_context", _fake_loader
    )
    session = StudioSession()
    before = build_meta_agent_system_prompt(session, include_volatile=False)
    before_sections = pop_volatile_sections(session)
    assert any("旧的长期记忆" in body for _, body in before_sections)
    assert "旧的长期记忆" not in before

    state["memory"] = "刚刚 memory_append 写进来的新事实"
    after = build_meta_agent_system_prompt(session, include_volatile=False)
    after_sections = pop_volatile_sections(session)

    assert after == before, "memory_append must not perturb the cached prefix"
    assert any("刚刚 memory_append 写进来的新事实" in body for _, body in after_sections)


def test_identity_block_leads_the_session_context(monkeypatch):
    """背景在前、要动手的材料在后——身份属于背景。"""
    monkeypatch.setattr(
        "agenticx.runtime.prompts.meta_agent.load_subject_workspace_context",
        lambda avatar_id=None, *, session=None, subject_label="": {
            "global_user": "g",
            "subject_label": "元智能体",
            "is_meta_subject": True,
            "identity": "我是谁",
            "soul": "",
            "memory": "",
            "daily_memory": "",
        },
    )
    session = StudioSession()
    sections = build_meta_agent_volatile_sections(session)
    non_empty = [(t, b) for t, b in sections if b.strip()]
    assert "身份与长期上下文" in non_empty[0][1]


def test_provider_hard_failure_does_not_move_the_system_prompt():
    """provider 硬失败隔离是运行中才出现的，原来也钉在 prompt 最开头。"""
    session = StudioSession()
    before = build_meta_agent_system_prompt(session, include_volatile=False)
    pop_volatile_sections(session)

    session.provider_hard_failure_providers = ["some_provider"]
    after = build_meta_agent_system_prompt(session, include_volatile=False)
    sections = pop_volatile_sections(session)

    assert after == before
    assert any("some_provider" in body for _, body in sections)


# --------------------------------------------------------------------------
# 9. system prompt 之后必须**立刻**是历史
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_cacheable_prefix_grows_with_history():
    """历史是 append-only 的，所以它必须紧贴 system prompt。

    ``[user-goal-anchor]`` 原来插在 ``messages[1]``——系统提示词之后、历史之前——
    而它每轮都变（内含用户当前问题）。于是可缓存前缀被**焊死**在系统提示词末尾，
    对话越长占比越低。实测 8 轮真实请求：

        anchor 在头部：可缓存前缀恒为 2928 字符，占比 25.2% → 13.6% 一路下滑
        anchor 在尾部：可缓存前缀 2887 → 12877 字符，占比 25.0% → 59.8% 一路上升

    这条用例钉的就是"上升"：相邻两轮的共享前缀必须随历史增长，而不是停在某个常数。
    """
    llm = _CaptureMessagesLLM()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    reply = "这是一段有实际长度的助手回复。" * 40
    llm.invoke = lambda messages, **_k: (  # type: ignore[method-assign]
        llm.turns.append([dict(m) for m in messages]) or _FakeResponse(reply, [])
    )

    for i in range(1, 5):
        async for _ in runtime.run_turn(f"第{i}轮：请继续推进这个任务并说明理由", session):
            pass

    def shared_prefix(a: list[dict], b: list[dict]) -> int:
        x, y = json.dumps(a, ensure_ascii=False), json.dumps(b, ensure_ascii=False)
        n = min(len(x), len(y))
        i = 0
        while i < n and x[i] == y[i]:
            i += 1
        return i

    grew = [shared_prefix(llm.turns[k - 1], llm.turns[k]) for k in range(1, len(llm.turns))]
    assert grew == sorted(grew), f"cacheable prefix must not shrink: {grew}"
    assert grew[-1] > grew[0], f"cacheable prefix must grow with history: {grew}"

    # 结构上：messages[0] 之后到 <session-context> 之前，只能是历史（user/assistant/tool）。
    last = llm.turns[-1]
    ctx_idx = next(
        i for i, m in enumerate(last) if str(m.get("content", "")).startswith("<session-context>")
    )
    history_roles = {str(m.get("role")) for m in last[1:ctx_idx]}
    assert history_roles <= {"user", "assistant", "tool"}, history_roles
    assert last[-1]["content"].startswith("[user-goal-anchor]")
