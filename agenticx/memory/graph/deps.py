#!/usr/bin/env python3
"""Optional graphiti dependency bootstrap for the active agx serve interpreter.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import sys
from typing import Optional

logger = logging.getLogger(__name__)

_GRAPHITI_SPEC = "graphiti-core[kuzu]>=0.29.1,<0.30"
_install_attempted = False
_install_lock = asyncio.Lock()


def graphiti_install_hint() -> str:
    """Return a pip command that targets the running backend Python."""
    return f'{sys.executable} -m pip install "{_GRAPHITI_SPEC}"'


def is_frozen_runtime() -> bool:
    return bool(getattr(sys, "frozen", False))


def auto_install_allowed() -> bool:
    if is_frozen_runtime():
        return False
    raw = os.environ.get("AGX_MEMORY_GRAPH_AUTO_INSTALL", "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _pip_install_graphiti_sync() -> bool:
    """Install graphiti-core into sys.executable; return True if import succeeds after."""
    try:
        from agenticx.memory.graph.store import graphiti_available
    except Exception:
        graphiti_available = None  # type: ignore[assignment,misc]

    if graphiti_available and graphiti_available():
        return True

    logger.info("memory graph: installing graphiti-core into %s", sys.executable)
    proc = subprocess.run(
        [sys.executable, "-m", "pip", "install", _GRAPHITI_SPEC],
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()
        snippet = tail[-1] if tail else f"exit {proc.returncode}"
        logger.warning("memory graph: graphiti-core install failed: %s", snippet)
        return False

    if graphiti_available and graphiti_available():
        logger.info("memory graph: graphiti-core ready")
        return True
    logger.warning("memory graph: pip succeeded but graphiti_core still not importable")
    return False


async def ensure_graphiti_if_enabled(*, force: bool = False) -> bool:
    """When memory_graph.enabled, ensure graphiti-core is importable in this process."""
    global _install_attempted

    from agenticx.memory.graph.config import load_memory_graph_config
    from agenticx.memory.graph.store import graphiti_available

    cfg = load_memory_graph_config()
    if not cfg.enabled:
        return False
    if graphiti_available():
        return True
    if not auto_install_allowed() and not force:
        return False

    async with _install_lock:
        if graphiti_available():
            return True
        if _install_attempted and not force:
            return graphiti_available()
        _install_attempted = True
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _pip_install_graphiti_sync)


def graphiti_runtime_info() -> dict[str, Optional[str]]:
    from agenticx.memory.graph.store import graphiti_available

    installed = graphiti_available()
    hint = None if installed else graphiti_install_hint()
    if not installed and is_frozen_runtime():
        hint = "当前为打包后端，需在构建时打入 graphiti-core 可选依赖"
    return {
        "python_executable": sys.executable,
        "install_hint": hint,
        "auto_install_allowed": auto_install_allowed(),
    }
