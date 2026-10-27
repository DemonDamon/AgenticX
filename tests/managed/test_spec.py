#!/usr/bin/env python3
"""AgentSpec compilation tests.

Author: Damon Li
"""

from __future__ import annotations

import dataclasses

import pytest

from agenticx.cli.agent_tools import STUDIO_TOOLS
from agenticx.managed.errors import MAError
from agenticx.managed.spec import MANAGED_BUILTIN_TOOLS, compile_spec


def _manifest(tools: list | None = None, **extra: object) -> dict:
    raw: dict = {"schema": "agx.agent/v1", "model": "fake/scripted"}
    if tools is not None:
        raw["tools"] = tools
    raw.update(extra)
    return raw


def test_invalid_manifest_raises_with_errors() -> None:
    with pytest.raises(MAError) as caught:
        compile_spec("agent", 1, {"schema": "agx.agent/v1"})
    err = caught.value
    assert err.code == "manifest_invalid"
    assert err.details["errors"] == ["manifest.model: is required"]


def test_minimal_manifest_has_no_tools() -> None:
    spec = compile_spec("agent", 1, {"schema": "agx.agent/v1", "model": "openai/gpt-4o"})
    assert spec.tools == ()
    assert spec.provider == "openai"
    assert spec.model == "gpt-4o"
    assert spec.max_tool_rounds == 40


def test_builtin_toolset_default_allows_all_whitelisted() -> None:
    spec = compile_spec("agent", 1, _manifest(tools=[{"type": "agx_builtin"}]))
    assert [tool.name for tool in spec.tools] == list(MANAGED_BUILTIN_TOOLS)
    assert all(tool.policy == "always_allow" for tool in spec.tools)
    assert all(tool.kind == "builtin" for tool in spec.tools)


def test_builtin_config_overrides_and_disable() -> None:
    spec = compile_spec(
        "agent",
        1,
        _manifest(
            tools=[
                {
                    "type": "agx_builtin",
                    "default_policy": "always_allow",
                    "configs": [
                        {"name": "bash_exec", "policy": "always_ask"},
                        {"name": "web_search", "enabled": False},
                    ],
                }
            ]
        ),
    )
    bash = spec.tool("bash_exec")
    file_read = spec.tool("file_read")
    assert bash is not None and bash.policy == "always_ask"
    assert spec.tool("web_search") is None
    assert spec.kind_of("web_search") is None
    assert file_read is not None and file_read.policy == "always_allow"


def test_unknown_builtin_rejected() -> None:
    with pytest.raises(MAError) as caught:
        compile_spec(
            "agent",
            1,
            _manifest(tools=[{"type": "agx_builtin", "configs": [{"name": "cc_bridge_start"}]}]),
        )
    assert caught.value.details["errors"] == [
        'manifest.tools[0].configs[0].name: unknown builtin tool "cc_bridge_start"'
    ]


def test_custom_tool_compiled() -> None:
    spec = compile_spec(
        "agent",
        1,
        _manifest(
            tools=[
                {"type": "agx_builtin"},
                {
                    "type": "custom",
                    "name": "lookup_order",
                    "description": "Look up an order",
                    "input_schema": {
                        "type": "object",
                        "properties": {"order_id": {"type": "string"}},
                    },
                },
            ]
        ),
    )
    assert spec.kind_of("lookup_order") == "custom"
    entry = spec.tool("lookup_order")
    assert entry is not None
    assert "order_id" in entry.schema["function"]["parameters"]["properties"]
    names = [tool.name for tool in spec.tools]
    assert names[:-1] == list(MANAGED_BUILTIN_TOOLS)
    assert names[-1] == "lookup_order"


