#!/usr/bin/env python3
"""Start/stop long-running orchestration when Studio enables it.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING, Optional

from agenticx.cli.config_manager import ConfigManager

if TYPE_CHECKING:
    from fastapi import FastAPI

logger = logging.getLogger(__name__)


def longrun_runtime_enabled() -> bool:
    """Honor ``AGX_LONGRUN_ENABLED=1`` or ``longrun.enabled`` in merged YAML."""
    if os.getenv("AGX_LONGRUN_ENABLED", "").strip() == "1":
        return True
    try:
        return bool(ConfigManager.load().longrun.enabled)
    except Exception:
        return False


async def maybe_start_longrun(app: "FastAPI") -> Optional[asyncio.Task[None]]:
    """Attach routes + background poll loop when enabled."""
    if not longrun_runtime_enabled():
        return None
    from agenticx.longrun.studio_routes import attach_longrun

    try:
        return await attach_longrun(app)
    except Exception:
        logger.warning("longrun bootstrap failed", exc_info=True)
        return None


def resolve_longrun_workspace_root() -> Path:
    raw = "~/.agenticx/task-workspaces"
    try:
        raw = ConfigManager.load().longrun.workspace_root or raw
    except Exception:
        pass
    return Path(str(raw)).expanduser()


def resolve_worker_session_id() -> str:
    try:
        sid = str(ConfigManager.load().longrun.worker_session_id or "").strip()
        return sid or "__longrun_worker__"
    except Exception:
        return "__longrun_worker__"
