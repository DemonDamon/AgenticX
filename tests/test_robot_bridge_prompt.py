#!/usr/bin/env python3
"""Meta-Agent robot capability block and its context-usage accounting.

Author: Hongyi Zhao
"""

from __future__ import annotations

import re
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml

from agenticx.cli.agent_tools import studio_tools_for_session
from agenticx.cli.config_manager import ConfigManager
from agenticx.robot_bridge.tools import ROBOT_TOOL_NAMES, ROBOT_TOOLS
from agenticx.runtime.prompts.meta_agent import (
    _build_robot_capabilities_block,
    build_meta_agent_system_prompt,
)
from agenticx.runtime.tool_search import ToolSearchConfig, apply_search
from agenticx.runtime.tool_search_runtime import build_runtime_context
from agenticx.studio.context_usage import (
    _reset_usage_caches,
    _text_tokens,
    estimate_session_context_usage,
)
from agenticx.studio.session_manager import StudioSession

HEADING = "## 机器人策略会话"
PROFILE = {"type": "so101_follower", "policy_path": "/models/pick"}


@pytest.fixture
def write_config(tmp_path: Path, monkeypatch):
    global_path = tmp_path / "global.yaml"
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", global_path)
    monkeypatch.setattr(
        ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / ".agenticx" / "config.yaml"
    )

    def _write(robot: dict | None) -> None:
        data = {} if robot is None else {"robot": robot}
        global_path.write_text(yaml.safe_dump(data), encoding="utf-8")

    return _write


def test_block_empty_when_disabled(write_config):
    write_config(None)
    assert _build_robot_capabilities_block() == ""
    write_config({"enabled": False, "profiles": {"so101_desk": PROFILE}})
    assert _build_robot_capabilities_block() == ""


def test_block_lists_profiles_and_every_tool(write_config):
    write_config({"enabled": True, "profiles": {"so101_desk": PROFILE}})
    block = _build_robot_capabilities_block()
    assert block.startswith(HEADING)
    assert "so101_desk" in block
    for name in ROBOT_TOOL_NAMES:
        assert f"`{name}`" in block, name
    assert "`tool_search`" in block
    assert "robot_stop` 免确认" in block


def test_block_points_to_config_when_no_profiles(write_config):
    write_config({"enabled": True})
    assert "robot.profiles" in _build_robot_capabilities_block()


def test_block_empty_when_config_unreadable(monkeypatch):
    def _boom():
        raise RuntimeError("broken config")

    monkeypatch.setattr(ConfigManager, "load", staticmethod(_boom))
    assert _build_robot_capabilities_block() == ""


def test_prompted_tool_search_loads_every_robot_tool(write_config):
    """The query in the block must pull in all robot tools, robot_stop included."""
    write_config({"enabled": True, "profiles": {"so101_desk": PROFILE}})
    block = _build_robot_capabilities_block()
    match = re.search(r"`query` 用 `(\w+)`，`max_results` 用 (\d+)", block)
    assert match, block
    session = StudioSession()
    pool = list(studio_tools_for_session(session)) + list(ROBOT_TOOLS)
    ctx = build_runtime_context(
        session=session, full_openai_tools=pool, config=ToolSearchConfig(mode="always")
    )
    _, result = apply_search(ctx, match.group(1), max_results=int(match.group(2)))
    assert {m["name"] for m in result["matches"]} == set(ROBOT_TOOL_NAMES)


def test_meta_prompt_includes_block_only_outside_group_chat(write_config):
    write_config({"enabled": True, "profiles": {"so101_desk": PROFILE}})
    session = StudioSession()
    assert HEADING in build_meta_agent_system_prompt(session, include_volatile=False)
    group = {"id": "g1", "name": "测试群", "avatar_ids": ["a1"]}
    prompt = build_meta_agent_system_prompt(
        session, group_chat=group, include_volatile=False
    )
    assert HEADING not in prompt


def _empty_managed(session_id: str):
    session = SimpleNamespace(
        session_id=session_id,
        model_name="",
        bound_avatar_id=None,
        kb_retrieval_mode="",
        agent_messages=[],
        mcp_hub=None,
        mcp_configs={},
        connected_servers=set(),
        chat_history=[],
        scratchpad={},
        todo_manager=None,
    )
    return SimpleNamespace(studio_session=session, taskspaces=[])


def test_context_usage_counts_the_block(write_config, monkeypatch):
    monkeypatch.setattr(
        "agenticx.studio.context_usage.get_all_skill_summaries",
        lambda bound_avatar_id=None: [],
    )

    def _system_tokens(session_id: str) -> int:
        _reset_usage_caches()
        usage = estimate_session_context_usage(
            _empty_managed(session_id), session_id=session_id
        )
        return usage["categories"]["system_prompt"]

    write_config(None)
    disabled = _system_tokens("sid-robot-off")
    write_config({"enabled": True, "profiles": {"so101_desk": PROFILE}})
    enabled = _system_tokens("sid-robot-on")
    assert enabled - disabled == _text_tokens(_build_robot_capabilities_block())
