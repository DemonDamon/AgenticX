#!/usr/bin/env python3
"""Agent presets for reusable agent templates.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml  # type: ignore

from agenticx.core.agent import Agent


@dataclass
class AgentPreset:
    """Serializable preset template used to build an Agent."""

    name: str
    role: str
    goal: str
    backstory: Optional[str] = None
    prompt: Optional[str] = None
    tool_names: List[str] = field(default_factory=list)
    settings: Dict[str, Any] = field(default_factory=dict)


def load_preset_from_dict(data: Dict[str, Any]) -> AgentPreset:
    """Build AgentPreset from a dict."""
    required = ("name", "role", "goal")
    for key in required:
        if not data.get(key):
            raise ValueError(f"Preset field '{key}' is required")

    tool_names = data.get("tool_names", [])
    if not isinstance(tool_names, list):
        raise ValueError("Preset field 'tool_names' must be a list")
    settings = data.get("settings", {})
    if not isinstance(settings, dict):
        raise ValueError("Preset field 'settings' must be a dict")

    return AgentPreset(
        name=str(data["name"]),
        role=str(data["role"]),
        goal=str(data["goal"]),
        backstory=data.get("backstory"),
        prompt=data.get("prompt"),
        tool_names=list(tool_names),
        settings=dict(settings),
    )


def load_preset_from_yaml(path: Path) -> AgentPreset:
    """Load AgentPreset from YAML or frontmatter style YAML."""
    raw = path.read_text(encoding="utf-8")
    payload = _parse_yaml_or_frontmatter(raw)
    if not isinstance(payload, dict):
        raise ValueError(f"Invalid preset YAML format: {path}")
    return load_preset_from_dict(payload)


def create_agent_from_preset(
    preset: AgentPreset,
    llm: Any,
    llm_config_name: Optional[str] = None,
    **overrides: Any,
) -> Agent:
    """Create an Agent instance using preset values and runtime overrides."""
    if llm is None:
        raise ValueError("llm is required to create agent from preset")

    base_kwargs: Dict[str, Any] = {
        "name": preset.name,
        "role": preset.role,
        "goal": preset.goal,
        "backstory": preset.backstory,
        "tool_names": list(preset.tool_names),
    }
    base_kwargs.update(preset.settings)
    base_kwargs["llm"] = llm
    base_kwargs["llm_config_name"] = llm_config_name
    base_kwargs.update(overrides)
    return Agent(**_filter_agent_kwargs(base_kwargs))


def _parse_yaml_or_frontmatter(content: str) -> Any:
    stripped = content.strip()
    if stripped.startswith("---"):
        lines = content.splitlines()
        separator_indexes = [i for i, line in enumerate(lines) if line.strip() == "---"]
        if len(separator_indexes) >= 2:
            start = separator_indexes[0] + 1
            end = separator_indexes[1]
            frontmatter = "\n".join(lines[start:end])
            return yaml.safe_load(frontmatter) or {}
    return yaml.safe_load(content) or {}


def _filter_agent_kwargs(kwargs: Dict[str, Any]) -> Dict[str, Any]:
    valid_fields = set(Agent.model_fields.keys())
    return {k: v for k, v in kwargs.items() if k in valid_fields and v is not None}
