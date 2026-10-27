#!/usr/bin/env python3
"""Draft enterprise managed agents from Near and diff them. Never publishes.

Writes go through the desktop publish endpoint, which keeps new agents as
drafts and pins the current effective version before appending.

Author: Damon Li
"""

from __future__ import annotations

import difflib
import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Mapping

import httpx

from agenticx.managed.errors import MAError
from agenticx.managed.manifest import canonical_json, validate_manifest
from agenticx.managed.spec import MANAGED_BUILTIN_TOOLS, compile_spec
from agenticx.runtime.credential_store import CRED_REF_RE, redact_text
from agenticx.runtime.enterprise_agent_publish import (
    HOME_PATH_RE,
    EnterprisePublishError,
    enterprise_publish_settings,
)

logger = logging.getLogger(__name__)

LOCAL_ID_PREFIX = "nl-"
MAX_DIFF_CHARS = 12000
MAX_DISPLAY_NAME = 64
MAX_DESCRIPTION = 500
MAX_NOTE = 500
NOT_LOGGED_IN_TEXT = "ERROR: 尚未登录企业账号。请先在 Near「设置 → 企业」中登录后再试。"

_SLUG_RE = re.compile(r"[^a-z0-9]+")
_LOCAL_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")

_ERR_SECRET = "检测到疑似密钥，请删除后再试（密钥由管理员在凭证库中配置）" # gitleaks:allow
_ERR_CRED_REF = "不能使用本机凭证引用 ${cred:...}"
_ERR_HOME_PATH = "系统提示中包含本机路径，请改为相对说明"
_WARN_SKILLS = "技能需管理员在企业技能库中上架；未上架的技能会导致保存失败"
_WARN_MCP = "MCP 服务的访问凭证由管理员在凭证库中配置"
_WARN_NO_TOOLS = "未启用任何内置工具，智能体只能对话"
_SKIP_TOOLS = "（基线版本无法解析，跳过工具对比）"
_SAME_AS_BASE = "与基线版本内容相同（提交不会产生新版本）"


@dataclass
class DraftSummary:
    agent_id: str
    display_name: str
    description: str | None
    local_avatar_id: str
    lifecycle: str
    latest_version: int
    effective_version: int
    routing_mode: str
    updated_at: str


@dataclass
class PreviewReport:
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    normalized: dict[str, Any] | None = None
    manifest_hash: str | None = None
    base_version: int | None = None
    summary: list[str] = field(default_factory=list)
    diff: str = ""


def synth_local_id(display_name: str) -> str:
    """Stable ``nl-`` id. A pure non-latin name hashes to avoid collisions."""

    slug = _SLUG_RE.sub("-", display_name.lower()).strip("-")
    if slug:
        local_id = f"{LOCAL_ID_PREFIX}{slug[:40]}"
    else:
        digest = hashlib.sha256(display_name.strip().encode("utf-8")).hexdigest()[:16]
        local_id = f"{LOCAL_ID_PREFIX}{digest}"
    if _LOCAL_ID_RE.fullmatch(local_id) is None:
        digest = hashlib.sha256(display_name.strip().encode("utf-8")).hexdigest()[:16]
        local_id = f"{LOCAL_ID_PREFIX}{digest}"
    return local_id


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


