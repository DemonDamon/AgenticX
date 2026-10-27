"""Agent Manifest ``agx.agent/v1`` validator.

Author: Damon Li


Validation is procedural so the TypeScript port can reproduce the same error
strings. Pydantic models are carriers built only after validation succeeds.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

MAX_MANIFEST_BYTES = 262144
MAX_SYSTEM_BYTES = 65536
TOP_LEVEL_KEYS = (
    "schema",
    "model",
    "system",
    "tools",
    "mcp_servers",
    "skills",
    "multiagent",
    "runtime",
    "metadata",
)
SYSTEM_MANAGED_METADATA_KEYS = ("model", "description", "agentName")
TOOL_TYPES = ("agx_builtin", "mcp", "custom")
TOOL_POLICIES = ("always_allow", "always_ask")
MCP_TRANSPORTS = ("http", "sse")
MCP_TRANSPORT_ALIASES = {"streamable-http": "http", "streamable_http": "http"}
SKILL_SOURCES = ("builtin", "tenant")
MODEL_RE = re.compile(r"^[^/\s]+/\S+$")
CUSTOM_TOOL_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
DEFAULT_MAX_TOOL_ROUNDS = 40
MULTIAGENT_TYPES = ("coordinator",)
MULTIAGENT_MEMBER_TYPES = ("self", "agent", "advisor")
MULTIAGENT_MAX_MEMBERS = 20
MEMBER_AGENT_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
MAX_ADVISOR_INSTRUCTIONS_BYTES = 8192

REQUIRED_SCHEMA = "agx.agent/v1"
ToolPolicy = Literal["always_allow", "always_ask"]


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ToolConfig(_StrictModel):
    name: str
    policy: ToolPolicy | None = None
    enabled: bool = True


class BuiltinToolset(_StrictModel):
    type: Literal["agx_builtin"]
    default_policy: ToolPolicy = "always_allow"
    configs: list[ToolConfig] = Field(default_factory=list)


class McpToolset(_StrictModel):
    type: Literal["mcp"]
    server: str
    default_policy: ToolPolicy = "always_allow"
    configs: list[ToolConfig] = Field(default_factory=list)


class CustomTool(_StrictModel):
    type: Literal["custom"]
    name: str
    description: str
    input_schema: dict[str, Any]


class McpServer(_StrictModel):
    name: str
    url: str
    transport: Literal["http", "sse"] = "http"


class SkillRef(_StrictModel):
    source: Literal["builtin", "tenant"]
    id: str
    version: str | None = None


class RuntimeLimits(_StrictModel):
    max_tool_rounds: int = 40
    max_session_tokens: int | None = None


class MultiagentSelf(_StrictModel):
    type: Literal["self"]


class MultiagentAgentRef(_StrictModel):
    type: Literal["agent"]
    id: str
    version: int | None = None


class MultiagentAdvisor(_StrictModel):
    type: Literal["advisor"]
    model: str
    instructions: str | None = None


MultiagentMember = Annotated[
    MultiagentSelf | MultiagentAgentRef | MultiagentAdvisor,
    Field(discriminator="type"),
]


class MultiagentConfig(_StrictModel):
    type: Literal["coordinator"]
    agents: list[MultiagentMember]


Toolset = Annotated[
    BuiltinToolset | McpToolset | CustomTool,
    Field(discriminator="type"),
]


class AgentManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    schema_: str = Field(alias="schema")
    model: str
    system: str = ""
    tools: list[Toolset] = Field(default_factory=list)
    mcp_servers: list[McpServer] = Field(default_factory=list)
    skills: list[SkillRef] = Field(default_factory=list)
    multiagent: MultiagentConfig | None = None
    runtime: RuntimeLimits = Field(default_factory=RuntimeLimits)
    metadata: dict[str, Any] = Field(default_factory=dict)


@dataclass
class ManifestResult:
    ok: bool
    errors: list[str]
    manifest: AgentManifest | None
    normalized: dict[str, Any] | None
    manifest_hash: str | None


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def manifest_hash(normalized: dict[str, Any]) -> str:
    digest = hashlib.sha256(canonical_json(normalized).encode("utf-8")).hexdigest()
    return "sha256:" + digest


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _nonempty_str(value: Any) -> bool:
    return isinstance(value, str) and value != ""


def _json_literal(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _failure(errors: list[str]) -> ManifestResult:
    return ManifestResult(
        ok=False,
        errors=sorted(errors),
        manifest=None,
        normalized=None,
        manifest_hash=None,
    )


def _declared_mcp_servers(raw: dict[str, Any]) -> set[str]:
    names: set[str] = set()
    servers = raw.get("mcp_servers")
    if not isinstance(servers, list):
        return names
    for server in servers:
        if not isinstance(server, dict):
            continue
        name = server.get("name")
        if _nonempty_str(name):
            names.add(name)
    return names


def _validate_config(
    errors: list[str],
    tool_index: int,
    config_index: int,
    config: Any,
    seen_names: set[str],
) -> None:
    prefix = f"manifest.tools[{tool_index}].configs[{config_index}]"
    if not isinstance(config, dict):
        errors.append(f"{prefix}: must be an object")
        return
    for key in config:
        if key not in ("name", "policy", "enabled"):
            errors.append(f"{prefix}.{key}: unknown field")
    name = config.get("name")
    if not _nonempty_str(name):
        errors.append(f"{prefix}.name: is required")
    elif name in seen_names:
        errors.append(f'{prefix}.name: duplicate tool "{name}"')
    else:
        seen_names.add(name)
    if "policy" in config and config["policy"] is not None and config["policy"] not in TOOL_POLICIES:
        errors.append(f"{prefix}.policy: must be one of [always_allow,always_ask]")
    if "enabled" in config and not isinstance(config["enabled"], bool):
        errors.append(f"{prefix}.enabled: must be a boolean")


def _validate_tool_configs(errors: list[str], tool_index: int, item: dict[str, Any]) -> None:
    if "configs" not in item:
        return
    configs = item["configs"]
    if not isinstance(configs, list):
        errors.append(f"manifest.tools[{tool_index}].configs: must be an array")
        return
    seen_names: set[str] = set()
    for config_index, config in enumerate(configs):
        _validate_config(errors, tool_index, config_index, config, seen_names)


def _validate_default_policy(errors: list[str], tool_index: int, item: dict[str, Any]) -> None:
    if "default_policy" not in item:
        return
    if item["default_policy"] not in TOOL_POLICIES:
        errors.append(
            f"manifest.tools[{tool_index}].default_policy: must be one of [always_allow,always_ask]"
        )


def _validate_builtin_or_mcp(
    errors: list[str],
    tool_index: int,
    item: dict[str, Any],
    *,
    allowed_keys: tuple[str, ...],
) -> None:
    for key in item:
        if key not in allowed_keys:
            errors.append(f"manifest.tools[{tool_index}].{key}: unknown field")
    _validate_default_policy(errors, tool_index, item)
    _validate_tool_configs(errors, tool_index, item)


def _validate_mcp_server_ref(
    errors: list[str],
    tool_index: int,
    item: dict[str, Any],
    declared_servers: set[str] | None,
    seen_mcp_servers: set[str],
) -> None:
    server = item.get("server")
    if not _nonempty_str(server):
        errors.append(f"manifest.tools[{tool_index}].server: is required")
        return
    if declared_servers is not None and server not in declared_servers:
        errors.append(
            f'manifest.tools[{tool_index}].server: references undeclared mcp server "{server}"'
        )
    if server in seen_mcp_servers:
        errors.append(
            f'manifest.tools[{tool_index}].server: duplicate toolset for mcp server "{server}"'
        )
    else:
        seen_mcp_servers.add(server)


def _validate_custom_tool(errors: list[str], tool_index: int, item: dict[str, Any], seen_custom: set[str]) -> None:
    for key in item:
        if key not in ("type", "name", "description", "input_schema"):
            errors.append(f"manifest.tools[{tool_index}].{key}: unknown field")
    name = item.get("name")
    if not isinstance(name, str) or CUSTOM_TOOL_NAME_RE.fullmatch(name) is None:
        errors.append(
            f"manifest.tools[{tool_index}].name: must match ^[A-Za-z][A-Za-z0-9_]{{0,63}}$"
        )
    if isinstance(name, str):
        if name in seen_custom:
            errors.append(f'manifest.tools[{tool_index}].name: duplicate custom tool "{name}"')
        else:
            seen_custom.add(name)
    if not _nonempty_str(item.get("description")):
        errors.append(f"manifest.tools[{tool_index}].description: is required")
    if not isinstance(item.get("input_schema"), dict):
        errors.append(f"manifest.tools[{tool_index}].input_schema: must be an object")


def _validate_tools(raw: dict[str, Any], errors: list[str], declared_servers: set[str] | None) -> None:
    if "tools" not in raw:
        return
    tools = raw["tools"]
    if not isinstance(tools, list):
        errors.append("manifest.tools: must be an array")
        return
    seen_builtin = False
    seen_mcp_servers: set[str] = set()
    seen_custom: set[str] = set()
    for index, item in enumerate(tools):
        if not isinstance(item, dict):
            errors.append(f"manifest.tools[{index}]: must be an object")
            continue
        tool_type = item.get("type")
        if tool_type not in TOOL_TYPES:
            rendered = _json_literal(item["type"]) if "type" in item else "null"
            errors.append(
                "manifest.tools["
                f"{index}].type: must be one of [agx_builtin,mcp,custom], got {rendered}"
            )
            continue
        if tool_type == "agx_builtin":
            _validate_builtin_or_mcp(
                errors,
                index,
                item,
                allowed_keys=("type", "default_policy", "configs"),
            )
            if seen_builtin:
                errors.append(f"manifest.tools[{index}].type: duplicate agx_builtin toolset")
            else:
                seen_builtin = True
        elif tool_type == "mcp":
            _validate_builtin_or_mcp(
                errors,
                index,
                item,
                allowed_keys=("type", "server", "default_policy", "configs"),
            )
            _validate_mcp_server_ref(errors, index, item, declared_servers, seen_mcp_servers)
        else:
            _validate_custom_tool(errors, index, item, seen_custom)


def _validate_mcp_servers(raw: dict[str, Any], errors: list[str]) -> None:
    if "mcp_servers" not in raw:
        return
    servers = raw["mcp_servers"]
    if not isinstance(servers, list):
        errors.append("manifest.mcp_servers: must be an array")
        return
    seen_names: set[str] = set()
    allowed = ("name", "url", "transport", "headers", "env")
    for index, server in enumerate(servers):
        prefix = f"manifest.mcp_servers[{index}]"
        if not isinstance(server, dict):
            errors.append(f"{prefix}: must be an object")
            continue
        for key in server:
            if key in ("headers", "env"):
                errors.append(f"{prefix}.{key}: secrets are not allowed in manifest")
            elif key not in allowed:
                errors.append(f"{prefix}.{key}: unknown field")
        name = server.get("name")
        if not _nonempty_str(name):
            errors.append(f"{prefix}.name: is required")
        elif name in seen_names:
            errors.append(f'{prefix}.name: duplicate mcp server "{name}"')
        else:
            seen_names.add(name)
        url = server.get("url")
        if not _nonempty_str(url):
            errors.append(f"{prefix}.url: is required")
        elif not (url.startswith("https://") or url.startswith("http://")):
            errors.append(f"{prefix}.url: must start with http:// or https://")
        if "transport" in server:
            transport = server["transport"]
            if isinstance(transport, str):
                transport = MCP_TRANSPORT_ALIASES.get(transport, transport)
            if transport not in MCP_TRANSPORTS:
                errors.append(f"{prefix}.transport: must be one of [http,sse]")


def _validate_skills(raw: dict[str, Any], errors: list[str]) -> None:
    if "skills" not in raw:
        return
    skills = raw["skills"]
    if not isinstance(skills, list):
        errors.append("manifest.skills: must be an array")
        return
    for index, skill in enumerate(skills):
        prefix = f"manifest.skills[{index}]"
        if not isinstance(skill, dict):
            errors.append(f"{prefix}: must be an object")
            continue
        for key in skill:
            if key not in ("source", "id", "version"):
                errors.append(f"{prefix}.{key}: unknown field")
        if skill.get("source") not in SKILL_SOURCES:
            errors.append(f"{prefix}.source: must be one of [builtin,tenant]")
        if not _nonempty_str(skill.get("id")):
            errors.append(f"{prefix}.id: is required")
        if "version" in skill and skill["version"] is not None and not _nonempty_str(skill["version"]):
            errors.append(f"{prefix}.version: must be a string")


def _validate_runtime(raw: dict[str, Any], errors: list[str]) -> None:
    if "runtime" not in raw:
        return
    runtime = raw["runtime"]
    if not isinstance(runtime, dict):
        errors.append("manifest.runtime: must be an object")
        return
    for key in runtime:
        if key not in ("max_tool_rounds", "max_session_tokens"):
            errors.append(f"manifest.runtime.{key}: unknown field")
    if "max_tool_rounds" in runtime:
        rounds = runtime["max_tool_rounds"]
        if not (_is_int(rounds) and 1 <= rounds <= 500):
            errors.append("manifest.runtime.max_tool_rounds: must be an integer between 1 and 500")
    if "max_session_tokens" in runtime and runtime["max_session_tokens"] is not None:
        tokens = runtime["max_session_tokens"]
        if not (_is_int(tokens) and tokens >= 1000):
            errors.append(
                "manifest.runtime.max_session_tokens: must be null or an integer >= 1000"
            )


def _validate_multiagent(raw: dict[str, Any], errors: list[str]) -> None:
    """Procedural rules M1–M18. Error strings match the TypeScript port."""
    if "multiagent" not in raw or raw["multiagent"] is None:
        return
    value = raw["multiagent"]
    if not isinstance(value, dict):
        errors.append("manifest.multiagent: must be null or an object")
        return
    for key in value:
        if key not in ("type", "agents"):
            errors.append(f"manifest.multiagent.{key}: unknown field")
    if value.get("type") not in MULTIAGENT_TYPES:
        errors.append('manifest.multiagent.type: must be "coordinator"')
    if "agents" not in value or not isinstance(value.get("agents"), list):
        errors.append("manifest.multiagent.agents: must be an array")
        return
    agents = value["agents"]
    if len(agents) == 0 or len(agents) > MULTIAGENT_MAX_MEMBERS:
        errors.append("manifest.multiagent.agents: must contain 1-20 items")
        return
    seen_self = False
    seen_advisor = False
    seen_agent_ids: set[str] = set()
    has_delegate = False
    for index, item in enumerate(agents):
        prefix = f"manifest.multiagent.agents[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{prefix}: must be an object")
            continue
        kind = item.get("type")
        if kind not in MULTIAGENT_MEMBER_TYPES:
            errors.append(
                f"{prefix}.type: must be one of [self,agent,advisor], got {_json_literal(kind)}"
            )
            continue
        if kind in ("self", "agent"):
            has_delegate = True
        if kind == "self":
            for key in item:
                if key != "type":
                    errors.append(f"{prefix}.{key}: unknown field")
            if seen_self:
                errors.append(f"{prefix}.type: duplicate self entry")
            else:
                seen_self = True
            continue
        if kind == "agent":
            for key in item:
                if key not in ("type", "id", "version"):
                    errors.append(f"{prefix}.{key}: unknown field")
            agent_id = item.get("id")
            if "id" not in item or not _nonempty_str(agent_id):
                errors.append(f"{prefix}.id: is required")
            elif MEMBER_AGENT_ID_RE.fullmatch(agent_id) is None:
                errors.append(f"{prefix}.id: must match ^[A-Za-z0-9._-]{{1,64}}$")
            elif agent_id in seen_agent_ids:
                errors.append(f'{prefix}.id: duplicate agent "{agent_id}"')
            else:
                seen_agent_ids.add(agent_id)
            if "version" in item and item["version"] is not None:
                version = item["version"]
                if not (_is_int(version) and version >= 1):
                    errors.append(f"{prefix}.version: must be null or an integer >= 1")
            continue
        for key in item:
            if key not in ("type", "model", "instructions"):
                errors.append(f"{prefix}.{key}: unknown field")
        model = item.get("model")
        if "model" not in item:
            errors.append(f"{prefix}.model: is required")
        elif not isinstance(model, str) or MODEL_RE.fullmatch(model) is None:
            errors.append(f'{prefix}.model: must be "<providerId>/<modelName>"')
        if "instructions" in item and item["instructions"] is not None:
            instructions = item["instructions"]
            if not isinstance(instructions, str):
                errors.append(f"{prefix}.instructions: must be a string")
            elif len(instructions.encode("utf-8")) > MAX_ADVISOR_INSTRUCTIONS_BYTES:
                errors.append(f"{prefix}.instructions: exceeds 8192 bytes")
        if seen_advisor:
            errors.append(f"{prefix}.type: duplicate advisor entry")
        else:
            seen_advisor = True
    if not has_delegate:
        errors.append("manifest.multiagent.agents: must include at least one self or agent entry")


def _normalize_multiagent(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    members: list[dict[str, Any]] = []
    for item in value["agents"]:
        kind = item["type"]
        if kind == "self":
            members.append({"type": "self"})
        elif kind == "agent":
            members.append({"type": "agent", "id": item["id"], "version": item.get("version", None)})
        else:
            members.append(
                {
                    "type": "advisor",
                    "model": item["model"],
                    "instructions": item.get("instructions", None),
                }
            )
    return {"type": "coordinator", "agents": members}


def _validate_fields(raw: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for key in raw:
        if key not in TOP_LEVEL_KEYS:
            errors.append(f"manifest.{key}: unknown field")
    if raw.get("schema") != REQUIRED_SCHEMA:
        errors.append('manifest.schema: must be "agx.agent/v1"')
    if "model" not in raw:
        errors.append("manifest.model: is required")
    else:
        model = raw["model"]
        if not isinstance(model, str) or MODEL_RE.fullmatch(model) is None:
            errors.append('manifest.model: must be "<providerId>/<modelName>"')
    if "system" in raw:
        system = raw["system"]
        if not isinstance(system, str):
            errors.append("manifest.system: must be a string")
        elif len(system.encode("utf-8")) > MAX_SYSTEM_BYTES:
            errors.append("manifest.system: exceeds 65536 bytes")
    declared = _declared_mcp_servers(raw) if isinstance(raw.get("mcp_servers"), list) else None
    _validate_tools(raw, errors, declared)
    _validate_mcp_servers(raw, errors)
    _validate_skills(raw, errors)
    _validate_multiagent(raw, errors)
    _validate_runtime(raw, errors)
    if "metadata" in raw and not isinstance(raw["metadata"], dict):
        errors.append("manifest.metadata: must be an object")
    return errors


def _normalize_config(config: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": config["name"],
        "policy": config.get("policy", None),
        "enabled": config.get("enabled", True),
    }


def _normalize_transport(server: dict[str, Any]) -> str:
    transport = server.get("transport", "http")
    if isinstance(transport, str):
        return MCP_TRANSPORT_ALIASES.get(transport, transport)
    return transport


def normalize_manifest(raw: dict[str, Any]) -> dict[str, Any]:
    """Return a new normalized manifest. ``raw`` must already be valid."""
    tools: list[dict[str, Any]] = []
    for item in raw.get("tools", []):
        tool_type = item["type"]
        if tool_type == "agx_builtin":
            tools.append(
                {
                    "type": "agx_builtin",
                    "default_policy": item.get("default_policy", "always_allow"),
                    "configs": [_normalize_config(config) for config in item.get("configs", [])],
                }
            )
        elif tool_type == "mcp":
            tools.append(
                {
                    "type": "mcp",
                    "server": item["server"],
                    "default_policy": item.get("default_policy", "always_allow"),
                    "configs": [_normalize_config(config) for config in item.get("configs", [])],
                }
            )
        else:
            tools.append(
                {
                    "type": "custom",
                    "name": item["name"],
                    "description": item["description"],
                    "input_schema": dict(item["input_schema"]),
                }
            )

    mcp_servers = [
        {
            "name": server["name"],
            "url": server["url"],
            "transport": _normalize_transport(server),
        }
        for server in raw.get("mcp_servers", [])
    ]
    skills = [
        {
            "source": skill["source"],
            "id": skill["id"],
            "version": skill.get("version", None),
        }
        for skill in raw.get("skills", [])
    ]
    runtime_in = raw.get("runtime", {})
    runtime = {
        "max_tool_rounds": runtime_in.get("max_tool_rounds", DEFAULT_MAX_TOOL_ROUNDS),
        "max_session_tokens": runtime_in.get("max_session_tokens", None),
    }
    metadata = dict(raw.get("metadata", {}))
    for key in SYSTEM_MANAGED_METADATA_KEYS:
        metadata.pop(key, None)
    return {
        "schema": raw["schema"],
        "model": raw["model"],
        "system": raw.get("system", ""),
        "tools": tools,
        "mcp_servers": mcp_servers,
        "skills": skills,
        "multiagent": _normalize_multiagent(raw.get("multiagent")),
        "runtime": runtime,
        "metadata": metadata,
    }


def validate_manifest(raw: Any) -> ManifestResult:
    if not isinstance(raw, dict):
        return _failure(["manifest: must be a JSON object"])
    encoded = json.dumps(raw, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_MANIFEST_BYTES:
        return _failure(["manifest: exceeds 262144 bytes"])
    errors = _validate_fields(raw)
    if errors:
        return _failure(errors)
    normalized = normalize_manifest(raw)
    parsed = AgentManifest.model_validate(normalized)
    return ManifestResult(
        ok=True,
        errors=[],
        manifest=parsed,
        normalized=normalized,
        manifest_hash=manifest_hash(normalized),
    )
