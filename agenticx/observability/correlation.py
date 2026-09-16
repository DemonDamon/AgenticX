#!/usr/bin/env python3
"""Request-scoped correlation keys for OTel spans.

Author: Damon Li
"""

from __future__ import annotations

import os
from contextvars import ContextVar, Token
from typing import Any, Optional

from agenticx.observability.ai_attributes import AiObservationAttributes

_session_id: ContextVar[str] = ContextVar("agenticx_corr_session_id", default="")
_tenant_id: ContextVar[str] = ContextVar("agenticx_corr_tenant_id", default="")
_deployment_id: ContextVar[str] = ContextVar("agenticx_corr_deployment_id", default="")
_gateway_trace_id: ContextVar[str] = ContextVar("agenticx_corr_gateway_trace_id", default="")


def bind_correlation(
    *,
    session_id: str = "",
    tenant_id: str = "",
    deployment_id: str = "",
    gateway_trace_id: str = "",
) -> list[Token]:
    tokens = [
        _session_id.set(str(session_id or "").strip()),
        _tenant_id.set(str(tenant_id or "").strip()),
        _deployment_id.set(str(deployment_id or "").strip()),
        _gateway_trace_id.set(str(gateway_trace_id or "").strip()),
    ]
    return tokens


def reset_correlation(tokens: Optional[list[Token]] = None) -> None:
    if tokens:
        for token in reversed(tokens):
            token.var.reset(token)
        return
    _session_id.set("")
    _tenant_id.set("")
    _deployment_id.set("")
    _gateway_trace_id.set("")


def current_correlation() -> dict[str, str]:
    out = {
        "session_id": _session_id.get(),
        "tenant_id": _tenant_id.get(),
        "deployment_id": _deployment_id.get(),
        "gateway_trace_id": _gateway_trace_id.get(),
    }
    return {k: v for k, v in out.items() if v}


def apply_correlation_attributes(span: Any) -> None:
    if span is None or not hasattr(span, "set_attribute"):
        return
    corr = current_correlation()
    mapping = (
        ("session_id", AiObservationAttributes.AGENTICX_SESSION_ID),
        ("tenant_id", AiObservationAttributes.AGENTICX_TENANT_ID),
        ("deployment_id", AiObservationAttributes.AGENTICX_DEPLOYMENT_ID),
        ("gateway_trace_id", AiObservationAttributes.AGENTICX_GATEWAY_TRACE_ID),
    )
    for key, attr in mapping:
        value = corr.get(key)
        if value:
            span.set_attribute(attr, value)


def bind_correlation_from_session(session: Any) -> list[Token]:
    sid = ""
    if session is not None:
        sid = str(
            getattr(session, "session_id", None)
            or getattr(session, "_session_id", None)
            or ""
        ).strip()
    tenant = ""
    try:
        from agenticx.server.tenant import TenantContext

        tenant = str(TenantContext.get_tenant_id() or "").strip()
    except Exception:
        tenant = ""
    deployment = ""
    if session is not None:
        deployment = str(getattr(session, "deployment_id", "") or "").strip()
    if not deployment:
        deployment = str(os.environ.get("AGENTICX_DEPLOYMENT_ID") or "").strip()
    gateway_trace = ""
    if session is not None:
        gateway_trace = str(getattr(session, "gateway_trace_id", "") or "").strip()
        meta = getattr(session, "metadata", None)
        if not gateway_trace and isinstance(meta, dict):
            gateway_trace = str(meta.get("gateway_trace_id") or "").strip()
    return bind_correlation(
        session_id=sid,
        tenant_id=tenant,
        deployment_id=deployment,
        gateway_trace_id=gateway_trace,
    )
