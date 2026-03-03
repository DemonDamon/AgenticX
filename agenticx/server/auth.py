#!/usr/bin/env python3
"""JWT and API-Key authentication middleware for AgenticX server.

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
from typing import Callable, List, Optional

from fastapi import Depends, HTTPException, Request  # type: ignore
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer  # type: ignore
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

# Optional: JWT is only used when PyJWT is installed
try:
    import jwt  # type: ignore
    JWT_AVAILABLE = True
except ImportError:
    JWT_AVAILABLE = False
    jwt = None  # type: ignore

API_KEY_HEADER = "X-API-Key"
BEARER_SCHEME = HTTPBearer(auto_error=False)
API_KEY_SCHEME = APIKeyHeader(name=API_KEY_HEADER, auto_error=False)


def _get_jwt_secret() -> str:
    """Get JWT secret from env or default for dev."""
    return os.environ.get("AGENTICX_JWT_SECRET", "agenticx-dev-secret-change-in-production")


class AuthState:
    """Auth state injected into request.state."""

    user_id: Optional[str] = None
    tenant_id: Optional[str] = None
    roles: List[str] = []
    permissions: List[str] = []
    authenticated: bool = False
    auth_type: str = "none"  # "jwt" | "api_key" | "none"


class JWTAuthMiddleware(BaseHTTPMiddleware):
    """Extract and validate JWT from Authorization header, inject user/tenant into request.state."""

    def __init__(self, app, secret_key: Optional[str] = None, algorithms: List[str] = None):
        super().__init__(app)
        self.secret_key = secret_key or _get_jwt_secret()
        self.algorithms = algorithms or ["HS256"]

    async def dispatch(self, request: Request, call_next):
        auth_state = AuthState()
        if request.headers.get("Authorization"):
            creds = request.headers.get("Authorization", "").split()
            if len(creds) == 2 and creds[0].lower() == "bearer" and JWT_AVAILABLE:
                token = creds[1]
                try:
                    payload = jwt.decode(
                        token,
                        self.secret_key,
                        algorithms=self.algorithms,
                    )
                    auth_state.user_id = str(payload.get("user_id", payload.get("sub", "")))
                    auth_state.tenant_id = payload.get("tenant_id")
                    auth_state.roles = payload.get("roles", [])
                    auth_state.permissions = payload.get("permissions", [])
                    auth_state.authenticated = True
                    auth_state.auth_type = "jwt"
                    if auth_state.tenant_id:
                        request.state.tenant_id = auth_state.tenant_id
                except Exception as e:
                    logger.debug("JWT validation failed: %s", e)
        request.state.auth = auth_state
        response = await call_next(request)
        return response


async def _verify_api_key(api_key: Optional[str]) -> Optional[AuthState]:
    """Verify API key. Returns AuthState if valid. For M2M, api_key maps to tenant_id."""
    if not api_key:
        return None
    # Simplified: API key format "ak-<tenant_id>-<token>" or just accept any non-empty for dev
    # Production would lookup in DB/Redis
    if api_key.startswith("ak-"):
        parts = api_key.split("-", 2)
        state = AuthState()
        state.authenticated = True
        state.auth_type = "api_key"
        state.tenant_id = parts[1] if len(parts) > 2 else None
        state.user_id = f"api_key_{state.tenant_id or 'default'}"
        return state
    return None


async def get_current_user_optional(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(BEARER_SCHEME),
    api_key: Optional[str] = Depends(API_KEY_SCHEME),
) -> AuthState:
    """FastAPI dependency: optional auth. Returns AuthState (may be unauthenticated)."""
    auth = getattr(request.state, "auth", None)
    if auth and auth.authenticated:
        return auth
    if api_key:
        state = await _verify_api_key(api_key)
        if state:
            return state
    if credentials:
        from agenticx.server.user_manager import get_user_manager
        um = get_user_manager()
        payload = um.verify_jwt(credentials.credentials)
        if payload:
            state = AuthState()
            state.user_id = str(payload.get("user_id", payload.get("sub", "")))
            state.tenant_id = payload.get("tenant_id")
            state.roles = payload.get("roles", [])
            state.permissions = payload.get("permissions", [])
            state.authenticated = True
            state.auth_type = "jwt"
            return state
    return AuthState()


async def get_current_user(
    auth: AuthState = Depends(get_current_user_optional),
) -> AuthState:
    """FastAPI dependency: require auth. Raises 401 if not authenticated."""
    if not auth.authenticated:
        raise HTTPException(status_code=401, detail="Authentication required")
    return auth


def require_role(*roles: str) -> Callable:
    """Return a dependency that requires auth and at least one of the given roles."""

    async def _check(auth: AuthState = Depends(get_current_user)) -> AuthState:
        if not any(r in auth.roles for r in roles):
            raise HTTPException(status_code=403, detail=f"Required role: {roles}")
        return auth

    return _check


def require_permission(*perms: str) -> Callable:
    """Return a dependency that requires auth and at least one of the given permissions."""

    async def _check(auth: AuthState = Depends(get_current_user)) -> AuthState:
        if "admin" in auth.roles:
            return auth
        if not any(p in auth.permissions for p in perms):
            raise HTTPException(status_code=403, detail=f"Required permission: {perms}")
        return auth

    return _check
