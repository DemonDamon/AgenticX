#!/usr/bin/env python3
"""Guards for the prompt/tool token diet.

每一条都对应一个实测到的浪费，注释里记着当时的数字，将来回退了看得见。
"""

from __future__ import annotations

import time

import pytest

from agenticx.cli.agent_tools import STUDIO_TOOLS, studio_tools_for_session
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
