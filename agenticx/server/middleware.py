#!/usr/bin/env python3
"""Production middlewares for AgenticX server.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Dict, Optional

from fastapi import Request  # type: ignore
from fastapi.responses import JSONResponse, Response  # type: ignore
from starlette.middleware.base import BaseHTTPMiddleware  # type: ignore

from agenticx.core.error_handler import CircuitBreaker
from agenticx.observability.mineru.rate_limiter import (
    RateLimitConfig,
    RateLimiter,
    RateLimitScope,
    RateLimitStrategy,
)

logger = logging.getLogger(__name__)


@dataclass
class MiddlewareConfig:
    """Configuration for production middlewares."""

    request_timeout_seconds: float = 300.0
    enable_request_id: bool = True
    enable_jwt_auth: bool = False  # Optional: validate JWT and set request.state.auth
    enable_tenant_isolation: bool = True
    enable_timeout: bool = True
    enable_rate_limit: bool = True
    enable_circuit_breaker: bool = True
    rate_limit_max_requests: int = 120
    rate_limit_time_window: float = 60.0
    rate_limit_scope: RateLimitScope = RateLimitScope.PER_IP
    rate_limit_strategy: RateLimitStrategy = RateLimitStrategy.SLIDING_WINDOW
    cb_failure_threshold: int = 5
    cb_recovery_timeout_seconds: int = 30


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Attach request id to request/response lifecycle."""

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class TimeoutMiddleware(BaseHTTPMiddleware):
    """Request-level timeout middleware."""

    def __init__(self, app, timeout_seconds: float = 300.0) -> None:
        super().__init__(app)
        self.timeout_seconds = timeout_seconds

    async def dispatch(self, request: Request, call_next) -> Response:
        try:
            return await asyncio.wait_for(call_next(request), timeout=self.timeout_seconds)
        except asyncio.TimeoutError:
            request_id = getattr(request.state, "request_id", None)
            payload = {
                "error": "request_timeout",
                "message": f"Request timed out after {self.timeout_seconds} seconds",
            }
            if request_id:
                payload["request_id"] = request_id
            return JSONResponse(status_code=504, content=payload)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Rate limiting middleware built on AgenticX RateLimiter."""

    def __init__(self, app, config: Optional[RateLimitConfig] = None) -> None:
        super().__init__(app)
        self.config = config or RateLimitConfig(
            strategy=RateLimitStrategy.SLIDING_WINDOW,
            scope=RateLimitScope.PER_IP,
            max_requests=120,
            time_window=60.0,
        )
        self.rate_limiter = RateLimiter(self.config)

    async def dispatch(self, request: Request, call_next) -> Response:
        user_id = str(getattr(request.state, "user_id", "anonymous"))
        tenant_id = str(getattr(request.state, "tenant_id", "default"))
        api_key = request.headers.get("x-api-key", "")
        endpoint = request.url.path
        client_ip = request.client.host if request.client else "unknown"
        limit_result = self.rate_limiter.is_allowed(
            user_id=user_id,
            ip_address=client_ip,
            api_key=api_key,
            endpoint=endpoint,
            resource=tenant_id,
        )
        if not limit_result.allowed:
            headers = {
                "X-RateLimit-Remaining": str(limit_result.remaining),
                "X-RateLimit-Reset": str(int(limit_result.reset_time)),
            }
            if limit_result.retry_after is not None:
                headers["Retry-After"] = str(max(1, int(limit_result.retry_after)))
            return JSONResponse(
                status_code=429,
                content={
                    "error": "rate_limit_exceeded",
                    "message": "Too many requests",
                    "retry_after": limit_result.retry_after,
                },
                headers=headers,
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Remaining"] = str(limit_result.remaining)
        response.headers["X-RateLimit-Reset"] = str(int(limit_result.reset_time))
        return response


class CircuitBreakerMiddleware(BaseHTTPMiddleware):
    """Per-endpoint circuit breaker middleware."""

    def __init__(
        self,
        app,
        failure_threshold: int = 5,
        recovery_timeout_seconds: int = 30,
    ) -> None:
        super().__init__(app)
        self.failure_threshold = failure_threshold
        self.recovery_timeout_seconds = recovery_timeout_seconds
        self._breakers: Dict[str, CircuitBreaker] = {}

    def _get_breaker(self, key: str) -> CircuitBreaker:
        if key not in self._breakers:
            self._breakers[key] = CircuitBreaker(
                failure_threshold=self.failure_threshold,
                recovery_timeout=self.recovery_timeout_seconds,
            )
        return self._breakers[key]

    async def dispatch(self, request: Request, call_next) -> Response:
        key = f"{request.method}:{request.url.path}"
        breaker = self._get_breaker(key)
        now = time.time()
        if breaker.state == "open" and now - breaker.last_failure_time <= breaker.recovery_timeout:
            return JSONResponse(
                status_code=503,
                content={
                    "error": "circuit_open",
                    "message": "Service temporarily unavailable",
                },
            )
        if breaker.state == "open":
            breaker.state = "half_open"

        try:
            response = await call_next(request)
            if response.status_code < 500:
                breaker.on_success()
            else:
                breaker.on_failure()
            return response
        except Exception:
            breaker.on_failure()
            raise


def register_production_middlewares(app, config: Optional[MiddlewareConfig] = None) -> None:
    """Register production middleware chain on FastAPI app.

    Starlette executes middleware in LIFO order (last registered = outermost).
    We register innermost first so the execution order becomes:
        RequestId → JWT → Tenant → RateLimit → Timeout → CircuitBreaker → handler
    """
    cfg = config or MiddlewareConfig()
    if cfg.enable_circuit_breaker:
        app.add_middleware(
            CircuitBreakerMiddleware,
            failure_threshold=cfg.cb_failure_threshold,
            recovery_timeout_seconds=cfg.cb_recovery_timeout_seconds,
        )
    if cfg.enable_timeout:
        app.add_middleware(TimeoutMiddleware, timeout_seconds=cfg.request_timeout_seconds)
    if cfg.enable_rate_limit:
        rate_config = RateLimitConfig(
            strategy=cfg.rate_limit_strategy,
            scope=cfg.rate_limit_scope,
            max_requests=cfg.rate_limit_max_requests,
            time_window=cfg.rate_limit_time_window,
        )
        app.add_middleware(RateLimitMiddleware, config=rate_config)
    if cfg.enable_tenant_isolation:
        from agenticx.server.tenant import TenantIsolationMiddleware
        app.add_middleware(TenantIsolationMiddleware)
    if cfg.enable_jwt_auth:
        from agenticx.server.auth import JWTAuthMiddleware
        app.add_middleware(JWTAuthMiddleware)
    if cfg.enable_request_id:
        app.add_middleware(RequestIdMiddleware)
    logger.info("Registered production middlewares")