@pytest.mark.parametrize(
    ("tool", "expected"),
    [
        (
            {
                "type": "custom",
                "name": "bash_exec",
                "description": "run a command",
                "input_schema": {"type": "object", "properties": {}},
            },
            'manifest.tools[0].name: conflicts with builtin tool "bash_exec"',
        ),
        (
            {
                "type": "custom",
                "name": "lsp_x",
                "description": "reserved",
                "input_schema": {"type": "object", "properties": {}},
            },
            'manifest.tools[0].name: reserved prefix "lsp_"',
        ),
        (
            {
                "type": "custom",
                "name": "lookup_order",
                "description": "lookup",
                "input_schema": {
                    "type": "object",
                    "properties": {"task_intent": {"type": "string"}},
                },
            },
            'manifest.tools[0].input_schema: property "task_intent" is reserved',
        ),
        (
            {
                "type": "custom",
                "name": "lookup_order",
                "description": "lookup",
                "input_schema": {"type": "array"},
            },
            'manifest.tools[0].input_schema: type must be "object"',
        ),
    ],
)
def test_custom_tool_semantic_errors(tool: dict, expected: str) -> None:
    with pytest.raises(MAError) as caught:
        compile_spec("agent", 1, _manifest(tools=[tool]))
    assert caught.value.details["errors"] == [expected]


def test_multiagent_self_reference_rejected() -> None:
    with pytest.raises(MAError) as caught:
        compile_spec(
            "A",
            1,
            _manifest(
                multiagent={
                    "type": "coordinator",
                    "agents": [{"type": "agent", "id": "A"}],
                }
            ),
        )
    assert (
        'manifest.multiagent.agents[0].id: use {"type":"self"} to reference this agent'
        in caught.value.details["errors"]
    )


def test_custom_tool_conflicts_with_list_agents() -> None:
    with pytest.raises(MAError) as caught:
        compile_spec(
            "agent",
            1,
            _manifest(
                tools=[
                    {
                        "type": "custom",
                        "name": "list_agents",
                        "description": "list members",
                        "input_schema": {"type": "object", "properties": {}},
                    }
                ]
            ),
        )
    assert caught.value.details["errors"] == [
        'manifest.tools[0].name: conflicts with platform tool "list_agents"'
    ]


def test_custom_tool_conflicts_with_platform_tool() -> None:
    with pytest.raises(MAError) as caught:
        compile_spec(
            "agent",
            1,
            _manifest(
                tools=[
                    {
                        "type": "custom",
                        "name": "task_list",
                        "description": "list tasks",
                        "input_schema": {"type": "object", "properties": {}},
                    }
                ]
            ),
        )
    assert caught.value.code == "manifest_invalid"
    assert caught.value.details["errors"] == [
        'manifest.tools[0].name: conflicts with platform tool "task_list"'
    ]


def test_mcp_toolset_compiled_not_enumerated() -> None:
    spec = compile_spec(
        "agent",
        1,
        _manifest(
            mcp_servers=[{"name": "github", "url": "https://example.com/mcp"}],
            tools=[
                {
                    "type": "mcp",
                    "server": "github",
                    "default_policy": "always_ask",
                    "configs": [
                        {"name": "get_issue", "policy": "always_allow"},
                        {"name": "delete_repo", "enabled": False},
                    ],
                }
            ],
        ),
    )
    assert spec.tools == ()
    toolset = spec.mcp_toolset("github")
    assert toolset is not None
    assert toolset.policy_for("get_issue") == "always_allow"
    assert toolset.policy_for("list_prs") == "always_ask"
    assert toolset.policy_for("delete_repo") is None
    assert spec.mcp_servers[0].transport == "http"


def test_whitelist_exists_in_studio_tools() -> None:
    names = {tool["function"]["name"] for tool in STUDIO_TOOLS}
    assert set(MANAGED_BUILTIN_TOOLS) <= names


def test_tool_schemas_are_copies() -> None:
    spec = compile_spec("agent", 1, _manifest(tools=[{"type": "agx_builtin"}]))
    first = spec.tool_schemas()
    original_name = first[0]["function"]["name"]
    first[0]["function"]["name"] = "mutated"
    first[0]["mutated"] = True
    second = spec.tool_schemas()
    assert second[0]["function"]["name"] == original_name
    assert "mutated" not in second[0]
    with pytest.raises(dataclasses.FrozenInstanceError):
        spec.version = 2  # type: ignore[misc]
