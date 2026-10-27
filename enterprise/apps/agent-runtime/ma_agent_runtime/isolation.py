#!/usr/bin/env python3
"""Process HOME isolation and OS command-sandbox probe.

Author: Damon Li
"""

from __future__ import annotations

import logging
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.command_sandbox import CommandSandboxUnavailable, build_command_sandbox_plan

logger = logging.getLogger(__name__)

RUNTIME_CONFIG_YAML = (
    "# Managed by agent-runtime; rewritten on every start. Do not edit.\n"
    "permissions:\n"
    "  command_permissions: workspace-write\n"
)


class RuntimeIsolationError(RuntimeError):
    """The process is not isolated enough to execute hosted tools."""


def ensure_isolated_home(home: Path) -> Path:
    """Require HOME == MA_RUNTIME_HOME and create the session root."""
    if not home.is_absolute():
        raise RuntimeIsolationError("MA_RUNTIME_HOME must be an absolute path")
    if Path.home().resolve() != home.resolve():
        raise RuntimeIsolationError("HOME must equal MA_RUNTIME_HOME before the runtime starts")
    sessions = home / ".agenticx" / "sessions"
    sessions.mkdir(parents=True, exist_ok=True)
    return home / ".agenticx"


def write_runtime_config(home: Path) -> Path:
    """Overwrite the isolated config so bash uses workspace-write."""
    path = home / ".agenticx" / "config.yaml"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(RUNTIME_CONFIG_YAML, encoding="utf-8")
    path.chmod(0o600)
    invalidate = getattr(ConfigManager, "_invalidate_yaml_cache", None)
    if callable(invalidate):
        invalidate(None)
    return path


def probe_command_sandbox(
    home: Path,
    *,
    mode: Literal["required", "best_effort"],
    platform_name: str | None = None,
    runner: Callable[..., Any] = subprocess.run,
) -> str:
    """Return the sandbox backend name, or ``none`` in best-effort mode."""
    probe_dir = home / ".agenticx" / "sandbox-probe"
    probe_dir.mkdir(parents=True, exist_ok=True)
    try:
        plan = build_command_sandbox_plan(
            ["/bin/sh", "-c", "true"],
            permissions="workspace-write",
            writable_roots=[probe_dir],
            readable_roots=[probe_dir],
            scope_id="ma-runtime-probe",
            cwd=probe_dir,
            platform_name=platform_name,
        )
        proc = runner(
            list(plan.argv),
            env=dict(plan.env),
            cwd=str(probe_dir),
            timeout=15,
            capture_output=True,
        )
        ok = proc.returncode == 0
        backend = plan.backend
        stderr = getattr(proc, "stderr", b"") or b""
        detail = stderr[-300:].decode("utf-8", "replace")
    except CommandSandboxUnavailable as exc:
        ok, backend, detail = False, "none", str(exc)
    except Exception as exc:
        ok, backend, detail = False, "none", f"{type(exc).__name__}: {exc}"
    if ok:
        logger.info("command sandbox ready backend=%s", backend)
        return backend
    if mode == "required":
        raise RuntimeIsolationError(
            "command sandbox unavailable ("
            f"{detail}); set MA_RUNTIME_COMMAND_SANDBOX=best_effort only on a trusted development host"
        )
    logger.warning(
        "command sandbox unavailable; bash_exec will run WITHOUT OS isolation (best_effort)"
    )
    return "none"


__all__ = [
    "RUNTIME_CONFIG_YAML",
    "RuntimeIsolationError",
    "ensure_isolated_home",
    "probe_command_sandbox",
    "write_runtime_config",
]