def _exchange(
    send: Any,
    url: str,
    *,
    token: str,
    json_body: dict[str, Any] | None = None,
    params: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Call the portal with the device token. Network failures hide the token."""

    kwargs: dict[str, Any] = {
        "headers": {"Authorization": f"Bearer {token}"},
        "timeout": 15.0,
        "trust_env": False,
    }
    if json_body is not None:
        kwargs["json"] = json_body
    if params:
        kwargs["params"] = dict(params)
    try:
        resp = send(url, **kwargs)
    except httpx.HTTPError as exc:
        logger.warning("enterprise agent builder unreachable")
        raise EnterprisePublishError(0, "无法连接企业服务") from exc
    status = int(getattr(resp, "status_code", 0) or 0)
    if 200 <= status < 300:
        try:
            body = resp.json()
        except Exception as exc:
            raise EnterprisePublishError(status, f"HTTP {status}") from exc
        if isinstance(body, dict):
            return body
        raise EnterprisePublishError(status, f"HTTP {status}")
    logger.warning("enterprise agent builder failed: status=%s", status)
    payload = _json_object(resp)
    raw_errors = payload.get("errors") or []
    errors = [str(item) for item in raw_errors] if isinstance(raw_errors, list) else []
    message = str(payload.get("message") or f"HTTP {status}")
    raise EnterprisePublishError(status, message, errors)


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _draft_summary(item: Mapping[str, Any]) -> DraftSummary:
    description = item.get("description")
    if description is not None:
        description = str(description)
    return DraftSummary(
        agent_id=str(item.get("agent_id") or ""),
        display_name=str(item.get("display_name") or ""),
        description=description,
        local_avatar_id=str(item.get("local_avatar_id") or ""),
        lifecycle=str(item.get("lifecycle") or ""),
        latest_version=_as_int(item.get("latest_version")),
        effective_version=_as_int(item.get("effective_version")),
        routing_mode=str(item.get("routing_mode") or ""),
        updated_at=str(item.get("updated_at") or ""),
    )


def list_my_agents(
    *,
    settings: tuple[str, str],
    http_get: Any = httpx.get,
) -> list[DraftSummary]:
    """GET the employee's own enterprise agents (including drafts)."""

    token, base = settings
    payload = _exchange(http_get, f"{base}/api/desktop/agents/drafts", token=token)
    rows = payload.get("agents")
    if not isinstance(rows, list):
        return []
    return [_draft_summary(item) for item in rows if isinstance(item, Mapping)]


def get_my_agent(
    agent_id: str,
    version: int | None,
    *,
    settings: tuple[str, str],
    http_get: Any = httpx.get,
) -> dict[str, Any]:
    """GET one owned agent. ``version`` defaults to the latest on the server."""

    token, base = settings
    params = {"version": version} if version is not None else None
    return _exchange(
        http_get,
        f"{base}/api/desktop/agents/drafts/{agent_id}",
        token=token,
        params=params,
    )


def _line_delta(old: str, new: str) -> tuple[int, int]:
    added = 0
    removed = 0
    for line in difflib.ndiff(old.splitlines(), new.splitlines()):
        if line.startswith("+ "):
            added += 1
        elif line.startswith("- "):
            removed += 1
    return added, removed


def _builtin_policies(manifest: Mapping[str, Any]) -> dict[str, str] | None:
    try:
        spec = compile_spec("diff", 1, manifest)
    except MAError:
        return None
    return {entry.name: entry.policy for entry in spec.tools if entry.kind == "builtin"}


def _mcp_names(manifest: Mapping[str, Any]) -> list[str]:
    names: list[str] = []
    raw = manifest.get("mcp_servers")
    if not isinstance(raw, list):
        return names
    for item in raw:
        if isinstance(item, Mapping) and item.get("name"):
            names.append(str(item["name"]))
    return names


def _skill_labels(manifest: Mapping[str, Any]) -> list[str]:
    labels: list[str] = []
    raw = manifest.get("skills")
    if not isinstance(raw, list):
        return labels
    for item in raw:
        if not isinstance(item, Mapping):
            continue
        version = item.get("version")
        version_text = "null" if version is None else str(version)
        labels.append(f"{item.get('id')}@{version_text}")
    return labels


def _rounds(manifest: Mapping[str, Any]) -> int:
    runtime = manifest.get("runtime")
    if isinstance(runtime, Mapping) and "max_tool_rounds" in runtime:
        return _as_int(runtime.get("max_tool_rounds"))
    return 40


def _metadata(manifest: Mapping[str, Any]) -> dict[str, Any]:
    raw = manifest.get("metadata")
    if isinstance(raw, Mapping):
        return dict(raw)
    return {}


def _system_text(manifest: Mapping[str, Any]) -> str:
    system = manifest.get("system")
    return system if isinstance(system, str) else ""


def _join_names(names: list[str]) -> str:
    return "、".join(names)


def _new_agent_summary(new: Mapping[str, Any]) -> list[str]:
    lines = ["新建智能体", f"模型：{new.get('model') or ''}"]
    policies = _builtin_policies(new)
    if policies is None:
        lines.append(_SKIP_TOOLS)
    elif policies:
        ordered = [name for name in MANAGED_BUILTIN_TOOLS if name in policies]
        lines.append(f"内置工具：{_join_names(ordered)}")
    else:
        lines.append("未启用内置工具")
    mcp_names = _mcp_names(new)
    if mcp_names:
        lines.append(f"MCP 服务：{_join_names(mcp_names)}")
    skills = _skill_labels(new)
    if skills:
        lines.append(f"技能：{_join_names(skills)}")
    lines.append(f"最大工具轮数：{_rounds(new)}")
    return lines


def summarize_diff(
    base: Mapping[str, Any] | None,
    new: Mapping[str, Any],
) -> list[str]:
    """Chinese one-line summary. ``base is None`` describes a new agent."""

    if base is None:
        return _new_agent_summary(new)
    lines: list[str] = []
    old_model = str(base.get("model") or "")
    new_model = str(new.get("model") or "")
    if old_model != new_model:
        lines.append(f"模型：{old_model} → {new_model}")
    added_lines, removed_lines = _line_delta(_system_text(base), _system_text(new))
    if added_lines or removed_lines:
        lines.append(f"系统提示：+{added_lines} 行 / -{removed_lines} 行")
    base_tools = _builtin_policies(base)
    new_tools = _builtin_policies(new)
    if base_tools is None or new_tools is None:
        lines.append(_SKIP_TOOLS)
    else:
        added = [name for name in MANAGED_BUILTIN_TOOLS if name in new_tools and name not in base_tools]
        removed = [name for name in MANAGED_BUILTIN_TOOLS if name in base_tools and name not in new_tools]
        if added:
            lines.append(f"内置工具：新增 {_join_names(added)}")
        if removed:
            lines.append(f"内置工具：移除 {_join_names(removed)}")
        for name in MANAGED_BUILTIN_TOOLS:
            if name in base_tools and name in new_tools and base_tools[name] != new_tools[name]:
                lines.append(f"工具策略：{name} {base_tools[name]} → {new_tools[name]}")
    old_mcp = _mcp_names(base)
    new_mcp = _mcp_names(new)
    mcp_added = [name for name in new_mcp if name not in set(old_mcp)]
    mcp_removed = [name for name in old_mcp if name not in set(new_mcp)]
    if mcp_added:
        lines.append(f"MCP 服务：新增 {_join_names(mcp_added)}")
    if mcp_removed:
        lines.append(f"MCP 服务：移除 {_join_names(mcp_removed)}")
    old_skills = _skill_labels(base)
    new_skills = _skill_labels(new)
    skill_added = [name for name in new_skills if name not in set(old_skills)]
    skill_removed = [name for name in old_skills if name not in set(new_skills)]
    if skill_added:
        lines.append(f"技能：新增 {_join_names(skill_added)}")
    if skill_removed:
        lines.append(f"技能：移除 {_join_names(skill_removed)}")
    old_rounds = _rounds(base)
    new_rounds = _rounds(new)
    if old_rounds != new_rounds:
        lines.append(f"最大工具轮数：{old_rounds} → {new_rounds}")
    old_meta = _metadata(base)
    new_meta = _metadata(new)
    changed_keys = sorted(key for key in set(old_meta) | set(new_meta) if old_meta.get(key) != new_meta.get(key))
    if changed_keys:
        lines.append(f"元数据：变更键 {_join_names(changed_keys)}")
    if not lines:
        lines.append(_SAME_AS_BASE)
    return lines


def unified_manifest_diff(
    base: Mapping[str, Any] | None,
    new: Mapping[str, Any],
    *,
    base_version: int | None = None,
) -> str:
    """Unified diff of canonical pretty JSON, truncated past ``MAX_DIFF_CHARS``."""

    if base is None:
        base_lines: list[str] = []
        fromfile = "(none)"
    else:
        base_lines = json.dumps(
            dict(base), ensure_ascii=False, indent=2, sort_keys=True
        ).splitlines()
        fromfile = f"v{base_version}" if base_version is not None else "(base)"
    new_lines = json.dumps(
        dict(new), ensure_ascii=False, indent=2, sort_keys=True
    ).splitlines()
    text = "\n".join(
        difflib.unified_diff(
            base_lines,
            new_lines,
            fromfile=fromfile,
            tofile="draft",
            lineterm="",
        )
    )
    if len(text) > MAX_DIFF_CHARS:
        text = text[:MAX_DIFF_CHARS] + "\n…（差异过长已截断）"
    return text


def _has_agx_builtin(normalized: Mapping[str, Any]) -> bool:
    tools = normalized.get("tools")
    if not isinstance(tools, list):
        return False
    return any(isinstance(item, Mapping) and item.get("type") == "agx_builtin" for item in tools)


def preview_manifest(
    manifest: Any,
    *,
    base_manifest: Mapping[str, Any] | None,
    base_version: int | None,
) -> PreviewReport:
    """Validate locally and diff against the latest enterprise version. No write."""

    result = validate_manifest(manifest)
    if not result.ok or result.normalized is None:
        return PreviewReport(ok=False, errors=list(result.errors))
    try:
        compile_spec("draft", 1, result.normalized)
    except MAError as exc:
        details = exc.details if isinstance(exc.details, dict) else {}
        raw_errors = details.get("errors") if isinstance(details, dict) else None
        if isinstance(raw_errors, list) and raw_errors:
            errors = [str(item) for item in raw_errors]
        else:
            errors = [str(exc)]
        return PreviewReport(ok=False, errors=errors)
    normalized = result.normalized
    errors: list[str] = []
    warnings: list[str] = []
    text = canonical_json(normalized)
    if redact_text(text) != text:
        errors.append(_ERR_SECRET)
    if CRED_REF_RE.search(text):
        errors.append(_ERR_CRED_REF)
    system = normalized.get("system")
    if isinstance(system, str) and HOME_PATH_RE.search(system):
        errors.append(_ERR_HOME_PATH)
    skills = normalized.get("skills") or []
    if skills:
        warnings.append(_WARN_SKILLS)
    mcp_servers = normalized.get("mcp_servers") or []
    if mcp_servers:
        warnings.append(_WARN_MCP)
    if not _has_agx_builtin(normalized):
        warnings.append(_WARN_NO_TOOLS)
    summary = summarize_diff(base_manifest, normalized)
    diff = unified_manifest_diff(
        base_manifest, normalized, base_version=base_version
    )
    return PreviewReport(
        ok=not errors,
        errors=errors,
        warnings=warnings,
        normalized=normalized,
        manifest_hash=result.manifest_hash,
        base_version=base_version,
        summary=summary,
        diff=diff,
    )


def submit_draft(
    *,
    manifest: Mapping[str, Any],
    display_name: str,
    description: str | None,
    note: str | None,
    local_avatar_id: str,
    settings: tuple[str, str],
    http_post: Any = httpx.post,
) -> dict[str, Any]:
    """POST a draft version. The server decides lifecycle; this client never publishes."""

    token, base = settings
    desc = description if isinstance(description, str) else ""
    body: dict[str, Any] = {
        "local_avatar_id": local_avatar_id,
        "display_name": display_name.strip()[:MAX_DISPLAY_NAME],
        "description": desc.strip()[:MAX_DESCRIPTION] or None,
        "manifest": dict(manifest),
    }
    if isinstance(note, str) and note.strip():
        body["note"] = note.strip()[:MAX_NOTE]
    return _exchange(
        http_post,
        f"{base}/api/desktop/agents/publish",
        token=token,
        json_body=body,
    )


def render_preview(report: PreviewReport) -> str:
    """Markdown the model can show: result, summary, and a diff block."""

    status = "通过" if report.ok else "未通过"
    parts = [f"## 预检结果：{status}"]
    if report.errors:
        parts.append("### 需要修正")
        parts.extend(f"- {item}" for item in report.errors)
    if report.warnings:
        parts.append("### 提示")
        parts.extend(f"- {item}" for item in report.warnings)
    if report.base_version is None:
        parts.append("### 变更摘要（新建）")
    else:
        parts.append(f"### 变更摘要（相对 v{report.base_version}）")
    parts.extend(f"- {item}" for item in report.summary)
    parts.append("### 差异")
    parts.append("```diff")
    parts.append(report.diff)
    parts.append("```")
    return "\n".join(parts)
