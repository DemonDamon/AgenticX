#!/usr/bin/env python3
"""Compile an Agent Manifest into an immutable AgentSpec.

Author: Damon Li
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, Literal, Mapping

from agenticx.cli.agent_tools import STUDIO_TOOLS
from agenticx.managed.errors import MANIFEST_INVALID, MAError
from agenticx.managed.manifest import validate_manifest

ToolKind = Literal["builtin", "mcp", "custom"]
ToolPolicy = Literal["always_allow", "always_ask"]  # same literal values as protocol.ToolPolicy

MANAGED_BUILTIN_TOOLS: tuple[str, ...] = (
    "bash_exec", "file_read", "file_write", "file_edit", "list_files", "code_outline",
    "web_fetch", "web_search", "get_current_datetime", "todo_write",
    "scratchpad_read", "scratchpad_write", "liteparse", "tool_result_recall",
)
RESERVED_CUSTOM_PREFIXES: tuple[str, ...] = ("lsp_", "confirm_")
RESERVED_CUSTOM_INPUT_PROPERTIES: tuple[str, ...] = ("task_intent", "max_level")
PLATFORM_TOOL_NAMES: tuple[str, ...] = (
    "task_list",
    "task_get",
    "task_kill",
    "list_agents",
    "send_to_agent",
    "advisor",
)

# Every function name exposed by STUDIO_TOOLS, plus runtime-internal names.
ALL_BUILTIN_NAMES: frozenset[str] = frozenset(
    {str(t["function"]["name"]) for t in STUDIO_TOOLS} | {"mcp_call", "tool_search"}
)


@dataclass(frozen=True)
class ToolEntry:
    name: str
    kind: ToolKind
    policy: ToolPolicy
    schema: dict[str, Any]


@dataclass(frozen=True)
class McpServerSpec:
    name: str
    url: str
    transport: Literal["http", "sse"]


@dataclass(frozen=True)
class McpToolsetSpec:
    server: str
    default_policy: ToolPolicy
    policies: Mapping[str, ToolPolicy]
    disabled: frozenset[str]

    def policy_for(self, tool_name: str) -> ToolPolicy | None:
        """Return None when the tool is disabled, else explicit policy or default_policy."""
        if tool_name in self.disabled:
            return None
        if tool_name in self.policies:
            return self.policies[tool_name]
        return self.default_policy


@dataclass(frozen=True)
class AgentSpec:
    agent_id: str
    version: int
    manifest_hash: str
    model_ref: str
    provider: str
    model: str
    system: str
    tools: tuple[ToolEntry, ...]
    mcp_servers: tuple[McpServerSpec, ...]
    mcp_toolsets: tuple[McpToolsetSpec, ...]
    skills: tuple[Mapping[str, Any], ...]
    max_tool_rounds: int
    max_session_tokens: int | None
    metadata: Mapping[str, Any]
    normalized_manifest: Mapping[str, Any] = field(repr=False)
    multiagent: Mapping[str, Any] | None = None

    def tool(self, name: str) -> ToolEntry | None:
        """Return the enabled tool entry with this name, if any."""
        for entry in self.tools:
            if entry.name == name:
                return entry
        return None

    def kind_of(self, name: str) -> ToolKind | None:
        """'builtin' / 'custom' for entries in self.tools; None otherwise (W1 never returns 'mcp')."""
        entry = self.tool(name)
        if entry is None:
            return None
        return entry.kind

    @property
    def custom_tool_names(self) -> frozenset[str]:
        return frozenset(entry.name for entry in self.tools if entry.kind == "custom")

    @property
    def builtin_tool_names(self) -> frozenset[str]:
        return frozenset(entry.name for entry in self.tools if entry.kind == "builtin")

    def mcp_toolset(self, server: str) -> McpToolsetSpec | None:
        """Return the MCP toolset bound to ``server``, if the manifest declared one."""
        for toolset in self.mcp_toolsets:
            if toolset.server == server:
                return toolset
        return None

    def tool_schemas(self) -> list[dict[str, Any]]:
        """Deep copies of ToolEntry.schema in self.tools order."""
        return [copy.deepcopy(entry.schema) for entry in self.tools]


def split_model_ref(model_ref: str) -> tuple[str, str]:
    """Split '<provider>/<model>' on the first '/'. Caller guarantees MODEL_RE already matched."""
    provider, model = model_ref.split("/", 1)
    return provider, model


def _builtin_schema(name: str) -> dict[str, Any]:
    for tool in STUDIO_TOOLS:
        if str(tool["function"]["name"]) == name:
            copied: dict[str, Any] = copy.deepcopy(tool)
            return copied
    raise KeyError(name)


def _semantic_errors(normalized: Mapping[str, Any], agent_id: str) -> list[str]:
    errors: list[str] = []
    for index, item in enumerate(normalized["tools"]):
        tool_type = item["type"]
        if tool_type == "agx_builtin":
            for config_index, config in enumerate(item["configs"]):
                name = config["name"]
                if name not in MANAGED_BUILTIN_TOOLS:
                    errors.append(
                        f'manifest.tools[{index}].configs[{config_index}].name: '
                        f'unknown builtin tool "{name}"'
                    )
        elif tool_type == "custom":
            name = item["name"]
            if name in ALL_BUILTIN_NAMES:
                errors.append(
                    f'manifest.tools[{index}].name: conflicts with builtin tool "{name}"'
                )
            if name in PLATFORM_TOOL_NAMES:
                errors.append(
                    f'manifest.tools[{index}].name: conflicts with platform tool "{name}"'
                )
            for prefix in RESERVED_CUSTOM_PREFIXES:
                if name.startswith(prefix):
                    errors.append(
                        f'manifest.tools[{index}].name: reserved prefix "{prefix}"'
                    )
            input_schema = item["input_schema"]
            if input_schema.get("type", "object") != "object":
                errors.append(
                    f'manifest.tools[{index}].input_schema: type must be "object"'
                )
            properties = input_schema.get("properties")
            if isinstance(properties, dict):
                for prop in RESERVED_CUSTOM_INPUT_PROPERTIES:
                    if prop in properties:
                        errors.append(
                            f'manifest.tools[{index}].input_schema: property "{prop}" is reserved'
                        )
    multiagent = normalized.get("multiagent")
    if multiagent is not None:
        for index, member in enumerate(multiagent["agents"]):
            if member["type"] == "agent" and member["id"] == agent_id:
                errors.append(
                    f'manifest.multiagent.agents[{index}].id: use {{"type":"self"}} to reference this agent'
                )
    return errors


def _compile_tools(normalized: Mapping[str, Any]) -> list[ToolEntry]:
    tools: list[ToolEntry] = []
    builtin = next((item for item in normalized["tools"] if item["type"] == "agx_builtin"), None)
    if builtin is not None:
        configs = {config["name"]: config for config in builtin["configs"]}
        default_policy = builtin["default_policy"]
        for name in MANAGED_BUILTIN_TOOLS:
            config = configs.get(name)
            if config is not None and config["enabled"] is False:
                continue
            if config is None or config["policy"] is None:
                policy = default_policy
            else:
                policy = config["policy"]
            tools.append(
                ToolEntry(
                    name=name,
                    kind="builtin",
                    policy=policy,
                    schema=_builtin_schema(name),
                )
            )
    for item in normalized["tools"]:
        if item["type"] != "custom":
            continue
        name = item["name"]
        tools.append(
            ToolEntry(
                name=name,
                kind="custom",
                policy="always_allow",
                schema={
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": item["description"],
                        "parameters": copy.deepcopy(item["input_schema"]),
                    },
                },
            )
        )
    return tools


def _compile_mcp(normalized: Mapping[str, Any]) -> tuple[tuple[McpServerSpec, ...], tuple[McpToolsetSpec, ...]]:
    servers = tuple(
        McpServerSpec(name=server["name"], url=server["url"], transport=server["transport"])
        for server in normalized["mcp_servers"]
    )
    toolsets: list[McpToolsetSpec] = []
    for item in normalized["tools"]:
        if item["type"] != "mcp":
            continue
        default_policy = item["default_policy"]
        policies = {
            config["name"]: (config["policy"] or default_policy)
            for config in item["configs"]
            if config["enabled"]
        }
        disabled = frozenset(
            config["name"] for config in item["configs"] if config["enabled"] is False
        )
        toolsets.append(
            McpToolsetSpec(
                server=item["server"],
                default_policy=default_policy,
                policies=policies,
                disabled=disabled,
            )
        )
    return servers, tuple(toolsets)


def compile_spec(agent_id: str, version: int, manifest: Any) -> AgentSpec:
    """Validate + normalize + compile. Raises MAError(MANIFEST_INVALID) on any error."""
    if not isinstance(version, int) or version < 1:
        raise ValueError("version must be >= 1")
    result = validate_manifest(manifest)
    if not result.ok or result.normalized is None or result.manifest_hash is None:
        raise MAError(
            MANIFEST_INVALID,
            "manifest invalid",
            details={"errors": result.errors},
        )
    normalized = result.normalized
    errors = _semantic_errors(normalized, agent_id)
    if errors:
        raise MAError(
            MANIFEST_INVALID,
            "manifest invalid",
            details={"errors": sorted(errors)},
        )
    provider, model = split_model_ref(normalized["model"])
    mcp_servers, mcp_toolsets = _compile_mcp(normalized)
    runtime = normalized["runtime"]
    return AgentSpec(
        agent_id=agent_id,
        version=version,
        manifest_hash=result.manifest_hash,
        model_ref=normalized["model"],
        provider=provider,
        model=model,
        system=normalized["system"],
        tools=tuple(_compile_tools(normalized)),
        mcp_servers=mcp_servers,
        mcp_toolsets=mcp_toolsets,
        skills=tuple(normalized["skills"]),
        max_tool_rounds=runtime["max_tool_rounds"],
        max_session_tokens=runtime["max_session_tokens"],
        metadata=dict(normalized["metadata"]),
        normalized_manifest=normalized,
        multiagent=normalized["multiagent"],
    )


__all__ = [
    "ToolKind",
    "ToolPolicy",
    "MANAGED_BUILTIN_TOOLS",
    "RESERVED_CUSTOM_PREFIXES",
    "RESERVED_CUSTOM_INPUT_PROPERTIES",
    "PLATFORM_TOOL_NAMES",
    "ALL_BUILTIN_NAMES",
    "ToolEntry",
    "McpServerSpec",
    "McpToolsetSpec",
    "AgentSpec",
    "split_model_ref",
    "compile_spec",
]
