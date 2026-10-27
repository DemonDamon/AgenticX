#!/usr/bin/env python3
"""Export a local avatar as an agx.agent/v1 manifest and submit it as an enterprise draft version.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Mapping

import httpx

from agenticx.avatar.registry import AvatarConfig
from agenticx.cli.config_manager import ConfigManager
from agenticx.managed.errors import MAError
from agenticx.managed.manifest import MAX_MANIFEST_BYTES, MAX_SYSTEM_BYTES, validate_manifest
from agenticx.managed.spec import MANAGED_BUILTIN_TOOLS, compile_spec
from agenticx.runtime.credential_store import CRED_REF_RE, redact_text

logger = logging.getLogger(__name__)

ASK_BY_DEFAULT: tuple[str, ...] = ("bash_exec", "file_write", "file_edit")
DEFAULT_MAX_TOOL_ROUNDS = 40
ENTERPRISE_PROVIDER = "enterprise"
SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"agx-pat-[A-Za-z0-9._-]+"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{12,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
)
HOME_PATH_RE = re.compile(
    r"(?:/Users/[^/\s]+|/home/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)"
)
WARN_SKILLS = "本机技能不随版本发布；企业技能需管理员在企业技能库上架后，在管理台为该智能体添加"
WARN_MCP = "本机 MCP 服务不随版本发布；需要的 MCP 由管理员在管理台配置"
WARN_MODEL = "企业模型服务中需存在模型 {model}；如不存在，管理员可在发布前调整"
ERR_NO_MODEL = "请先在「基本信息」里为分身设置默认模型"
ERR_NOT_LOGGED_IN = "enterprise_login_required"


@dataclass
class PublishReport:
    model: str = ""
    included_tools: list[dict[str, str]] = field(default_factory=list)
    disabled_tools: list[str] = field(default_factory=list)
    excluded_tools: list[dict[str, str]] = field(default_factory=list)
    removed_credential_refs: list[str] = field(default_factory=list)
    redacted_secrets: int = 0
    replaced_local_paths: int = 0
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class EnterprisePublishError(Exception):
    def __init__(self, status: int, message: str, errors: list[str] | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.errors = list(errors or [])


def sanitize_system_prompt(text: str) -> tuple[str, list[str], int, int]:
    """Return (clean_text, removed_credential_ref_names, redacted_secret_count, replaced_path_count)."""

    refs = sorted(set(CRED_REF_RE.findall(text)))
    text = CRED_REF_RE.sub(lambda match: f"[凭证引用已移除:{match.group(1)}]", text)
    marks_before = text.count("[REDACTED:")
    text = redact_text(text)
    secrets = text.count("[REDACTED:") - marks_before
    for pattern in SECRET_PATTERNS:
        text, count = pattern.subn("[REDACTED]", text)
        secrets += count
    text, paths = HOME_PATH_RE.subn("~", text)
    return text, refs, secrets, paths


def resolve_manifest_model(provider: str, model: str) -> str | None:
    """Map a local provider/model pair onto ``<provider>/<model>``."""

    provider = (provider or "").strip()
    model = (model or "").strip()
    if not model:
        return None
    if provider == ENTERPRISE_PROVIDER and "/" in model:
        return model
    if not provider:
        return None
    return f"{provider}/{model}"


def effective_tool_enabled(
    name: str,
    avatar_tools: Mapping[str, bool],
    global_tools: Mapping[str, bool],
) -> bool:
    """Avatar key wins, then global key, default True (same rule as server._filter_tools_by_policy)."""

    if name in avatar_tools:
        return bool(avatar_tools[name])
    if name in global_tools:
        return bool(global_tools[name])
    return True


def load_global_tools_enabled() -> dict[str, bool]:
    """ConfigManager.get_value('tools_enabled') sanitized to {str: bool}; errors -> {}."""

    try:
        raw = ConfigManager.get_value("tools_enabled")
    except Exception:
        return {}
    if not isinstance(raw, dict):
        return {}
    return {
        str(key): bool(value)
        for key, value in raw.items()
        if str(key).strip()
    }


def build_publish_manifest(
    avatar: AvatarConfig,
    *,
    global_tools_enabled: Mapping[str, bool],
) -> tuple[dict[str, Any], PublishReport]:
    """Build an agx.agent/v1 manifest and a preview report. Errors stay on the report."""

    report = PublishReport()
    model = resolve_manifest_model(avatar.default_provider, avatar.default_model)
    if model is None:
        report.errors.append(ERR_NO_MODEL)
        model = ""
    report.model = model
    system, refs, secrets, paths = sanitize_system_prompt(avatar.system_prompt or "")
    report.removed_credential_refs = refs
    report.redacted_secrets = secrets
    report.replaced_local_paths = paths
    if len(system.encode("utf-8")) > MAX_SYSTEM_BYTES:
        report.errors.append("系统提示超过 64 KiB，请精简后再提交")
    avatar_tools = {str(key): bool(value) for key, value in (avatar.tools_enabled or {}).items()}
    configs: list[dict[str, Any]] = []
    for name in MANAGED_BUILTIN_TOOLS:
        if not effective_tool_enabled(name, avatar_tools, global_tools_enabled):
            configs.append({"name": name, "enabled": False})
            report.disabled_tools.append(name)
            continue
        if name in ASK_BY_DEFAULT:
            configs.append({"name": name, "policy": "always_ask"})
            report.included_tools.append({"name": name, "policy": "always_ask"})
        else:
            report.included_tools.append({"name": name, "policy": "always_allow"})
    for name, enabled in sorted(avatar_tools.items()):
        if enabled and name not in MANAGED_BUILTIN_TOOLS:
            report.excluded_tools.append({"name": name, "reason": "托管模式不支持该工具"})
    welcome, _, _, _ = sanitize_system_prompt((avatar.description or "").strip()[:500])
    manifest: dict[str, Any] = {
        "schema": "agx.agent/v1",
        "model": model,
        "system": system,
        "tools": [{"type": "agx_builtin", "default_policy": "always_allow", "configs": configs}],
        "mcp_servers": [],
        "skills": [],
        "multiagent": None,
        "runtime": {
            "max_tool_rounds": DEFAULT_MAX_TOOL_ROUNDS,
            "max_session_tokens": None,
        },
        "metadata": {"welcome_message": welcome, "suggested_questions": []},
    }
    report.warnings += [WARN_SKILLS, WARN_MCP]
    if model:
        report.warnings.append(WARN_MODEL.format(model=model))
    if not report.errors:
        result = validate_manifest(manifest)
        if not result.ok:
            report.errors.extend(result.errors)
        else:
            try:
                compile_spec("draft", 1, manifest)
            except MAError as err:
                details = err.details.get("errors", []) if isinstance(err.details, dict) else []
                report.errors.extend(details or [err.message])
    encoded = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
    if len(encoded) > MAX_MANIFEST_BYTES:
        report.errors.append("Manifest 超过 256 KiB")
    return manifest, report


def enterprise_publish_settings() -> tuple[str, str] | None:
    """(token, base_url) when enterprise.enabled is True and token/base_url non-empty."""

    try:
        if ConfigManager.get_value("enterprise.enabled") is not True:
            return None
        token = ConfigManager.get_value("enterprise.token")
        base = ConfigManager.get_value("enterprise.base_url")
    except Exception:
        return None
    if not isinstance(token, str) or not isinstance(base, str):
        return None
    token = token.strip()
    base = base.strip().rstrip("/")
    if not token or not base:
        return None
    return token, base


def _json_object(resp: Any) -> dict[str, Any]:
    headers = getattr(resp, "headers", None)
    content_type = ""
    if headers is not None and hasattr(headers, "get"):
        content_type = str(headers.get("content-type") or "")
    if "json" not in content_type.lower():
        return {}
    try:
        payload = resp.json()
    except Exception:
        return {}
    if isinstance(payload, dict):
        return payload
    return {}


def publish_avatar_draft(
    avatar: AvatarConfig,
    manifest: Mapping[str, Any],
    note: str | None,
    *,
    settings: tuple[str, str],
    http_post: Any = httpx.post,
) -> dict[str, Any]:
    """POST {base}/api/desktop/agents/publish; 2xx -> response JSON; else EnterprisePublishError."""

    token, base = settings
    body: dict[str, Any] = {
        "local_avatar_id": avatar.id,
        "display_name": avatar.name.strip()[:64],
        "description": (avatar.description or "").strip()[:500] or None,
        "manifest": dict(manifest),
    }
    if note:
        body["note"] = note
    try:
        resp = http_post(
            f"{base}/api/desktop/agents/publish",
            headers={"Authorization": f"Bearer {token}"},
            json=body,
            timeout=15.0,
            trust_env=False,
        )
    except httpx.HTTPError as exc:
        logger.warning("enterprise avatar publish unreachable")
        raise EnterprisePublishError(0, "无法连接企业服务") from exc
    if 200 <= resp.status_code < 300:
        return resp.json()
    logger.warning("enterprise avatar publish failed: status=%s", resp.status_code)
    payload = _json_object(resp)
    raw_errors = payload.get("errors") or []
    errors = [str(item) for item in raw_errors] if isinstance(raw_errors, list) else []
    message = str(payload.get("message") or f"HTTP {resp.status_code}")
    raise EnterprisePublishError(resp.status_code, message, errors)
