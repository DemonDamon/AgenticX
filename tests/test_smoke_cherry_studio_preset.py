"""Smoke tests for Cherry Studio style AgentPreset support."""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.core.agent import Agent
from agenticx.presets import (
    AgentPreset,
    create_agent_from_preset,
    load_preset_from_dict,
    load_preset_from_yaml,
)


def test_load_preset_from_dict() -> None:
    preset = load_preset_from_dict(
        {
            "name": "code-reviewer",
            "role": "Code Review Expert",
            "goal": "Review code for quality and bugs",
            "tool_names": ["file_read", "code_analysis"],
            "settings": {"temperature": 0.3, "organization_id": "org-a"},
        }
    )

    assert preset.name == "code-reviewer"
    assert preset.role == "Code Review Expert"
    assert preset.goal == "Review code for quality and bugs"
    assert preset.tool_names == ["file_read", "code_analysis"]
    assert preset.settings["temperature"] == 0.3


def test_load_preset_from_yaml_file(tmp_path: Path) -> None:
    preset_path = tmp_path / "preset.yaml"
    preset_path.write_text(
        """name: code-reviewer
role: Code Review Expert
goal: Review code for quality and bugs
tool_names:
  - file_read
settings:
  max_iterations: 5
""",
        encoding="utf-8",
    )

    preset = load_preset_from_yaml(preset_path)
    assert preset.name == "code-reviewer"
    assert preset.settings["max_iterations"] == 5


def test_create_agent_from_preset_success() -> None:
    llm = object()
    preset = AgentPreset(
        name="code-reviewer",
        role="Code Review Expert",
        goal="Review code for quality and bugs",
        tool_names=["file_read"],
        settings={"organization_id": "org-a"},
    )

    agent = create_agent_from_preset(preset, llm=llm, llm_config_name="test-llm")

    assert isinstance(agent, Agent)
    assert agent.name == "code-reviewer"
    assert agent.llm is llm
    assert agent.llm_config_name == "test-llm"
    assert agent.tool_names == ["file_read"]


def test_create_agent_from_preset_requires_llm() -> None:
    preset = AgentPreset(name="a", role="r", goal="g")
    with pytest.raises(ValueError, match="llm is required"):
        create_agent_from_preset(preset, llm=None)


def test_create_agent_from_preset_supports_overrides() -> None:
    llm = object()
    preset = AgentPreset(name="a", role="r", goal="g", settings={"max_iterations": 3})

    agent = create_agent_from_preset(
        preset,
        llm=llm,
        name="override-name",
        max_iterations=9,
    )

    assert agent.name == "override-name"
    assert agent.max_iterations == 9


def test_load_preset_from_dict_validates_tool_names_type() -> None:
    with pytest.raises(ValueError, match="tool_names"):
        load_preset_from_dict(
            {
                "name": "a",
                "role": "r",
                "goal": "g",
                "tool_names": "wrong-type",
            }
        )


def test_explicit_llm_config_name_takes_priority_over_settings() -> None:
    llm = object()
    preset = AgentPreset(
        name="a",
        role="r",
        goal="g",
        settings={"llm_config_name": "from-settings"},
    )
    agent = create_agent_from_preset(preset, llm=llm, llm_config_name="from-arg")
    assert agent.llm_config_name == "from-arg"
