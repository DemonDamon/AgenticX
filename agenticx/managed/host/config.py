#!/usr/bin/env python3
"""Development host configuration loaded from a local agents file.

Author: Damon Li
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from agenticx.managed.credentials import LocalCredentialSpec, normalize_mcp_url
from agenticx.managed.errors import MAError
from agenticx.managed.ids import utc_now_iso
from agenticx.managed.manifest import validate_manifest
from agenticx.managed.protocol import (
    PAT_SCOPES,
    SSE_PING_INTERVAL_SECONDS,
    AgentRecord,
    AgentVersionRecord,
    EnvironmentRecord,
)
from agenticx.managed.spec import compile_spec
from agenticx.runtime.enterprise_agent_policy import EnterpriseAgentPolicy, policy_from_mapping

DEV_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_SECRET_REF_RE = re.compile(r"^\$\{cred:[A-Z][A-Z0-9_]{1,63}\}$")
_SECRET_NAME_RE = re.compile(r"^[A-Z_][A-Z0-9_]{0,127}$")
_CREDENTIAL_TYPES = frozenset({"static_bearer", "mcp_oauth", "bearer", "environment_variable"})
_PLAINTEXT_KEYS = frozenset(
    {"token", "secret", "secret_value", "access_token", "refresh_token", "client_secret", "value"}
)
_RESERVED_SECRET_NAMES = frozenset(
    {
        "PATH",
        "HOME",
        "SHELL",
        "USER",
        "LOGNAME",
        "PWD",
        "TMPDIR",
        "LANG",
        "TERM",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "SSL_CERT_FILE",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "NODE_EXTRA_CA_CERTS",
        "NODE_OPTIONS",
        "PYTHONPATH",
        "PYTHONHOME",
    }
)
_RESERVED_SECRET_PREFIXES = ("LD_", "DYLD_", "AGX_", "MA_")
DEFAULT_TENANT_ID = "dev"
DEFAULT_PORT = 8092


class HostConfigError(ValueError):
    """A development agents file or host option failed validation."""


@dataclass(frozen=True)
class Principal:
    """Authenticated caller. ``ma:admin`` satisfies every scope check."""

    tenant_id: str
    user_id: str
    scopes: frozenset[str]


@dataclass(frozen=True)
class AgentDefinition:
    """One agent and every version declared in the development file."""

    record: AgentRecord
    versions: Mapping[int, AgentVersionRecord]


@dataclass
class HostConfig:
    """Injectable host settings. Storage, tokens, and agents can be replaced."""

    data_dir: Path
    tenant_id: str = DEFAULT_TENANT_ID
    tokens: Mapping[str, Principal] = field(default_factory=dict)
    agents: Mapping[str, AgentDefinition] = field(default_factory=dict)
    environments: Mapping[str, EnvironmentRecord] = field(default_factory=dict)
    enterprise_policy: EnterpriseAgentPolicy = field(default_factory=EnterpriseAgentPolicy)
    dev: bool = True
    interrupt_grace_seconds: float = 3.0
    sse_ping_seconds: float = float(SSE_PING_INTERVAL_SECONDS)
    tasks_enabled: bool = False
    threads_enabled: bool = False
    task_foreground_seconds: float = 60.0
    task_max_runtime_seconds: float = 3600.0
    max_running_tasks: int = 8
    vaults: Mapping[str, tuple[LocalCredentialSpec, ...]] = field(default_factory=dict)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "ma.sqlite3"

    @property
    def workdir_root(self) -> Path:
        return self.data_dir / "sessions"


def default_environments(tenant_id: str) -> dict[str, EnvironmentRecord]:
    """Built-in ``local`` cloud environment and ``worker`` desktop environment."""
    local = EnvironmentRecord.model_validate(
        {
            "id": "local",
            "tenant_id": tenant_id,
            "name": "Local host (subprocess)",
            "type": "cloud",
            "config": {"type": "cloud", "sandbox_backend": "subprocess"},
            "status": "active",
        }
    )
    worker = EnvironmentRecord.model_validate(
        {
            "id": "worker",
            "tenant_id": tenant_id,
            "name": "Desktop worker",
            "type": "desktop_worker",
            "config": {"type": "desktop_worker"},
            "status": "active",
        }
    )
    return {"local": local, "worker": worker}


def dev_principal(tenant_id: str) -> Principal:
    """Single-tenant development user holding every PAT scope."""
    return Principal(
        tenant_id=tenant_id,
        user_id="dev-user",
        scopes=frozenset(PAT_SCOPES),
    )


def _positive_version(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 1


def _version_entries(index: int, item: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    has_versions = "versions" in item and item.get("versions") is not None
    has_manifest = "manifest" in item and item.get("manifest") is not None
    if has_versions == has_manifest:
        raise HostConfigError(f"agents[{index}]: exactly one of versions/manifest is required")
    if has_manifest:
        return [{"version": 1, "manifest": item["manifest"]}]
    versions = item.get("versions")
    if not isinstance(versions, list):
        raise HostConfigError(f"agents[{index}]: exactly one of versions/manifest is required")
    entries: list[Mapping[str, Any]] = []
    for entry in versions:
        if not isinstance(entry, Mapping):
            raise HostConfigError(
                f"agents[{index}].versions[0].version: must be a unique integer >= 1"
            )
        entries.append(entry)
    return entries


def _compile_version(
    agent_index: int,
    version_index: int,
    agent_id: str,
    entry: Mapping[str, Any],
    seen_versions: set[int],
) -> AgentVersionRecord:
    prefix = f"agents[{agent_index}].versions[{version_index}]"
    version = entry.get("version")
    if not _positive_version(version) or version in seen_versions:
        raise HostConfigError(f"{prefix}.version: must be a unique integer >= 1")
    seen_versions.add(version)
    manifest = entry.get("manifest")
    result = validate_manifest(manifest)
    manifest_prefix = f"{prefix}.manifest: "
    if not result.ok or result.normalized is None or result.manifest_hash is None:
        raise HostConfigError(manifest_prefix + "; ".join(result.errors))
    try:
        compile_spec(agent_id, version, result.normalized)
    except MAError as exc:
        details = exc.details.get("errors")
        if isinstance(details, list):
            reason = "; ".join(str(item) for item in details)
        else:
            reason = exc.message
        raise HostConfigError(manifest_prefix + reason) from None
    return AgentVersionRecord(
        agent_id=agent_id,
        version=version,
        manifest=result.normalized,
        manifest_hash=result.manifest_hash,
        created_by=None,
        created_at=utc_now_iso(),
        note=None,
    )


def _load_environments(
    raw: Mapping[str, Any],
    tenant_id: str,
) -> dict[str, EnvironmentRecord]:
    environments = default_environments(tenant_id)
    if "environments" not in raw or raw.get("environments") is None:
        return environments
    items = raw.get("environments")
    if not isinstance(items, list):
        raise HostConfigError("environments: must be a list")
    for index, item in enumerate(items):
        if not isinstance(item, Mapping):
            raise HostConfigError(f"environments[{index}]: invalid")
        payload = dict(item)
        payload["tenant_id"] = tenant_id
        payload["status"] = "active"
        try:
            record = EnvironmentRecord.model_validate(payload)
        except ValidationError:
            raise HostConfigError(f"environments[{index}]: invalid") from None
        environments[record.id] = record
    return environments


def _load_agent(
    index: int,
    item: Any,
    tenant_id: str,
    environments: Mapping[str, EnvironmentRecord],
    seen_ids: set[str],
) -> AgentDefinition:
    if not isinstance(item, Mapping):
        raise HostConfigError(f"agents[{index}].id: invalid id")
    agent_id = item.get("id")
    if not isinstance(agent_id, str) or DEV_ID_RE.fullmatch(agent_id) is None:
        raise HostConfigError(f"agents[{index}].id: invalid id")
    if agent_id in seen_ids:
        raise HostConfigError(f"agents[{index}].id: duplicate agent id")
    seen_ids.add(agent_id)
    slug = item.get("slug", agent_id)
    if not isinstance(slug, str) or not slug:
        slug = agent_id
    display_name = item.get("display_name", slug)
    if not isinstance(display_name, str) or not display_name:
        display_name = slug
    description = item.get("description")
    if description is not None and not isinstance(description, str):
        description = None
    default_environment_id = item.get("default_environment_id", "local")
    if default_environment_id is None:
        default_environment_id = "local"
    if not isinstance(default_environment_id, str) or default_environment_id not in environments:
        raise HostConfigError(f"agents[{index}].default_environment_id: unknown environment")
    seen_versions: set[int] = set()
    version_records: dict[int, AgentVersionRecord] = {}
    for version_index, entry in enumerate(_version_entries(index, item)):
        record = _compile_version(index, version_index, agent_id, entry, seen_versions)
        version_records[record.version] = record
    if not version_records:
        raise HostConfigError(f"agents[{index}]: exactly one of versions/manifest is required")
    latest = max(version_records)
    agent = AgentRecord(
        id=agent_id,
        tenant_id=tenant_id,
        slug=slug,
        display_name=display_name,
        description=description,
        latest_version=latest,
        status="active",
        lifecycle="published",
        origin="enterprise",
        assignment_keys=[],
        worker_keys=[],
        default_environment_id=default_environment_id,
    )
    return AgentDefinition(record=agent, versions=version_records)


def load_agents_file(
    path: Path,
) -> tuple[str, dict[str, AgentDefinition], dict[str, EnvironmentRecord], EnterpriseAgentPolicy]:
    """Load tenant, agents, environments, and enterprise policy from YAML."""
    file_path = Path(path)
    if not file_path.is_file():
        raise HostConfigError(f"{file_path}: file not found")
    try:
        loaded = yaml.safe_load(file_path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise HostConfigError(f"{file_path}: must be a mapping") from exc
    if not isinstance(loaded, Mapping):
        raise HostConfigError(f"{file_path}: must be a mapping")
    tenant_raw = loaded.get("tenant_id", DEFAULT_TENANT_ID)
    if not isinstance(tenant_raw, str) or not tenant_raw:
        raise HostConfigError(f"{file_path}: must be a mapping")
    tenant_id = tenant_raw
    environments = _load_environments(loaded, tenant_id)
    policy_raw = loaded.get("enterprise_agent_policy")
    policy = policy_from_mapping(policy_raw) if policy_raw is not None else EnterpriseAgentPolicy()
    if "agents" not in loaded or not isinstance(loaded.get("agents"), list):
        raise HostConfigError("agents: must be a list")
    agents: dict[str, AgentDefinition] = {}
    seen_ids: set[str] = set()
    for index, item in enumerate(loaded["agents"]):
        definition = _load_agent(index, item, tenant_id, environments, seen_ids)
        agents[definition.record.id] = definition
    return tenant_id, agents, environments, policy


def build_dev_config(*, agents_file: Path, data_dir: Path, token: str) -> HostConfig:
    """Build a single-tenant development config and create ``data_dir``."""
    tenant_id, agents, environments, policy = load_agents_file(agents_file)
    vaults = _vaults_from_agents_file(agents_file)
    resolved = Path(data_dir).expanduser().resolve()
    resolved.mkdir(parents=True, exist_ok=True)
    return HostConfig(
        data_dir=resolved,
        tenant_id=tenant_id,
        tokens={token: dev_principal(tenant_id)},
        agents=agents,
        environments=environments,
        enterprise_policy=policy,
        dev=True,
        vaults=vaults,
    )


def _vault_error(index: int, cred_index: int, field_name: str) -> HostConfigError:
    return HostConfigError(f"vaults[{index}].credentials[{cred_index}].{field_name}: invalid")


def _vaults_from_agents_file(path: Path) -> dict[str, tuple[LocalCredentialSpec, ...]]:
    loaded = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if not isinstance(loaded, Mapping) or "vaults" not in loaded or loaded.get("vaults") is None:
        return {}
    return _load_vaults(loaded.get("vaults"))


def _load_vaults(raw: Any) -> dict[str, tuple[LocalCredentialSpec, ...]]:
    if not isinstance(raw, list):
        raise HostConfigError("vaults: must be a list")
    vaults: dict[str, tuple[LocalCredentialSpec, ...]] = {}
    for index, item in enumerate(raw):
        if not isinstance(item, Mapping):
            raise HostConfigError(f"vaults[{index}].id: invalid")
        vault_id = item.get("id")
        if not isinstance(vault_id, str) or DEV_ID_RE.fullmatch(vault_id) is None or vault_id in vaults:
            raise HostConfigError(f"vaults[{index}].id: invalid")
        credentials = item.get("credentials", [])
        if not isinstance(credentials, list):
            raise HostConfigError(f"vaults[{index}].credentials: invalid")
        seen_ids: set[str] = set()
        specs: list[LocalCredentialSpec] = []
        for cred_index, credential in enumerate(credentials):
            specs.append(_load_local_credential(index, cred_index, credential, seen_ids))
        vaults[vault_id] = tuple(specs)
    return vaults


def _load_local_credential(
    index: int,
    cred_index: int,
    raw: Any,
    seen_ids: set[str],
) -> LocalCredentialSpec:
    if not isinstance(raw, Mapping):
        raise _vault_error(index, cred_index, "id")
    for key in _PLAINTEXT_KEYS:
        if key in raw:
            raise _vault_error(index, cred_index, key)
    credential_id = raw.get("id")
    if (
        not isinstance(credential_id, str)
        or DEV_ID_RE.fullmatch(credential_id) is None
        or credential_id in seen_ids
    ):
        raise _vault_error(index, cred_index, "id")
    seen_ids.add(credential_id)
    credential_type = raw.get("type")
    if credential_type not in _CREDENTIAL_TYPES:
        raise _vault_error(index, cred_index, "type")
    secret_ref = raw.get("secret_ref")
    if not isinstance(secret_ref, str) or _SECRET_REF_RE.fullmatch(secret_ref) is None:
        raise _vault_error(index, cred_index, "secret_ref")
    display = raw.get("display_name")
    if display is not None and not isinstance(display, str):
        raise _vault_error(index, cred_index, "display_name")
    mcp_url: str | None = None
    host: str | None = None
    secret_name: str | None = None
    networking: str | None = None
    allowed: tuple[str, ...] = ()
    if credential_type in {"static_bearer", "mcp_oauth"}:
        mcp_url = _load_mcp_url(index, cred_index, raw.get("mcp_server_url"))
    elif credential_type == "bearer":
        host = _load_host(index, cred_index, raw.get("host"), allow_wildcard=False)
    else:
        secret_name = _load_secret_name(index, cred_index, raw.get("secret_name"))
        networking, allowed = _load_networking(index, cred_index, raw.get("networking"))
    return LocalCredentialSpec(
        credential_id=credential_id,
        type=credential_type,
        secret_ref=secret_ref,
        display_name=display,
        mcp_server_url=mcp_url,
        host=host,
        secret_name=secret_name,
        networking=networking,  # type: ignore[arg-type]
        allowed_hosts=allowed,
    )


def _load_mcp_url(index: int, cred_index: int, raw: Any) -> str:
    if not isinstance(raw, str) or "?" in raw or "#" in raw:
        raise _vault_error(index, cred_index, "mcp_server_url")
    normalized = normalize_mcp_url(raw)
    if normalized is None or "?" in normalized:
        raise _vault_error(index, cred_index, "mcp_server_url")
    return normalized


def _load_host(index: int, cred_index: int, raw: Any, *, allow_wildcard: bool) -> str:
    if not isinstance(raw, str):
        raise _vault_error(index, cred_index, "host")
    host = raw.strip().lower().rstrip(".")
    if not host or len(host) > 253 or "/" in host or ":" in host or " " in host:
        raise _vault_error(index, cred_index, "host")
    if host.startswith("*.") and not allow_wildcard:
        raise _vault_error(index, cred_index, "host")
    if host.startswith("*.") and host.count(".") < 2:
        raise _vault_error(index, cred_index, "host")
    return host


def _load_secret_name(index: int, cred_index: int, raw: Any) -> str:
    if not isinstance(raw, str) or _SECRET_NAME_RE.fullmatch(raw) is None:
        raise _vault_error(index, cred_index, "secret_name")
    if raw in _RESERVED_SECRET_NAMES or raw.startswith(_RESERVED_SECRET_PREFIXES):
        raise _vault_error(index, cred_index, "secret_name")
    return raw


def _load_networking(
    index: int,
    cred_index: int,
    raw: Any,
) -> tuple[str, tuple[str, ...]]:
    if not isinstance(raw, Mapping):
        raise _vault_error(index, cred_index, "networking")
    kind = raw.get("type")
    hosts = raw.get("allowed_hosts")
    if kind == "unrestricted":
        if hosts:
            raise _vault_error(index, cred_index, "networking")
        return "unrestricted", ()
    if kind != "limited" or not isinstance(hosts, list) or not hosts or len(hosts) > 16:
        raise _vault_error(index, cred_index, "networking")
    normalized: list[str] = []
    for host in hosts:
        normalized.append(_load_host(index, cred_index, host, allow_wildcard=True))
    deduped: list[str] = []
    for host in normalized:
        if host not in deduped:
            deduped.append(host)
    return "limited", tuple(deduped)


__all__ = [
    "DEV_ID_RE",
    "DEFAULT_PORT",
    "DEFAULT_TENANT_ID",
    "AgentDefinition",
    "HostConfig",
    "HostConfigError",
    "Principal",
    "build_dev_config",
    "default_environments",
    "dev_principal",
    "load_agents_file",
]
