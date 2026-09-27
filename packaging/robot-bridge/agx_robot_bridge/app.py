#!/usr/bin/env python3
"""FastAPI application exposing a single robot rollout session over localhost HTTP.

Author: Hongyi Zhao
"""

from __future__ import annotations

import asyncio
import functools
import hmac
import logging
import platform
import secrets
import threading
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse

from . import __version__
from .backend import RolloutBackend
from .errors import (
    MAX_RELATIVE_TARGET_REQUIRED,
    NOT_FOUND,
    SESSION_ACTIVE,
    UNAUTHORIZED,
    BridgeError,
)
from .models import SessionCreate, TaskUpdate
from .session import LOADING, STOPPING, BridgeSession

logger = logging.getLogger(__name__)

_SHUTDOWN_WAIT_S = 15.0


@functools.lru_cache(maxsize=1)
def _lerobot_version() -> str | None:
    try:
        import lerobot
    except Exception:
        return None
    version = getattr(lerobot, "__version__", None)
    return str(version) if version else None


class SessionManager:
    """Holds at most one session that still owns hardware."""

    def __init__(self, backend_factory: Callable[[], RolloutBackend], snapshot_dir: Path) -> None:
        self._backend_factory = backend_factory
        self._snapshot_dir = snapshot_dir
        self._lock = threading.Lock()
        self.current: BridgeSession | None = None

    def create(self, spec: SessionCreate) -> BridgeSession:
        with self._lock:
            current = self.current
            if current is not None and not current.torn_down:
                raise BridgeError(
                    SESSION_ACTIVE,
                    "a robot session is already active",
                    hint=f"stop session {current.session_id} first",
                    status=409,
                )
            if spec.robot.max_relative_target is None:
                raise BridgeError(
                    MAX_RELATIVE_TARGET_REQUIRED,
                    "robot.max_relative_target is required",
                    hint="set a per-step motion limit for this robot",
                    status=400,
                )
            session = BridgeSession(
                "rs-" + secrets.token_hex(6), spec, self._backend_factory(), self._snapshot_dir
            )
            self.current = session
        session.begin_load()
        return session

    def get(self, sid: str) -> BridgeSession:
        with self._lock:
            current = self.current
        if current is None or current.session_id != sid:
            raise BridgeError(NOT_FOUND, f"session {sid} not found", status=404)
        return current

    def shutdown(self) -> None:
        with self._lock:
            current = self.current
        if current is None or current.torn_down:
            return
        logger.info("shutting down: stopping session %s", current.session_id)
        current.stop()
        if current.wait_torn_down(_SHUTDOWN_WAIT_S):
            logger.info("session %s stopped: pose_check=%s", current.session_id, current.status()["pose_check"])
        else:
            logger.error("session %s did not finish tearing down within %.0fs", current.session_id, _SHUTDOWN_WAIT_S)


def create_app(
    *,
    token: str,
    backend_factory: Callable[[], RolloutBackend],
    snapshot_dir: Path,
    backend_name: str = "fake",
) -> FastAPI:
    if not token:
        raise ValueError("token must not be empty")
    manager = SessionManager(backend_factory, Path(snapshot_dir))
    expected = token.encode("utf-8")

    def require_token(authorization: str | None = Header(default=None)) -> None:
        scheme, _, provided = (authorization or "").partition(" ")
        if scheme.lower() != "bearer" or not hmac.compare_digest(provided.strip().encode("utf-8"), expected):
            raise BridgeError(UNAUTHORIZED, "invalid or missing bearer token", status=401)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        await asyncio.to_thread(manager.shutdown)

    app = FastAPI(
        title="agx-robot-bridge",
        version=__version__,
        lifespan=lifespan,
        dependencies=[Depends(require_token)],
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.manager = manager

    @app.exception_handler(BridgeError)
    async def _bridge_error(_request: Request, exc: BridgeError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status,
            content={"ok": False, "error_code": exc.code, "error": exc.message, "hint": exc.hint},
        )

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "version": __version__,
            "backend": backend_name,
            "python": platform.python_version(),
            "lerobot_version": _lerobot_version(),
        }

    @app.post("/session", status_code=202)
    def create_session(body: SessionCreate) -> dict[str, Any]:
        session = manager.create(body)
        return {"ok": True, "session_id": session.session_id, "state": LOADING}

    @app.get("/session/{sid}")
    def get_session(sid: str, since: int = 0) -> dict[str, Any]:
        return {"ok": True, **manager.get(sid).status(since)}

    @app.post("/session/{sid}/start")
    def start(sid: str) -> dict[str, Any]:
        return {"ok": True, **manager.get(sid).start()}

    @app.post("/session/{sid}/task")
    def set_task(sid: str, body: TaskUpdate) -> dict[str, Any]:
        return {"ok": True, **manager.get(sid).set_task(body.task)}

    @app.post("/session/{sid}/reset")
    def reset(sid: str) -> dict[str, Any]:
        return {"ok": True, **manager.get(sid).reset()}

    @app.post("/session/{sid}/stop")
    def stop(sid: str) -> JSONResponse:
        result = manager.get(sid).stop()
        return JSONResponse(status_code=202 if result["state"] == STOPPING else 200, content={"ok": True, **result})

    @app.get("/session/{sid}/snapshot")
    def snapshot(sid: str, camera: str | None = None) -> dict[str, Any]:
        return {"ok": True, **manager.get(sid).snapshot(camera)}

    return app
