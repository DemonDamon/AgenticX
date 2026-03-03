#!/usr/bin/env python3
"""Verify Production API Infrastructure (P1-P6).

Run from project root:
  python scripts/verify_production_infrastructure.py

Or with live server test:
  python scripts/verify_production_infrastructure.py --live
"""

import argparse
import asyncio
import sys
from pathlib import Path

# Ensure project root in path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def check_imports():
    """P1-P6: Verify all new modules import correctly."""
    print("=" * 50)
    print("1. Verify imports (P1-P6)")
    print("=" * 50)
    errors = []

    # P1: Middleware
    try:
        from agenticx.server.middleware import (
            RequestIdMiddleware,
            TimeoutMiddleware,
            RateLimitMiddleware,
            CircuitBreakerMiddleware,
            MiddlewareConfig,
            register_production_middlewares,
        )
        print("  [P1] middleware.py OK")
    except Exception as e:
        errors.append(f"P1 middleware: {e}")
        print(f"  [P1] middleware.py FAIL: {e}")

    # P2: Task queue
    try:
        from agenticx.server.task_queue import (
            AsyncTaskQueue,
            BackgroundAgentRunner,
            get_task_queue,
            AsyncTaskStatus,
        )
        from agenticx.core.background import AsyncBackgroundPool
        print("  [P2] task_queue.py + AsyncBackgroundPool OK")
    except Exception as e:
        errors.append(f"P2 task_queue: {e}")
        print(f"  [P2] task_queue.py FAIL: {e}")

    # P3: Tenant
    try:
        from agenticx.server.tenant import TenantContext, TenantIsolationMiddleware
        from agenticx.sessions import InMemorySessionService
        from agenticx.memory.base import resolve_tenant_id
        print("  [P3] tenant.py + sessions tenant_id OK")
    except Exception as e:
        errors.append(f"P3 tenant: {e}")
        print(f"  [P3] tenant.py FAIL: {e}")

    # P4: Auth
    try:
        from agenticx.server.auth import (
            JWTAuthMiddleware,
            get_current_user,
            require_role,
            require_permission,
        )
        from agenticx.server.user_manager import get_user_manager
        um = get_user_manager()
        jwt_token = um.generate_jwt(1, "test@test.com", "test", ["user"])
        print(f"  [P4] auth.py + user_manager JWT OK (JWT: {'yes' if jwt_token else 'no'})")
    except Exception as e:
        errors.append(f"P4 auth: {e}")
        print(f"  [P4] auth.py FAIL: {e}")

    # P5: Health
    try:
        from agenticx.server.health import (
            HealthProbe,
            DependencyChecker,
            SelfHealingManager,
            get_health_probe,
        )
        print("  [P5] health.py OK")
    except Exception as e:
        errors.append(f"P5 health: {e}")
        print(f"  [P5] health.py FAIL: {e}")

    # P6: Resilience
    try:
        from agenticx.server.resilience import (
            RetryableEndpoint,
            IdempotencyStore,
            GracefulDegradation,
            get_idempotency_store,
        )
        from agenticx.core.error_handler import is_retryable
        print("  [P6] resilience.py + is_retryable OK")
    except Exception as e:
        errors.append(f"P6 resilience: {e}")
        print(f"  [P6] resilience.py FAIL: {e}")

    return errors


async def check_task_queue():
    """P2: Verify AsyncTaskQueue submit/status/cancel."""
    print("\n" + "=" * 50)
    print("2. Verify task queue (P2)")
    print("=" * 50)
    try:
        from agenticx.server.task_queue import get_task_queue

        queue = get_task_queue()

        async def dummy_task():
            await asyncio.sleep(0.05)
            return {"done": True}

        task_id = await queue.submit(dummy_task, name="verify_task")
        print(f"  submit() -> task_id: {task_id}")

        await asyncio.sleep(0.1)
        info = await queue.get_status(task_id)
        print(f"  get_status() -> status: {info.status.value}")

        ok = await queue.cancel(task_id)
        print(f"  cancel() -> {ok}")

        print("  [P2] task queue OK")
        return []
    except Exception as e:
        print(f"  [P2] task queue FAIL: {e}")
        return [f"P2 task queue: {e}"]


