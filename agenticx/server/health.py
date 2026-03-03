#!/usr/bin/env python3
"""Deep health checks and self-healing for AgenticX server.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


class HealthStatus(str, Enum):
    """Health check result status."""

    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    DEGRADED = "degraded"
    UNKNOWN = "unknown"


@dataclass
class CheckResult:
    """Result of a single dependency check."""

    name: str
    status: HealthStatus
    message: str = ""
    latency_ms: Optional[float] = None
    details: Dict[str, Any] = field(default_factory=dict)


class DependencyChecker:
    """Check health of database, LLM provider, memory backend."""

    def __init__(
        self,
        check_database: Optional[Callable[[], Any]] = None,
        check_llm: Optional[Callable[[], Any]] = None,
        check_memory: Optional[Callable[[], Any]] = None,
    ) -> None:
        self._check_db = check_database
        self._check_llm = check_llm
        self._check_memory = check_memory

    async def check_database(self) -> CheckResult:
        """Check database connectivity."""
        if not self._check_db:
            return CheckResult("database", HealthStatus.UNKNOWN, "No checker configured")
        start = time.perf_counter()
        try:
            result = self._check_db()
            if asyncio.iscoroutine(result):
                result = await result
            latency = (time.perf_counter() - start) * 1000
            return CheckResult("database", HealthStatus.HEALTHY, "OK", latency_ms=latency)
        except Exception as e:
            latency = (time.perf_counter() - start) * 1000
            return CheckResult(
                "database",
                HealthStatus.UNHEALTHY,
                str(e),
                latency_ms=latency,
                details={"error": str(e)},
            )

    async def check_llm_provider(self) -> CheckResult:
        """Check LLM provider availability."""
        if not self._check_llm:
            return CheckResult("llm", HealthStatus.UNKNOWN, "No checker configured")
        start = time.perf_counter()
        try:
            result = self._check_llm()
            if asyncio.iscoroutine(result):
                result = await result
            latency = (time.perf_counter() - start) * 1000
            return CheckResult("llm", HealthStatus.HEALTHY, "OK", latency_ms=latency)
        except Exception as e:
            latency = (time.perf_counter() - start) * 1000
            return CheckResult(
                "llm",
                HealthStatus.UNHEALTHY,
                str(e),
                latency_ms=latency,
                details={"error": str(e)},
            )

    async def check_memory_backend(self) -> CheckResult:
        """Check memory backend availability."""
        if not self._check_memory:
            return CheckResult("memory", HealthStatus.UNKNOWN, "No checker configured")
        start = time.perf_counter()
        try:
            result = self._check_memory()
            if asyncio.iscoroutine(result):
                result = await result
            latency = (time.perf_counter() - start) * 1000
            return CheckResult("memory", HealthStatus.HEALTHY, "OK", latency_ms=latency)
        except Exception as e:
            latency = (time.perf_counter() - start) * 1000
            return CheckResult(
                "memory",
                HealthStatus.UNHEALTHY,
                str(e),
                latency_ms=latency,
                details={"error": str(e)},
            )

    async def check_all(self) -> List[CheckResult]:
        """Run all configured checks."""
        results = []
        if self._check_db:
            results.append(await self.check_database())
        if self._check_llm:
            results.append(await self.check_llm_provider())
        if self._check_memory:
            results.append(await self.check_memory_backend())
        return results


class HealthProbe:
    """Kubernetes-style health probes: liveness, readiness, startup."""

    def __init__(self, dependency_checker: Optional[DependencyChecker] = None) -> None:
        self._checker = dependency_checker or DependencyChecker()
        self._startup_done = False
        self._startup_time = time.time()

    async def liveness(self) -> Dict[str, Any]:
        """Liveness: process is alive. Always healthy if we respond."""
        return {"status": "ok", "probe": "liveness"}

    async def readiness(self) -> Dict[str, Any]:
        """Readiness: dependencies are ready to serve traffic."""
        results = await self._checker.check_all()
        unhealthy = [r for r in results if r.status == HealthStatus.UNHEALTHY]
        degraded = [r for r in results if r.status == HealthStatus.DEGRADED]
        if unhealthy:
            return {
                "status": "unhealthy",
                "probe": "readiness",
                "checks": [
                    {"name": r.name, "status": r.status.value, "message": r.message}
                    for r in results
                ],
            }
        if degraded:
            return {
                "status": "degraded",
                "probe": "readiness",
                "checks": [
                    {"name": r.name, "status": r.status.value, "message": r.message}
                    for r in results
                ],
            }
        return {
            "status": "ok",
            "probe": "readiness",
            "checks": [
                {"name": r.name, "status": r.status.value, "latency_ms": r.latency_ms}
                for r in results
            ],
        }

    async def startup(self) -> Dict[str, Any]:
        """Startup: initialization complete."""
        if not self._startup_done:
            results = await self._checker.check_all()
            critical_fail = any(r.status == HealthStatus.UNHEALTHY for r in results)
            if critical_fail:
                return {
                    "status": "unhealthy",
                    "probe": "startup",
                    "checks": [
                        {"name": r.name, "status": r.status.value, "message": r.message}
                        for r in results
                    ],
                }
            self._startup_done = True
        return {
            "status": "ok",
            "probe": "startup",
            "uptime_seconds": time.time() - self._startup_time,
        }


class SelfHealingManager:
    """Auto-reconnect on dependency failure. Integrates with CircuitBreaker."""

    def __init__(
        self,
        checker: DependencyChecker,
        failure_threshold: int = 5,
        recovery_timeout_seconds: float = 30.0,
    ) -> None:
        self._checker = checker
        self._failure_threshold = failure_threshold
        self._recovery_timeout = recovery_timeout_seconds
        self._failure_counts: Dict[str, int] = {}
        self._last_failure: Dict[str, float] = {}
        self._recovery_callbacks: Dict[str, Callable] = {}

    def register_recovery(self, name: str, callback: Callable) -> None:
        """Register a callback to run when dependency recovers."""
        self._recovery_callbacks[name] = callback

    def record_failure(self, name: str) -> None:
        """Record a failure. Triggers recovery attempt after threshold."""
        self._failure_counts[name] = self._failure_counts.get(name, 0) + 1
        self._last_failure[name] = time.time()

    def record_success(self, name: str) -> None:
        """Record success. Resets failure count."""
        self._failure_counts[name] = 0

    def should_attempt_recovery(self, name: str) -> bool:
        """Whether to attempt recovery (past threshold and recovery window)."""
        count = self._failure_counts.get(name, 0)
        last = self._last_failure.get(name, 0)
        if count < self._failure_threshold:
            return False
        if time.time() - last < self._recovery_timeout:
            return False
        return True

    async def attempt_recovery(self, name: str) -> bool:
        """Attempt to recover a dependency. Returns True if recovered."""
        callback = self._recovery_callbacks.get(name)
        if not callback:
            return False
        try:
            result = callback()
            if asyncio.iscoroutine(result):
                await result
            self.record_success(name)
            logger.info("SelfHealingManager: %s recovered", name)
            return True
        except Exception as e:
            logger.warning("SelfHealingManager: %s recovery failed: %s", name, e)
            self.record_failure(name)
            return False


_default_probe: Optional[HealthProbe] = None


def get_health_probe() -> HealthProbe:
    """Get default health probe singleton."""
    global _default_probe
    if _default_probe is None:
        _default_probe = HealthProbe()
    return _default_probe


def set_health_probe(probe: HealthProbe) -> None:
    """Set custom health probe (e.g. with dependency checkers)."""
    global _default_probe
    _default_probe = probe
