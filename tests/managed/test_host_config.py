#!/usr/bin/env python3
"""Development agents-file loader.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.managed.host.config import HostConfigError, load_agents_file

_OK_YAML = """
tenant_id: dev
agents:
  - id: demo
    display_name: W1 Demo
    default_environment_id: local
    manifest:
      schema: agx.agent/v1
      model: fake/scripted
      system: >-
        You are a test agent. First run bash_exec with the command `echo ma-w1-ok`.
        Then call lookup_order with order_id "A-1". Finally summarize both results in one sentence.
      tools:
        - type: agx_builtin
          default_policy: always_allow
          configs:
            - {name: bash_exec, policy: always_ask}
        - type: custom
          name: lookup_order
          description: Look up an order status in the caller's system.
          input_schema:
            type: object
            properties: {order_id: {type: string}}
            required: [order_id]
      runtime: {max_tool_rounds: 8}
"""

_MISSING_MODEL = """
agents:
  - id: demo
    manifest:
      schema: agx.agent/v1
      system: hi
"""

_BAD_ID = """
agents:
  - id: "bad id"
    manifest:
      schema: agx.agent/v1
      model: fake/scripted
"""

_CUSTOM_CONFLICT = """
agents:
  - id: demo
    manifest:
      schema: agx.agent/v1
      model: fake/scripted
      tools:
        - type: custom
          name: bash_exec
          description: overlaps a builtin
          input_schema: {type: object}
"""

_UNKNOWN_ENV = """
agents:
  - id: demo
    default_environment_id: nope
    manifest:
      schema: agx.agent/v1
      model: fake/scripted
"""


def test_load_agents_file_ok(tmp_path: Path) -> None:
    path = tmp_path / "agents.yaml"
    path.write_text(_OK_YAML, encoding="utf-8")
    _tenant, agents, environments, _policy = load_agents_file(path)
    assert agents["demo"].record.latest_version == 1
    assert agents["demo"].versions[1].manifest_hash.startswith("sha256:")
    assert environments["local"].type == "cloud"
    assert environments["worker"].type == "desktop_worker"


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ("tenant_id: dev\n", "agents: must be a list"),
        (_BAD_ID, "agents[0].id: invalid id"),
        (_UNKNOWN_ENV, "agents[0].default_environment_id: unknown environment"),
    ],
)
def test_load_agents_file_errors_exact(tmp_path: Path, body: str, expected: str) -> None:
    path = tmp_path / "agents.yaml"
    path.write_text(body, encoding="utf-8")
    with pytest.raises(HostConfigError, match=expected.replace("[", "\\[").replace("]", "\\]")):
        load_agents_file(path)


def test_load_agents_file_errors(tmp_path: Path) -> None:
    missing_agents = tmp_path / "missing-agents.yaml"
    missing_agents.write_text("tenant_id: dev\n", encoding="utf-8")
    with pytest.raises(HostConfigError, match="agents: must be a list"):
        load_agents_file(missing_agents)

    bad_id = tmp_path / "bad-id.yaml"
    bad_id.write_text(_BAD_ID, encoding="utf-8")
    with pytest.raises(HostConfigError, match=r"agents\[0\]\.id: invalid id"):
        load_agents_file(bad_id)

    missing_model = tmp_path / "missing-model.yaml"
    missing_model.write_text(_MISSING_MODEL, encoding="utf-8")
    with pytest.raises(HostConfigError) as missing:
        load_agents_file(missing_model)
    message = str(missing.value)
    assert message.startswith("agents[0].versions[0].manifest: ")
    assert "manifest.model: is required" in message

    conflict = tmp_path / "conflict.yaml"
    conflict.write_text(_CUSTOM_CONFLICT, encoding="utf-8")
    with pytest.raises(HostConfigError) as conflict_error:
        load_agents_file(conflict)
    assert "conflicts with builtin tool" in str(conflict_error.value)

    unknown_env = tmp_path / "unknown-env.yaml"
    unknown_env.write_text(_UNKNOWN_ENV, encoding="utf-8")
    with pytest.raises(HostConfigError, match="unknown environment"):
        load_agents_file(unknown_env)
