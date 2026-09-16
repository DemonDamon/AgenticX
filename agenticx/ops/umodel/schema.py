"""Frozen UModel v0 object kinds and validation.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

OBJECT_KINDS = (
    "service",
    "session",
    "tool_call",
    "model_channel",
    "alert",
    "deployment",
)

FORBIDDEN_ATTR_KEYS = frozenset(
    {"content", "messages", "prompt", "body", "chat", "input", "output"}
)

_SUMMARY_MAX = 512
_ATTR_VALUE_MAX = 512


@dataclass
class UModelObject:
    kind: str
    id: str
    tenant_id: str = ""
    session_id: str = ""
    deployment_id: str = ""
    trace_id: str = ""
    tool_call_id: str = ""
    name: str = ""
    status: str = ""
    summary: str = ""
    attrs: dict[str, str] = field(default_factory=dict)
    updated_ts: datetime | None = None


def _clip(text: str, limit: int) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) <= limit:
        return text
    return encoded[:limit].decode("utf-8", errors="ignore")


def prepare_object(obj: UModelObject) -> UModelObject:
    """Strip keys, coerce attrs, then validate. Returns a new instance."""
    raw_attrs = obj.attrs if isinstance(obj.attrs, dict) else {}
    attrs: dict[str, str] = {}
    for key, value in raw_attrs.items():
        name = str(key).strip()
        if name in FORBIDDEN_ATTR_KEYS:
            raise ValueError(f"forbidden attr key: {name}")
        if not name:
            continue
        attrs[name] = _clip(str(value), _ATTR_VALUE_MAX)
    cleaned = UModelObject(
        kind=str(obj.kind or "").strip(),
        id=str(obj.id or "").strip(),
        tenant_id=str(obj.tenant_id or "").strip(),
        session_id=str(obj.session_id or "").strip(),
        deployment_id=str(obj.deployment_id or "").strip(),
        trace_id=str(obj.trace_id or "").strip(),
        tool_call_id=str(obj.tool_call_id or "").strip(),
        name=str(obj.name or "").strip(),
        status=str(obj.status or "").strip(),
        summary=_clip(str(obj.summary or ""), _SUMMARY_MAX),
        attrs=attrs,
        updated_ts=obj.updated_ts,
    )
    validate_object(cleaned)
    return cleaned


def validate_object(obj: UModelObject) -> None:
    kind = str(obj.kind or "").strip()
    object_id = str(obj.id or "").strip()
    if kind not in OBJECT_KINDS:
        raise ValueError(f"unknown kind: {kind}")
    if not object_id:
        raise ValueError("id is required")
    session_id = str(obj.session_id or "").strip()
    tool_call_id = str(obj.tool_call_id or "").strip()
    deployment_id = str(obj.deployment_id or "").strip()
    if kind == "session" and object_id != session_id:
        raise ValueError("session id must match session_id")
    if kind == "tool_call":
        if object_id != tool_call_id:
            raise ValueError("tool_call id must match tool_call_id")
        if not session_id:
            raise ValueError("tool_call session_id is required")
    if kind == "deployment" and object_id != deployment_id:
        raise ValueError("deployment id must match deployment_id")
    attrs = obj.attrs if isinstance(obj.attrs, dict) else {}
    for key in attrs:
        if str(key) in FORBIDDEN_ATTR_KEYS:
            raise ValueError(f"forbidden attr key: {key}")
