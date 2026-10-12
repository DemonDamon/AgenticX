#!/usr/bin/env python3
"""TypeSafe (Jev) settings and connectivity probe — not a chat provider."""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from agenticx.cli.config_manager import ConfigManager
from agenticx.llms.typesafe_client import TypesafeHttpError, TypesafeTimeout, system_one
from agenticx.llms.typesafe_config import (
    load_typesafe_settings,
    resolve_typesafe_api_key,
    typesafe_settings_public_dict,
)

logger = logging.getLogger(__name__)

_SETTABLE_FIELDS = (
    "enabled",
    "model",
    "timeout_sec",
    "soft_timeout_sec",
    "group_routing",
    "kb_auto",
    "show_decision_card",
    "act_above",
    "review_above",
)


def _apply_typesafe_patch(payload: dict[str, Any]) -> dict[str, Any]:
    if "api_key" in payload:
        raw = payload.get("api_key")
        ConfigManager.set_value("typesafe.api_key", "" if raw is None else str(raw), scope="global")
    for field in _SETTABLE_FIELDS:
        if field not in payload:
            continue
        ConfigManager.set_value(f"typesafe.{field}", payload[field], scope="global")
    return typesafe_settings_public_dict()


def register_typesafe_routes(app: FastAPI) -> None:
    @app.get("/api/typesafe/settings")
    async def get_typesafe_settings() -> dict[str, Any]:
        return typesafe_settings_public_dict()

    @app.put("/api/typesafe/settings")
    async def put_typesafe_settings(payload: dict[str, Any] | None = None) -> dict[str, Any]:
        body = payload if isinstance(payload, dict) else {}
        return _apply_typesafe_patch(body)

    @app.post("/api/typesafe/test")
    async def test_typesafe() -> Any:
        settings = load_typesafe_settings()
        api_key = resolve_typesafe_api_key()
        if not api_key:
            return JSONResponse(
                {"ok": False, "model": "", "latency_ms": 0, "error": "未配置密钥"},
                status_code=400,
            )
        started = time.perf_counter()
        try:
            data = await system_one(
                state="ping",
                questions={
                    "ok": {
                        "type": "noul",
                        "instructions": "Is this a connectivity probe?",
                    }
                },
                model=settings.model,
                api_key=api_key,
                timeout_sec=settings.timeout_sec,
                base_url=settings.base_url,
            )
        except TypesafeTimeout as exc:
            latency_ms = int((time.perf_counter() - started) * 1000)
            return JSONResponse(
                {"ok": False, "model": "", "latency_ms": latency_ms, "error": str(exc)},
                status_code=408,
            )
        except TypesafeHttpError as exc:
            latency_ms = int((time.perf_counter() - started) * 1000)
            status = exc.status_code if 400 <= int(exc.status_code) < 600 else 400
            if exc.status_code == 401:
                status = 401
            return JSONResponse(
                {
                    "ok": False,
                    "model": "",
                    "latency_ms": latency_ms,
                    "error": exc.message or f"HTTP {exc.status_code}",
                },
                status_code=status,
            )
        except Exception as exc:
            logger.warning("typesafe probe failed: %s", exc)
            latency_ms = int((time.perf_counter() - started) * 1000)
            return JSONResponse(
                {"ok": False, "model": "", "latency_ms": latency_ms, "error": str(exc)},
                status_code=400,
            )
        latency_ms = int((time.perf_counter() - started) * 1000)
        model = str(data.get("model") or settings.model).strip()
        return {"ok": True, "model": model, "latency_ms": latency_ms, "error": ""}