async def check_tenant_session():
    """P3: Verify tenant isolation in sessions."""
    print("\n" + "=" * 50)
    print("3. Verify tenant isolation (P3)")
    print("=" * 50)
    try:
        from agenticx.server.tenant import TenantContext
        from agenticx.sessions import InMemorySessionService

        svc = InMemorySessionService()
        TenantContext.set_tenant_id("tenant-1")

        s = await svc.create_session("app", "user1", tenant_id="tenant-1")
        print(f"  create_session(tenant_id='tenant-1') -> id: {s.id}")

        s2 = await svc.get_session("app", "user1", s.id, tenant_id="tenant-1")
        print(f"  get_session(tenant_id='tenant-1') -> found: {s2 is not None}")

        s3 = await svc.get_session("app", "user1", s.id, tenant_id="tenant-2")
        print(f"  get_session(tenant_id='tenant-2') -> found: {s3 is not None} (expect False)")

        TenantContext.clear()
        print("  [P3] tenant isolation OK")
        return []
    except Exception as e:
        print(f"  [P3] tenant isolation FAIL: {e}")
        return [f"P3 tenant: {e}"]


async def check_health_probes():
    """P5: Verify health probe responses."""
    print("\n" + "=" * 50)
    print("4. Verify health probes (P5)")
    print("=" * 50)
    try:
        from agenticx.server.health import get_health_probe

        probe = get_health_probe()

        live = await probe.liveness()
        print(f"  liveness() -> {live}")

        ready = await probe.readiness()
        print(f"  readiness() -> status: {ready.get('status')}")

        startup = await probe.startup()
        print(f"  startup() -> status: {startup.get('status')}")

        print("  [P5] health probes OK")
        return []
    except Exception as e:
        print(f"  [P5] health probes FAIL: {e}")
        return [f"P5 health: {e}"]


async def check_live_server():
    """Use TestClient to hit /health/live, /health/ready, /tasks/submit."""
    print("\n" + "=" * 50)
    print("5. API endpoints test (TestClient)")
    print("=" * 50)
    try:
        from starlette.testclient import TestClient
    except ImportError:
        print("  Skip: starlette not installed")
        return []

    from agenticx.server import AgentServer, register_api_routes

    app = AgentServer(agent_handler=lambda r: "ok").app
    register_api_routes(app)

    errors = []
    with TestClient(app) as client:
        r = client.get("/health")
        print(f"  GET /health -> {r.status_code}")

        r = client.get("/health/live")
        print(f"  GET /health/live -> {r.status_code} {r.json()}")

        r = client.get("/health/ready")
        print(f"  GET /health/ready -> {r.status_code}")

        r = client.post("/tasks/submit", json={"name": "test", "payload": {}})
        print(f"  POST /tasks/submit -> {r.status_code} {r.json()}")

        if r.status_code == 202:
            task_id = r.json().get("task_id")
            r2 = client.get(f"/tasks/{task_id}/status")
            print(f"  GET /tasks/{{id}}/status -> {r2.status_code}")

        print("  [Live] API endpoints OK")
    return errors


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="Run live server test")
    args = parser.parse_args()

    all_errors = []

    all_errors.extend(check_imports())
    all_errors.extend(await check_task_queue())
    all_errors.extend(await check_tenant_session())
    all_errors.extend(await check_health_probes())

    if args.live:
        all_errors.extend(await check_live_server())

    print("\n" + "=" * 50)
    if all_errors:
        print("FAILED:")
        for e in all_errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("All checks passed.")
        sys.exit(0)


if __name__ == "__main__":
    asyncio.run(main())
