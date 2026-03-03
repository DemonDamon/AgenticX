#!/usr/bin/env python3
"""Multi-tenant context and isolation middleware.

Author: Damon Li
"""

from __future__ import annotations

import logging
from contextvars import ContextVar
from typing import Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = logging.getLogger(__name__)

_tenant_context: ContextVar[Optional[str]] = ContextVar("tenant_id", default=None)


class TenantContext:
    """Request-scoped tenant context using contextvars.

    Propagates tenant_id through the entire request lifecycle.
    Downstream SessionService / Memory automatically inject tenant_id filtering.
    """

    @staticmethod
    def get_tenant_id() -> Optional[str]:
        """Get current request's tenant_id from context."""
        return _tenant_context.get()

    @staticmethod
    def set_tenant_id(tenant_id: Optional[str]) -> None:
        """Set tenant_id for current request context."""
        _tenant_context.set(tenant_id)

    @staticmethod
    def clear() -> None:
        """Clear tenant context (e.g. after request)."""
        try:
            _tenant_context.set(None)
        except LookupError:
            pass


class TenantIsolationMiddleware(BaseHTTPMiddleware):
    """Extract tenant_id from request and set TenantContext.

    Sources (in order):
    1. request.state.tenant_id (set by JWT/auth middleware)
    2. X-Tenant-ID header
    3. None (single-tenant mode)
    """

    async def dispatch(self, request: Request, call_next):
        tenant_id: Optional[str] = None

        auth = getattr(request.state, "auth", None)
        is_authenticated = auth and getattr(auth, "authenticated", False)

        # Primary: from auth middleware (JWT / API-Key sets request.state.tenant_id)
        if hasattr(request.state, "tenant_id") and request.state.tenant_id:
            tenant_id = request.state.tenant_id
        # Fallback: X-Tenant-ID header, but ONLY for authenticated requests
        elif is_authenticated and request.headers.get("X-Tenant-ID"):
            tenant_id = request.headers.get("X-Tenant-ID")

        TenantContext.set_tenant_id(tenant_id)
        try:
            response = await call_next(request)
            return response
        finally:
            TenantContext.clear()
