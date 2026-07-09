#!/usr/bin/env python3
"""Tests for Meta context budget compaction."""

from __future__ import annotations

from agenticx.cli.studio import StudioSession
from agenticx.runtime.context_budget import (
    build_compact_meta_system_prompt,
    force_compact_meta_turn_context,
    maybe_compact_meta_turn_context,
    model_prefers_compact_meta_context,
)
from agenticx.runtime.meta_tools import META_AGENT_TOOLS
from agenticx.runtime.prompts.meta_agent import build_meta_agent_system_prompt


def test_model_prefers_compact_for_qwen3_32b() -> None:
    assert model_prefers_compact_meta_context("Qwen3-32B", "custom_openai_v") is True
    assert model_prefers_compact_meta_context("glm-4-9b-chat-1m", "custom_openai_v") is False
    assert model_prefers_compact_meta_context("doubao-seed-2-0-pro-260215", "volcengine") is False


def test_force_compact_meta_turn_context() -> None:
    session = StudioSession()
    session.provider_name = "custom_openai_v"
    session.model_name = "Qwen3-32B"
    compact_prompt, compact_tools, notice = force_compact_meta_turn_context(
        session,
        tools=list(META_AGENT_TOOLS),
    )
    assert notice
    assert "32K" in notice
    assert "精简模式" in notice
    assert len(compact_prompt) < 25_000
    assert len(compact_tools) < len(META_AGENT_TOOLS)


def test_maybe_compact_meta_turn_context_shrinks_full_meta_prompt() -> None:
    session = StudioSession()
    session.provider_name = "custom_openai_v"
    session.model_name = "Qwen3-32B"
    full_prompt = build_meta_agent_system_prompt(session, mode="interactive", taskspaces=[])
    assert len(full_prompt) > 40_000
    compact_prompt, compact_tools, notice = maybe_compact_meta_turn_context(
        session,
        system_prompt=full_prompt,
        tools=list(META_AGENT_TOOLS),
    )
    assert notice
    assert len(compact_prompt) < len(full_prompt)
    assert len(compact_tools) <= len(META_AGENT_TOOLS)
    assert compact_prompt == build_compact_meta_system_prompt(session)


def test_meta_prompt_includes_large_artifact_file_write_discipline() -> None:
    session = StudioSession()
    prompt = build_meta_agent_system_prompt(session, mode="interactive", taskspaces=[])
    assert "大文件落盘" in prompt
    assert "骨架" in prompt
    assert "再分章追加" in prompt
